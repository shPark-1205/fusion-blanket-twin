"""Coordinate transforms for MCNP mesh tallies."""

from __future__ import annotations

from collections.abc import Iterable

from fusion_blanket_twin.config.settings import MCNP_TO_PROJECT_LENGTH_SCALE


def cm_to_mm(value_cm: float) -> float:
    """Convert MCNP length coordinates from cm to project/CAD mm."""
    return value_cm * MCNP_TO_PROJECT_LENGTH_SCALE


def point_cm_to_mm(point_cm: Iterable[float]) -> tuple[float, float, float]:
    """Convert an MCNP point from cm to the project/CAD frame in mm."""
    x_cm, y_cm, z_cm = point_cm
    return cm_to_mm(x_cm), cm_to_mm(y_cm), cm_to_mm(z_cm)


def bounds_cm_to_mm(
    bounds_cm: tuple[float, float, float, float, float, float],
) -> tuple[float, float, float, float, float, float]:
    """Convert VTK-style bounds from MCNP cm to project/CAD mm."""
    xmin, xmax, ymin, ymax, zmin, zmax = bounds_cm
    return (
        cm_to_mm(xmin),
        cm_to_mm(xmax),
        cm_to_mm(ymin),
        cm_to_mm(ymax),
        cm_to_mm(zmin),
        cm_to_mm(zmax),
    )

