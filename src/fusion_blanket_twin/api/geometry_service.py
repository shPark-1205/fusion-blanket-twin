"""Reusable parametric geometry generation and compact mesh serialization."""

from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter

import numpy as np

from fusion_blanket_twin.geometry.csg import PrimitiveCSGParameters
from fusion_blanket_twin.geometry.doe_mapping import CurrentDOEGeometryMapping
from fusion_blanket_twin.geometry.parametric_csg import ParametricCSGGeometryProvider


@dataclass(frozen=True)
class GeometryResult:
    design: PrimitiveCSGParameters
    payload: dict[str, object]
    generation_ms: float
    cache_hit: bool


class ParametricGeometryService:
    """Build geometry with one reusable mapping/provider configuration.

    The cache is intentionally small and keyed by normalized high-level DOE
    controls. It avoids rebuilding identical applied designs while keeping the
    provider authoritative for all component geometry rules.
    """

    def __init__(self, mapping: CurrentDOEGeometryMapping | None = None) -> None:
        self.mapping = mapping or CurrentDOEGeometryMapping.current_fixed_spacing()
        self._cache: dict[tuple[float, float], GeometryResult] = {}

    def generate(self, pz_206: float, cz_301_radius: float) -> GeometryResult:
        key = (round(float(pz_206), 9), round(float(cz_301_radius), 9))
        cached = self._cache.get(key)
        if cached is not None:
            return GeometryResult(cached.design, cached.payload, 0.0, True)
        started = perf_counter()
        design = self.mapping.from_current_controls(*key)
        assembly = ParametricCSGGeometryProvider(design).build()
        components = [_serialize_component(component) for component in assembly.components]
        payload = {
            "design": {
                "pz_206": key[0],
                "cz_301_radius": key[1],
                "units": {"pz_206": "cm", "cz_301_radius": "cm"},
            },
            "units": "mm",
            "provenance": {
                "source": "ParametricCSGGeometryProvider",
                "provider": "Python geometry provider",
                "representation": "component surface meshes",
                "coordinate_transform": "MCNP cm × 10 → project mm",
            },
            "bounds_mm": list(assembly.bounds_mm),
            "components": components,
            "component_count": assembly.component_count,
            "vertex_count": sum(int(component["vertex_count"]) for component in components),
            "triangle_count": sum(int(component["triangle_count"]) for component in components),
        }
        result = GeometryResult(design, payload, (perf_counter() - started) * 1000.0, False)
        self._cache[key] = result
        return result


def _serialize_component(component) -> dict[str, object]:
    mesh = component.mesh.triangulate()
    points = np.asarray(mesh.points, dtype=np.float32)
    faces = np.asarray(mesh.faces, dtype=np.int64)
    triangles: list[int] = []
    cursor = 0
    while cursor < len(faces):
        count = int(faces[cursor])
        if count != 3:
            raise ValueError("parametric component mesh must be triangulated")
        triangles.extend(int(value) for value in faces[cursor + 1 : cursor + 4])
        cursor += count + 1
    return {
        "id": component.component_id,
        "group": component.component_group,
        "display_name": component.display_name,
        "positions": points.reshape(-1).tolist(),
        "indices": triangles,
        "bounds_mm": list(component.bounds_mm),
        "vertex_count": int(points.shape[0]),
        "triangle_count": len(triangles) // 3,
    }
