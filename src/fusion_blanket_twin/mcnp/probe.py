"""Raw voxel probing for MCNP mesh tally data."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from fusion_blanket_twin.config.settings import (
    MCNP_TO_PROJECT_LENGTH_SCALE,
    REQUIRED_MCNP_FIELD,
)
from fusion_blanket_twin.mcnp.fields import CANONICAL_MCNP_FIELD_ARRAYS


@dataclass(frozen=True)
class ProbeResult:
    point_mm: tuple[float, float, float]
    cell_id: int | None
    value: float | None
    field_name: str
    status: str


@dataclass(frozen=True)
class MultiFieldProbeResult:
    point_mm: tuple[float, float, float]
    cell_id: int | None
    values: dict[str, float]
    active_field_name: str | None
    status: str

    @property
    def active_value(self) -> float | None:
        if self.active_field_name is None:
            return None
        return self.values.get(self.active_field_name)


class McnpRawVoxelProbe:
    """Return the containing voxel's raw tally value for project-frame points.

    This class does not interpolate or smooth the tally. It preserves the MCNP
    voxel mesh as an independent Cartesian field registered by unit conversion.
    """

    def __init__(
        self,
        vtkhdf_path: Path,
        field_name: str = REQUIRED_MCNP_FIELD,
        field_names: tuple[str, ...] = CANONICAL_MCNP_FIELD_ARRAYS,
        block_path: str = "VTKHDF/Block_2",
    ) -> None:
        h5py, np = _import_hdf_dependencies()
        self._np = np
        self.field_name = field_name
        self.field_names = field_names
        self.path = vtkhdf_path

        if not vtkhdf_path.exists():
            raise FileNotFoundError(f"MCNP VTKHDF file not found: {vtkhdf_path}")

        with h5py.File(vtkhdf_path, "r") as h5:
            block = h5[block_path]
            points_cm = block["Points"][:]
            connectivity = block["Connectivity"][:]
            offsets = block["Offsets"][:]
            cell_data = block["CellData"]
            if field_name not in cell_data:
                available = ", ".join(block["CellData"].keys())
                raise ValueError(
                    f"Required MCNP field '{field_name}' not found. "
                    f"Available cell fields: {available}"
                )
            missing = [name for name in field_names if name not in cell_data]
            if missing:
                available = ", ".join(cell_data.keys())
                raise ValueError(
                    "Required MCNP probe fields missing: "
                    + ", ".join(missing)
                    + f". Available cell fields: {available}"
                )
            field_values = {name: cell_data[name][:] for name in field_names}

        cell_count = len(field_values[field_name])
        if len(offsets) != cell_count + 1:
            raise ValueError("VTKHDF offsets do not match cell data length.")

        voxel_points = points_cm[connectivity.reshape(cell_count, -1)]
        mins_cm = voxel_points.min(axis=1)
        maxs_cm = voxel_points.max(axis=1)
        self._mins_mm = mins_cm * MCNP_TO_PROJECT_LENGTH_SCALE
        self._maxs_mm = maxs_cm * MCNP_TO_PROJECT_LENGTH_SCALE
        self._field_values = field_values
        self._values = field_values[field_name]
        self.bounds_mm = (
            float(self._mins_mm[:, 0].min()),
            float(self._maxs_mm[:, 0].max()),
            float(self._mins_mm[:, 1].min()),
            float(self._maxs_mm[:, 1].max()),
            float(self._mins_mm[:, 2].min()),
            float(self._maxs_mm[:, 2].max()),
        )

    def probe(self, point_mm: tuple[float, float, float]) -> ProbeResult:
        """Return the raw value of the voxel containing ``point_mm``."""
        point = self._np.asarray(point_mm, dtype=float)
        xmin, xmax, ymin, ymax, zmin, zmax = self.bounds_mm
        if not (xmin <= point[0] <= xmax and ymin <= point[1] <= ymax and zmin <= point[2] <= zmax):
            return ProbeResult(point_mm, None, None, self.field_name, "out_of_bounds")

        inside_min = self._mins_mm <= point
        inside_max = point <= self._maxs_mm
        matches = self._np.flatnonzero((inside_min & inside_max).all(axis=1))
        if len(matches) == 0:
            return ProbeResult(point_mm, None, None, self.field_name, "no_containing_voxel")

        cell_id = int(matches[0])
        return ProbeResult(
            point_mm=point_mm,
            cell_id=cell_id,
            value=float(self._values[cell_id]),
            field_name=self.field_name,
            status="ok",
        )

    def probe_all(
        self,
        point_mm: tuple[float, float, float],
        active_field_name: str | None = None,
    ) -> MultiFieldProbeResult:
        """Return raw containing-voxel values for every configured field."""
        single = self.probe(point_mm)
        if single.cell_id is None:
            return MultiFieldProbeResult(
                point_mm=point_mm,
                cell_id=None,
                values={},
                active_field_name=active_field_name,
                status=single.status,
            )
        return MultiFieldProbeResult(
            point_mm=point_mm,
            cell_id=single.cell_id,
            values={
                name: float(values[single.cell_id])
                for name, values in self._field_values.items()
            },
            active_field_name=active_field_name,
            status="ok",
        )


def _import_hdf_dependencies():
    try:
        import h5py
        import numpy as np
    except ImportError as exc:
        raise RuntimeError(
            "Raw MCNP probing requires h5py and numpy. "
            "Install project requirements before probing MCNP data."
        ) from exc
    return h5py, np
