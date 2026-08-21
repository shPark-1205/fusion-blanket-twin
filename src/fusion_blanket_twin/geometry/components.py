"""Viewer-facing component geometry contracts."""

from __future__ import annotations

from dataclasses import dataclass

import pyvista as pv


COMPONENT_GROUPS: tuple[str, ...] = (
    "Armor",
    "Breeder",
    "Multiplier",
    "Structure",
    "Coolant",
)


@dataclass(frozen=True)
class ComponentSurfaceGeometry:
    component_id: str
    component_group: str
    display_name: str
    mesh: pv.PolyData
    bounds_mm: tuple[float, float, float, float, float, float]
    source_metadata: dict[str, object]


@dataclass(frozen=True)
class ComponentGeometryAssembly:
    components: tuple[ComponentSurfaceGeometry, ...]
    bounds_mm: tuple[float, float, float, float, float, float]
    source_metadata: dict[str, object]

    @property
    def component_count(self) -> int:
        return len(self.components)

    @property
    def component_groups(self) -> tuple[str, ...]:
        return tuple(sorted({component.component_group for component in self.components}))


def union_bounds(
    bounds: tuple[tuple[float, float, float, float, float, float], ...],
) -> tuple[float, float, float, float, float, float]:
    return (
        min(bound[0] for bound in bounds),
        max(bound[1] for bound in bounds),
        min(bound[2] for bound in bounds),
        max(bound[3] for bound in bounds),
        min(bound[4] for bound in bounds),
        max(bound[5] for bound in bounds),
    )

