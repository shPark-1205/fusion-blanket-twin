from pathlib import Path
import tempfile
import unittest

from fusion_blanket_twin.data.case_registry import (
    CZ_LABELS,
    CaseIdentity,
    CaseRecord,
    CaseRegistry,
    DuplicateCaseError,
    MissingCaseCombinationError,
    load_scalar_results_workbook,
    parse_case_identity_from_filename,
    sorted_cz_labels,
)
from fusion_blanket_twin.geometry.csg import PrimitiveCSGParameters


LOCAL_INPUT_DIR = Path("data/local/mcnp_inputs")
LOCAL_WORKBOOK = Path("data/local/fusion_blanket_twin_100case_results_parsed.xlsx")


class CaseIdentityTests(unittest.TestCase):
    def test_filename_case_identity_parsing(self):
        identity = parse_case_identity_from_filename("INDEX_107-Base.inp")
        self.assertEqual(identity.case_id, "107-Base")
        self.assertEqual(identity.pz_case_number, 107)
        self.assertEqual(identity.cz_label, "Base")
        self.assertEqual(identity.input_filename, "INDEX_107-Base.inp")

    def test_base_ordering_between_e_and_f(self):
        self.assertEqual(CZ_LABELS, ("A", "B", "C", "D", "E", "Base", "F", "G", "H", "I"))
        self.assertEqual(sorted_cz_labels(["F", "Base", "E"]), ["E", "Base", "F"])


class CaseRegistryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.registry = CaseRegistry.from_input_directory(LOCAL_INPUT_DIR)

    def test_100_unique_cases(self):
        self.assertEqual(len(self.registry.records), 100)
        self.assertEqual(len(self.registry.by_case_id), 100)

    def test_complete_10_by_10_cartesian_product(self):
        self.registry.validate_complete_10x10()
        pz_cases = {record.identity.pz_case_number for record in self.registry.records}
        cz_labels = {record.identity.cz_label for record in self.registry.records}
        self.assertEqual(len(pz_cases), 10)
        self.assertEqual(len(cz_labels), 10)

    def test_current_pz_spacing_consistency(self):
        report = self.registry.validate_current_doe_constraints()
        self.assertTrue(report.pz_spacing_constant)
        self.assertTrue(report.pz_independent_of_cz)
        self.assertEqual(report.pz_spacings_cm, (0.10000000000000009, 0.19999999999999973, 0.10000000000000009))

    def test_current_cz_spacing_consistency(self):
        report = self.registry.validate_current_doe_constraints()
        self.assertTrue(report.cz_spacing_constant)
        self.assertTrue(report.cz_independent_of_pz)
        self.assertEqual(report.cz_radial_spacings_cm, (0.10000000000000009, 0.20000000000000018, 0.09999999999999964))

    def test_scalar_workbook_join(self):
        registry = self.registry.with_scalar_results(LOCAL_WORKBOOK)
        self.assertEqual(len(registry.records), 100)
        for record in registry.records:
            self.assertIsNotNone(record.total_tbr)
            self.assertIsNotNone(record.li6_tbr)
            self.assertIsNotNone(record.li7_tbr)
            self.assertIsNotNone(record.multiplying)

    def test_scalar_workbook_loader_has_100_records(self):
        results = load_scalar_results_workbook(LOCAL_WORKBOOK)
        self.assertEqual(len(results), 100)
        self.assertIn("104-A", results)
        self.assertGreater(results["104-A"].total_tbr, 0.0)

    def test_duplicate_case_detection(self):
        record = _dummy_record("104-A")
        with self.assertRaises(DuplicateCaseError):
            CaseRegistry([record, record])

    def test_missing_case_detection(self):
        records = [
            _dummy_record(f"{pz}-{cz}")
            for pz in range(104, 114)
            for cz in CZ_LABELS
            if f"{pz}-{cz}" != "113-I"
        ]
        registry = CaseRegistry(records)
        with self.assertRaises(MissingCaseCombinationError):
            registry.validate_complete_10x10()

    def test_registry_export_csv_and_json(self):
        registry = self.registry.with_scalar_results(LOCAL_WORKBOOK)
        with tempfile.TemporaryDirectory() as temp_dir:
            csv_path = Path(temp_dir) / "registry.csv"
            json_path = Path(temp_dir) / "registry.json"
            registry.export_csv(csv_path)
            registry.export_json(json_path)
            self.assertTrue(csv_path.exists())
            self.assertTrue(json_path.exists())
            self.assertIn("case_id", csv_path.read_text(encoding="utf-8").splitlines()[0])


def _dummy_record(case_id: str) -> CaseRecord:
    pz_text, cz_label = case_id.split("-", 1)
    identity = CaseIdentity(
        case_id=case_id,
        pz_case_number=int(pz_text),
        cz_label=cz_label,
        input_filename=f"INDEX_{case_id}.inp",
    )
    return CaseRecord(
        identity=identity,
        input_path=Path(identity.input_filename),
        primitive_csg=PrimitiveCSGParameters(
            pz_206=2.6,
            pz_207=2.7,
            pz_208=2.9,
            pz_209=3.0,
            cz_301_radius=3.6,
            cz_302_radius=3.5,
            cz_303_radius=3.3,
            cz_304_radius=3.2,
        ),
    )


if __name__ == "__main__":
    unittest.main()

