"""OpenCASCADE-based STEP tessellation for CAD surface rendering."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pyvista as pv

from fusion_blanket_twin.geometry.loader import CadGeometrySummary, read_step_summary


DEFAULT_TESSELLATION_TOLERANCE_MM = 0.5
DEFAULT_ANGULAR_TOLERANCE = 0.1


@dataclass(frozen=True)
class TessellatedCadBody:
    body_id: str
    source_index: int
    mesh: pv.PolyData
    bounds_mm: tuple[float, float, float, float, float, float]


@dataclass(frozen=True)
class TessellatedCadAssembly:
    summary: CadGeometrySummary
    bodies: tuple[TessellatedCadBody, ...]
    bounds_mm: tuple[float, float, float, float, float, float]

    @property
    def body_count(self) -> int:
        return len(self.bodies)

    @property
    def triangle_count(self) -> int:
        return sum(body.mesh.n_cells for body in self.bodies)


def load_tessellated_step_assembly(
    path: Path,
    tolerance_mm: float = DEFAULT_TESSELLATION_TOLERANCE_MM,
    angular_tolerance: float = DEFAULT_ANGULAR_TOLERANCE,
) -> TessellatedCadAssembly:
    """Load all STEP solids and convert them to separated PyVista triangle meshes."""
    cq = _import_cadquery()
    summary = read_step_summary(path)
    workplane = cq.importers.importStep(str(path))
    solids = list(workplane.solids().vals())
    if not solids:
        raise ValueError(f"No solid bodies found in STEP file: {path}")

    indexed_solids = sorted(
        enumerate(solids, start=1),
        key=lambda item: (_solid_bounds(item[1]), item[0]),
    )
    bodies = tuple(
        _tessellate_solid(
            body_id=f"Solid_{stable_index:02d}",
            source_index=source_index,
            solid=solid,
            tolerance_mm=tolerance_mm,
            angular_tolerance=angular_tolerance,
        )
        for stable_index, (source_index, solid) in enumerate(indexed_solids, start=1)
    )
    bounds = _union_bounds(tuple(body.bounds_mm for body in bodies))
    return TessellatedCadAssembly(summary=summary, bodies=bodies, bounds_mm=bounds)


def _tessellate_solid(
    body_id: str,
    source_index: int,
    solid,
    tolerance_mm: float,
    angular_tolerance: float,
) -> TessellatedCadBody:
    vertices, triangles = solid.tessellate(tolerance_mm, angularTolerance=angular_tolerance)
    if not vertices or not triangles:
        raise ValueError(f"CAD tessellation produced an empty mesh for {body_id}")

    points = np.array([(vertex.x, vertex.y, vertex.z) for vertex in vertices], dtype=float)
    faces = np.empty((len(triangles), 4), dtype=np.int64)
    faces[:, 0] = 3
    faces[:, 1:] = np.array(triangles, dtype=np.int64)
    mesh = pv.PolyData(points, faces=faces.ravel())
    mesh.clean(inplace=True)
    mesh["body_source_index"] = np.full(mesh.n_points, source_index, dtype=np.int32)

    bounds = tuple(float(value) for value in mesh.bounds)
    return TessellatedCadBody(
        body_id=body_id,
        source_index=source_index,
        mesh=mesh,
        bounds_mm=bounds,
    )


def _solid_bounds(solid) -> tuple[float, float, float, float, float, float]:
    bounds = solid.BoundingBox()
    return (
        float(bounds.xmin),
        float(bounds.xmax),
        float(bounds.ymin),
        float(bounds.ymax),
        float(bounds.zmin),
        float(bounds.zmax),
    )


def _union_bounds(
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


def _import_cadquery():
    try:
        import cadquery as cq
    except ImportError as exc:
        raise RuntimeError(
            "STEP tessellation requires cadquery, which provides an "
            "OpenCASCADE/OCP-backed STEP import path. Install requirements first."
        ) from exc
    return cq

