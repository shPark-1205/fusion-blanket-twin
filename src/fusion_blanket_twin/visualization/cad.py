"""PyVista CAD display helpers for the current STEP sample."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re

import pyvista as pv

from fusion_blanket_twin.geometry.loader import CadGeometrySummary, read_step_summary
from fusion_blanket_twin.geometry.cad_tessellation import (
    TessellatedCadAssembly,
    load_tessellated_step_assembly,
)


_POINT_RE = re.compile(
    r"#(\d+)\s*=\s*CARTESIAN_POINT\s*\([^,]*,\s*\(([^)]*)\)\)\s*;",
    re.IGNORECASE,
)
_VERTEX_RE = re.compile(
    r"#(\d+)\s*=\s*VERTEX_POINT\s*\([^,]*,\s*#(\d+)\)\s*;",
    re.IGNORECASE,
)
_EDGE_RE = re.compile(
    r"#(\d+)\s*=\s*EDGE_CURVE\s*\([^,]*,\s*#(\d+),\s*#(\d+),\s*#(\d+),\s*\.(T|F)\.\)\s*;",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class CadDisplayGeometry:
    summary: CadGeometrySummary
    tessellated: TessellatedCadAssembly
    outline: pv.PolyData
    edge_wireframe: pv.PolyData


def load_cad_display_geometry(path: Path) -> CadDisplayGeometry:
    """Create PyVista geometry from actual tessellated STEP solids."""
    summary = read_step_summary(path)
    tessellated = load_tessellated_step_assembly(path)
    edge_wireframe = _read_step_edge_wireframe(path)
    outline = pv.Box(bounds=summary.bounds_mm)
    return CadDisplayGeometry(
        summary=summary,
        tessellated=tessellated,
        outline=outline,
        edge_wireframe=edge_wireframe,
    )


def _read_step_edge_wireframe(path: Path) -> pv.PolyData:
    text = path.read_text(errors="replace")
    point_by_id = {
        int(match.group(1)): _parse_point(match.group(2)) for match in _POINT_RE.finditer(text)
    }
    vertex_to_point = {
        int(match.group(1)): int(match.group(2)) for match in _VERTEX_RE.finditer(text)
    }

    points: list[tuple[float, float, float]] = []
    point_index: dict[tuple[float, float, float], int] = {}
    lines: list[int] = []

    for match in _EDGE_RE.finditer(text):
        start_vertex = int(match.group(2))
        end_vertex = int(match.group(3))
        start_point = point_by_id.get(vertex_to_point.get(start_vertex, -1))
        end_point = point_by_id.get(vertex_to_point.get(end_vertex, -1))
        if start_point is None or end_point is None:
            continue
        start_index = _index_point(start_point, points, point_index)
        end_index = _index_point(end_point, points, point_index)
        if start_index == end_index:
            continue
        lines.extend((2, start_index, end_index))

    if not points:
        raise ValueError(f"No STEP EDGE_CURVE wireframe geometry found: {path}")

    return pv.PolyData(points, lines=lines)


def _index_point(
    point: tuple[float, float, float],
    points: list[tuple[float, float, float]],
    point_index: dict[tuple[float, float, float], int],
) -> int:
    key = tuple(round(value, 9) for value in point)
    existing = point_index.get(key)
    if existing is not None:
        return existing
    index = len(points)
    point_index[key] = index
    points.append(point)
    return index


def _parse_point(raw_values: str) -> tuple[float, float, float] | None:
    values = [value.strip() for value in raw_values.split(",")]
    if len(values) != 3:
        return None
    try:
        return float(values[0]), float(values[1]), float(values[2])
    except ValueError:
        return None
