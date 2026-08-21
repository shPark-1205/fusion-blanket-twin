from pathlib import Path
import unittest

from fusion_blanket_twin.config.settings import SAMPLE_CAD_PATH
from fusion_blanket_twin.data.case_registry import CaseRegistry
from fusion_blanket_twin.geometry.cad_tessellation import load_tessellated_step_assembly
from fusion_blanket_twin.geometry.csg import PrimitiveCSGParameters
from fusion_blanket_twin.geometry.doe_mapping import CurrentDOEGeometryMapping
from fusion_blanket_twin.geometry.parametric_csg import (
    DEFAULT_PRIMITIVE_CSG_PARAMETERS,
    ParametricCSGGeometryProvider,
)


LOCAL_INPUT_DIR = Path("data/local/mcnp_inputs")


class CurrentDOEGeometryMappingTests(unittest.TestCase):
    def test_current_fixed_spacing_reconstructs_full_primitive_parameters(self):
        mapping = CurrentDOEGeometryMapping.current_fixed_spacing()
        self.assertEqual(
            mapping.from_current_controls(5.6, 4.8),
            PrimitiveCSGParameters(
                pz_206=5.6,
                pz_207=5.699999999999999,
                pz_208=5.8999999999999995,
                pz_209=6.0,
                cz_301_radius=4.8,
                cz_302_radius=4.7,
                cz_303_radius=4.5,
                cz_304_radius=4.3999999999999995,
            ),
        )

    def test_mapping_from_registry_uses_verified_current_doe_offsets(self):
        registry = CaseRegistry.from_input_directory(LOCAL_INPUT_DIR)
        mapping = CurrentDOEGeometryMapping.from_registry(registry)
        params = mapping.from_current_controls(5.6, 4.8)
        self.assertAlmostEqual(params.pz_207 - params.pz_206, 0.1)
        self.assertAlmostEqual(params.pz_208 - params.pz_207, 0.2)
        self.assertAlmostEqual(params.pz_209 - params.pz_208, 0.1)
        self.assertAlmostEqual(params.cz_301_radius - params.cz_302_radius, 0.1)
        self.assertAlmostEqual(params.cz_302_radius - params.cz_303_radius, 0.2)
        self.assertAlmostEqual(params.cz_303_radius - params.cz_304_radius, 0.1)


class ParametricCSGGeometryProviderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.assembly = ParametricCSGGeometryProvider(
            DEFAULT_PRIMITIVE_CSG_PARAMETERS
        ).build()
        cls.step = load_tessellated_step_assembly(SAMPLE_CAD_PATH)

    def test_provider_returns_expected_component_groups(self):
        self.assertEqual(
            self.assembly.component_groups,
            ("Armor", "Breeder", "Coolant", "Multiplier", "Structure"),
        )

    def test_provider_preserves_stable_component_ids(self):
        component_ids = [component.component_id for component in self.assembly.components]
        self.assertEqual(component_ids[0], "Armor")
        self.assertIn("Pin_01", component_ids)
        self.assertIn("Pin_10", component_ids)
        self.assertIn("Coolant_01", component_ids)
        self.assertIn("Coolant_09", component_ids)
        self.assertIn("BSS_01", component_ids)
        self.assertIn("BSS_02", component_ids)
        self.assertEqual(len(component_ids), len(set(component_ids)))

    def test_component_count_matches_current_step_body_count(self):
        self.assertEqual(self.assembly.component_count, 26)
        self.assertEqual(self.step.body_count, 26)

    def test_generated_bounds_match_representative_step_bounds(self):
        for generated, step in zip(self.assembly.bounds_mm, self.step.bounds_mm):
            self.assertAlmostEqual(generated, step, delta=1.0e-6)

    def test_design_parameters_move_component_bounds(self):
        baseline = {
            component.component_id: component.bounds_mm
            for component in self.assembly.components
        }
        changed_params = PrimitiveCSGParameters(
            pz_206=6.6,
            pz_207=6.7,
            pz_208=6.9,
            pz_209=7.0,
            cz_301_radius=5.0,
            cz_302_radius=4.9,
            cz_303_radius=4.7,
            cz_304_radius=4.6,
        )
        changed = ParametricCSGGeometryProvider(changed_params).build()
        changed_by_id = {
            component.component_id: component.bounds_mm
            for component in changed.components
        }
        self.assertNotEqual(baseline["Breeder"], changed_by_id["Breeder"])
        self.assertNotEqual(baseline["Pin_05"], changed_by_id["Pin_05"])


if __name__ == "__main__":
    unittest.main()
