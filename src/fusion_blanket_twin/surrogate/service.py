"""Production-facing scalar KPI prediction service."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np

from fusion_blanket_twin.data.case_registry import CaseRecord, CaseRegistry
from fusion_blanket_twin.surrogate.features import SCALAR_OUTPUTS, extract_dataset_from_registry
from fusion_blanket_twin.surrogate.models import PolynomialResponseSurface, ScalarSurrogate


PREDICTION_OUTPUT_LABELS: dict[str, str] = {
    "total_tbr": "Total TBR",
    "li6_tbr": "Li-6 TBR",
    "li7_tbr": "Li-7 TBR",
    "multiplying": "Multiplying",
}


class ScalarModelFactory(Protocol):
    def __call__(self) -> ScalarSurrogate:
        ...


@dataclass(frozen=True)
class ScalarKpis:
    total_tbr: float
    li6_tbr: float
    li7_tbr: float
    multiplying: float

    def as_dict(self) -> dict[str, float]:
        return {
            "total_tbr": self.total_tbr,
            "li6_tbr": self.li6_tbr,
            "li7_tbr": self.li7_tbr,
            "multiplying": self.multiplying,
        }


@dataclass(frozen=True)
class ScalarPredictionMetadata:
    source: str
    status: str
    domain_status: str
    warning: str | None
    nearest_case_id: str
    nearest_case_distance: float
    model_name: str
    model_metadata: dict[str, object]
    input_units: dict[str, str]


@dataclass(frozen=True)
class ScalarPrediction:
    pz_206: float
    cz_301_radius: float
    kpis: ScalarKpis
    metadata: ScalarPredictionMetadata


class ScalarPredictionService:
    """Predict scalar blanket KPIs for the current two-axis DOE coordinates."""

    def __init__(
        self,
        registry: CaseRegistry,
        model_factory: ScalarModelFactory | None = None,
        exact_tolerance: float = 1.0e-10,
    ) -> None:
        self.registry = registry
        self.exact_tolerance = exact_tolerance
        self.dataset = extract_dataset_from_registry(registry)
        self._case_by_coordinate = self._build_exact_coordinate_index(registry)
        self._models = {}
        self._model_factory = model_factory or (lambda: PolynomialResponseSurface(3))
        self._fit_models()

        self.domain_min = np.min(self.dataset.X, axis=0)
        self.domain_max = np.max(self.dataset.X, axis=0)
        self.domain_ranges = np.where(
            self.domain_max - self.domain_min == 0.0,
            1.0,
            self.domain_max - self.domain_min,
        )

    @classmethod
    def from_paths(
        cls,
        input_dir: Path,
        workbook_path: Path,
        model_factory: ScalarModelFactory | None = None,
    ) -> "ScalarPredictionService":
        registry = CaseRegistry.from_input_directory(input_dir).with_scalar_results(workbook_path)
        return cls(registry, model_factory=model_factory)

    @property
    def output_names(self) -> tuple[str, ...]:
        return SCALAR_OUTPUTS

    def predict(self, pz_206: float, cz_301_radius: float) -> ScalarPrediction:
        point = np.asarray([float(pz_206), float(cz_301_radius)], dtype=float)
        exact_case = self._find_exact_case(point)
        nearest_case, distance = self._nearest_case(point)
        domain_status = self._domain_status(point, exact_case is not None)

        if exact_case is not None:
            kpis = _kpis_from_case_record(exact_case)
            source = "simulation"
            status = "exact"
            model_name = "exact_case_lookup"
            model_metadata: dict[str, object] = {}
        else:
            predictions = {
                output_name: float(model.predict(point.reshape(1, -1))[0])
                for output_name, model in self._models.items()
            }
            kpis = ScalarKpis(**predictions)
            source = "surrogate"
            status = "predicted"
            model_name = "degree_3_polynomial_scalar_service"
            model_metadata = {
                output_name: dict(model.metadata)
                for output_name, model in self._models.items()
            }

        warning = (
            "Input is outside the scalar-surrogate training domain."
            if domain_status == "extrapolation"
            else None
        )
        return ScalarPrediction(
            pz_206=float(point[0]),
            cz_301_radius=float(point[1]),
            kpis=kpis,
            metadata=ScalarPredictionMetadata(
                source=source,
                status=status,
                domain_status=domain_status,
                warning=warning,
                nearest_case_id=nearest_case.case_id,
                nearest_case_distance=distance,
                model_name=model_name,
                model_metadata=model_metadata,
                input_units={"pz_206": "cm", "cz_301_radius": "cm"},
            ),
        )

    def _fit_models(self) -> None:
        for output_name in SCALAR_OUTPUTS:
            model = self._model_factory()
            model.fit(self.dataset.X, self.dataset.output(output_name))
            self._models[output_name] = model

    def _build_exact_coordinate_index(self, registry: CaseRegistry) -> dict[tuple[float, float], CaseRecord]:
        return {
            (record.primitive_csg.pz_206, record.primitive_csg.cz_301_radius): record
            for record in registry.records
        }

    def _find_exact_case(self, point: np.ndarray) -> CaseRecord | None:
        for coordinate, record in self._case_by_coordinate.items():
            if np.allclose(point, coordinate, rtol=0.0, atol=self.exact_tolerance):
                return record
        return None

    def _nearest_case(self, point: np.ndarray) -> tuple[CaseRecord, float]:
        scaled = (self.dataset.X - point) / self.domain_ranges
        distances = np.sqrt(np.sum(scaled * scaled, axis=1))
        nearest_index = int(np.argmin(distances))
        nearest_id = self.dataset.case_ids[nearest_index]
        return self.registry.by_case_id[nearest_id], float(distances[nearest_index])

    def _domain_status(self, point: np.ndarray, is_exact_case: bool) -> str:
        outside = np.any((point < self.domain_min) | (point > self.domain_max))
        if outside:
            return "extrapolation"
        if is_exact_case:
            return "exact"
        on_boundary = np.any(
            np.isclose(point, self.domain_min, rtol=0.0, atol=self.exact_tolerance)
            | np.isclose(point, self.domain_max, rtol=0.0, atol=self.exact_tolerance)
        )
        return "boundary" if on_boundary else "interpolation"


def _kpis_from_case_record(record: CaseRecord) -> ScalarKpis:
    if (
        record.total_tbr is None
        or record.li6_tbr is None
        or record.li7_tbr is None
        or record.multiplying is None
    ):
        raise ValueError(f"case {record.case_id} has incomplete scalar results")
    return ScalarKpis(
        total_tbr=record.total_tbr,
        li6_tbr=record.li6_tbr,
        li7_tbr=record.li7_tbr,
        multiplying=record.multiplying,
    )

