from pathlib import Path
import unittest

import numpy as np
import pyvista as pv

from fusion_blanket_twin.config.settings import SAMPLE_MCNP_PATH
from fusion_blanket_twin.mcnp.fields import (
    CANONICAL_MCNP_FIELD_ARRAYS,
    DEFAULT_MCNP_FIELD_KEY,
    field_definition_by_key,
    selectable_field_items,
    validate_required_mcnp_fields,
)
from fusion_blanket_twin.mcnp.loader import read_mcnp_multifield_summary
from fusion_blanket_twin.mcnp.probe import McnpRawVoxelProbe
from fusion_blanket_twin.visualization.mcnp import (
    axis_bounds,
    create_mcnp_iso_surface,
    create_mcnp_slice,
    load_mcnp_visualization_mesh,
)


class McnpFieldCatalogTests(unittest.TestCase):
    def test_canonical_field_mapping(self):
        field = field_definition_by_key(DEFAULT_MCNP_FIELD_KEY)
        self.assertEqual(field.internal_name, "Nuclear heating (W_cm3)")
        self.assertEqual(field.scalar_bar_title, "Total Nuclear Heating (W/cm3)")
        self.assertEqual(len(CANONICAL_MCNP_FIELD_ARRAYS), 5)
        self.assertIn("Neutron flux (n_cm^2_s)", CANONICAL_MCNP_FIELD_ARRAYS)

    def test_selector_excludes_raw_tally_and_rsd_arrays(self):
        titles = [item["title"] for item in selectable_field_items()]
        self.assertEqual(len(titles), 5)
        self.assertFalse(any("tally" in title.lower() for title in titles))
        self.assertFalse(any("standard_deviation" in title for title in titles))

    def test_required_field_validation(self):
        validate_required_mcnp_fields(CANONICAL_MCNP_FIELD_ARRAYS)
        with self.assertRaises(ValueError):
            validate_required_mcnp_fields(("Neutron flux (n_cm^2_s)",))


class McnpVisualizationPipelineTests(unittest.TestCase):
    def setUp(self):
        self.mesh = _synthetic_mcnp_mesh()

    def test_x_y_z_slice_creation_preserves_selected_cell_field(self):
        for axis in ("X", "Y", "Z"):
            with self.subTest(axis=axis):
                sliced = create_mcnp_slice(
                    self.mesh,
                    axis,
                    0.5,
                    "Nuclear heating (W_cm3)",
                )
                self.assertGreater(sliced.mesh.n_cells, 0)
                self.assertIn("Nuclear heating (W_cm3)", sliced.mesh.cell_data)

    def test_slice_bounds_come_from_axis(self):
        bounds = (0.0, 2.0, 10.0, 20.0, -5.0, 5.0)
        self.assertEqual(axis_bounds(bounds, "X"), (0.0, 2.0))
        self.assertEqual(axis_bounds(bounds, "Y"), (10.0, 20.0))
        self.assertEqual(axis_bounds(bounds, "Z"), (-5.0, 5.0))

    def test_log_display_configuration_does_not_modify_raw_mesh(self):
        before = set(self.mesh.cell_data.keys())
        display = create_mcnp_slice(
            self.mesh,
            "Z",
            0.5,
            "Neutron flux (n_cm^2_s)",
            use_log_scale=True,
        )
        self.assertTrue(display.uses_log_scale)
        self.assertIn("log10", display.scalar_name)
        self.assertEqual(set(self.mesh.cell_data.keys()), before)

    def test_iso_surface_conversion_does_not_modify_raw_cell_data(self):
        before = {name: self.mesh.cell_data[name].copy() for name in self.mesh.cell_data}
        display = create_mcnp_iso_surface(
            self.mesh,
            "Nuclear heating (W_cm3)",
            20.0,
        )
        self.assertIsNotNone(display.interpolation_note)
        for name, values in before.items():
            np.testing.assert_array_equal(self.mesh.cell_data[name], values)
        self.assertNotIn("log10(Nuclear heating (W_cm3))", self.mesh.cell_data)


@unittest.skipUnless(SAMPLE_MCNP_PATH.exists(), "local multi-field VTKHDF sample not available")
class LocalMcnpMultifieldSampleTests(unittest.TestCase):
    def test_actual_sample_array_discovery(self):
        summary = read_mcnp_multifield_summary(SAMPLE_MCNP_PATH)
        self.assertEqual(summary.cell_count, 1_172_380)
        self.assertEqual(summary.point_count, 1_210_104)
        expected_bounds = (-73.0, 73.0, -73.0, 73.0, 0.0, 921.0)
        for actual, expected in zip(summary.bounds_mm, expected_bounds):
            self.assertAlmostEqual(actual, expected, delta=1.0e-3)
        for name in CANONICAL_MCNP_FIELD_ARRAYS:
            self.assertIn(name, summary.cell_arrays)
            self.assertIn(name, summary.field_ranges)

    def test_visualization_mesh_loads_once_with_all_fields(self):
        loaded = load_mcnp_visualization_mesh(SAMPLE_MCNP_PATH)
        self.assertEqual(loaded.mesh_mm.n_cells, 1_172_380)
        for name in CANONICAL_MCNP_FIELD_ARRAYS:
            self.assertIn(name, loaded.mesh_mm.cell_data)
        self.assertGreater(loaded.load_time_s, 0.0)
        self.assertGreater(loaded.transform_time_s, 0.0)

    def test_raw_multifield_probe_returns_all_canonical_values(self):
        probe = McnpRawVoxelProbe(SAMPLE_MCNP_PATH)
        result = probe.probe_all((0.0, 0.0, 10.0), active_field_name="Nuclear heating (W_cm3)")
        self.assertEqual(result.status, "ok")
        self.assertEqual(set(result.values), set(CANONICAL_MCNP_FIELD_ARRAYS))
        self.assertIsNotNone(result.active_value)


def _synthetic_mcnp_mesh() -> pv.DataSet:
    mesh = pv.ImageData(dimensions=(3, 3, 3), spacing=(1.0, 1.0, 1.0))
    base = np.arange(mesh.n_cells, dtype=float)
    for index, name in enumerate(CANONICAL_MCNP_FIELD_ARRAYS, start=1):
        mesh.cell_data[name] = base * index + index
    return mesh


if __name__ == "__main__":
    unittest.main()
