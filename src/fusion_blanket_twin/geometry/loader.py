"""STEP geometry inspection helpers.

The v0.1 data layer only uses this parser for reproducible metadata and bounds
checks. Rendering support can later use a CAD-capable backend without changing
the coordinate convention.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re


_POINT_RE = re.compile(
    r"CARTESIAN_POINT\s*\([^,]*,\s*\(([^)]*)\)\)", re.IGNORECASE
)


@dataclass(frozen=True)
class CadGeometrySummary:
    path: Path
    point_count: int
    solid_count: int
    bounds_mm: tuple[float, float, float, float, float, float]

    @property
    def extent_mm(self) -> tuple[float, float, float]:
        xmin, xmax, ymin, ymax, zmin, zmax = self.bounds_mm
        return xmax - xmin, ymax - ymin, zmax - zmin


def read_step_summary(path: Path) -> CadGeometrySummary:
    """Read STEP coordinate bounds and solid count from a CAD file in mm."""
    if not path.exists():
        raise FileNotFoundError(f"CAD STEP file not found: {path}")
    if not path.is_file():
        raise ValueError(f"CAD STEP path is not a file: {path}")

    text = path.read_text(errors="replace")
    points = [_parse_point(match.group(1)) for match in _POINT_RE.finditer(text)]
    points = [point for point in points if point is not None]
    if not points:
        raise ValueError(f"No CARTESIAN_POINT coordinates found in STEP file: {path}")

    mins = tuple(min(point[i] for point in points) for i in range(3))
    maxs = tuple(max(point[i] for point in points) for i in range(3))
    bounds = (mins[0], maxs[0], mins[1], maxs[1], mins[2], maxs[2])
    solid_count = text.upper().count("MANIFOLD_SOLID_BREP")

    return CadGeometrySummary(
        path=path,
        point_count=len(points),
        solid_count=solid_count,
        bounds_mm=bounds,
    )


def _parse_point(raw_values: str) -> tuple[float, float, float] | None:
    values = [value.strip() for value in raw_values.split(",")]
    if len(values) != 3:
        return None
    try:
        return float(values[0]), float(values[1]), float(values[2])
    except ValueError:
        return None

