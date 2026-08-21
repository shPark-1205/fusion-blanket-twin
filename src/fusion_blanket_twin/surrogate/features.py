"""Feature extraction for scalar surrogates from the CaseRegistry."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from fusion_blanket_twin.data.case_registry import CaseRegistry


SCALAR_OUTPUTS: tuple[str, ...] = ("total_tbr", "li6_tbr", "li7_tbr", "multiplying")
FEATURE_NAMES: tuple[str, str] = ("pz_206", "cz_301_radius")


@dataclass(frozen=True)
class ScalarSurrogateDataset:
    case_ids: tuple[str, ...]
    feature_names: tuple[str, str]
    X: np.ndarray
    outputs: dict[str, np.ndarray]
    pz_case_numbers: np.ndarray
    cz_labels: tuple[str, ...]

    @property
    def output_names(self) -> tuple[str, ...]:
        return tuple(self.outputs)

    def output(self, name: str) -> np.ndarray:
        return self.outputs[name]


@dataclass(frozen=True)
class DatasetSanityReport:
    case_count: int
    unique_coordinate_count: int
    unique_pz_206_count: int
    unique_cz_301_radius_count: int
    scalar_nan_counts: dict[str, int]
    input_ranges: dict[str, tuple[float, float]]
    output_ranges: dict[str, tuple[float, float]]
    issues: tuple[str, ...]

    @property
    def is_valid(self) -> bool:
        return not self.issues


def load_dataset_from_registry(
    input_dir: Path,
    workbook_path: Path,
) -> ScalarSurrogateDataset:
    registry = CaseRegistry.from_input_directory(input_dir).with_scalar_results(workbook_path)
    return extract_dataset_from_registry(registry)


def extract_dataset_from_registry(registry: CaseRegistry) -> ScalarSurrogateDataset:
    records = registry.records
    case_ids = tuple(record.case_id for record in records)
    X = np.asarray(
        [
            [record.primitive_csg.pz_206, record.primitive_csg.cz_301_radius]
            for record in records
        ],
        dtype=float,
    )
    outputs = {
        name: np.asarray([getattr(record, name) for record in records], dtype=float)
        for name in SCALAR_OUTPUTS
    }
    return ScalarSurrogateDataset(
        case_ids=case_ids,
        feature_names=FEATURE_NAMES,
        X=X,
        outputs=outputs,
        pz_case_numbers=np.asarray(
            [record.identity.pz_case_number for record in records], dtype=int
        ),
        cz_labels=tuple(record.identity.cz_label for record in records),
    )


def validate_scalar_dataset(dataset: ScalarSurrogateDataset) -> DatasetSanityReport:
    issues: list[str] = []
    X = dataset.X
    case_count = len(dataset.case_ids)
    unique_coordinates = {tuple(row) for row in X.tolist()}
    unique_pz = sorted(set(X[:, 0]))
    unique_cz = sorted(set(X[:, 1]))

    if case_count != 100:
        issues.append(f"expected 100 cases, found {case_count}")
    if len(unique_coordinates) != case_count:
        issues.append("input coordinates are not unique")
    if len(unique_pz) != 10:
        issues.append(f"expected 10 pz_206 levels, found {len(unique_pz)}")
    if len(unique_cz) != 10:
        issues.append(f"expected 10 cz_301_radius levels, found {len(unique_cz)}")

    scalar_nan_counts = {
        name: int(np.isnan(values).sum())
        for name, values in dataset.outputs.items()
    }
    for name, count in scalar_nan_counts.items():
        if count:
            issues.append(f"{name} contains {count} NaN values")

    return DatasetSanityReport(
        case_count=case_count,
        unique_coordinate_count=len(unique_coordinates),
        unique_pz_206_count=len(unique_pz),
        unique_cz_301_radius_count=len(unique_cz),
        scalar_nan_counts=scalar_nan_counts,
        input_ranges={
            dataset.feature_names[0]: (float(np.min(X[:, 0])), float(np.max(X[:, 0]))),
            dataset.feature_names[1]: (float(np.min(X[:, 1])), float(np.max(X[:, 1]))),
        },
        output_ranges={
            name: (float(np.min(values)), float(np.max(values)))
            for name, values in dataset.outputs.items()
        },
        issues=tuple(issues),
    )

