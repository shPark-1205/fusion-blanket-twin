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
from fusion_blanket_twin.surrogate.service import ScalarPredictionService  # noqa: E402
from fusion_blanket_twin.visualization.mcnp import (  # noqa: E402
    create_z_heating_slice,
    load_mcnp_heating_geometry,
)
from fusion_blanket_twin.visualization.scene import build_blanket_viewer_scene  # noqa: E402


LOCAL_MCNP_INPUT_DIR = ROOT / "data" / "local" / "mcnp_inputs"
LOCAL_SCALAR_WORKBOOK = ROOT / "data" / "local" / "fusion_blanket_twin_100case_results_parsed.xlsx"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Launch the v0.1 scientific 3D viewer.")
    parser.add_argument("--cad", type=Path, default=SAMPLE_CAD_PATH)
    parser.add_argument("--mcnp", type=Path, default=SAMPLE_MCNP_PATH)
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--host", default="localhost")
    parser.add_argument("--show-debug-edges", action="store_true")
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
    )
    return 0


def launch_trame_viewer(
    cad_path: Path,
    mcnp_path: Path,
    host: str,
    port: int,
    show_debug_edges: bool = False,
    ui_stage: str = "full",
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
        )
        zmin, zmax = scene.z_bounds_mm
        state.slice_z = scene.slice_z_mm
        state.cad_opacity = scene.cad_opacity

    state.ui_stage = ui_stage
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

    if scene is not None and hasattr(scene, "mcnp"):
        state.mcnp_bounds_text = _format_bounds(scene.mcnp.summary.bounds_mm)
        state.field_range_text = (
            f"{scene.mcnp.summary.field_range[0]:.6g} to "
            f"{scene.mcnp.summary.field_range[1]:.6g} W/cm3"
        )
    else:
        state.mcnp_bounds_text = "not loaded"
        state.field_range_text = "not loaded"

    if ui_stage in ("heating", "full"):
        @state.change("slice_z")
        def _on_slice_change(slice_z, **_kwargs):
            scene.update_slice(float(slice_z))
            controller.view_update()

    if ui_stage == "full":
        @state.change("cad_opacity")
        def _on_opacity_change(cad_opacity, **_kwargs):
            scene.update_cad_opacity(float(cad_opacity))
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

    def _button_action() -> None:
        if scene is not None:
            scene.reset_camera()
            controller.view_update()

    controller.button_action = _button_action

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
            if ui_stage in ("heating", "full"):
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
                vuetify.VCardText("Geometry")
                vuetify.VSlider(
                    v_model=("cad_opacity", scene.cad_opacity),
                    min=0.05,
                    max=1.0,
                    step=0.05,
                    label="CAD opacity",
                    hide_details=True,
                )
                vuetify.VCardText(f"CAD solids: {state.cad_body_count_text}")
                vuetify.VCardText(f"CAD triangles: {state.cad_triangle_count_text}")
                vuetify.VCardText(f"CAD bounds: {state.cad_bounds_text}")
                vuetify.VCardText(f"MCNP bounds: {state.mcnp_bounds_text}")
                vuetify.VCardText(f"Heating range: {state.field_range_text}")
                vuetify.VCardText("3D field: loaded MCNP simulation")
                vuetify.VDivider(classes="my-2")
                vuetify.VCardText("Case")
                for line in state.case_metadata:
                    vuetify.VCardText(line)
                vuetify.VDivider(classes="my-2")
                vuetify.VCardText("Scalar Design")
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
                    vuetify.VCardText("{{ scalar_source_text }}")
                    vuetify.VCardText("Nearest MCNP case: {{ scalar_nearest_case_text }}")
                    vuetify.VCardText("Total TBR: {{ scalar_total_tbr_text }}")
                    vuetify.VCardText("Li-6 TBR: {{ scalar_li6_tbr_text }}")
                    vuetify.VCardText("Li-7 TBR: {{ scalar_li7_tbr_text }}")
                    vuetify.VCardText("Multiplying: {{ scalar_multiplying_text }}")
                    vuetify.VCardText("{{ scalar_warning_text }}")
                    vuetify.VCardText(
                        "Scalar KPIs follow the selected design parameters. "
                        "The 3D heating field remains the currently loaded MCNP simulation "
                        "until field-surrogate integration is available."
                    )
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


def _initialize_scalar_prediction_state(state, scalar_service: ScalarPredictionService | None) -> None:
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
    state.scalar_pz_206 = 5.6
    state.scalar_cz_301_radius = 4.8
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


def _format_scalar_value(value: float) -> str:
    return f"{value:.6g}"


def _format_bounds(bounds: tuple[float, float, float, float, float, float]) -> str:
    return (
        f"X[{bounds[0]:.3g}, {bounds[1]:.3g}] "
        f"Y[{bounds[2]:.3g}, {bounds[3]:.3g}] "
        f"Z[{bounds[4]:.3g}, {bounds[5]:.3g}] mm"
    )


if __name__ == "__main__":
    raise SystemExit(main())
