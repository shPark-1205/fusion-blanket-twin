"""Benchmark metrics for scalar surrogate validation."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class RegressionMetrics:
    mae: float
    rmse: float
    max_abs_error: float
    r2: float | None
    mape_percent: float | None
    worst_case_id: str


def calculate_regression_metrics(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    case_ids: tuple[str, ...] | list[str],
    percentage_floor: float = 1.0e-12,
) -> RegressionMetrics:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    if y_true.shape != y_pred.shape:
        raise ValueError(f"shape mismatch: y_true {y_true.shape}, y_pred {y_pred.shape}")
    if y_true.ndim != 1:
        raise ValueError("regression metrics expect one-dimensional arrays")
    if len(case_ids) != len(y_true):
        raise ValueError("case ID count does not match target count")

    error = y_pred - y_true
    abs_error = np.abs(error)
    worst_index = int(np.argmax(abs_error))
    ss_res = float(np.sum(error**2))
    ss_tot = float(np.sum((y_true - np.mean(y_true)) ** 2))
    r2 = None if ss_tot <= 0.0 else 1.0 - ss_res / ss_tot
    if np.any(np.abs(y_true) <= percentage_floor):
        mape = None
    else:
        mape = float(np.mean(abs_error / np.abs(y_true)) * 100.0)

    return RegressionMetrics(
        mae=float(np.mean(abs_error)),
        rmse=float(np.sqrt(np.mean(error**2))),
        max_abs_error=float(np.max(abs_error)),
        r2=r2,
        mape_percent=mape,
        worst_case_id=str(case_ids[worst_index]),
    )

