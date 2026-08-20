"""PyVista adapters for MCNP VTKHDF fields."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pyvista as pv

from fusion_blanket_twin.config.settings import (
    MCNP_TO_PROJECT_LENGTH_SCALE,
    REQUIRED_MCNP_FIELD,
)
from fusion_blanket_twin.mcnp.loader import McnpMeshSummary, read_mcnp_summary


@dataclass(frozen=True)
class McnpHeatingGeometry:
    summary: McnpMeshSummary
    mesh_mm: pv.DataSet


def load_mcnp_heating_geometry(
    path: Path,
    field_name: str = REQUIRED_MCNP_FIELD,
) -> McnpHeatingGeometry:
    """Load MCNP VTKHDF and convert mesh coordinates from cm to mm."""
    vtk = _import_vtk()
    reader = vtk.vtkHDFReader()
    reader.SetFileName(str(path))
    reader.Update()
    wrapped = pv.wrap(reader.GetOutputDataObject(0))
    mesh = _find_dataset_with_cell_field(wrapped, field_name).copy(deep=True)
    mesh.points *= MCNP_TO_PROJECT_LENGTH_SCALE
    mesh.set_active_scalars(field_name, preference="cell")
    return McnpHeatingGeometry(
        summary=read_mcnp_summary(path, field_name),
        mesh_mm=mesh,
    )


def create_z_heating_slice(
    mesh_mm: pv.DataSet,
    z_mm: float,
    field_name: str = REQUIRED_MCNP_FIELD,
) -> pv.PolyData:
    """Create a visual Z-normal cut of the heating field in project mm."""
    slice_mesh = mesh_mm.slice(normal=(0.0, 0.0, 1.0), origin=(0.0, 0.0, z_mm))
    if field_name not in slice_mesh.cell_data:
        raise ValueError(f"Slice does not contain expected cell field: {field_name}")
    slice_mesh.set_active_scalars(field_name, preference="cell")
    return slice_mesh


def _find_dataset_with_cell_field(obj, field_name: str) -> pv.DataSet:
    if isinstance(obj, pv.MultiBlock):
        for block in obj:
            if block is None:
                continue
            try:
                return _find_dataset_with_cell_field(block, field_name)
            except ValueError:
                continue
        raise ValueError(f"No VTKHDF block contains cell field: {field_name}")

    if field_name in obj.cell_data:
        return obj
    raise ValueError(f"Dataset does not contain cell field: {field_name}")


def _import_vtk():
    try:
        import vtk
    except ImportError as exc:
        raise RuntimeError(
            "Loading VTKHDF for visualization requires vtk. "
            "Install project requirements before launching the viewer."
        ) from exc
    return vtk

