"""Load MCNP VTKHDF mesh tally data without changing mesh topology."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from fusion_blanket_twin.config.settings import REQUIRED_MCNP_FIELD
from fusion_blanket_twin.mcnp.transforms import bounds_cm_to_mm


@dataclass(frozen=True)
class McnpMeshSummary:
    path: Path
    block_path: str
    point_count: int
    cell_count: int
    field_name: str
    field_range: tuple[float, float]
    cell_arrays: tuple[str, ...]
    bounds_cm: tuple[float, float, float, float, float, float]
    bounds_mm: tuple[float, float, float, float, float, float]


def read_mcnp_summary(
    path: Path,
    field_name: str = REQUIRED_MCNP_FIELD,
    block_path: str = "VTKHDF/Block_2",
) -> McnpMeshSummary:
    """Read VTKHDF mesh metadata and validate the required MCNP field."""
    h5py, np = _import_hdf_dependencies()
    if not path.exists():
        raise FileNotFoundError(f"MCNP VTKHDF file not found: {path}")
    if not path.is_file():
        raise ValueError(f"MCNP VTKHDF path is not a file: {path}")

    with h5py.File(path, "r") as h5:
        if block_path not in h5:
            raise ValueError(f"Expected VTKHDF block not found: {block_path}")
        block = h5[block_path]
        points = block["Points"]
        cell_data = block["CellData"]
        if field_name not in cell_data:
            available = ", ".join(cell_data.keys())
            raise ValueError(
                f"Required MCNP field '{field_name}' not found. "
                f"Available cell fields: {available}"
            )

        point_count = int(points.shape[0])
        cell_arrays = tuple(cell_data.keys())
        point_mins = points[:].min(axis=0)
        point_maxs = points[:].max(axis=0)
        field = cell_data[field_name][:]
        bounds_cm = (
            float(point_mins[0]),
            float(point_maxs[0]),
            float(point_mins[1]),
            float(point_maxs[1]),
            float(point_mins[2]),
            float(point_maxs[2]),
        )
        cell_count = int(block["NumberOfCells"][0])

    return McnpMeshSummary(
        path=path,
        block_path=block_path,
        point_count=point_count,
        cell_count=cell_count,
        field_name=field_name,
        field_range=(float(np.nanmin(field)), float(np.nanmax(field))),
        cell_arrays=cell_arrays,
        bounds_cm=bounds_cm,
        bounds_mm=bounds_cm_to_mm(bounds_cm),
    )


def _import_hdf_dependencies():
    try:
        import h5py
        import numpy as np
    except ImportError as exc:
        raise RuntimeError(
            "Reading VTKHDF requires h5py and numpy. "
            "Install project requirements before loading MCNP data."
        ) from exc
    return h5py, np
