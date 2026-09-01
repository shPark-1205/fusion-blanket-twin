import json
import tempfile
import unittest
from pathlib import Path

import h5py
import numpy as np

from fusion_blanket_twin.config.settings import SAMPLE_MCNP_PATH
from fusion_blanket_twin.mcnp.web_field import (
    MCNP_TO_VIEWER_SCALE,
    WEB_SCIENTIFIC_SCHEMA,
    export_web_scientific_field,
)


class WebScientificFieldExportTests(unittest.TestCase):
    def test_exact_rectilinear_cell_export_and_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "tiny.vtkhdf"
            output = root / "web"
            self._write_fixture(source)
            manifest = export_web_scientific_field(source, output)
            values = np.fromfile(output / "values.f32", dtype="<f4")
            written = json.loads((output / "manifest.json").read_text(encoding="utf-8"))

            self.assertEqual(manifest["schema"], WEB_SCIENTIFIC_SCHEMA)
            self.assertEqual(written["field"]["source_name"], "Nuclear heating (W_cm3)")
            self.assertEqual(written["field"]["display_name"], "Total Nuclear Heating")
            self.assertEqual(written["field"]["units"], "W/cm3")
            self.assertEqual(written["field"]["association"], "cell")
            self.assertEqual(written["field"]["source_precision"], "float64")
            self.assertEqual(written["mesh"]["point_count"], 18)
            self.assertEqual(written["mesh"]["cell_count"], 4)
            self.assertEqual(written["mesh"]["cell_shape_zyx"], [2, 1, 2])
            self.assertEqual(written["mesh"]["bounds_cm"], [-1.0, 1.0, -0.5, 0.5, 0.0, 3.0])
            self.assertEqual(written["mesh"]["bounds_mm"], [-10.0, 10.0, -5.0, 5.0, 0.0, 30.0])
            np.testing.assert_array_equal(values, np.array([1.0, 2.0, 3.0, 4.0], dtype=np.float32))
            self.assertTrue(np.all(np.isfinite(values)))
            self.assertIn("Float64 remains authoritative", written["values"]["precision_role"])
            self.assertEqual(written["values"]["exported_precision"], "Float32")
            self.assertEqual(written["provenance"]["kind"], "MCNP Simulation")
            self.assertEqual(written["slicing"]["semantics"], "raw containing-voxel cell values; no interpolation")
            self.assertEqual(written["slicing"]["layers"][1]["bounds_mm"], [10.0, 30.0])
            self.assertEqual(written["slicing"]["layers"][1]["center_mm"], 20.0)
            self.assertEqual(written["slicing"]["layers"][1]["source_range"], [3.0, 4.0])
            self.assertEqual(written["slicing"]["layers"][1]["web_range"], [3.0, 4.0])
            self.assertEqual(written["transform"]["scale"], [10.0, 10.0, 10.0])

    def test_rejects_non_voxel_topology(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "bad.vtkhdf"
            self._write_fixture(source)
            with h5py.File(source, "r+") as h5:
                h5["VTKHDF/Block_2/Types"][0] = 12
            with self.assertRaisesRegex(ValueError, "VTK_VOXEL"):
                export_web_scientific_field(source, Path(temporary) / "out")

    def test_authoritative_sample_export_contract_and_registration(self):
        if not SAMPLE_MCNP_PATH.exists():
            self.skipTest(f"sample MCNP file not available: {SAMPLE_MCNP_PATH}")
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            manifest = export_web_scientific_field(SAMPLE_MCNP_PATH, output)
            values = np.fromfile(output / "values.f32", dtype="<f4")

        self.assertEqual(manifest["mesh"]["point_count"], 1_210_104)
        self.assertEqual(manifest["mesh"]["cell_count"], 1_172_380)
        self.assertEqual(manifest["mesh"]["cell_shape_zyx"], [55, 146, 146])
        np.testing.assert_allclose(manifest["mesh"]["bounds_cm"], [-7.3, 7.3, -7.3, 7.3, 0.0, 92.1], atol=1e-5)
        np.testing.assert_allclose(manifest["mesh"]["bounds_mm"], [-73.0, 73.0, -73.0, 73.0, 0.0, 921.0], atol=1e-4)
        self.assertEqual(values.size, 1_172_380)
        self.assertTrue(np.all(np.isfinite(values)))
        self.assertAlmostEqual(manifest["field"]["source_range"][0], 0.0)
        self.assertAlmostEqual(manifest["field"]["source_range"][1], 32.20605895204285)
        self.assertLess(manifest["values"]["maximum_absolute_deviation"], 1.0e-6)
        self.assertLess(manifest["values"]["maximum_relative_deviation_nonzero"], 6.0e-8)

        glb_min = (-72.168785, -62.500132, -0.000008)
        glb_max = (72.168785, 62.500008, 921.000132)
        bounds = manifest["mesh"]["bounds_mm"]
        self.assertLessEqual(bounds[0], glb_min[0])
        self.assertGreaterEqual(bounds[1], glb_max[0])
        self.assertLessEqual(bounds[2], glb_min[1])
        self.assertGreaterEqual(bounds[3], glb_max[1])
        self.assertAlmostEqual(bounds[4], 0.0, delta=1e-4)
        self.assertAlmostEqual(bounds[5], glb_max[2], delta=2e-4)
        self.assertEqual(MCNP_TO_VIEWER_SCALE, 10.0)

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
        with h5py.File(path, "w") as h5:
            block = h5.create_group("VTKHDF/Block_2")
            block.create_dataset("Points", data=points)
            block.create_dataset("Connectivity", data=np.asarray(cells, dtype=np.int64).reshape(-1))
            block.create_dataset("Offsets", data=np.arange(0, 8 * len(cells) + 1, 8, dtype=np.int64))
            block.create_dataset("Types", data=np.full(len(cells), 11, dtype=np.uint8))
            block.create_dataset("NumberOfCells", data=np.array([len(cells)], dtype=np.int64))
            block.create_dataset("NumberOfPoints", data=np.array([len(points)], dtype=np.int64))
            cell_data = block.create_group("CellData")
            cell_data.create_dataset("Nuclear heating (W_cm3)", data=np.array([1.0, 2.0, 3.0, 4.0], dtype=np.float64))


if __name__ == "__main__":
    unittest.main()
