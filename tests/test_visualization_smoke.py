import unittest

from fusion_blanket_twin.config.settings import (
    REQUIRED_MCNP_FIELD,
    SAMPLE_CAD_PATH,
    SAMPLE_MCNP_PATH,
)
from fusion_blanket_twin.visualization.component_display import ClippingConfig
from fusion_blanket_twin.visualization.cad import load_cad_display_geometry
from fusion_blanket_twin.visualization.mcnp import create_z_heating_slice, load_mcnp_heating_geometry
from fusion_blanket_twin.visualization.scene import (
    ISO_SURFACE_MODE,
    MCNP_FIELD_ACTOR,
    OFF_MODE,
    SLICE_MODE,
    build_blanket_viewer_scene,
)


class VisualizationSmokeTests(unittest.TestCase):
    def test_step_cad_display_geometry(self):
        cad = load_cad_display_geometry(SAMPLE_CAD_PATH)
        self.assertEqual(cad.summary.solid_count, 26)
        self.assertEqual(cad.tessellated.body_count, 26)
        self.assertGreater(cad.tessellated.triangle_count, 0)
        self.assertGreater(cad.edge_wireframe.n_cells, 0)
        self.assertGreater(cad.outline.n_cells, 0)

    def test_mcnp_heating_mesh_is_scaled_to_mm_and_sliceable(self):
        if not SAMPLE_MCNP_PATH.exists():
            self.skipTest(f"sample MCNP file not available: {SAMPLE_MCNP_PATH}")
        mcnp = load_mcnp_heating_geometry(SAMPLE_MCNP_PATH)
        self.assertIn(REQUIRED_MCNP_FIELD, mcnp.mesh_mm.cell_data)
        self.assertAlmostEqual(mcnp.mesh_mm.bounds[5], 921.0, delta=1.0e-4)
        slice_mesh = create_z_heating_slice(mcnp.mesh_mm, 100.0)
        self.assertGreater(slice_mesh.n_cells, 0)
        self.assertIn(REQUIRED_MCNP_FIELD, slice_mesh.cell_data)

    def test_scene_builds_off_screen(self):
        if not SAMPLE_MCNP_PATH.exists():
            self.skipTest(f"sample MCNP file not available: {SAMPLE_MCNP_PATH}")
        scene = build_blanket_viewer_scene(
            SAMPLE_CAD_PATH,
            SAMPLE_MCNP_PATH,
            off_screen=True,
        )
        try:
            self.assertGreater(len(scene.plotter.renderer.actors), 0)
            self.assertGreater(scene.mcnp.mesh_mm.n_cells, 0)
        finally:
            scene.plotter.close()

    def test_scene_step_geometry_source_still_builds(self):
        if not SAMPLE_MCNP_PATH.exists():
            self.skipTest(f"sample MCNP file not available: {SAMPLE_MCNP_PATH}")
        scene = build_blanket_viewer_scene(
            SAMPLE_CAD_PATH,
            SAMPLE_MCNP_PATH,
            off_screen=True,
            geometry_source="step",
        )
        try:
            self.assertEqual(scene.geometry_source, "step")
            self.assertIsNone(scene.component_view)
            self.assertEqual(scene.cad.tessellated.body_count, 26)
        finally:
            scene.plotter.close()

    def test_scene_cad_opacity_update(self):
        if not SAMPLE_MCNP_PATH.exists():
            self.skipTest(f"sample MCNP file not available: {SAMPLE_MCNP_PATH}")
        scene = build_blanket_viewer_scene(
            SAMPLE_CAD_PATH,
            SAMPLE_MCNP_PATH,
            off_screen=True,
        )
        try:
            scene.update_cad_opacity(0.4)
            self.assertAlmostEqual(scene.cad_opacity, 0.4)
        finally:
            scene.plotter.close()

    def test_parametric_geometry_update_does_not_replace_mcnp_dataset(self):
        if not SAMPLE_MCNP_PATH.exists():
            self.skipTest(f"sample MCNP file not available: {SAMPLE_MCNP_PATH}")
        scene = build_blanket_viewer_scene(
            SAMPLE_CAD_PATH,
            SAMPLE_MCNP_PATH,
            off_screen=True,
        )
        try:
            original_mesh = scene.mcnp.mesh_mm
            original_cell_count = scene.mcnp.mesh_mm.n_cells
            updated = scene.primitive_csg.__class__(
                pz_206=6.6,
                pz_207=6.7,
                pz_208=6.9,
                pz_209=7.0,
                cz_301_radius=5.0,
                cz_302_radius=4.9,
                cz_303_radius=4.7,
                cz_304_radius=4.6,
            )
            scene.update_parametric_geometry(updated)
            self.assertIs(scene.mcnp.mesh_mm, original_mesh)
            self.assertEqual(scene.mcnp.mesh_mm.n_cells, original_cell_count)
            self.assertIn(REQUIRED_MCNP_FIELD, scene.mcnp.mesh_mm.cell_data)
        finally:
            scene.plotter.close()

    def test_field_switch_does_not_replace_mcnp_dataset(self):
        if not SAMPLE_MCNP_PATH.exists():
            self.skipTest(f"sample MCNP file not available: {SAMPLE_MCNP_PATH}")
        scene = build_blanket_viewer_scene(
            SAMPLE_CAD_PATH,
            SAMPLE_MCNP_PATH,
            off_screen=True,
        )
        try:
            original_mesh = scene.mcnp.mesh_mm
            scene.set_mcnp_field("neutron_flux")
            self.assertIs(scene.mcnp.mesh_mm, original_mesh)
            self.assertEqual(scene.field_name, "Neutron flux (n_cm^2_s)")
            scene.set_mcnp_field("photon_heating")
            self.assertIs(scene.mcnp.mesh_mm, original_mesh)
            self.assertEqual(scene.field_name, "Photon heating (W_cm3)")
        finally:
            scene.plotter.close()

    def test_x_y_z_scene_slices(self):
        if not SAMPLE_MCNP_PATH.exists():
            self.skipTest(f"sample MCNP file not available: {SAMPLE_MCNP_PATH}")
        scene = build_blanket_viewer_scene(
            SAMPLE_CAD_PATH,
            SAMPLE_MCNP_PATH,
            off_screen=True,
        )
        try:
            for axis in ("X", "Y", "Z"):
                scene.update_mcnp_slice(axis, 0.0)
                self.assertEqual(scene.slice_axis, axis)
                self.assertIsNotNone(scene.operation_timings_s.get("slice_update"))
        finally:
            scene.plotter.close()

    def test_cad_clipping_is_independent_from_mcnp_slice(self):
        if not SAMPLE_MCNP_PATH.exists():
            self.skipTest(f"sample MCNP file not available: {SAMPLE_MCNP_PATH}")
        scene = build_blanket_viewer_scene(
            SAMPLE_CAD_PATH,
            SAMPLE_MCNP_PATH,
            off_screen=True,
        )
        try:
            scene.set_cad_clipping(ClippingConfig(enabled=True, axis="X", position_mm=10.0))
            mcnp_position = scene.slice_position_mm
            scene.update_mcnp_slice("Y", 0.0)
            self.assertNotEqual(scene.slice_axis, "X")
            self.assertNotEqual(scene.slice_position_mm, mcnp_position)
            self.assertIsNotNone(scene.operation_timings_s.get("cad_clipping_update"))
        finally:
            scene.plotter.close()

    def test_mcnp_off_mode_hides_actor_and_scalar_bar_without_replacing_mesh(self):
        if not SAMPLE_MCNP_PATH.exists():
            self.skipTest(f"sample MCNP file not available: {SAMPLE_MCNP_PATH}")
        scene = build_blanket_viewer_scene(
            SAMPLE_CAD_PATH,
            SAMPLE_MCNP_PATH,
            off_screen=True,
        )
        try:
            original_mesh = scene.mcnp.mesh_mm
            self.assertIn(MCNP_FIELD_ACTOR, scene.plotter.renderer.actors)
            self.assertIn(scene.scalar_bar_title, scene.plotter.scalar_bars)

            scene.set_visualization_mode(OFF_MODE)

            self.assertNotIn(MCNP_FIELD_ACTOR, scene.plotter.renderer.actors)
            self.assertEqual(list(scene.plotter.scalar_bars.keys()), [])
            self.assertIs(scene.mcnp.mesh_mm, original_mesh)
        finally:
            scene.plotter.close()

    def test_mcnp_off_to_slice_restores_preserved_field_and_slice_settings(self):
        if not SAMPLE_MCNP_PATH.exists():
            self.skipTest(f"sample MCNP file not available: {SAMPLE_MCNP_PATH}")
        scene = build_blanket_viewer_scene(
            SAMPLE_CAD_PATH,
            SAMPLE_MCNP_PATH,
            off_screen=True,
        )
        try:
            original_mesh = scene.mcnp.mesh_mm
            scene.set_mcnp_field("neutron_flux")
            scene.update_mcnp_slice("X", 0.0)
            scene.set_log_scale(True)
            preserved = (
                scene.active_field_key,
                scene.field_name,
                scene.slice_axis,
                scene.slice_position_mm,
                scene.iso_value,
                scene.use_log_scale,
            )

            scene.set_visualization_mode(OFF_MODE)
            scene.set_visualization_mode(SLICE_MODE)

            self.assertEqual(
                (
                    scene.active_field_key,
                    scene.field_name,
                    scene.slice_axis,
                    scene.slice_position_mm,
                    scene.iso_value,
                    scene.use_log_scale,
                ),
                preserved,
            )
            self.assertIs(scene.mcnp.mesh_mm, original_mesh)
            self.assertIn(MCNP_FIELD_ACTOR, scene.plotter.renderer.actors)
            self.assertIn(scene.scalar_bar_title, scene.plotter.scalar_bars)
        finally:
            scene.plotter.close()

    def test_mcnp_off_to_iso_restores_field_and_leaves_cad_geometry_visible(self):
        if not SAMPLE_MCNP_PATH.exists():
            self.skipTest(f"sample MCNP file not available: {SAMPLE_MCNP_PATH}")
        scene = build_blanket_viewer_scene(
            SAMPLE_CAD_PATH,
            SAMPLE_MCNP_PATH,
            off_screen=True,
        )
        try:
            original_mesh = scene.mcnp.mesh_mm
            scene.set_mcnp_field("photon_heating")
            scene.update_iso_value(10.0)
            preserved = (
                scene.active_field_key,
                scene.field_name,
                scene.slice_axis,
                scene.slice_position_mm,
                scene.iso_value,
                scene.use_log_scale,
            )
            component_actor_names = tuple(scene.component_view._actor_names.values())
            self.assertTrue(component_actor_names)

            scene.set_visualization_mode(OFF_MODE)
            self.assertTrue(
                all(name in scene.plotter.renderer.actors for name in component_actor_names)
            )

            scene.set_visualization_mode(ISO_SURFACE_MODE)

            self.assertEqual(
                (
                    scene.active_field_key,
                    scene.field_name,
                    scene.slice_axis,
                    scene.slice_position_mm,
                    scene.iso_value,
                    scene.use_log_scale,
                ),
                preserved,
            )
            self.assertIs(scene.mcnp.mesh_mm, original_mesh)
            self.assertIn(MCNP_FIELD_ACTOR, scene.plotter.renderer.actors)
            self.assertIn(scene.scalar_bar_title, scene.plotter.scalar_bars)
            self.assertTrue(
                all(name in scene.plotter.renderer.actors for name in component_actor_names)
            )
        finally:
            scene.plotter.close()


if __name__ == "__main__":
    unittest.main()
