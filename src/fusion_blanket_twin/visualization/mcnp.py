"""PyVista adapters for shared-mesh MCNP VTKHDF fields."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from time import perf_counter

import numpy as np
import pyvista as pv

from fusion_blanket_twin.config.settings import (
    MCNP_TO_PROJECT_LENGTH_SCALE,
    REQUIRED_MCNP_FIELD,
)
from fusion_blanket_twin.mcnp.fields import (
    CANONICAL_MCNP_FIELD_ARRAYS,
    DEFAULT_MCNP_FIELD_KEY,
    McnpFieldDefinition,
    field_definition_by_key,
    validate_required_mcnp_fields,
)
from fusion_blanket_twin.mcnp.loader import (
    McnpMultiFieldSummary,
    read_mcnp_multifield_summary,
)


LOG_DISPLAY_PREFIX = "log10"


@dataclass(frozen=True)
class McnpVisualizationMesh:
    summary: McnpMultiFieldSummary
    mesh_mm: pv.DataSet
    load_time_s: float
    transform_time_s: float
    active_field_key: str = DEFAULT_MCNP_FIELD_KEY

    @property
    def active_field(self) -> McnpFieldDefinition:
        return field_definition_by_key(self.active_field_key)


McnpHeatingGeometry = McnpVisualizationMesh


@dataclass(frozen=True)
class McnpDisplayData:
    mesh: pv.DataSet
    scalar_name: str
    scalar_bar_title: str
    scalar_range: tuple[float, float]
    uses_log_scale: bool
    interpolation_note: str | None = None


def load_mcnp_visualization_mesh(
    path: Path,
    default_field_key: str = DEFAULT_MCNP_FIELD_KEY,
) -> McnpVisualizationMesh:
    """Load MCNP VTKHDF once and convert coordinates from cm to mm once."""
    default_field = field_definition_by_key(default_field_key)
    vtk = _import_vtk()
    start = perf_counter()
    reader = vtk.vtkHDFReader()
    reader.SetFileName(str(path))
    reader.Update()
    wrapped = pv.wrap(reader.GetOutputDataObject(0))
    raw_mesh = _find_dataset_with_cell_fields(wrapped, CANONICAL_MCNP_FIELD_ARRAYS)
    load_time_s = perf_counter() - start

    transform_start = perf_counter()
    mesh = raw_mesh.copy(deep=True)
    mesh.points *= MCNP_TO_PROJECT_LENGTH_SCALE
    mesh.set_active_scalars(default_field.internal_name, preference="cell")
    transform_time_s = perf_counter() - transform_start

    summary = read_mcnp_multifield_summary(
        path,
        default_field_name=default_field.internal_name,
    )
    validate_required_mcnp_fields(tuple(mesh.cell_data.keys()))
    return McnpVisualizationMesh(
        summary=summary,
        mesh_mm=mesh,
        load_time_s=load_time_s,
        transform_time_s=transform_time_s,
        active_field_key=default_field_key,
    )


def load_mcnp_heating_geometry(
    path: Path,
    field_name: str = REQUIRED_MCNP_FIELD,
) -> McnpVisualizationMesh:
    """Backward-compatible loader for the current default MCNP field."""
    field_key = DEFAULT_MCNP_FIELD_KEY
    for candidate_key in ("nuclear_heating", "neutron_heating", "photon_heating"):
        candidate = field_definition_by_key(candidate_key)
        if candidate.internal_name == field_name:
            field_key = candidate_key
            break
    return load_mcnp_visualization_mesh(path, field_key)


def create_mcnp_slice(
    mesh_mm: pv.DataSet,
    axis: str,
    position_mm: float,
    field_name: str,
    use_log_scale: bool = False,
) -> McnpDisplayData:
    """Create an axis-normal MCNP field slice without modifying raw cell data."""
    normal = _axis_normal(axis)
    origin = _axis_origin(axis, position_mm)
    slice_mesh = mesh_mm.slice(normal=normal, origin=origin)
    if field_name not in slice_mesh.cell_data:
        raise ValueError(f"Slice does not contain expected cell field: {field_name}")
    return prepare_display_data(slice_mesh, field_name, use_log_scale)


def create_z_heating_slice(
    mesh_mm: pv.DataSet,
    z_mm: float,
    field_name: str = REQUIRED_MCNP_FIELD,
) -> pv.PolyData:
    """Create a visual Z-normal cut of the active MCNP field in project mm."""
    return create_mcnp_slice(mesh_mm, "Z", z_mm, field_name).mesh


def create_mcnp_iso_surface(
    mesh_mm: pv.DataSet,
    field_name: str,
    iso_value: float,
    use_log_scale: bool = False,
) -> McnpDisplayData:
    """Create an MCNP iso-surface from cell data through explicit point conversion.

    The raw MCNP cell data on ``mesh_mm`` is not modified. PyVista/VTK contouring
    operates on point data, so this function explicitly creates a visualization
    pipeline copy, converts cell data to point data, and contours that result.
    """
    source = mesh_mm.copy(deep=False)
    scalar_name = field_name
    if use_log_scale:
        scalar_name = _log_display_array_name(field_name)
        source.cell_data[scalar_name] = _log10_safe(source.cell_data[field_name])
    point_mesh = source.cell_data_to_point_data(pass_cell_data=True)
    contour = point_mesh.contour(
        isosurfaces=[float(iso_value)],
        scalars=scalar_name,
        preference="point",
    )
    display = prepare_display_data(contour, field_name, use_log_scale)
    return McnpDisplayData(
        mesh=display.mesh,
        scalar_name=display.scalar_name,
        scalar_bar_title=display.scalar_bar_title,
        scalar_range=display.scalar_range,
        uses_log_scale=display.uses_log_scale,
        interpolation_note=(
            "Iso-surface uses explicit cell-to-point conversion for visualization; "
            "raw MCNP cell values remain unchanged."
        ),
    )


def prepare_display_data(
    mesh: pv.DataSet,
    field_name: str,
    use_log_scale: bool = False,
) -> McnpDisplayData:
    if use_log_scale:
        scalar_name = _log_display_array_name(field_name)
        if field_name in mesh.cell_data:
            mesh.cell_data[scalar_name] = _log10_safe(mesh.cell_data[field_name])
            scalars = mesh.cell_data[scalar_name]
            mesh.set_active_scalars(scalar_name, preference="cell")
        elif field_name in mesh.point_data:
            mesh.point_data[scalar_name] = _log10_safe(mesh.point_data[field_name])
            scalars = mesh.point_data[scalar_name]
            mesh.set_active_scalars(scalar_name, preference="point")
        else:
            raise ValueError(f"Display mesh does not contain field: {field_name}")
        finite = scalars[np.isfinite(scalars)]
        scalar_range = _safe_scalar_range(finite)
        return McnpDisplayData(
            mesh=mesh,
            scalar_name=scalar_name,
            scalar_bar_title=f"log10 {field_name}",
            scalar_range=scalar_range,
            uses_log_scale=True,
        )

    if field_name in mesh.cell_data:
        scalars = mesh.cell_data[field_name]
        mesh.set_active_scalars(field_name, preference="cell")
    elif field_name in mesh.point_data:
        scalars = mesh.point_data[field_name]
        mesh.set_active_scalars(field_name, preference="point")
    else:
        raise ValueError(f"Display mesh does not contain field: {field_name}")
    return McnpDisplayData(
        mesh=mesh,
        scalar_name=field_name,
        scalar_bar_title=field_name,
        scalar_range=_safe_scalar_range(np.asarray(scalars)),
        uses_log_scale=False,
    )


def axis_bounds(bounds: tuple[float, float, float, float, float, float], axis: str) -> tuple[float, float]:
    lower_index, upper_index = {"X": (0, 1), "Y": (2, 3), "Z": (4, 5)}.get(
        axis.upper(),
        (4, 5),
    )
    return float(bounds[lower_index]), float(bounds[upper_index])


def axis_center(bounds: tuple[float, float, float, float, float, float], axis: str) -> float:
    lower, upper = axis_bounds(bounds, axis)
    return (lower + upper) * 0.5


def _find_dataset_with_cell_fields(obj, field_names: tuple[str, ...]) -> pv.DataSet:
    if isinstance(obj, pv.MultiBlock):
        for block in obj:
            if block is None:
                continue
            try:
                return _find_dataset_with_cell_fields(block, field_names)
            except ValueError:
                continue
        raise ValueError(
            "No VTKHDF block contains all required canonical MCNP fields: "
            + ", ".join(field_names)
        )

    missing = [field_name for field_name in field_names if field_name not in obj.cell_data]
    if missing:
        raise ValueError(
            "Dataset is missing required MCNP fields: "
            + ", ".join(missing)
            + ". Available cell fields: "
            + ", ".join(obj.cell_data.keys())
        )
    return obj


def _axis_normal(axis: str) -> tuple[float, float, float]:
    return {
        "X": (1.0, 0.0, 0.0),
        "Y": (0.0, 1.0, 0.0),
        "Z": (0.0, 0.0, 1.0),
    }.get(axis.upper(), (0.0, 0.0, 1.0))


def _axis_origin(axis: str, position_mm: float) -> tuple[float, float, float]:
    return {
        "X": (float(position_mm), 0.0, 0.0),
        "Y": (0.0, float(position_mm), 0.0),
        "Z": (0.0, 0.0, float(position_mm)),
    }.get(axis.upper(), (0.0, 0.0, float(position_mm)))


def _log_display_array_name(field_name: str) -> str:
    return f"{LOG_DISPLAY_PREFIX}({field_name})"


def _log10_safe(values) -> np.ndarray:
    values = np.asarray(values, dtype=float)
    positive = values[values > 0.0]
    floor = float(np.nanmin(positive)) if positive.size else 1.0e-300
    return np.log10(np.where(values > 0.0, values, floor))


def _safe_scalar_range(values: np.ndarray) -> tuple[float, float]:
    array = np.asarray(values)
    finite = array[np.isfinite(array)]
    if finite.size == 0:
        return (0.0, 0.0)
    return float(np.nanmin(finite)), float(np.nanmax(finite))


def _import_vtk():
    try:
        import vtk
    except ImportError as exc:
        raise RuntimeError(
            "Loading VTKHDF for visualization requires vtk. "
            "Install project requirements before launching the viewer."
        ) from exc
    return vtk
