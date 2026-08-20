import unittest

from fusion_blanket_twin.config.settings import SAMPLE_CAD_PATH
from fusion_blanket_twin.geometry.cad_tessellation import load_tessellated_step_assembly


class CadTessellationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.assembly = load_tessellated_step_assembly(SAMPLE_CAD_PATH)

    def test_step_load_succeeds(self):
        self.assertEqual(self.assembly.summary.path, SAMPLE_CAD_PATH)

    def test_detects_26_solids(self):
        self.assertEqual(self.assembly.body_count, 26)
        self.assertEqual(self.assembly.summary.solid_count, 26)

    def test_tessellated_output_is_non_empty(self):
        self.assertGreater(self.assembly.triangle_count, 0)
        for body in self.assembly.bodies:
            self.assertGreater(body.mesh.n_points, 0)
            self.assertGreater(body.mesh.n_cells, 0)

    def test_tessellated_bounds_match_step_bounds(self):
        expected = self.assembly.summary.bounds_mm
        actual = self.assembly.bounds_mm
        for actual_value, expected_value in zip(actual, expected):
            self.assertAlmostEqual(actual_value, expected_value, delta=1.0e-6)

    def test_body_ids_are_stable(self):
        self.assertEqual(self.assembly.bodies[0].body_id, "Solid_01")
        self.assertEqual(self.assembly.bodies[-1].body_id, "Solid_26")


if __name__ == "__main__":
    unittest.main()
