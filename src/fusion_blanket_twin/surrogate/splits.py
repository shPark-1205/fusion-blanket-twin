"""Deterministic validation splits for the 10 by 10 scalar DOE."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from fusion_blanket_twin.surrogate.features import ScalarSurrogateDataset


@dataclass(frozen=True)
class ValidationSplit:
    name: str
    family: str
    region: str
    train_indices: np.ndarray
    test_indices: np.ndarray
    heldout_axis: str | None = None
    heldout_level: str | None = None


def checkerboard_interior_split(dataset: ScalarSurrogateDataset) -> ValidationSplit:
    pz_values = sorted(set(dataset.X[:, 0]))
    cz_values = sorted(set(dataset.X[:, 1]))
    pz_index = {value: index for index, value in enumerate(pz_values)}
    cz_index = {value: index for index, value in enumerate(cz_values)}

    test: list[int] = []
    train: list[int] = []
    for index, (pz_value, cz_value) in enumerate(dataset.X):
        i = pz_index[pz_value]
        j = cz_index[cz_value]
        is_interior = 0 < i < len(pz_values) - 1 and 0 < j < len(cz_values) - 1
        if is_interior and (i + j) % 2 == 0:
            test.append(index)
        else:
            train.append(index)

    return ValidationSplit(
        name="checkerboard_interior",
        family="checkerboard",
        region="interpolation",
        train_indices=np.asarray(train, dtype=int),
        test_indices=np.asarray(test, dtype=int),
    )


def design_level_holdout_splits(dataset: ScalarSurrogateDataset) -> tuple[ValidationSplit, ...]:
    splits: list[ValidationSplit] = []
    pz_values = sorted(set(dataset.X[:, 0]))
    cz_values = sorted(set(dataset.X[:, 1]))

    for axis_name, axis_index, values in (
        ("pz_206", 0, pz_values),
        ("cz_301_radius", 1, cz_values),
    ):
        for value_index, value in enumerate(values):
            test = np.flatnonzero(dataset.X[:, axis_index] == value)
            train = np.flatnonzero(dataset.X[:, axis_index] != value)
            region = "extrapolation" if value_index in (0, len(values) - 1) else "interpolation"
            family_axis = "pz_row" if axis_name == "pz_206" else "cz_column"
            splits.append(
                ValidationSplit(
                    name=f"{family_axis}_holdout_{_format_level(value)}",
                    family=f"{family_axis}_holdout",
                    region=region,
                    train_indices=train.astype(int),
                    test_indices=test.astype(int),
                    heldout_axis=axis_name,
                    heldout_level=_format_level(value),
                )
            )
    return tuple(splits)


def all_validation_splits(dataset: ScalarSurrogateDataset) -> tuple[ValidationSplit, ...]:
    return (checkerboard_interior_split(dataset), *design_level_holdout_splits(dataset))


def assert_no_leakage(split: ValidationSplit) -> None:
    overlap = set(split.train_indices.tolist()) & set(split.test_indices.tolist())
    if overlap:
        raise ValueError(f"validation split {split.name} leaks cases: {sorted(overlap)}")


def _format_level(value: float) -> str:
    return f"{value:.12g}"

