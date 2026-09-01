"""Export an exact rectilinear MCNP cell field for browser visualization."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from fusion_blanket_twin.mcnp.fields import field_definition_by_key
from fusion_blanket_twin.mcnp.transforms import bounds_cm_to_mm


WEB_SCIENTIFIC_SCHEMA = "fusion-blanket-web-cell-field/v1"
DEFAULT_BLOCK_PATH = "VTKHDF/Block_2"
MCNP_TO_VIEWER_SCALE = 10.0


def export_web_scientific_field(
    source_path: Path,
    output_directory: Path,
    *,
    field_key: str = "nuclear_heating",
    block_path: str = DEFAULT_BLOCK_PATH,
) -> dict[str, Any]:
    """Write a manifest plus a little-endian Float32 cell array.

    The VTKHDF source remains authoritative. The exported array preserves every
    cell value and the exact rectilinear boundaries; only numeric precision is
    reduced for the browser visualization copy.
    """
    h5py, np = _import_dependencies()
    source_path = Path(source_path)
    output_directory = Path(output_directory)
    field = field_definition_by_key(field_key)
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
        if field.internal_name not in block["CellData"]:
            available = ", ".join(block["CellData"].keys())
            raise ValueError(
                f"Required MCNP field '{field.internal_name}' not found. "
                f"Available cell fields: {available}"
            )

        points = block["Points"][:]
        connectivity = block["Connectivity"][:]
        offsets = block["Offsets"][:]
        cell_types = block["Types"][:]
        source_values = block["CellData"][field.internal_name][:]

    if points.ndim != 2 or points.shape[1] != 3:
        raise ValueError(f"Expected Nx3 point coordinates, got {points.shape}")
    if offsets.ndim != 1 or offsets.size < 2:
        raise ValueError("VTKHDF offsets must contain one entry per cell plus the terminator")
    cell_count = int(offsets.size - 1)
    if source_values.shape != (cell_count,):
        raise ValueError(f"Field length {source_values.size} does not match cell count {cell_count}")
    if not np.all(np.diff(offsets) == 8):
        raise ValueError("Web export currently requires eight-node VTK voxel cells")
    if not np.all(cell_types == 11):
        raise ValueError("Web export currently requires VTK_VOXEL (type 11) cells")
    if not np.all(np.isfinite(source_values)):
        raise ValueError(f"Field '{field.internal_name}' contains non-finite values")

    axes_cm = tuple(np.unique(points[:, axis]) for axis in range(3))
    point_shape = tuple(int(axis.size) for axis in axes_cm)
    if int(np.prod(point_shape)) != int(points.shape[0]):
        raise ValueError("Points do not form a complete rectilinear Cartesian product")
    cell_shape_xyz = tuple(size - 1 for size in point_shape)
    if int(np.prod(cell_shape_xyz)) != cell_count:
        raise ValueError("Voxel cells do not fill the rectilinear point grid")

    structured_values = np.empty(
        (cell_shape_xyz[2], cell_shape_xyz[1], cell_shape_xyz[0]), dtype=source_values.dtype
    )
    occupied = np.zeros(structured_values.size, dtype=np.bool_)
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
            (lower_indices[2], lower_indices[1], lower_indices[0]), structured_values.shape
        )
        if np.any(occupied[linear]):
            raise ValueError("Duplicate voxel detected in rectilinear mapping")
        occupied[linear] = True
        structured_values.reshape(-1)[linear] = source_values[start:stop]
    if not np.all(occupied):
        raise ValueError("Rectilinear mapping contains missing voxels")

    web_values = structured_values.astype("<f4")
    reconstructed = web_values.astype(np.float64)
    source64 = structured_values.astype(np.float64)
    absolute_error = np.abs(reconstructed - source64)
    nonzero = np.abs(source64) > 0
    relative_error = absolute_error[nonzero] / np.abs(source64[nonzero])
    bounds_cm = (
        float(axes_cm[0][0]), float(axes_cm[0][-1]),
        float(axes_cm[1][0]), float(axes_cm[1][-1]),
        float(axes_cm[2][0]), float(axes_cm[2][-1]),
    )
    bounds_mm = bounds_cm_to_mm(bounds_cm)
    axes_mm = [[float(value * MCNP_TO_VIEWER_SCALE) for value in axis] for axis in axes_cm]
    layer_ranges = [[float(np.min(layer)), float(np.max(layer))] for layer in web_values]
    layers = []
    for index, layer_range in enumerate(layer_ranges):
        layer_source = source64[index]
        layer_web = web_values[index].astype(np.float64)
        layer_absolute = np.abs(layer_web - layer_source)
        layer_nonzero = np.abs(layer_source) > 0
        layer_relative = layer_absolute[layer_nonzero] / np.abs(layer_source[layer_nonzero])
        layers.append({
            "index": index,
            "bounds_mm": [axes_mm[2][index], axes_mm[2][index + 1]],
            "center_mm": (axes_mm[2][index] + axes_mm[2][index + 1]) / 2.0,
            "range": layer_range,
            "source_range": [float(np.min(layer_source)), float(np.max(layer_source))],
            "web_range": layer_range,
            "maximum_absolute_deviation": float(np.max(layer_absolute)),
            "maximum_relative_deviation_nonzero": (
                float(np.max(layer_relative)) if layer_relative.size else 0.0
            ),
        })
    maximum_index = tuple(
        int(value) for value in np.unravel_index(np.argmax(source64), source64.shape)
    )
    sample_indices = [(0, 0, 0), maximum_index, tuple(size - 1 for size in source64.shape)]
    samples = [
        {
            "index_zyx": list(index),
            "source_float64": float(source64[index]),
            "web_float32": float(web_values[index]),
        }
        for index in dict.fromkeys(sample_indices)
    ]
    validation_layers = []
    sample_cells = [
        (0, 0),
        (source64.shape[1] // 2, source64.shape[2] // 2),
        (source64.shape[1] - 1, source64.shape[2] - 1),
    ]
    for layer_index in dict.fromkeys((0, source64.shape[0] // 2, source64.shape[0] - 1)):
        validation_layers.append({
            **layers[layer_index],
            "samples": [
                {
                    "index_zyx": [layer_index, iy, ix],
                    "source_float64": float(source64[layer_index, iy, ix]),
                    "web_float32": float(web_values[layer_index, iy, ix]),
                }
                for iy, ix in sample_cells
            ],
        })

    output_directory.mkdir(parents=True, exist_ok=True)
    values_name = "values.f32"
    (output_directory / values_name).write_bytes(web_values.tobytes(order="C"))
    manifest: dict[str, Any] = {
        "schema": WEB_SCIENTIFIC_SCHEMA,
        "dataset_id": "reference-mcnp-nuclear-heating",
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
        "field": {
            "key": field.key,
            "source_name": field.internal_name,
            "display_name": field.display_name,
            "units": field.units,
            "display_units": "W/cm³",
            "association": "cell",
            "source_precision": str(source_values.dtype),
            "source_range": [float(np.min(source64)), float(np.max(source64))],
            "web_range": [float(np.min(web_values)), float(np.max(web_values))],
        },
        "mesh": {
            "representation": "exact_rectilinear_voxel_cell_grid",
            "point_count": int(points.shape[0]),
            "cell_count": cell_count,
            "point_shape_xyz": list(point_shape),
            "cell_shape_zyx": list(structured_values.shape),
            "array_order": "C order; X cell index varies fastest, then Y, then Z",
            "axis_boundaries_mm": {"x": axes_mm[0], "y": axes_mm[1], "z": axes_mm[2]},
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
        "values": {
            "url": values_name,
            "dtype": "float32-le",
            "exported_precision": "Float32",
            "precision_role": "visualization copy; source VTKHDF Float64 remains authoritative",
            "byte_length": int(web_values.nbytes),
            "scalar_count": int(web_values.size),
            "maximum_absolute_deviation": float(np.max(absolute_error)),
            "maximum_relative_deviation_nonzero": (
                float(np.max(relative_error)) if relative_error.size else 0.0
            ),
            "mean_absolute_deviation": float(np.mean(absolute_error)),
        },
        "slicing": {
            "axis": "Z",
            "position_range_mm": [float(axes_mm[2][0]), float(axes_mm[2][-1])],
            "default_position_mm": float((axes_mm[2][0] + axes_mm[2][-1]) / 2.0),
            "semantics": "raw containing-voxel cell values; no interpolation",
            "layer_ranges": layer_ranges,
            "layers": layers,
        },
        "validation_samples": samples,
        "validation_layers": validation_layers,
    }
    (output_directory / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    return manifest


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
