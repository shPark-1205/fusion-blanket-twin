from pathlib import Path
import tempfile
import unittest

import numpy as np

from fusion_blanket_twin.data.case_registry import CaseRegistry
from fusion_blanket_twin.surrogate.benchmark import run_benchmark
from fusion_blanket_twin.surrogate.features import (
    extract_dataset_from_registry,
    validate_scalar_dataset,
)
from fusion_blanket_twin.surrogate.metrics import calculate_regression_metrics
from fusion_blanket_twin.surrogate.models import PolynomialResponseSurface
from fusion_blanket_twin.surrogate.splits import (
    all_validation_splits,
    checkerboard_interior_split,
)


LOCAL_INPUT_DIR = Path("data/local/mcnp_inputs")
LOCAL_WORKBOOK = Path("data/local/fusion_blanket_twin_100case_results_parsed.xlsx")


class ScalarSurrogateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        registry = CaseRegistry.from_input_directory(LOCAL_INPUT_DIR).with_scalar_results(
            LOCAL_WORKBOOK
        )
        cls.dataset = extract_dataset_from_registry(registry)

    def test_feature_extraction_from_case_registry(self):
        dataset = self.dataset
        self.assertEqual(dataset.X.shape, (100, 2))
        self.assertEqual(dataset.feature_names, ("pz_206", "cz_301_radius"))
        self.assertEqual(len(dataset.output("total_tbr")), 100)
        report = validate_scalar_dataset(dataset)
        self.assertTrue(report.is_valid)
        self.assertEqual(report.unique_pz_206_count, 10)
        self.assertEqual(report.unique_cz_301_radius_count, 10)

    def test_checkerboard_split_is_deterministic(self):
        split_a = checkerboard_interior_split(self.dataset)
        split_b = checkerboard_interior_split(self.dataset)
        np.testing.assert_array_equal(split_a.train_indices, split_b.train_indices)
        np.testing.assert_array_equal(split_a.test_indices, split_b.test_indices)
        self.assertEqual(split_a.region, "interpolation")
        self.assertEqual(len(split_a.test_indices), 32)

    def test_validation_splits_have_no_training_test_leakage(self):
        for split in all_validation_splits(self.dataset):
            overlap = set(split.train_indices.tolist()) & set(split.test_indices.tolist())
            self.assertFalse(overlap, split.name)

    def test_polynomial_model_fit_predict(self):
        X = np.asarray([[0.0, 0.0], [1.0, 0.0], [0.0, 1.0], [1.0, 1.0]])
        y = 1.0 + 2.0 * X[:, 0] + 3.0 * X[:, 1]
        model = PolynomialResponseSurface(degree=1).fit(X, y)
        pred = model.predict(X)
        np.testing.assert_allclose(pred, y, atol=1.0e-12)

    def test_benchmark_metric_calculation(self):
        metrics = calculate_regression_metrics(
            np.asarray([1.0, 2.0, 3.0]),
            np.asarray([1.1, 1.7, 3.2]),
            ["a", "b", "c"],
        )
        self.assertAlmostEqual(metrics.mae, (0.1 + 0.3 + 0.2) / 3.0)
        self.assertEqual(metrics.worst_case_id, "b")
        self.assertIsNotNone(metrics.r2)
        self.assertIsNotNone(metrics.mape_percent)

    def test_prediction_output_shape(self):
        model = PolynomialResponseSurface(degree=2).fit(
            self.dataset.X,
            self.dataset.output("total_tbr"),
        )
        pred = model.predict(self.dataset.X[:7])
        self.assertEqual(pred.shape, (7,))

    def test_out_of_domain_detection(self):
        model = PolynomialResponseSurface(degree=1).fit(
            np.asarray([[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]]),
            np.asarray([0.0, 1.0, 1.0]),
        )
        mask = model.in_domain_mask(np.asarray([[0.5, 0.5], [2.0, 0.5]]))
        np.testing.assert_array_equal(mask, np.asarray([True, False]))

    def test_benchmark_writes_lightweight_artifacts(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            result = run_benchmark(self.dataset, Path(temp_dir))
            self.assertIn("summary", result)
            self.assertTrue((Path(temp_dir) / "model_comparison.csv").exists())
            self.assertTrue((Path(temp_dir) / "heldout_predictions.csv").exists())
            self.assertTrue((Path(temp_dir) / "benchmark_summary.json").exists())


if __name__ == "__main__":
    unittest.main()
