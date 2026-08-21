from pathlib import Path
import unittest

from fusion_blanket_twin.data.case_registry import CaseRegistry
from fusion_blanket_twin.surrogate.service import ScalarPredictionService


LOCAL_INPUT_DIR = Path("data/local/mcnp_inputs")
LOCAL_WORKBOOK = Path("data/local/fusion_blanket_twin_100case_results_parsed.xlsx")


class ScalarPredictionServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        registry = CaseRegistry.from_input_directory(LOCAL_INPUT_DIR).with_scalar_results(
            LOCAL_WORKBOOK
        )
        cls.service = ScalarPredictionService(registry)

    def test_exact_case_lookup_returns_simulation(self):
        prediction = self.service.predict(2.6, 3.6)
        self.assertEqual(prediction.metadata.source, "simulation")
        self.assertEqual(prediction.metadata.status, "exact")
        self.assertEqual(prediction.metadata.domain_status, "exact")
        self.assertEqual(prediction.metadata.nearest_case_id, "104-A")
        self.assertAlmostEqual(prediction.kpis.total_tbr, 1.12856)

    def test_intermediate_coordinate_returns_surrogate(self):
        prediction = self.service.predict(3.1, 3.8)
        self.assertEqual(prediction.metadata.source, "surrogate")
        self.assertEqual(prediction.metadata.status, "predicted")
        self.assertEqual(prediction.metadata.domain_status, "interpolation")
        self.assertIsNone(prediction.metadata.warning)
        self.assertGreater(prediction.kpis.total_tbr, 1.0)

    def test_boundary_domain_detection(self):
        prediction = self.service.predict(2.6, 3.8)
        self.assertEqual(prediction.metadata.source, "surrogate")
        self.assertEqual(prediction.metadata.domain_status, "boundary")

    def test_extrapolation_warning(self):
        prediction = self.service.predict(2.5, 3.8)
        self.assertEqual(prediction.metadata.source, "surrogate")
        self.assertEqual(prediction.metadata.domain_status, "extrapolation")
        self.assertIsNotNone(prediction.metadata.warning)

    def test_output_names(self):
        self.assertEqual(
            self.service.output_names,
            ("total_tbr", "li6_tbr", "li7_tbr", "multiplying"),
        )

    def test_reproducibility(self):
        first = self.service.predict(4.25, 4.25)
        second = self.service.predict(4.25, 4.25)
        self.assertEqual(first.kpis, second.kpis)
        self.assertEqual(first.metadata.domain_status, second.metadata.domain_status)


if __name__ == "__main__":
    unittest.main()

