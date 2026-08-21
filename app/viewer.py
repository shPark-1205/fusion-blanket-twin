"""Browser-based PyVista/trame viewer for Fusion Blanket Twin v0.1."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from fusion_blanket_twin.config.settings import (  # noqa: E402
    REPRESENTATIVE_CASE,
    REQUIRED_MCNP_FIELD,
    SAMPLE_CAD_PATH,
    SAMPLE_MCNP_PATH,
)
from fusion_blanket_twin.geometry.doe_mapping import CurrentDOEGeometryMapping  # noqa: E402
from fusion_blanket_twin.mcnp.fields import (  # noqa: E402
    DEFAULT_MCNP_FIELD_KEY,
    selectable_field_items,
)
from fusion_blanket_twin.visualization.component_display import (  # noqa: E402
    DEFAULT_COMPONENT_GROUP_COLORS,
    ClippingConfig,
)
from fusion_blanket_twin.surrogate.service import ScalarPredictionService  # noqa: E402
from fusion_blanket_twin.visualization.mcnp import (  # noqa: E402
    create_z_heating_slice,
    load_mcnp_heating_geometry,
    axis_center,
)
from fusion_blanket_twin.visualization.scene import build_blanket_viewer_scene  # noqa: E402


LOCAL_MCNP_INPUT_DIR = ROOT / "data" / "local" / "mcnp_inputs"
LOCAL_SCALAR_WORKBOOK = ROOT / "data" / "local" / "fusion_blanket_twin_100case_results_parsed.xlsx"
INITIAL_PZ_206_CM = 5.6
INITIAL_CZ_301_RADIUS_CM = 4.8
COMPONENT_GROUP_STATE_KEYS: dict[str, str] = {
    "Armor": "armor",
    "Breeder": "breeder",
    "Multiplier": "multiplier",
    "Structure": "structure",
    "Coolant": "coolant",
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Launch the v0.1 scientific 3D viewer.")
    parser.add_argument("--cad", type=Path, default=SAMPLE_CAD_PATH)
    parser.add_argument("--mcnp", type=Path, default=SAMPLE_MCNP_PATH)
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--host", default="localhost")
    parser.add_argument("--show-debug-edges", action="store_true")
    parser.add_argument(
        "--geometry-source",
        choices=("parametric_csg", "step"),
        default="parametric_csg",
        help="Geometry source for CAD/component rendering.",
    )
    parser.add_argument(
        "--ui-stage",
        choices=("basic", "primitive", "heating", "full"),
        default="full",
        help="Diagnostic launch stage for isolating trame/PyVista rendering.",
    )
    args = parser.parse_args(argv)

    launch_trame_viewer(
        cad_path=args.cad,
        mcnp_path=args.mcnp,
        host=args.host,
        port=args.port,
        show_debug_edges=args.show_debug_edges,
        ui_stage=args.ui_stage,
        geometry_source=args.geometry_source,
    )
    return 0


def launch_trame_viewer(
    cad_path: Path,
    mcnp_path: Path,
    host: str,
    port: int,
    show_debug_edges: bool = False,
    ui_stage: str = "full",
    geometry_source: str = "parametric_csg",
) -> None:
    try:
        from trame.app import get_server
        from trame.ui.vuetify3 import SinglePageWithDrawerLayout
        from trame.widgets import vtk as vtk_widgets
        from trame.widgets import vuetify3 as vuetify
    except ImportError as exc:
        raise RuntimeError(
            "Browser viewer requires trame-vtk and trame-vuetify. "
            "Run: .\\.venv\\Scripts\\pip.exe install -r requirements.txt"
        ) from exc

    server = get_server(client_type="vue3")
    state, controller = server.state, server.controller
    scalar_service = _try_build_scalar_prediction_service()
    geometry_mapping = _geometry_mapping_for_scalar_service(scalar_service)
    initial_primitive_csg = geometry_mapping.from_current_controls(
        INITIAL_PZ_206_CM,
        INITIAL_CZ_301_RADIUS_CM,
    )

    scene = None
    zmin = zmax = None
    if ui_stage == "primitive":
        scene = _build_primitive_scene()
    elif ui_stage == "heating":
        scene = _build_heating_scene(mcnp_path)
        zmin, zmax = scene.z_bounds_mm
        state.slice_z = scene.slice_z_mm
    elif ui_stage == "full":
        scene = build_blanket_viewer_scene(
            cad_path=cad_path,
            mcnp_path=mcnp_path,
            show_debug_edges=show_debug_edges,
            primitive_csg=initial_primitive_csg,
            geometry_source=geometry_source,
        )
        zmin, zmax = scene.z_bounds_mm
        state.slice_z = scene.slice_z_mm
        state.cad_opacity = scene.cad_opacity

    state.ui_stage = ui_stage
    state.geometry_source = geometry_source
    state.case_metadata = _case_metadata_lines()
    _initialize_scalar_prediction_state(state, scalar_service)

    if scene is not None and hasattr(scene, "cad"):
        state.cad_bounds_text = _format_bounds(scene.cad.summary.bounds_mm)
        state.cad_body_count_text = str(scene.cad.tessellated.body_count)
        state.cad_triangle_count_text = str(scene.cad.tessellated.triangle_count)
    else:
        state.cad_bounds_text = "not loaded"
        state.cad_body_count_text = "not loaded"
        state.cad_triangle_count_text = "not loaded"
    _initialize_component_display_state(state, scene)
    _initialize_mcnp_field_state(state, scene)

    if scene is not None and hasattr(scene, "mcnp"):
        state.mcnp_bounds_text = _format_bounds(scene.mcnp.summary.bounds_mm)
        state.field_range_text = _format_range(scene.active_field_range)
    else:
        state.mcnp_bounds_text = "not loaded"
        state.field_range_text = "not loaded"

    if ui_stage == "heating":
        @state.change("slice_z")
        def _on_slice_change(slice_z, **_kwargs):
            scene.update_slice(float(slice_z))
            controller.view_update()

    if ui_stage == "full":
        @state.change("cad_opacity")
        def _on_opacity_change(cad_opacity, **_kwargs):
            scene.update_cad_opacity(float(cad_opacity))
            _update_timing_state(state, scene)
            controller.view_update()

        _bind_component_display_handlers(state, controller, scene)
        _bind_mcnp_field_handlers(state, controller, scene)

        @state.change("cad_clipping_enabled")
        @state.change("cad_clipping_axis")
        @state.change("cad_clip_position")
        @state.change("cad_clipping_invert")
        def _on_cad_clipping_change(
            cad_clipping_enabled,
            cad_clipping_axis,
            cad_clip_position,
            cad_clipping_invert,
            **_kwargs,
        ):
            _refresh_clipping_axis_bounds(state, scene, preserve_position=True)
            scene.set_cad_clipping(
                ClippingConfig(
                    enabled=bool(cad_clipping_enabled),
                    axis=str(cad_clipping_axis),
                    position_mm=float(getattr(state, "cad_clip_position", cad_clip_position)),
                    invert=bool(cad_clipping_invert),
                )
            )
            controller.view_update()

    if scalar_service is not None:
        @state.change("scalar_pz_206")
        @state.change("scalar_cz_301_radius")
        def _on_scalar_design_change(scalar_pz_206, scalar_cz_301_radius, **_kwargs):
            _update_scalar_prediction_state(
                state,
                scalar_service,
                float(scalar_pz_206),
                float(scalar_cz_301_radius),
            )
            if scene is not None and ui_stage == "full":
                state.geometry_pending_text = "Geometry update pending"
                controller.view_update()

    def _button_action() -> None:
        if scene is not None:
            scene.reset_camera()
            controller.view_update()

    controller.button_action = _button_action

    def _apply_design_geometry() -> None:
        if scene is not None and ui_stage == "full":
            scene.update_parametric_geometry(
                geometry_mapping.from_current_controls(
                    float(state.scalar_pz_206),
                    float(state.scalar_cz_301_radius),
                )
            )
            state.geometry_pending_text = "Geometry matches selected design"
            state.cad_bounds_text = _format_bounds(scene.component_bounds_mm)
            _refresh_clipping_axis_bounds(state, scene, preserve_position=True)
            _update_timing_state(state, scene)
            controller.view_update()

    controller.apply_design_geometry = _apply_design_geometry

    def _reset_cad_clipping() -> None:
        if scene is not None:
            scene.reset_cad_clipping()
            _refresh_clipping_axis_bounds(state, scene, preserve_position=False)
            state.cad_clipping_enabled = False
            state.cad_clip_position = state.cad_clip_default
            _update_timing_state(state, scene)
            controller.view_update()

    controller.reset_cad_clipping = _reset_cad_clipping

    def _reset_mcnp_slice() -> None:
        if scene is not None:
            scene.reset_mcnp_slice()
            _refresh_mcnp_slice_axis_bounds(state, scene, preserve_position=True)
            state.mcnp_slice_position = scene.slice_position_mm
            _update_mcnp_field_state(state, scene)
            controller.view_update()

    controller.reset_mcnp_slice = _reset_mcnp_slice

    with SinglePageWithDrawerLayout(server) as layout:
        layout.title.set_text("Fusion Blanket Twin")
        with layout.toolbar:
            vuetify.VSpacer()
            vuetify.VBtn("Reset Camera", click=controller.button_action)
        with layout.drawer:
            vuetify.VCardTitle("v0.1 Scientific Viewer")
            vuetify.VDivider()
            vuetify.VCardText("Trame UI loaded")
            vuetify.VCardText(f"Stage: {ui_stage}")
            vuetify.VDivider(classes="my-2")
            if ui_stage == "heating":
                vuetify.VCardText("Heating Slice")
                vuetify.VSlider(
                    v_model=("slice_z", scene.slice_z_mm),
                    min=float(zmin),
                    max=float(zmax),
                    step=1.0,
                    label="Z slice mm",
                    thumb_label=True,
                    hide_details=False,
                )
            if ui_stage == "full":
                vuetify.VCardText("DESIGN")
                if scalar_service is None:
                    vuetify.VCardText("Scalar prediction unavailable")
                else:
                    vuetify.VSlider(
                        v_model=("scalar_pz_206", state.scalar_pz_206),
                        min=float(state.scalar_pz_206_min),
                        max=float(state.scalar_pz_206_max),
                        step=0.05,
                        label="PZ 206 cm",
                        thumb_label=True,
                        hide_details=True,
                    )
                    vuetify.VSlider(
                        v_model=("scalar_cz_301_radius", state.scalar_cz_301_radius),
                        min=float(state.scalar_cz_301_radius_min),
                        max=float(state.scalar_cz_301_radius_max),
                        step=0.01,
                        label="CZ 301 radius cm",
                        thumb_label=True,
                        hide_details=True,
                    )
                    vuetify.VBtn("Apply Geometry", click=controller.apply_design_geometry)
                    vuetify.VCardText("{{ geometry_pending_text }}")
                    vuetify.VCardText("{{ scalar_source_text }}")
                    vuetify.VCardText("Nearest MCNP case: {{ scalar_nearest_case_text }}")
                vuetify.VDivider(classes="my-2")
                vuetify.VCardText("PERFORMANCE")
                vuetify.VCardText("Total TBR: {{ scalar_total_tbr_text }}")
                vuetify.VCardText("Li-6 TBR: {{ scalar_li6_tbr_text }}")
                vuetify.VCardText("Li-7 TBR: {{ scalar_li7_tbr_text }}")
                vuetify.VCardText("Multiplying: {{ scalar_multiplying_text }}")
                vuetify.VCardText("{{ scalar_warning_text }}")
                vuetify.VDivider(classes="my-2")
                vuetify.VCardText("GEOMETRY")
                vuetify.VSlider(
                    v_model=("cad_opacity", scene.cad_opacity),
                    min=0.05,
                    max=1.0,
                    step=0.05,
                    label="CAD opacity",
                    hide_details=True,
                )
                vuetify.VCardText("Geometry source: {{ geometry_source }}")
                vuetify.VCardText(f"CAD solids: {state.cad_body_count_text}")
                vuetify.VCardText(f"CAD triangles: {state.cad_triangle_count_text}")
                vuetify.VCardText(f"CAD bounds: {state.cad_bounds_text}")
                vuetify.VCardText(f"MCNP bounds: {state.mcnp_bounds_text}")
                vuetify.VCardText(f"Heating range: {state.field_range_text}")
                vuetify.VCardText("3D field: loaded MCNP simulation")
                vuetify.VDivider(classes="my-2")
                vuetify.VCardText("Component Colors")
                for group, key in COMPONENT_GROUP_STATE_KEYS.items():
                    vuetify.VTextField(
                        v_model=(f"component_color_{key}", DEFAULT_COMPONENT_GROUP_COLORS[group]),
                        label=f"{group} color",
                        type="color",
                        density="compact",
                        hide_details=True,
                    )
                vuetify.VDivider(classes="my-2")
                vuetify.VCardText("Component Visibility")
                for group, key in COMPONENT_GROUP_STATE_KEYS.items():
                    vuetify.VCheckbox(
                        v_model=(f"component_visible_{key}", True),
                        label=group,
                        density="compact",
                        hide_details=True,
                    )
                vuetify.VDivider(classes="my-2")
                vuetify.VCardText("CAD Clipping")
                vuetify.VCheckbox(
                    v_model=("cad_clipping_enabled", state.cad_clipping_enabled),
                    label="Enable clipping",
                    density="compact",
                    hide_details=True,
                )
                vuetify.VSelect(
                    v_model=("cad_clipping_axis", state.cad_clipping_axis),
                    items=("cad_clipping_axis_options", state.cad_clipping_axis_options),
                    label="Axis",
                    density="compact",
                    hide_details=True,
                )
                vuetify.VSlider(
                    v_model=("cad_clip_position", state.cad_clip_position),
                    min=("cad_clip_min", state.cad_clip_min),
                    max=("cad_clip_max", state.cad_clip_max),
                    step=1.0,
                    label="Clip position mm",
                    thumb_label=True,
                    hide_details=True,
                )
                vuetify.VCheckbox(
                    v_model=("cad_clipping_invert", state.cad_clipping_invert),
                    label="Invert",
                    density="compact",
                    hide_details=True,
                )
                vuetify.VBtn("Reset clipping", click=controller.reset_cad_clipping)
                vuetify.VDivider(classes="my-2")
                vuetify.VCardText("NEUTRONICS")
                vuetify.VSelect(
                    v_model=("mcnp_active_field_key", state.mcnp_active_field_key),
                    items=("mcnp_field_items", state.mcnp_field_items),
                    item_title="title",
                    item_value="value",
                    label="MCNP field",
                    density="compact",
                    hide_details=True,
                )
                vuetify.VCardText("Active field: {{ mcnp_active_field_text }}")
                vuetify.VCardText("Units: {{ mcnp_active_units_text }}")
                vuetify.VCardText("Range: {{ field_range_text }}")
                vuetify.VSelect(
                    v_model=("mcnp_visualization_mode", state.mcnp_visualization_mode),
                    items=("mcnp_visualization_modes", state.mcnp_visualization_modes),
                    label="Visualization mode",
                    density="compact",
                    hide_details=True,
                )
                vuetify.VCheckbox(
                    v_model=("mcnp_use_log_scale", state.mcnp_use_log_scale),
                    label="Log10 display",
                    density="compact",
                    hide_details=True,
                )
                vuetify.VSelect(
                    v_model=("mcnp_slice_axis", state.mcnp_slice_axis),
                    items=("mcnp_slice_axis_options", state.mcnp_slice_axis_options),
                    label="Slice axis",
                    density="compact",
                    hide_details=True,
                )
                vuetify.VSlider(
                    v_model=("mcnp_slice_position", state.mcnp_slice_position),
                    min=("mcnp_slice_min", state.mcnp_slice_min),
                    max=("mcnp_slice_max", state.mcnp_slice_max),
                    step=1.0,
                    label="Slice position mm",
                    thumb_label=True,
                    hide_details=True,
                )
                vuetify.VBtn("Reset Slice", click=controller.reset_mcnp_slice)
                vuetify.VSlider(
                    v_model=("mcnp_iso_value", state.mcnp_iso_value),
                    min=("mcnp_iso_min", state.mcnp_iso_min),
                    max=("mcnp_iso_max", state.mcnp_iso_max),
                    step=("mcnp_iso_step", state.mcnp_iso_step),
                    label="Iso value",
                    thumb_label=True,
                    hide_details=True,
                )
                vuetify.VCardText("{{ mcnp_interpolation_note }}")
                vuetify.VCardText("Last field switch: {{ timing_field_switch_text }}")
                vuetify.VCardText("Last slice update: {{ timing_slice_update_text }}")
                vuetify.VCardText("Last iso update: {{ timing_iso_update_text }}")
                vuetify.VDivider(classes="my-2")
                vuetify.VCardText("DATA PROVENANCE")
                vuetify.VCardText("Geometry: {{ geometry_source }}")
                vuetify.VCardText("Scalar KPIs: {{ scalar_source_text }}")
                vuetify.VCardText("3D MCNP Field: Loaded Simulation Dataset")
                vuetify.VCardText(
                    "Geometry and scalar KPIs follow the selected design after Apply Geometry. "
                    "The 3D MCNP field remains the currently loaded simulation dataset "
                    "until field-surrogate integration is available."
                )
                for line in state.case_metadata:
                    vuetify.VCardText(line)
        with layout.content:
            if scene is None:
                vuetify.VContainer(
                    children=[vuetify.VCardText("Trame UI loaded")],
                    fluid=True,
                )
                controller.view_update = lambda: None
            else:
                view = vtk_widgets.VtkRemoteView(scene.plotter.ren_win, interactive_ratio=1)
                controller.view_update = view.update
                controller.view_reset_camera = view.reset_camera

    print(f"Fusion Blanket Twin viewer ({ui_stage}): http://{host}:{port}")
    server.start(host=host, port=port, open_browser=False)


def _build_primitive_scene():
    import pyvista as pv

    plotter = pv.Plotter()
    plotter.set_background("#f4f6f8")
    plotter.add_mesh(pv.Cube(center=(-0.75, 0.0, 0.0)), color="#6b7280", opacity=0.65)
    plotter.add_mesh(pv.Sphere(center=(0.9, 0.0, 0.0), radius=0.5), color="#f97316")
    plotter.add_axes()
    plotter.reset_camera()
    return _SimpleScene(plotter=plotter)


def _build_heating_scene(mcnp_path: Path):
    import pyvista as pv

    mcnp = load_mcnp_heating_geometry(mcnp_path)
    zmin, zmax = mcnp.summary.bounds_mm[4], mcnp.summary.bounds_mm[5]
    slice_z = (zmin + zmax) * 0.5
    plotter = pv.Plotter()
    plotter.set_background("#f4f6f8")
    _add_heating_slice_to_plotter(plotter, mcnp.mesh_mm, slice_z)
    plotter.add_axes()
    plotter.show_bounds(
        grid="front",
        location="outer",
        xtitle="X mm",
        ytitle="Y mm",
        ztitle="Z mm",
    )
    plotter.reset_camera()
    return _HeatingScene(plotter=plotter, mcnp=mcnp, slice_z_mm=slice_z)


class _SimpleScene:
    def __init__(self, plotter):
        self.plotter = plotter

    def reset_camera(self) -> None:
        self.plotter.reset_camera()


class _HeatingScene:
    def __init__(self, plotter, mcnp, slice_z_mm):
        self.plotter = plotter
        self.mcnp = mcnp
        self.slice_z_mm = float(slice_z_mm)

    @property
    def z_bounds_mm(self) -> tuple[float, float]:
        return self.mcnp.summary.bounds_mm[4], self.mcnp.summary.bounds_mm[5]

    def update_slice(self, z_mm: float) -> None:
        self.slice_z_mm = float(z_mm)
        self.plotter.remove_actor("heating_slice")
        _add_heating_slice_to_plotter(self.plotter, self.mcnp.mesh_mm, self.slice_z_mm)

    def reset_camera(self) -> None:
        self.plotter.reset_camera()


def _add_heating_slice_to_plotter(plotter, mesh_mm, z_mm: float) -> None:
    heating_slice = create_z_heating_slice(mesh_mm, z_mm, REQUIRED_MCNP_FIELD)
    plotter.add_mesh(
        heating_slice,
        scalars=REQUIRED_MCNP_FIELD,
        preference="cell",
        cmap="inferno",
        name="heating_slice",
        show_scalar_bar=True,
        scalar_bar_args={"title": REQUIRED_MCNP_FIELD, "vertical": True},
    )


def _case_metadata_lines() -> list[str]:
    case = REPRESENTATIVE_CASE
    return [
        f"TBR: {case.tbr}",
        f"NWL: {case.nwl_mw_m2} MW/m2",
        f"Breeder ratio: {case.breeder_ratio:.1%}",
        f"Coolant: {case.coolant}",
        f"Pressure: {case.pressure_mpa} MPa",
        f"Tin: {case.inlet_temperature_c:g} C",
        f"Expected Tout: {case.expected_outlet_temperature_c:g} C",
        f"Mass flow: {case.mass_flow}",
    ]


def _try_build_scalar_prediction_service() -> ScalarPredictionService | None:
    try:
        return ScalarPredictionService.from_paths(
            LOCAL_MCNP_INPUT_DIR,
            LOCAL_SCALAR_WORKBOOK,
        )
    except (FileNotFoundError, ValueError):
        return None


def _geometry_mapping_for_scalar_service(
    scalar_service: ScalarPredictionService | None,
) -> CurrentDOEGeometryMapping:
    if scalar_service is None:
        return CurrentDOEGeometryMapping.current_fixed_spacing()
    return CurrentDOEGeometryMapping.from_registry(scalar_service.registry)


def _initialize_scalar_prediction_state(state, scalar_service: ScalarPredictionService | None) -> None:
    state.geometry_pending_text = "Geometry matches selected design"
    if scalar_service is None:
        state.scalar_prediction_available = False
        state.scalar_source_text = "Scalar prediction unavailable"
        state.scalar_nearest_case_text = "not loaded"
        state.scalar_total_tbr_text = "not loaded"
        state.scalar_li6_tbr_text = "not loaded"
        state.scalar_li7_tbr_text = "not loaded"
        state.scalar_multiplying_text = "not loaded"
        state.scalar_warning_text = ""
        return

    state.scalar_prediction_available = True
    state.scalar_pz_206_min = float(scalar_service.domain_min[0])
    state.scalar_pz_206_max = float(scalar_service.domain_max[0])
    state.scalar_cz_301_radius_min = float(scalar_service.domain_min[1])
    state.scalar_cz_301_radius_max = float(scalar_service.domain_max[1])
    state.scalar_pz_206 = INITIAL_PZ_206_CM
    state.scalar_cz_301_radius = INITIAL_CZ_301_RADIUS_CM
    _update_scalar_prediction_state(
        state,
        scalar_service,
        state.scalar_pz_206,
        state.scalar_cz_301_radius,
    )


def _update_scalar_prediction_state(
    state,
    scalar_service: ScalarPredictionService,
    pz_206: float,
    cz_301_radius: float,
) -> None:
    prediction = scalar_service.predict(pz_206, cz_301_radius)
    source_label = {
        "simulation": "SIMULATION",
        "surrogate": "SURROGATE PREDICTION",
    }[prediction.metadata.source]
    if prediction.metadata.domain_status == "extrapolation":
        source_label = "EXTRAPOLATION"

    state.scalar_source_text = (
        f"{source_label} - {prediction.metadata.domain_status.upper()}"
    )
    state.scalar_nearest_case_text = prediction.metadata.nearest_case_id
    state.scalar_total_tbr_text = _format_scalar_value(prediction.kpis.total_tbr)
    state.scalar_li6_tbr_text = _format_scalar_value(prediction.kpis.li6_tbr)
    state.scalar_li7_tbr_text = _format_scalar_value(prediction.kpis.li7_tbr)
    state.scalar_multiplying_text = _format_scalar_value(prediction.kpis.multiplying)
    state.scalar_warning_text = prediction.metadata.warning or ""


def _initialize_component_display_state(state, scene) -> None:
    for group, key in COMPONENT_GROUP_STATE_KEYS.items():
        setattr(state, f"component_color_{key}", DEFAULT_COMPONENT_GROUP_COLORS[group])
        setattr(state, f"component_visible_{key}", True)
    state.cad_clipping_axis_options = ["X", "Y", "Z"]
    state.cad_clipping_enabled = False
    state.cad_clipping_axis = "Z"
    state.cad_clipping_invert = False
    _refresh_clipping_axis_bounds(state, scene, preserve_position=False)
    state.cad_clip_position = state.cad_clip_default


def _initialize_mcnp_field_state(state, scene) -> None:
    state.mcnp_field_items = selectable_field_items()
    state.mcnp_visualization_modes = ["Off", "Slice", "Iso-surface"]
    state.mcnp_slice_axis_options = ["X", "Y", "Z"]
    state.mcnp_active_field_key = DEFAULT_MCNP_FIELD_KEY
    state.mcnp_visualization_mode = "Slice"
    state.mcnp_use_log_scale = False
    state.mcnp_slice_axis = "Z"
    if scene is None or not hasattr(scene, "mcnp"):
        state.mcnp_active_field_text = "not loaded"
        state.mcnp_active_units_text = "not loaded"
        state.mcnp_slice_min = 0.0
        state.mcnp_slice_max = 1.0
        state.mcnp_slice_default = 0.5
        state.mcnp_slice_position = 0.5
        state.mcnp_iso_min = 0.0
        state.mcnp_iso_max = 1.0
        state.mcnp_iso_step = 0.1
        state.mcnp_iso_value = 0.5
        state.mcnp_interpolation_note = ""
        _initialize_timing_state(state)
        return

    _refresh_mcnp_slice_axis_bounds(state, scene, preserve_position=False)
    state.mcnp_slice_position = scene.slice_position_mm
    _update_mcnp_field_state(state, scene)
    _initialize_timing_state(state)


def _bind_mcnp_field_handlers(state, controller, scene) -> None:
    @state.change("mcnp_active_field_key")
    def _on_mcnp_field_change(mcnp_active_field_key, **_kwargs):
        scene.set_mcnp_field(str(mcnp_active_field_key))
        _update_mcnp_field_state(state, scene)
        controller.view_update()

    @state.change("mcnp_slice_axis")
    @state.change("mcnp_slice_position")
    def _on_mcnp_slice_change(mcnp_slice_axis, mcnp_slice_position, **_kwargs):
        _refresh_mcnp_slice_axis_bounds(state, scene, preserve_position=True)
        scene.update_mcnp_slice(
            str(mcnp_slice_axis),
            float(getattr(state, "mcnp_slice_position", mcnp_slice_position)),
        )
        state.mcnp_slice_position = scene.slice_position_mm
        _update_mcnp_field_state(state, scene)
        controller.view_update()

    @state.change("mcnp_visualization_mode")
    def _on_mcnp_visualization_mode_change(mcnp_visualization_mode, **_kwargs):
        scene.set_visualization_mode(str(mcnp_visualization_mode))
        _update_mcnp_field_state(state, scene)
        controller.view_update()

    @state.change("mcnp_use_log_scale")
    def _on_mcnp_log_scale_change(mcnp_use_log_scale, **_kwargs):
        scene.set_log_scale(bool(mcnp_use_log_scale))
        _update_mcnp_field_state(state, scene)
        controller.view_update()

    @state.change("mcnp_iso_value")
    def _on_mcnp_iso_value_change(mcnp_iso_value, **_kwargs):
        if str(getattr(state, "mcnp_visualization_mode", "Slice")) != "Iso-surface":
            return
        scene.update_iso_value(float(mcnp_iso_value))
        _update_mcnp_field_state(state, scene)
        controller.view_update()


def _bind_component_display_handlers(state, controller, scene) -> None:
    for group, key in COMPONENT_GROUP_STATE_KEYS.items():
        color_field = f"component_color_{key}"
        visible_field = f"component_visible_{key}"

        def _make_color_handler(component_group: str, field: str):
            @state.change(field)
            def _on_component_color_change(**_kwargs):
                scene.set_component_group_color(component_group, str(getattr(state, field)))
                _update_timing_state(state, scene)
                controller.view_update()

            return _on_component_color_change

        def _make_visibility_handler(component_group: str, field: str):
            @state.change(field)
            def _on_component_visibility_change(**_kwargs):
                scene.set_component_group_visibility(
                    component_group,
                    bool(getattr(state, field)),
                )
                state.cad_bounds_text = _format_bounds(scene.component_bounds_mm)
                _refresh_clipping_axis_bounds(state, scene, preserve_position=True)
                _update_timing_state(state, scene)
                controller.view_update()

            return _on_component_visibility_change

        _make_color_handler(group, color_field)
        _make_visibility_handler(group, visible_field)


def _update_mcnp_field_state(state, scene) -> None:
    field = scene.active_field
    state.mcnp_active_field_key = scene.active_field_key
    state.mcnp_active_field_text = field.display_name
    state.mcnp_active_units_text = field.units
    state.field_range_text = _format_range(scene.active_field_range)
    low, high = scene.active_display_range
    state.mcnp_iso_min = low
    state.mcnp_iso_max = high
    state.mcnp_iso_step = _iso_step(low, high)
    if scene.iso_value is None or scene.iso_value < low or scene.iso_value > high:
        scene.iso_value = scene.default_iso_value()
    state.mcnp_iso_value = scene.iso_value
    state.mcnp_interpolation_note = scene.last_interpolation_note or ""
    _refresh_mcnp_slice_axis_bounds(state, scene, preserve_position=True)
    _update_timing_state(state, scene)


def _refresh_mcnp_slice_axis_bounds(state, scene, preserve_position: bool) -> None:
    axis = str(getattr(state, "mcnp_slice_axis", "Z")).upper()
    lower, upper = scene.mcnp_axis_bounds(axis)
    default = axis_center(scene.mcnp.summary.bounds_mm, axis)
    state.mcnp_slice_min = lower
    state.mcnp_slice_max = upper
    state.mcnp_slice_default = default
    if not preserve_position:
        state.mcnp_slice_position = default
        return
    position = float(getattr(state, "mcnp_slice_position", default))
    if position < lower or position > upper:
        state.mcnp_slice_position = default


def _initialize_timing_state(state) -> None:
    state.timing_field_switch_text = "not measured"
    state.timing_slice_update_text = "not measured"
    state.timing_iso_update_text = "not measured"
    state.timing_geometry_update_text = "not measured"


def _update_timing_state(state, scene) -> None:
    timings = scene.operation_timings_s
    state.timing_field_switch_text = _format_timing(timings.get("field_switch"))
    state.timing_slice_update_text = _format_timing(timings.get("slice_update"))
    state.timing_iso_update_text = _format_timing(
        timings.get("iso_surface_update")
        or timings.get("visualization_mode_update")
    )
    state.timing_geometry_update_text = _format_timing(
        timings.get("parametric_geometry_update")
    )


def _refresh_clipping_axis_bounds(state, scene, preserve_position: bool) -> None:
    bounds = scene.component_bounds_mm if scene is not None else (0.0, 1.0, 0.0, 1.0, 0.0, 1.0)
    axis = str(getattr(state, "cad_clipping_axis", "Z")).upper()
    axis_indices = {"X": (0, 1), "Y": (2, 3), "Z": (4, 5)}
    lower_index, upper_index = axis_indices.get(axis, (4, 5))
    lower = float(bounds[lower_index])
    upper = float(bounds[upper_index])
    default = (lower + upper) * 0.5
    state.cad_clip_min = lower
    state.cad_clip_max = upper
    state.cad_clip_default = default
    if not preserve_position:
        state.cad_clip_position = default
        return

    position = float(getattr(state, "cad_clip_position", default))
    if position < lower or position > upper:
        state.cad_clip_position = default


def _format_scalar_value(value: float) -> str:
    return f"{value:.6g}"


def _format_range(values: tuple[float, float]) -> str:
    return f"{values[0]:.6g} to {values[1]:.6g}"


def _format_timing(value: float | None) -> str:
    if value is None:
        return "not measured"
    return f"{value * 1000.0:.1f} ms"


def _iso_step(low: float, high: float) -> float:
    span = abs(high - low)
    if span == 0.0:
        return 1.0
    return max(span / 200.0, 1.0e-12)


def _format_bounds(bounds: tuple[float, float, float, float, float, float]) -> str:
    return (
        f"X[{bounds[0]:.3g}, {bounds[1]:.3g}] "
        f"Y[{bounds[2]:.3g}, {bounds[3]:.3g}] "
        f"Z[{bounds[4]:.3g}, {bounds[5]:.3g}] mm"
    )


if __name__ == "__main__":
    raise SystemExit(main())
