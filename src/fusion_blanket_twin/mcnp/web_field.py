"""Export exact rectilinear MCNP cell fields for browser visualization."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Iterable

from fusion_blanket_twin.mcnp.fields import (
    CANONICAL_MCNP_FIELDS,
    DEFAULT_MCNP_FIELD_KEY,
    McnpFieldDefinition,
)
from fusion_blanket_twin.mcnp.transforms import bounds_cm_to_mm


WEB_SCIENTIFIC_SCHEMA = "fusion-blanket-web-cell-fields/v2"
DEFAULT_BLOCK_PATH = "VTKHDF/Block_2"
MCNP_TO_VIEWER_SCALE = 10.0


def export_web_scientific_field(
    source_path: Path,
    output_directory: Path,
    *,
    field_key: str = DEFAULT_MCNP_FIELD_KEY,
    block_path: str = DEFAULT_BLOCK_PATH,
) -> dict[str, Any]:
    """Compatibility wrapper that exports the common grid and all fields.

    ``field_key`` selects the default active field in the manifest. The browser
    representation is intentionally multi-field because the canonical MCNP
    arrays share one validated FMESH grid.
    """
    return export_web_scientific_dataset(
        source_path,
        output_directory,
        default_field_key=field_key,
        block_path=block_path,
    )


def export_web_scientific_dataset(
    source_path: Path,
    output_directory: Path,
    *,
    fields: Iterable[McnpFieldDefinition] = CANONICAL_MCNP_FIELDS,
    default_field_key: str = DEFAULT_MCNP_FIELD_KEY,
    block_path: str = DEFAULT_BLOCK_PATH,
) -> dict[str, Any]:
    """Write one manifest plus one little-endian Float32 payload per field.

    The VTKHDF source remains authoritative. The exported arrays preserve every
    cell value and the exact rectilinear boundaries; only numeric precision is
    reduced for browser visualization and explicitly recorded per field.
    """
    h5py, np = _import_dependencies()
    source_path = Path(source_path)
    output_directory = Path(output_directory)
    field_definitions = tuple(fields)
    field_keys = [field.key for field in field_definitions]
    if default_field_key not in field_keys:
        raise ValueError(f"Default field '{default_field_key}' is not part of this export")
    if not source_path.is_file():
        raise FileNotFoundError(f"MCNP VTKHDF file not found: {source_path}")

    with h5py.File(source_path, "r") as h5:
        if block_path not in h5:
            raise ValueError(f"Expected VTKHDF block not found: {block_path}")
        block = h5[block_path]
        required = ("Points", "Connectivity", "Offsets", "Types", "CellData")
        missing = [name for name in required if name not in block]
        if missing:
            raise ValueError(f"VTKHDF block is missing required arrays: {', '.join(missing)}")
        cell_data = block["CellData"]
        missing_fields = [field.internal_name for field in field_definitions if field.internal_name not in cell_data]
        if missing_fields:
            available = ", ".join(cell_data.keys())
            raise ValueError(
                "Required MCNP fields are missing: "
                + ", ".join(missing_fields)
                + f". Available cell fields: {available}"
            )

        points = block["Points"][:]
        connectivity = block["Connectivity"][:]
        offsets = block["Offsets"][:]
        cell_types = block["Types"][:]
        source_fields = {
            field.key: cell_data[field.internal_name][:] for field in field_definitions
        }

    if points.ndim != 2 or points.shape[1] != 3:
        raise ValueError(f"Expected Nx3 point coordinates, got {points.shape}")
    if offsets.ndim != 1 or offsets.size < 2:
        raise ValueError("VTKHDF offsets must contain one entry per cell plus the terminator")
    cell_count = int(offsets.size - 1)
    for field in field_definitions:
        if source_fields[field.key].shape != (cell_count,):
            raise ValueError(
                f"Field '{field.internal_name}' length {source_fields[field.key].size} "
                f"does not match cell count {cell_count}"
            )
        if not np.all(np.isfinite(source_fields[field.key])):
            raise ValueError(f"Field '{field.internal_name}' contains non-finite values")
    if not np.all(np.diff(offsets) == 8):
        raise ValueError("Web export currently requires eight-node VTK voxel cells")
    if not np.all(cell_types == 11):
        raise ValueError("Web export currently requires VTK_VOXEL (type 11) cells")

    axes_cm = tuple(np.unique(points[:, axis]) for axis in range(3))
    point_shape = tuple(int(axis.size) for axis in axes_cm)
    if int(np.prod(point_shape)) != int(points.shape[0]):
        raise ValueError("Points do not form a complete rectilinear Cartesian product")
    cell_shape_xyz = tuple(size - 1 for size in point_shape)
    cell_shape_zyx = (cell_shape_xyz[2], cell_shape_xyz[1], cell_shape_xyz[0])
    if int(np.prod(cell_shape_xyz)) != cell_count:
        raise ValueError("Voxel cells do not fill the rectilinear point grid")

    cell_linear_indices = _map_cells_to_rectilinear_grid(
        np,
        points,
        connectivity,
        offsets,
        axes_cm,
        cell_shape_zyx,
        cell_count,
    )
    structured_fields = {}
    for field in field_definitions:
        structured = np.empty(cell_shape_zyx, dtype=source_fields[field.key].dtype)
        structured.reshape(-1)[cell_linear_indices] = source_fields[field.key]
        structured_fields[field.key] = structured

    bounds_cm = (
        float(axes_cm[0][0]), float(axes_cm[0][-1]),
        float(axes_cm[1][0]), float(axes_cm[1][-1]),
        float(axes_cm[2][0]), float(axes_cm[2][-1]),
    )
    bounds_mm = bounds_cm_to_mm(bounds_cm)
    axes_mm = [[float(value * MCNP_TO_VIEWER_SCALE) for value in axis] for axis in axes_cm]
    axis_metadata = {
        "x": _axis_metadata(np, axes_mm[0]),
        "y": _axis_metadata(np, axes_mm[1]),
        "z": _axis_metadata(np, axes_mm[2]),
    }

    output_directory.mkdir(parents=True, exist_ok=True)
    field_records: dict[str, Any] = {}
    for field in field_definitions:
        source_values = structured_fields[field.key].astype(np.float64)
        web_values = structured_fields[field.key].astype("<f4")
        filename = f"{field.key}.f32"
        (output_directory / filename).write_bytes(web_values.tobytes(order="C"))
        field_records[field.key] = _field_record(np, field, filename, source_values, web_values)

    consistency = _nuclear_heating_consistency(np, structured_fields)
    validation_indices_ijk = _validation_indices_ijk(np, structured_fields[default_field_key])
    validation_samples = [
        {
            "index_ijk": list(index),
            "index_zyx": [index[2], index[1], index[0]],
            "center_mm": _cell_center(axes_mm, index),
            "values": {
                field.key: {
                    "source_float64": float(structured_fields[field.key][index[2], index[1], index[0]]),
                    "web_float32": float(structured_fields[field.key].astype("<f4")[index[2], index[1], index[0]]),
                }
                for field in field_definitions
            },
        }
        for index in validation_indices_ijk
    ]

    manifest: dict[str, Any] = {
        "schema": WEB_SCIENTIFIC_SCHEMA,
        "dataset_id": "reference-mcnp-multifield",
        "default_field_key": default_field_key,
        "field_order": field_keys,
        "provenance": {
            "kind": "MCNP Simulation",
            "role": "reference simulation independent of selected PZ/CZ design",
            "source_path": source_path.as_posix(),
            "source_sha256": _sha256(source_path),
            "source_format": "VTKHDF MultiBlockDataSet / UnstructuredGrid",
            "source_block": block_path,
            "source_reference": source_path.stem,
            "case_id": None,
        },
        "fields": field_records,
        "mesh": {
            "representation": "exact_rectilinear_voxel_cell_grid",
            "point_count": int(points.shape[0]),
            "cell_count": cell_count,
            "point_shape_xyz": list(point_shape),
            "cell_shape_zyx": list(cell_shape_zyx),
            "array_order": "C order; X cell index varies fastest, then Y, then Z",
            "cell_index_order": "i=x, j=y, k=z; linear index = k*ny*nx + j*nx + i",
            "axis_boundaries_mm": {"x": axes_mm[0], "y": axes_mm[1], "z": axes_mm[2]},
            "axis_metadata": axis_metadata,
            "bounds_cm": list(bounds_cm),
            "bounds_mm": list(bounds_mm),
        },
        "transform": {
            "description": "MCNP cm × 10 to CAD/viewer mm; no rotation or translation",
            "scale": [10.0, 10.0, 10.0],
            "rotation_degrees": [0.0, 0.0, 0.0],
            "translation_mm": [0.0, 0.0, 0.0],
            "matrix_row_major": [
                10.0, 0.0, 0.0, 0.0,
                0.0, 10.0, 0.0, 0.0,
                0.0, 0.0, 10.0, 0.0,
                0.0, 0.0, 0.0, 1.0,
            ],
        },
        "slicing": {
            "available_axes": ["X", "Y", "Z"],
            "default_axis": "Z",
            "semantics": "raw containing-voxel cell values; no interpolation",
            "boundary_convention": "half-open intervals [lower, upper), with the final upper boundary included in the final cell",
            "axes": {
                "X": _slice_axis_metadata(axes_mm[0]),
                "Y": _slice_axis_metadata(axes_mm[1]),
                "Z": _slice_axis_metadata(axes_mm[2]),
            },
        },
        "probe": {
            "semantics": "click-based raw original FMESH voxel lookup; no interpolation",
            "returns": field_keys,
            "boundary_convention": "half-open intervals [lower, upper), final upper boundary maps to final cell",
        },
        "consistency_checks": {
            "nuclear_heating_equals_neutron_plus_photon": consistency,
        },
        "validation_samples": validation_samples,
    }
    (output_directory / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    return manifest


def _map_cells_to_rectilinear_grid(np, points, connectivity, offsets, axes_cm, shape_zyx, cell_count):
    occupied = np.zeros(int(np.prod(shape_zyx)), dtype=np.bool_)
    linear_indices = np.empty(cell_count, dtype=np.int64)
    chunk_size = 100_000
    for start in range(0, cell_count, chunk_size):
        stop = min(start + chunk_size, cell_count)
        ids = connectivity[offsets[start] : offsets[stop]].reshape(stop - start, 8)
        cell_points = points[ids]
        cell_mins = cell_points.min(axis=1)
        cell_maxs = cell_points.max(axis=1)
        lower_indices = [
            np.searchsorted(axes_cm[axis], cell_mins[:, axis]) for axis in range(3)
        ]
        upper_indices = [
            np.searchsorted(axes_cm[axis], cell_maxs[:, axis]) for axis in range(3)
        ]
        if any(
            not np.all(upper == lower + 1)
            for lower, upper in zip(lower_indices, upper_indices, strict=True)
        ):
            raise ValueError("Cells are not adjacent, axis-aligned rectilinear voxels")
        for axis in range(3):
            if not np.allclose(axes_cm[axis][lower_indices[axis]], cell_mins[:, axis]):
                raise ValueError("Cell minimum does not match a rectilinear boundary")
            if not np.allclose(axes_cm[axis][upper_indices[axis]], cell_maxs[:, axis]):
                raise ValueError("Cell maximum does not match a rectilinear boundary")
        linear = np.ravel_multi_index(
            (lower_indices[2], lower_indices[1], lower_indices[0]), shape_zyx
        )
        if np.any(occupied[linear]):
            raise ValueError("Duplicate voxel detected in rectilinear mapping")
        occupied[linear] = True
        linear_indices[start:stop] = linear
    if not np.all(occupied):
        raise ValueError("Rectilinear mapping contains missing voxels")
    return linear_indices


def _field_record(np, field: McnpFieldDefinition, filename: str, source64, web_values) -> dict[str, Any]:
    reconstructed = web_values.astype(np.float64)
    absolute_error = np.abs(reconstructed - source64)
    nonzero_source = np.abs(source64) > 0
    relative_error = absolute_error[nonzero_source] / np.abs(source64[nonzero_source])
    positive = source64[source64 > 0]
    return {
        "key": field.key,
        "source_name": field.internal_name,
        "display_name": field.display_name,
        "quantity_type": field.category,
        "units": field.units,
        "display_units": _display_units(field.units),
        "association": "cell",
        "source_precision": str(source64.dtype),
        "web_precision": "Float32",
        "source_range": [float(np.min(source64)), float(np.max(source64))],
        "web_range": [float(np.min(web_values)), float(np.max(web_values))],
        "finite_count": int(np.isfinite(source64).sum()),
        "zero_count": int(np.count_nonzero(source64 == 0)),
        "positive_minimum": float(np.min(positive)) if positive.size else None,
        "log_scale_supported": bool(positive.size),
        "log_scale_recommended": field.log_scale_recommended,
        "values": {
            "url": filename,
            "dtype": "float32-le",
            "byte_length": int(web_values.nbytes),
            "scalar_count": int(web_values.size),
        },
        "precision": {
            "role": "visualization copy; source VTKHDF Float64 remains authoritative",
            "maximum_absolute_deviation": float(np.max(absolute_error)),
            "maximum_relative_deviation_nonzero": (
                float(np.max(relative_error)) if relative_error.size else 0.0
            ),
            "mean_absolute_deviation": float(np.mean(absolute_error)),
        },
        "slice_ranges": {
            "X": _axis_slice_ranges(np, web_values, "X"),
            "Y": _axis_slice_ranges(np, web_values, "Y"),
            "Z": _axis_slice_ranges(np, web_values, "Z"),
        },
        "source_slice_ranges": {
            "X": _axis_slice_ranges(np, source64, "X"),
            "Y": _axis_slice_ranges(np, source64, "Y"),
            "Z": _axis_slice_ranges(np, source64, "Z"),
        },
        "provenance": {
            "kind": "MCNP Simulation",
            "role": "raw cell field exported from authoritative VTKHDF source",
        },
    }


def _axis_slice_ranges(np, values_zyx, axis: str) -> list[list[float]]:
    if axis == "X":
        slices = (values_zyx[:, :, index] for index in range(values_zyx.shape[2]))
    elif axis == "Y":
        slices = (values_zyx[:, index, :] for index in range(values_zyx.shape[1]))
    elif axis == "Z":
        slices = (values_zyx[index, :, :] for index in range(values_zyx.shape[0]))
    else:
        raise ValueError(f"Unsupported axis: {axis}")
    return [[float(np.min(slice_values)), float(np.max(slice_values))] for slice_values in slices]


def _axis_metadata(np, boundaries: list[float]) -> dict[str, Any]:
    widths = np.diff(np.asarray(boundaries, dtype=np.float64))
    return {
        "cell_count": len(boundaries) - 1,
        "minimum_spacing_mm": float(np.min(widths)),
        "maximum_spacing_mm": float(np.max(widths)),
        "uniform": bool(np.allclose(widths, widths[0])),
    }


def _slice_axis_metadata(boundaries: list[float]) -> dict[str, Any]:
    layers = [
        {
            "index": index,
            "bounds_mm": [boundaries[index], boundaries[index + 1]],
            "center_mm": (boundaries[index] + boundaries[index + 1]) / 2.0,
        }
        for index in range(len(boundaries) - 1)
    ]
    return {
        "position_range_mm": [boundaries[0], boundaries[-1]],
        "default_position_mm": (boundaries[0] + boundaries[-1]) / 2.0,
        "layers": layers,
    }


def _nuclear_heating_consistency(np, structured_fields: dict[str, Any]) -> dict[str, float | bool]:
    required = ("neutron_heating", "photon_heating", "nuclear_heating")
    if any(key not in structured_fields for key in required):
        return {"passed": False, "maximum_absolute_error": float("nan"), "mean_absolute_error": float("nan")}
    difference = np.abs(
        structured_fields["nuclear_heating"].astype(np.float64)
        - structured_fields["neutron_heating"].astype(np.float64)
        - structured_fields["photon_heating"].astype(np.float64)
    )
    maximum = float(np.max(difference))
    return {
        "passed": bool(maximum < 1.0e-10),
        "maximum_absolute_error": maximum,
        "mean_absolute_error": float(np.mean(difference)),
    }


def _validation_indices_ijk(np, reference_values_zyx) -> list[tuple[int, int, int]]:
    maximum_zyx = tuple(int(value) for value in np.unravel_index(np.argmax(reference_values_zyx), reference_values_zyx.shape))
    nz, ny, nx = reference_values_zyx.shape
    candidates = [
        (0, 0, 0),
        (nx // 2, ny // 2, nz // 2),
        (maximum_zyx[2], maximum_zyx[1], maximum_zyx[0]),
        (nx - 1, ny - 1, nz - 1),
    ]
    return list(dict.fromkeys(candidates))


def _cell_center(axes_mm: list[list[float]], index_ijk: tuple[int, int, int]) -> list[float]:
    return [
        (axes_mm[axis][index_ijk[axis]] + axes_mm[axis][index_ijk[axis] + 1]) / 2.0
        for axis in range(3)
    ]


def _display_units(units: str) -> str:
    return units.replace("cm^2", "cm²").replace("cm3", "cm³")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _import_dependencies():
    try:
        import h5py
        import numpy as np
    except ImportError as exc:
        raise RuntimeError(
            "Web scientific-field export requires h5py and numpy. "
            "Install project requirements before exporting MCNP data."
        ) from exc
    return h5py, np
