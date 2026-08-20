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


if __name__ == "__main__":
    unittest.main()

