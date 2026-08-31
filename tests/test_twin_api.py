from pathlib import Path
import unittest

from fastapi.testclient import TestClient

from fusion_blanket_twin.api.app import create_app
from fusion_blanket_twin.api.services import TwinServices
from fusion_blanket_twin.data.case_registry import CaseRegistry
from fusion_blanket_twin.surrogate.service import ScalarPredictionService


LOCAL_INPUT_DIR = Path("data/local/mcnp_inputs")
LOCAL_WORKBOOK = Path("data/local/fusion_blanket_twin_100case_results_parsed.xlsx")


class TwinApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        registry = CaseRegistry.from_input_directory(LOCAL_INPUT_DIR).with_scalar_results(
            LOCAL_WORKBOOK
        )
        cls.predictor = ScalarPredictionService(registry)
        cls.loader_calls = 0

        def loader():
            cls.loader_calls += 1
            return TwinServices(cls.predictor, startup_seconds=0.125)

        cls.client_context = TestClient(create_app(loader))
        cls.client = cls.client_context.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client_context.__exit__(None, None, None)

    def test_health_reports_ready_service_and_reuses_startup_instance(self):
        first = self.client.get("/api/health")
        second = self.client.get("/api/health")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()["status"], "ok")
        self.assertEqual(first.json()["scalar_prediction"], "ready")
        self.assertEqual(first.json()["case_count"], 100)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(self.loader_calls, 1)

    def test_design_domain_is_derived_from_registry(self):
        response = self.client.get("/api/design-domain")
        self.assertEqual(response.status_code, 200)
        domain = response.json()
        self.assertEqual(domain["pz_206"]["minimum"], self.predictor.domain_min[0])
        self.assertEqual(domain["pz_206"]["maximum"], self.predictor.domain_max[0])
        self.assertEqual(len(domain["pz_206"]["levels"]), 10)
        self.assertEqual(
            domain["cz_301_radius"]["minimum"], self.predictor.domain_min[1]
        )
        self.assertEqual(
            domain["cz_301_radius"]["maximum"], self.predictor.domain_max[1]
        )
        self.assertEqual(len(domain["cz_301_radius"]["levels"]), 10)
        self.assertEqual(domain["pz_206"]["unit"], "cm")

    def test_exact_case_returns_simulation_provenance(self):
        response = self._predict(2.6, 3.6)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["metadata"]["source"], "simulation")
        self.assertEqual(body["metadata"]["status"], "exact")
        self.assertEqual(body["metadata"]["nearest_case"], "104-A")
        self.assertAlmostEqual(body["kpis"]["total_tbr"], 1.12856)

    def test_intermediate_case_returns_surrogate_provenance(self):
        body = self._predict(3.1, 3.8).json()
        self.assertEqual(body["metadata"]["source"], "surrogate")
        self.assertEqual(body["metadata"]["domain_status"], "interpolation")
        self.assertIsNone(body["metadata"]["warning"])

    def test_extrapolation_metadata_is_preserved(self):
        body = self._predict(2.5, 3.8).json()
        self.assertEqual(body["metadata"]["source"], "surrogate")
        self.assertEqual(body["metadata"]["domain_status"], "extrapolation")
        self.assertIn("outside", body["metadata"]["warning"])

    def test_invalid_and_non_finite_requests_are_rejected(self):
        missing = self.client.post("/api/predict/scalars", json={"pz_206": 2.6})
        malformed = self.client.post(
            "/api/predict/scalars",
            json={"pz_206": "not-a-number", "cz_301_radius": 3.6},
        )
        non_finite = self.client.post(
            "/api/predict/scalars",
            content='{"pz_206": NaN, "cz_301_radius": 3.6}',
            headers={"content-type": "application/json"},
        )
        self.assertEqual(missing.status_code, 422)
        self.assertEqual(malformed.status_code, 422)
        self.assertEqual(non_finite.status_code, 422)

    def test_http_results_match_direct_service_for_exact_intermediate_and_boundary(self):
        for pz_206, cz_301_radius in ((2.6, 3.6), (3.1, 3.8), (2.6, 3.8)):
            with self.subTest(pz_206=pz_206, cz_301_radius=cz_301_radius):
                direct = self.predictor.predict(pz_206, cz_301_radius)
                api = self._predict(pz_206, cz_301_radius).json()
                for output_name, direct_value in direct.kpis.as_dict().items():
                    self.assertAlmostEqual(api["kpis"][output_name], direct_value, places=14)
                self.assertEqual(api["metadata"]["source"], direct.metadata.source)
                self.assertEqual(
                    api["metadata"]["domain_status"], direct.metadata.domain_status
                )
                self.assertAlmostEqual(
                    api["metadata"]["nearest_distance"],
                    direct.metadata.nearest_case_distance,
                    places=14,
                )

    def _predict(self, pz_206, cz_301_radius):
        return self.client.post(
            "/api/predict/scalars",
            json={"pz_206": pz_206, "cz_301_radius": cz_301_radius},
        )


class UnavailableTwinApiTests(unittest.TestCase):
    def test_unavailable_model_reports_degraded_health_and_503(self):
        app = create_app(
            lambda: TwinServices(None, startup_seconds=0.01, error="test unavailable")
        )
        with TestClient(app) as client:
            health = client.get("/api/health")
            prediction = client.post(
                "/api/predict/scalars",
                json={"pz_206": 2.6, "cz_301_radius": 3.6},
            )
        self.assertEqual(health.json()["status"], "degraded")
        self.assertEqual(health.json()["scalar_prediction"], "unavailable")
        self.assertEqual(prediction.status_code, 503)


if __name__ == "__main__":
    unittest.main()
