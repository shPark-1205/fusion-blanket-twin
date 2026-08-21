"""Build the PyVista scene for the v0.1 scientific viewer."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pyvista as pv

from fusion_blanket_twin.config.settings import REQUIRED_MCNP_FIELD
from fusion_blanket_twin.geometry.csg import PrimitiveCSGParameters
from fusion_blanket_twin.geometry.parametric_csg import (
    DEFAULT_PRIMITIVE_CSG_PARAMETERS,
    ParametricCSGGeometryProvider,
)
from fusion_blanket_twin.visualization.cad import CadDisplayGeometry, load_cad_display_geometry
from fusion_blanket_twin.visualization.component_display import (
    ClippingConfig,
    ComponentGeometryView,
)
from fusion_blanket_twin.visualization.mcnp import (
    McnpHeatingGeometry,
    create_z_heating_slice,
    load_mcnp_heating_geometry,
)


CAD_BODY_ACTOR_PREFIX = "cad_body_"
CAD_OUTLINE_ACTOR = "cad_outline_debug"
CAD_EDGES_ACTOR = "cad_edges"
HEATING_SLICE_ACTOR = "heating_slice"


@dataclass
class BlanketViewerScene:
    plotter: pv.Plotter
    cad: CadDisplayGeometry
    mcnp: McnpHeatingGeometry
    slice_z_mm: float
    cad_opacity: float
    component_view: ComponentGeometryView | None = None
    primitive_csg: PrimitiveCSGParameters | None = None
    geometry_source: str = "parametric_csg"
    field_name: str = REQUIRED_MCNP_FIELD

    @property
    def z_bounds_mm(self) -> tuple[float, float]:
        return self.mcnp.summary.bounds_mm[4], self.mcnp.summary.bounds_mm[5]

    @property
    def component_bounds_mm(self) -> tuple[float, float, float, float, float, float]:
        if self.component_view is not None:
            return self.component_view.bounds_mm
        return self.cad.summary.bounds_mm

    def update_slice(self, z_mm: float) -> None:
        self.slice_z_mm = float(z_mm)
        self.plotter.remove_actor(HEATING_SLICE_ACTOR)
        _add_heating_slice(self.plotter, self.mcnp.mesh_mm, self.slice_z_mm, self.field_name)

    def update_cad_opacity(self, opacity: float) -> None:
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

    def update_parametric_geometry(self, parameters: PrimitiveCSGParameters) -> None:
        if self.component_view is None:
            return
        provider = ParametricCSGGeometryProvider(parameters)
        self.component_view.update_geometry(provider.build())
        self.primitive_csg = parameters

    def set_component_group_color(self, group: str, color: str) -> None:
        if self.component_view is not None:
            self.component_view.set_group_color(group, color)

    def set_component_group_visibility(self, group: str, visible: bool) -> None:
        if self.component_view is not None:
            self.component_view.set_group_visibility(group, visible)

    def set_cad_clipping(self, clipping: ClippingConfig) -> None:
        if self.component_view is not None:
            self.component_view.set_clipping(clipping)

    def reset_cad_clipping(self) -> None:
        if self.component_view is not None:
            self.component_view.reset_clipping()

    def reset_camera(self) -> None:
        self.plotter.reset_camera()


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
    mcnp = load_mcnp_heating_geometry(mcnp_path)
    zmin, zmax = mcnp.summary.bounds_mm[4], mcnp.summary.bounds_mm[5]
    slice_z = (zmin + zmax) * 0.5 if initial_slice_z_mm is None else initial_slice_z_mm

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
    _add_heating_slice(plotter, mcnp.mesh_mm, slice_z, REQUIRED_MCNP_FIELD)
    plotter.add_axes()
    plotter.show_bounds(
        grid="front",
        location="outer",
        xtitle="X mm",
        ytitle="Y mm",
        ztitle="Z mm",
    )
    plotter.camera_position = "iso"
    plotter.reset_camera()

    return BlanketViewerScene(
        plotter=plotter,
        cad=cad,
        mcnp=mcnp,
        slice_z_mm=float(slice_z),
        cad_opacity=cad_opacity,
        component_view=component_view,
        primitive_csg=primitive_parameters if component_view is not None else None,
        geometry_source=geometry_source,
    )


def _body_actor_name(body_id: str) -> str:
    return f"{CAD_BODY_ACTOR_PREFIX}{body_id}"


def _add_heating_slice(
    plotter: pv.Plotter,
    mesh_mm: pv.DataSet,
    z_mm: float,
    field_name: str,
) -> None:
    heating_slice = create_z_heating_slice(mesh_mm, z_mm, field_name)
    plotter.add_mesh(
        heating_slice,
        scalars=field_name,
        preference="cell",
        cmap="inferno",
        name=HEATING_SLICE_ACTOR,
        show_scalar_bar=True,
        scalar_bar_args={
            "title": field_name,
            "vertical": True,
        },
    )
