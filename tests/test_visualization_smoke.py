import unittest

from fusion_blanket_twin.config.settings import (
    REQUIRED_MCNP_FIELD,
    SAMPLE_CAD_PATH,
    SAMPLE_MCNP_PATH,
)
from fusion_blanket_twin.visualization.cad import load_cad_display_geometry
from fusion_blanket_twin.visualization.mcnp import create_z_heating_slice, load_mcnp_heating_geometry
from fusion_blanket_twin.visualization.scene import build_blanket_viewer_scene


class VisualizationSmokeTests(unittest.TestCase):
    def test_step_cad_display_geometry(self):
        cad = load_cad_display_geometry(SAMPLE_CAD_PATH)
        self.assertEqual(cad.summary.solid_count, 26)
        self.assertEqual(cad.tessellated.body_count, 26)
        self.assertGreater(cad.tessellated.triangle_count, 0)
        self.assertGreater(cad.edge_wireframe.n_cells, 0)
        self.assertGreater(cad.outline.n_cells, 0)

    def test_mcnp_heating_mesh_is_scaled_to_mm_and_sliceable(self):
        mcnp = load_mcnp_heating_geometry(SAMPLE_MCNP_PATH)
        self.assertIn(REQUIRED_MCNP_FIELD, mcnp.mesh_mm.cell_data)
        self.assertAlmostEqual(mcnp.mesh_mm.bounds[5], 921.0, delta=1.0e-4)
        slice_mesh = create_z_heating_slice(mcnp.mesh_mm, 100.0)
        self.assertGreater(slice_mesh.n_cells, 0)
        self.assertIn(REQUIRED_MCNP_FIELD, slice_mesh.cell_data)

    def test_scene_builds_off_screen(self):
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

    def test_scene_cad_opacity_update(self):
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


if __name__ == "__main__":
    unittest.main()
