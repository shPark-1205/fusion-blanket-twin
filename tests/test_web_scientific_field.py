import json
import tempfile
import unittest
from pathlib import Path

import h5py
import numpy as np

from fusion_blanket_twin.config.settings import SAMPLE_MCNP_PATH
from fusion_blanket_twin.mcnp.fields import CANONICAL_MCNP_FIELDS
from fusion_blanket_twin.mcnp.web_field import (
    MCNP_TO_VIEWER_SCALE,
    WEB_SCIENTIFIC_SCHEMA,
    export_web_scientific_dataset,
    export_web_scientific_field,
)


class WebScientificFieldExportTests(unittest.TestCase):
    def test_exact_rectilinear_multifield_export_and_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "tiny.vtkhdf"
            output = root / "web"
            self._write_fixture(source)
            manifest = export_web_scientific_dataset(source, output)
            written = json.loads((output / "manifest.json").read_text(encoding="utf-8"))

            self.assertEqual(manifest["schema"], WEB_SCIENTIFIC_SCHEMA)
            self.assertEqual(written["default_field_key"], "nuclear_heating")
            self.assertEqual(written["field_order"], [field.key for field in CANONICAL_MCNP_FIELDS])
            self.assertEqual(written["mesh"]["point_count"], 18)
            self.assertEqual(written["mesh"]["cell_count"], 4)
            self.assertEqual(written["mesh"]["cell_shape_zyx"], [2, 1, 2])
            self.assertEqual(written["mesh"]["bounds_cm"], [-1.0, 1.0, -0.5, 0.5, 0.0, 3.0])
            self.assertEqual(written["mesh"]["bounds_mm"], [-10.0, 10.0, -5.0, 5.0, 0.0, 30.0])
            self.assertEqual(written["mesh"]["axis_metadata"]["z"]["uniform"], False)
            self.assertEqual(written["slicing"]["available_axes"], ["X", "Y", "Z"])
            self.assertEqual(written["slicing"]["axes"]["Z"]["layers"][1]["bounds_mm"], [10.0, 30.0])
            self.assertEqual(written["slicing"]["axes"]["Z"]["layers"][1]["center_mm"], 20.0)
            self.assertIn("half-open", written["slicing"]["boundary_convention"])
            self.assertEqual(written["transform"]["scale"], [10.0, 10.0, 10.0])

            for field in CANONICAL_MCNP_FIELDS:
                record = written["fields"][field.key]
                values = np.fromfile(output / f"{field.key}.f32", dtype="<f4")
                self.assertEqual(record["source_name"], field.internal_name)
                self.assertEqual(record["display_name"], field.display_name)
                self.assertEqual(record["units"], field.units)
                self.assertEqual(record["association"], "cell")
                self.assertEqual(record["source_precision"], "float64")
                self.assertEqual(record["web_precision"], "Float32")
                self.assertEqual(record["values"]["scalar_count"], 4)
                self.assertEqual(record["values"]["byte_length"], 16)
                self.assertEqual(record["finite_count"], 4)
                self.assertEqual(len(record["slice_ranges"]["X"]), 2)
                self.assertEqual(len(record["slice_ranges"]["Y"]), 1)
                self.assertEqual(len(record["slice_ranges"]["Z"]), 2)
                self.assertEqual(len(record["source_slice_ranges"]["X"]), 2)
                self.assertEqual(len(record["source_slice_ranges"]["Y"]), 1)
                self.assertEqual(len(record["source_slice_ranges"]["Z"]), 2)
                self.assertTrue(np.all(np.isfinite(values)))

            np.testing.assert_array_equal(
                np.fromfile(output / "nuclear_heating.f32", dtype="<f4"),
                np.array([11.0, 22.0, 33.0, 44.0], dtype=np.float32),
            )
            consistency = written["consistency_checks"]["nuclear_heating_equals_neutron_plus_photon"]
            self.assertTrue(consistency["passed"])
            self.assertEqual(consistency["maximum_absolute_error"], 0.0)

    def test_compatibility_wrapper_exports_all_fields(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "tiny.vtkhdf"
            output = Path(temporary) / "web"
            self._write_fixture(source)
            manifest = export_web_scientific_field(source, output, field_key="neutron_flux")
            self.assertEqual(manifest["default_field_key"], "neutron_flux")
            self.assertTrue((output / "photon_heating.f32").exists())

    def test_rejects_non_voxel_topology(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "bad.vtkhdf"
            self._write_fixture(source)
            with h5py.File(source, "r+") as h5:
                h5["VTKHDF/Block_2/Types"][0] = 12
            with self.assertRaisesRegex(ValueError, "VTK_VOXEL"):
                export_web_scientific_dataset(source, Path(temporary) / "out")

    def test_rejects_missing_canonical_field(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "bad.vtkhdf"
            self._write_fixture(source)
            with h5py.File(source, "r+") as h5:
                del h5["VTKHDF/Block_2/CellData/Photon flux (n_cm^2_s)"]
            with self.assertRaisesRegex(ValueError, "Required MCNP fields are missing"):
                export_web_scientific_dataset(source, Path(temporary) / "out")

    def test_authoritative_sample_export_contract_and_registration(self):
        if not SAMPLE_MCNP_PATH.exists():
            self.skipTest(f"sample MCNP file not available: {SAMPLE_MCNP_PATH}")
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            manifest = export_web_scientific_dataset(SAMPLE_MCNP_PATH, output)

            self.assertEqual(manifest["mesh"]["point_count"], 1_210_104)
            self.assertEqual(manifest["mesh"]["cell_count"], 1_172_380)
            self.assertEqual(manifest["mesh"]["cell_shape_zyx"], [55, 146, 146])
            np.testing.assert_allclose(manifest["mesh"]["bounds_cm"], [-7.3, 7.3, -7.3, 7.3, 0.0, 92.1], atol=1e-5)
            np.testing.assert_allclose(manifest["mesh"]["bounds_mm"], [-73.0, 73.0, -73.0, 73.0, 0.0, 921.0], atol=1e-4)
            self.assertTrue(manifest["mesh"]["axis_metadata"]["x"]["uniform"])
            self.assertTrue(manifest["mesh"]["axis_metadata"]["y"]["uniform"])
            self.assertFalse(manifest["mesh"]["axis_metadata"]["z"]["uniform"])
            self.assertEqual(MCNP_TO_VIEWER_SCALE, 10.0)

            expected_ranges = {
                "nuclear_heating": (0.0, 32.20605895204285),
                "neutron_heating": (0.0, 31.599262549982686),
                "photon_heating": (0.0, 24.37950438245989),
            }
            for field_key, (minimum, maximum) in expected_ranges.items():
                record = manifest["fields"][field_key]
                self.assertAlmostEqual(record["source_range"][0], minimum)
                self.assertAlmostEqual(record["source_range"][1], maximum)
                self.assertLess(record["precision"]["maximum_relative_deviation_nonzero"], 7.0e-8)
                values = np.fromfile(output / f"{field_key}.f32", dtype="<f4")
                self.assertEqual(values.size, 1_172_380)
                self.assertTrue(np.all(np.isfinite(values)))
                for axis in ("X", "Y", "Z"):
                    layer = len(record["slice_ranges"][axis]) // 2
                    source_range = record["source_slice_ranges"][axis][layer]
                    web_range = record["slice_ranges"][axis][layer]
                    np.testing.assert_allclose(web_range, source_range, rtol=7.0e-8, atol=1.0e-6)

            consistency = manifest["consistency_checks"]["nuclear_heating_equals_neutron_plus_photon"]
            self.assertTrue(consistency["passed"])
            self.assertLess(consistency["maximum_absolute_error"], 1.0e-12)
            self.assertLess(consistency["mean_absolute_error"], 1.0e-13)

            glb_min = (-72.168785, -62.500132, -0.000008)
            glb_max = (72.168785, 62.500008, 921.000132)
            bounds = manifest["mesh"]["bounds_mm"]
            self.assertLessEqual(bounds[0], glb_min[0])
            self.assertGreaterEqual(bounds[1], glb_max[0])
            self.assertLessEqual(bounds[2], glb_min[1])
            self.assertGreaterEqual(bounds[3], glb_max[1])
            self.assertAlmostEqual(bounds[4], 0.0, delta=1e-4)
            self.assertAlmostEqual(bounds[5], glb_max[2], delta=2e-4)

    @staticmethod
    def _write_fixture(path: Path) -> None:
        x = np.array([-1.0, 0.0, 1.0], dtype=np.float32)
        y = np.array([-0.5, 0.5], dtype=np.float32)
        z = np.array([0.0, 1.0, 3.0], dtype=np.float32)
        points = np.array([(px, py, pz) for pz in z for py in y for px in x], dtype=np.float32)

        def point_id(ix: int, iy: int, iz: int) -> int:
            return iz * len(y) * len(x) + iy * len(x) + ix

        cells = []
        for iz in range(len(z) - 1):
            for iy in range(len(y) - 1):
                for ix in range(len(x) - 1):
                    cells.append([
                        point_id(ix, iy, iz), point_id(ix + 1, iy, iz),
                        point_id(ix, iy + 1, iz), point_id(ix + 1, iy + 1, iz),
                        point_id(ix, iy, iz + 1), point_id(ix + 1, iy, iz + 1),
                        point_id(ix, iy + 1, iz + 1), point_id(ix + 1, iy + 1, iz + 1),
                    ])
        base = np.array([1.0, 2.0, 3.0, 4.0], dtype=np.float64)
        with h5py.File(path, "w") as h5:
            block = h5.create_group("VTKHDF/Block_2")
            block.create_dataset("Points", data=points)
            block.create_dataset("Connectivity", data=np.asarray(cells, dtype=np.int64).reshape(-1))
            block.create_dataset("Offsets", data=np.arange(0, 8 * len(cells) + 1, 8, dtype=np.int64))
            block.create_dataset("Types", data=np.full(len(cells), 11, dtype=np.uint8))
            block.create_dataset("NumberOfCells", data=np.array([len(cells)], dtype=np.int64))
            block.create_dataset("NumberOfPoints", data=np.array([len(points)], dtype=np.int64))
            cell_data = block.create_group("CellData")
            cell_data.create_dataset("Neutron flux (n_cm^2_s)", data=base * 100.0)
            cell_data.create_dataset("Photon flux (n_cm^2_s)", data=base * 10.0)
            cell_data.create_dataset("Neutron heating (W_cm3)", data=base * 10.0)
            cell_data.create_dataset("Photon heating (W_cm3)", data=base)
            cell_data.create_dataset("Nuclear heating (W_cm3)", data=base * 11.0)


if __name__ == "__main__":
    unittest.main()
