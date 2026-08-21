from pathlib import Path
import unittest


class TrameBindingTests(unittest.TestCase):
    def test_static_text_is_not_passed_as_vue_expression_tuple(self):
        source = Path("app/viewer.py").read_text()
        self.assertNotIn("title=(line,)", source)
        self.assertNotIn("VCardText((\"", source)
        self.assertNotIn("style=(\"height:", source)

    def test_expected_vue_bindings_remain_limited(self):
        source = Path("app/viewer.py").read_text()
        self.assertIn('v_model=("slice_z", scene.slice_z_mm)', source)
        self.assertIn('v_model=("cad_opacity", scene.cad_opacity)', source)

    def test_scalar_design_panel_is_separate_from_3d_field(self):
        source = Path("app/viewer.py").read_text()
        self.assertIn("Scalar Design", source)
        self.assertIn('v_model=("scalar_pz_206", state.scalar_pz_206)', source)
        self.assertIn(
            'v_model=("scalar_cz_301_radius", state.scalar_cz_301_radius)',
            source,
        )
        self.assertIn("The 3D Total Heating field remains the currently loaded MCNP simulation", source)

    def test_component_controls_are_bound_in_browser_ui(self):
        source = Path("app/viewer.py").read_text()
        self.assertIn("Component Colors", source)
        self.assertIn("Component Visibility", source)
        self.assertIn("CAD Clipping", source)
        self.assertIn('v_model=("cad_clipping_enabled", state.cad_clipping_enabled)', source)


if __name__ == "__main__":
    unittest.main()
