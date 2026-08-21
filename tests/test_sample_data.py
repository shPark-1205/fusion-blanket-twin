import unittest

from fusion_blanket_twin.config.settings import (
    REQUIRED_MCNP_FIELD,
    SAMPLE_CAD_PATH,
    SAMPLE_MCNP_PATH,
)
from fusion_blanket_twin.geometry.loader import read_step_summary
from fusion_blanket_twin.mcnp.loader import read_mcnp_summary
from fusion_blanket_twin.mcnp.probe import McnpRawVoxelProbe


class SampleDataTests(unittest.TestCase):
    def test_cad_step_bounds_and_solids(self):
        cad = read_step_summary(SAMPLE_CAD_PATH)
        self.assertEqual(cad.solid_count, 26)
        self.assertAlmostEqual(cad.bounds_mm[5], 921.0)

    def test_mcnp_required_field_and_bounds(self):
        if not SAMPLE_MCNP_PATH.exists():
            self.skipTest(f"sample MCNP file not available: {SAMPLE_MCNP_PATH}")
        mcnp = read_mcnp_summary(SAMPLE_MCNP_PATH)
        self.assertEqual(mcnp.field_name, REQUIRED_MCNP_FIELD)
        self.assertIn(REQUIRED_MCNP_FIELD, mcnp.cell_arrays)
        self.assertAlmostEqual(mcnp.bounds_mm[4], 0.0, delta=1.0e-4)
        self.assertAlmostEqual(mcnp.bounds_mm[5], 921.0, delta=1.0e-4)

    def test_raw_probe_outside_mesh(self):
        if not SAMPLE_MCNP_PATH.exists():
            self.skipTest(f"sample MCNP file not available: {SAMPLE_MCNP_PATH}")
        probe = McnpRawVoxelProbe(SAMPLE_MCNP_PATH)
        result = probe.probe((10_000.0, 0.0, 0.0))
        self.assertEqual(result.status, "out_of_bounds")
        self.assertIsNone(result.value)


if __name__ == "__main__":
    unittest.main()
