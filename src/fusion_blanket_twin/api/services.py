"""Lifecycle-managed scientific service loading for the HTTP adapter."""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
from time import perf_counter

from fusion_blanket_twin.config.settings import PROJECT_ROOT
from fusion_blanket_twin.surrogate.service import ScalarPredictionService


DEFAULT_INPUT_DIR = PROJECT_ROOT / "data" / "local" / "mcnp_inputs"
DEFAULT_WORKBOOK_PATH = (
    PROJECT_ROOT / "data" / "local" / "fusion_blanket_twin_100case_results_parsed.xlsx"
)


@dataclass(frozen=True)
class ApiSettings:
    input_dir: Path
    workbook_path: Path

    @classmethod
    def from_environment(cls) -> "ApiSettings":
        return cls(
            input_dir=Path(os.getenv("TWIN_MCNP_INPUT_DIR", str(DEFAULT_INPUT_DIR))),
            workbook_path=Path(os.getenv("TWIN_SCALAR_WORKBOOK", str(DEFAULT_WORKBOOK_PATH))),
        )


@dataclass(frozen=True)
class TwinServices:
    scalar_prediction: ScalarPredictionService | None
    startup_seconds: float
    error: str | None = None

    @property
    def case_count(self) -> int:
        return len(self.scalar_prediction.registry) if self.scalar_prediction is not None else 0


def load_twin_services(settings: ApiSettings | None = None) -> TwinServices:
    """Build reusable scientific services once for the FastAPI lifespan."""

    started = perf_counter()
    selected = settings or ApiSettings.from_environment()
    try:
        predictor = ScalarPredictionService.from_paths(
            selected.input_dir,
            selected.workbook_path,
        )
    except (FileNotFoundError, ValueError) as exc:
        return TwinServices(
            scalar_prediction=None,
            startup_seconds=perf_counter() - started,
            error=str(exc),
        )
    return TwinServices(
        scalar_prediction=predictor,
        startup_seconds=perf_counter() - started,
    )
