"""Lightweight scalar surrogate model implementations."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np


class ScalarSurrogate(Protocol):
    name: str
    metadata: dict[str, object]

    def fit(self, X: np.ndarray, y: np.ndarray) -> "ScalarSurrogate":
        ...

    def predict(self, X: np.ndarray) -> np.ndarray:
        ...

    def in_domain_mask(self, X: np.ndarray) -> np.ndarray:
        ...


@dataclass
class _InputScaler:
    mean: np.ndarray | None = None
    scale: np.ndarray | None = None

    def fit(self, X: np.ndarray) -> "_InputScaler":
        self.mean = np.mean(X, axis=0)
        scale = np.std(X, axis=0)
        self.scale = np.where(scale == 0.0, 1.0, scale)
        return self

    def transform(self, X: np.ndarray) -> np.ndarray:
        if self.mean is None or self.scale is None:
            raise RuntimeError("input scaler is not fitted")
        return (np.asarray(X, dtype=float) - self.mean) / self.scale


class _BaseModel:
    name: str
    metadata: dict[str, object]

    def __init__(self) -> None:
        self._x_min: np.ndarray | None = None
        self._x_max: np.ndarray | None = None

    def _record_domain(self, X: np.ndarray) -> None:
        self._x_min = np.min(X, axis=0)
        self._x_max = np.max(X, axis=0)

    def in_domain_mask(self, X: np.ndarray) -> np.ndarray:
        if self._x_min is None or self._x_max is None:
            raise RuntimeError("model is not fitted")
        X = np.asarray(X, dtype=float)
        return np.all((self._x_min <= X) & (X <= self._x_max), axis=1)


class PolynomialResponseSurface(_BaseModel):
    def __init__(self, degree: int) -> None:
        super().__init__()
        if degree < 1:
            raise ValueError("polynomial degree must be positive")
        self.degree = degree
        self.name = f"polynomial_degree_{degree}"
        self.metadata = {
            "family": "polynomial_response_surface",
            "degree": degree,
            "input_scaling": "standard",
            "target_transform": "none",
        }
        self._scaler = _InputScaler()
        self._powers = _polynomial_powers(degree)
        self._coef: np.ndarray | None = None

    def fit(self, X: np.ndarray, y: np.ndarray) -> "PolynomialResponseSurface":
        X = np.asarray(X, dtype=float)
        y = np.asarray(y, dtype=float)
        self._record_domain(X)
        Xs = self._scaler.fit(X).transform(X)
        phi = _polynomial_design_matrix(Xs, self._powers)
        self._coef = np.linalg.lstsq(phi, y, rcond=None)[0]
        return self

    def predict(self, X: np.ndarray) -> np.ndarray:
        if self._coef is None:
            raise RuntimeError("model is not fitted")
        Xs = self._scaler.transform(np.asarray(X, dtype=float))
        return _polynomial_design_matrix(Xs, self._powers) @ self._coef


class RBFRegressor(_BaseModel):
    def __init__(self, ridge: float = 1.0e-10) -> None:
        super().__init__()
        self.ridge = ridge
        self.name = "rbf_gaussian"
        self.metadata = {
            "family": "radial_basis_function",
            "kernel": "gaussian",
            "ridge": ridge,
            "input_scaling": "standard",
            "target_transform": "none",
        }
        self._scaler = _InputScaler()
        self._centers: np.ndarray | None = None
        self._weights: np.ndarray | None = None
        self._epsilon: float | None = None

    def fit(self, X: np.ndarray, y: np.ndarray) -> "RBFRegressor":
        X = np.asarray(X, dtype=float)
        y = np.asarray(y, dtype=float)
        self._record_domain(X)
        Xs = self._scaler.fit(X).transform(X)
        self._centers = Xs
        self._epsilon = _median_pairwise_distance(Xs)
        kernel = _gaussian_kernel(_pairwise_distances(Xs, Xs), self._epsilon)
        kernel += np.eye(len(Xs)) * self.ridge
        self._weights = np.linalg.solve(kernel, y)
        self.metadata["epsilon"] = self._epsilon
        return self

    def predict(self, X: np.ndarray) -> np.ndarray:
        if self._centers is None or self._weights is None or self._epsilon is None:
            raise RuntimeError("model is not fitted")
        Xs = self._scaler.transform(np.asarray(X, dtype=float))
        kernel = _gaussian_kernel(_pairwise_distances(Xs, self._centers), self._epsilon)
        return kernel @ self._weights


class GaussianProcessRegressor(_BaseModel):
    def __init__(self, alpha: float = 1.0e-8) -> None:
        super().__init__()
        self.alpha = alpha
        self.name = "gaussian_process_rbf"
        self.metadata = {
            "family": "gaussian_process_regression",
            "kernel": "squared_exponential",
            "alpha": alpha,
            "input_scaling": "standard",
            "target_transform": "standardized_mean_variance",
        }
        self._scaler = _InputScaler()
        self._X_train: np.ndarray | None = None
        self._alpha_weights: np.ndarray | None = None
        self._length_scale: float | None = None
        self._y_mean = 0.0
        self._y_scale = 1.0

    def fit(self, X: np.ndarray, y: np.ndarray) -> "GaussianProcessRegressor":
        X = np.asarray(X, dtype=float)
        y = np.asarray(y, dtype=float)
        self._record_domain(X)
        Xs = self._scaler.fit(X).transform(X)
        self._X_train = Xs
        self._length_scale = _median_pairwise_distance(Xs)
        self._y_mean = float(np.mean(y))
        y_std = float(np.std(y))
        self._y_scale = 1.0 if y_std == 0.0 else y_std
        y_scaled = (y - self._y_mean) / self._y_scale
        kernel = _squared_exponential_kernel(
            _pairwise_distances(Xs, Xs),
            self._length_scale,
        )
        kernel += np.eye(len(Xs)) * self.alpha
        self._alpha_weights = np.linalg.solve(kernel, y_scaled)
        self.metadata["length_scale"] = self._length_scale
        self.metadata["target_mean"] = self._y_mean
        self.metadata["target_scale"] = self._y_scale
        return self

    def predict(self, X: np.ndarray) -> np.ndarray:
        if self._X_train is None or self._alpha_weights is None or self._length_scale is None:
            raise RuntimeError("model is not fitted")
        Xs = self._scaler.transform(np.asarray(X, dtype=float))
        kernel = _squared_exponential_kernel(
            _pairwise_distances(Xs, self._X_train),
            self._length_scale,
        )
        return (kernel @ self._alpha_weights) * self._y_scale + self._y_mean


class StructuredGridBilinear(_BaseModel):
    def __init__(self) -> None:
        super().__init__()
        self.name = "structured_grid_bilinear"
        self.metadata = {
            "family": "structured_grid_interpolation",
            "method": "bilinear_with_linear_edge_extrapolation",
            "input_scaling": "none",
            "target_transform": "none",
        }
        self._x_levels: np.ndarray | None = None
        self._y_levels: np.ndarray | None = None
        self._grid: np.ndarray | None = None

    def fit(self, X: np.ndarray, y: np.ndarray) -> "StructuredGridBilinear":
        X = np.asarray(X, dtype=float)
        y = np.asarray(y, dtype=float)
        self._record_domain(X)
        x_levels = np.asarray(sorted(set(X[:, 0])), dtype=float)
        y_levels = np.asarray(sorted(set(X[:, 1])), dtype=float)
        expected = len(x_levels) * len(y_levels)
        if expected != len(X):
            raise ValueError("structured-grid bilinear model requires a complete tensor grid")

        grid = np.full((len(x_levels), len(y_levels)), np.nan, dtype=float)
        x_index = {value: index for index, value in enumerate(x_levels)}
        y_index = {value: index for index, value in enumerate(y_levels)}
        for point, value in zip(X, y):
            grid[x_index[point[0]], y_index[point[1]]] = value
        if np.isnan(grid).any():
            raise ValueError("structured-grid bilinear model has missing grid values")

        self._x_levels = x_levels
        self._y_levels = y_levels
        self._grid = grid
        return self

    def predict(self, X: np.ndarray) -> np.ndarray:
        if self._x_levels is None or self._y_levels is None or self._grid is None:
            raise RuntimeError("model is not fitted")
        X = np.asarray(X, dtype=float)
        return np.asarray(
            [
                _bilinear_predict_one(point[0], point[1], self._x_levels, self._y_levels, self._grid)
                for point in X
            ],
            dtype=float,
        )


def default_model_factories() -> tuple[tuple[str, object], ...]:
    return (
        ("polynomial_degree_1", lambda: PolynomialResponseSurface(1)),
        ("polynomial_degree_2", lambda: PolynomialResponseSurface(2)),
        ("polynomial_degree_3", lambda: PolynomialResponseSurface(3)),
        ("rbf_gaussian", RBFRegressor),
        ("gaussian_process_rbf", GaussianProcessRegressor),
        ("structured_grid_bilinear", StructuredGridBilinear),
    )


def _polynomial_powers(degree: int) -> tuple[tuple[int, int], ...]:
    powers: list[tuple[int, int]] = []
    for total_degree in range(degree + 1):
        for power_x in range(total_degree + 1):
            powers.append((power_x, total_degree - power_x))
    return tuple(powers)


def _polynomial_design_matrix(X: np.ndarray, powers: tuple[tuple[int, int], ...]) -> np.ndarray:
    columns = [(X[:, 0] ** power_x) * (X[:, 1] ** power_y) for power_x, power_y in powers]
    return np.column_stack(columns)


def _pairwise_distances(left: np.ndarray, right: np.ndarray) -> np.ndarray:
    diff = left[:, None, :] - right[None, :, :]
    return np.sqrt(np.sum(diff * diff, axis=2))


def _median_pairwise_distance(X: np.ndarray) -> float:
    distances = _pairwise_distances(X, X)
    nonzero = distances[distances > 0.0]
    if len(nonzero) == 0:
        return 1.0
    return float(np.median(nonzero))


def _gaussian_kernel(distance: np.ndarray, epsilon: float) -> np.ndarray:
    return np.exp(-((distance / epsilon) ** 2))


def _squared_exponential_kernel(distance: np.ndarray, length_scale: float) -> np.ndarray:
    return np.exp(-0.5 * ((distance / length_scale) ** 2))


def _bracket(levels: np.ndarray, value: float) -> tuple[int, int, float]:
    if len(levels) < 2:
        raise ValueError("at least two levels are required for interpolation")
    upper = int(np.searchsorted(levels, value, side="right"))
    if upper <= 0:
        lower, upper = 0, 1
    elif upper >= len(levels):
        lower, upper = len(levels) - 2, len(levels) - 1
    else:
        lower = upper - 1
    x0, x1 = levels[lower], levels[upper]
    fraction = 0.0 if x1 == x0 else float((value - x0) / (x1 - x0))
    return lower, upper, fraction


def _bilinear_predict_one(
    x: float,
    y: float,
    x_levels: np.ndarray,
    y_levels: np.ndarray,
    grid: np.ndarray,
) -> float:
    x0, x1, tx = _bracket(x_levels, x)
    y0, y1, ty = _bracket(y_levels, y)
    f00 = grid[x0, y0]
    f10 = grid[x1, y0]
    f01 = grid[x0, y1]
    f11 = grid[x1, y1]
    return float(
        (1.0 - tx) * (1.0 - ty) * f00
        + tx * (1.0 - ty) * f10
        + (1.0 - tx) * ty * f01
        + tx * ty * f11
    )
