"""Build the PyVista scene for the scientific MCNP/component viewer."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from time import perf_counter

import numpy as np
import pyvista as pv

from fusion_blanket_twin.geometry.csg import PrimitiveCSGParameters
from fusion_blanket_twin.geometry.parametric_csg import (
    DEFAULT_PRIMITIVE_CSG_PARAMETERS,
    ParametricCSGGeometryProvider,
)
from fusion_blanket_twin.mcnp.fields import (
    DEFAULT_MCNP_FIELD_KEY,
    field_definition_by_key,
)
from fusion_blanket_twin.visualization.cad import CadDisplayGeometry, load_cad_display_geometry
from fusion_blanket_twin.visualization.component_display import (
    ClippingConfig,
    ComponentGeometryView,
)
from fusion_blanket_twin.visualization.mcnp import (
    McnpVisualizationMesh,
    axis_bounds,
    axis_center,
    create_mcnp_iso_surface,
    create_mcnp_slice,
    load_mcnp_visualization_mesh,
)


CAD_BODY_ACTOR_PREFIX = "cad_body_"
CAD_EDGES_ACTOR = "cad_edges"
MCNP_FIELD_ACTOR = "mcnp_field_visualization"

OFF_MODE = "Off"
SLICE_MODE = "Slice"
ISO_SURFACE_MODE = "Iso-surface"


@dataclass
class BlanketViewerScene:
    plotter: pv.Plotter
    cad: CadDisplayGeometry
    mcnp: McnpVisualizationMesh
    slice_position_mm: float
    cad_opacity: float
    component_view: ComponentGeometryView | None = None
    primitive_csg: PrimitiveCSGParameters | None = None
    geometry_source: str = "parametric_csg"
    slice_axis: str = "Z"
    active_field_key: str = DEFAULT_MCNP_FIELD_KEY
    visualization_mode: str = SLICE_MODE
    use_log_scale: bool = False
    iso_value: float | None = None
    last_interpolation_note: str | None = None
    operation_timings_s: dict[str, float] = field(default_factory=dict)

    @property
    def field_name(self) -> str:
        return self.active_field.internal_name

    @property
    def active_field(self):
        return field_definition_by_key(self.active_field_key)

    @property
    def slice_z_mm(self) -> float:
        return self.slice_position_mm

    @property
    def z_bounds_mm(self) -> tuple[float, float]:
        return self.mcnp.summary.bounds_mm[4], self.mcnp.summary.bounds_mm[5]

    @property
    def component_bounds_mm(self) -> tuple[float, float, float, float, float, float]:
        if self.component_view is not None:
            return self.component_view.bounds_mm
        return self.cad.summary.bounds_mm

    @property
    def active_field_range(self) -> tuple[float, float]:
        return self.mcnp.summary.field_ranges[self.field_name]

    @property
    def active_display_range(self) -> tuple[float, float]:
        if not self.use_log_scale:
            return self.active_field_range
        values = np.asarray(self.mcnp.mesh_mm.cell_data[self.field_name], dtype=float)
        positive = values[values > 0.0]
        if positive.size == 0:
            return (0.0, 0.0)
        return float(np.log10(np.nanmin(positive))), float(np.log10(np.nanmax(positive)))

    @property
    def scalar_bar_title(self) -> str:
        title = self.active_field.scalar_bar_title
        return f"log10 {title}" if self.use_log_scale else title

    def mcnp_axis_bounds(self, axis: str | None = None) -> tuple[float, float]:
        return axis_bounds(self.mcnp.summary.bounds_mm, axis or self.slice_axis)

    def reset_camera(self) -> None:
        self.plotter.reset_camera()

    def update_slice(self, z_mm: float) -> None:
        self.update_mcnp_slice("Z", z_mm)

    def update_mcnp_slice(self, axis: str, position_mm: float) -> None:
        self.slice_axis = axis.upper()
        self.slice_position_mm = self._clamp_slice_position(position_mm)
        self.visualization_mode = SLICE_MODE
        self._refresh_mcnp_visualization("slice_update")

    def reset_mcnp_slice(self) -> None:
        self.slice_position_mm = axis_center(self.mcnp.summary.bounds_mm, self.slice_axis)
        self.visualization_mode = SLICE_MODE
        self._refresh_mcnp_visualization("slice_update")

    def set_mcnp_field(self, field_key: str) -> None:
        field_definition_by_key(field_key)
        self.active_field_key = field_key
        self.mcnp.mesh_mm.set_active_scalars(self.field_name, preference="cell")
        self.iso_value = self.default_iso_value()
        self._refresh_mcnp_visualization("field_switch")

    def set_visualization_mode(self, mode: str) -> None:
        self.visualization_mode = mode if mode in (OFF_MODE, SLICE_MODE, ISO_SURFACE_MODE) else SLICE_MODE
        if self.iso_value is None:
            self.iso_value = self.default_iso_value()
        self._refresh_mcnp_visualization("visualization_mode_update")

    def set_log_scale(self, use_log_scale: bool) -> None:
        self.use_log_scale = bool(use_log_scale)
        self.iso_value = self.default_iso_value()
        self._refresh_mcnp_visualization("log_scale_update")

    def update_iso_value(self, iso_value: float) -> None:
        self.iso_value = float(iso_value)
        self.visualization_mode = ISO_SURFACE_MODE
        self._refresh_mcnp_visualization("iso_surface_update")

    def default_iso_value(self) -> float:
        low, high = self.active_display_range
        return (low + high) * 0.5

    def update_cad_opacity(self, opacity: float) -> None:
        start = perf_counter()
        self.cad_opacity = float(opacity)
        for body in self.cad.tessellated.bodies:
            actor = self.plotter.renderer.actors.get(_body_actor_name(body.body_id))
            if actor is not None:
                actor.GetProperty().SetOpacity(self.cad_opacity)
        edge_actor = self.plotter.renderer.actors.get(CAD_EDGES_ACTOR)
        if edge_actor is not None:
            edge_actor.GetProperty().SetOpacity(max(0.15, min(1.0, self.cad_opacity + 0.25)))
        if self.component_view is not None:
            self.component_view.set_opacity(self.cad_opacity)
        self.operation_timings_s["cad_opacity_update"] = perf_counter() - start

    def update_parametric_geometry(self, parameters: PrimitiveCSGParameters) -> None:
        if self.component_view is None:
            return
        if parameters == self.primitive_csg:
            self.operation_timings_s["parametric_geometry_update"] = 0.0
            return
        start = perf_counter()
        provider = ParametricCSGGeometryProvider(parameters)
        self.component_view.update_geometry(provider.build())
        self.primitive_csg = parameters
        self.operation_timings_s["parametric_geometry_update"] = perf_counter() - start

    def set_component_group_color(self, group: str, color: str) -> None:
        start = perf_counter()
        if self.component_view is not None:
            self.component_view.set_group_color(group, color)
        self.operation_timings_s["component_color_update"] = perf_counter() - start

    def set_component_group_visibility(self, group: str, visible: bool) -> None:
        start = perf_counter()
        if self.component_view is not None:
            self.component_view.set_group_visibility(group, visible)
        self.operation_timings_s["component_visibility_update"] = perf_counter() - start

    def set_cad_clipping(self, clipping: ClippingConfig) -> None:
        start = perf_counter()
        if self.component_view is not None:
            self.component_view.set_clipping(clipping)
        self.operation_timings_s["cad_clipping_update"] = perf_counter() - start

    def reset_cad_clipping(self) -> None:
        self.set_cad_clipping(ClippingConfig(enabled=False))

    def _refresh_mcnp_visualization(self, timing_key: str) -> None:
        start = perf_counter()
        self._remove_mcnp_visualization()
        if self.visualization_mode == OFF_MODE:
            self.last_interpolation_note = None
            self.operation_timings_s[timing_key] = perf_counter() - start
            return
        if self.visualization_mode == ISO_SURFACE_MODE:
            display = create_mcnp_iso_surface(
                self.mcnp.mesh_mm,
                self.field_name,
                self.iso_value if self.iso_value is not None else self.default_iso_value(),
                self.use_log_scale,
            )
        else:
            display = create_mcnp_slice(
                self.mcnp.mesh_mm,
                self.slice_axis,
                self.slice_position_mm,
                self.field_name,
                self.use_log_scale,
            )
        self.last_interpolation_note = display.interpolation_note
        if display.mesh.n_points == 0 or display.mesh.n_cells == 0:
            self.last_interpolation_note = "Selected MCNP slice produced no visible cells."
            self.operation_timings_s[timing_key] = perf_counter() - start
            return
        self.plotter.add_mesh(
            display.mesh,
            scalars=display.scalar_name,
            cmap="inferno" if self.active_field.category == "Heating" else "viridis",
            name=MCNP_FIELD_ACTOR,
            show_scalar_bar=True,
            scalar_bar_args={"title": self.scalar_bar_title, "vertical": True},
            clim=display.scalar_range,
        )
        self.operation_timings_s[timing_key] = perf_counter() - start

    def _remove_mcnp_visualization(self) -> None:
        self.plotter.remove_actor(MCNP_FIELD_ACTOR)
        if self.scalar_bar_title in self.plotter.scalar_bars:
            self.plotter.remove_scalar_bar(self.scalar_bar_title)

    def _clamp_slice_position(self, position_mm: float) -> float:
        lower, upper = self.mcnp_axis_bounds(self.slice_axis)
        return max(lower, min(upper, float(position_mm)))


def build_blanket_viewer_scene(
    cad_path: Path,
    mcnp_path: Path,
    cad_opacity: float = 0.28,
    initial_slice_z_mm: float | None = None,
    off_screen: bool = False,
    show_debug_edges: bool = False,
    primitive_csg: PrimitiveCSGParameters | None = None,
    geometry_source: str = "parametric_csg",
) -> BlanketViewerScene:
    """Load CAD and MCNP data, then compose the PyVista scene."""
    cad = load_cad_display_geometry(cad_path)
    mcnp = load_mcnp_visualization_mesh(mcnp_path)
    slice_position = (
        axis_center(mcnp.summary.bounds_mm, "Z")
        if initial_slice_z_mm is None
        else initial_slice_z_mm
    )

    plotter = pv.Plotter(off_screen=off_screen)
    plotter.set_background("#f4f6f8")
    primitive_parameters = primitive_csg or DEFAULT_PRIMITIVE_CSG_PARAMETERS
    component_view = None
    if geometry_source == "parametric_csg":
        component_view = ComponentGeometryView(
            plotter=plotter,
            assembly=ParametricCSGGeometryProvider(primitive_parameters).build(),
        )
        component_view.set_opacity(cad_opacity)
    elif geometry_source == "step":
        for body in cad.tessellated.bodies:
            plotter.add_mesh(
                body.mesh,
                color="#aeb7c2",
                opacity=cad_opacity,
                name=_body_actor_name(body.body_id),
                smooth_shading=True,
            )
    else:
        raise ValueError(f"unknown geometry source: {geometry_source}")

    if show_debug_edges:
        plotter.add_mesh(
            cad.edge_wireframe,
            color="#1f2937",
            opacity=max(0.15, min(1.0, cad_opacity + 0.25)),
            name=CAD_EDGES_ACTOR,
            line_width=1.0,
        )
    plotter.add_axes()
    plotter.show_bounds(
        grid="front",
        location="outer",
        xtitle="X mm",
        ytitle="Y mm",
        ztitle="Z mm",
    )

    scene = BlanketViewerScene(
        plotter=plotter,
        cad=cad,
        mcnp=mcnp,
        slice_position_mm=float(slice_position),
        cad_opacity=cad_opacity,
        component_view=component_view,
        primitive_csg=primitive_parameters if component_view is not None else None,
        geometry_source=geometry_source,
        iso_value=None,
    )
    scene.iso_value = scene.default_iso_value()
    scene._refresh_mcnp_visualization("initial_field_visualization")
    plotter.camera_position = "iso"
    plotter.reset_camera()
    return scene


def _body_actor_name(body_id: str) -> str:
    return f"{CAD_BODY_ACTOR_PREFIX}{body_id}"
