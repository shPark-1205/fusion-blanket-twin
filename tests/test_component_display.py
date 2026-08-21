import unittest

import pyvista as pv

from fusion_blanket_twin.geometry.parametric_csg import (
    DEFAULT_PRIMITIVE_CSG_PARAMETERS,
    ParametricCSGGeometryProvider,
)
from fusion_blanket_twin.visualization.component_display import (
    DEFAULT_COMPONENT_GROUP_COLORS,
    ClippingConfig,
    ComponentDisplayConfig,
    ComponentGeometryView,
)


class ComponentDisplayConfigTests(unittest.TestCase):
    def test_default_group_colors(self):
        self.assertEqual(DEFAULT_COMPONENT_GROUP_COLORS["Armor"], "#7E57C2")
        self.assertEqual(DEFAULT_COMPONENT_GROUP_COLORS["Breeder"], "#F28E2B")
        self.assertEqual(DEFAULT_COMPONENT_GROUP_COLORS["Multiplier"], "#59A14F")
        self.assertEqual(DEFAULT_COMPONENT_GROUP_COLORS["Structure"], "#8A8A8A")
        self.assertEqual(DEFAULT_COMPONENT_GROUP_COLORS["Coolant"], "#4E79A7")

    def test_color_override_and_visibility_state(self):
        config = ComponentDisplayConfig()
        config.group_colors["Breeder"] = "#112233"
        config.group_visibility["Coolant"] = False
        self.assertEqual(config.color_for_group("Breeder"), "#112233")
        self.assertFalse(config.is_group_visible("Coolant"))
        self.assertTrue(config.is_group_visible("Armor"))

    def test_clipping_configuration_defaults(self):
        clipping = ClippingConfig()
        self.assertFalse(clipping.enabled)
        self.assertEqual(clipping.axis, "Z")
        self.assertEqual(clipping.position_mm, 0.0)
        self.assertFalse(clipping.invert)


class ComponentGeometryViewTests(unittest.TestCase):
    def setUp(self):
        self.plotter = pv.Plotter(off_screen=True)
        assembly = ParametricCSGGeometryProvider(DEFAULT_PRIMITIVE_CSG_PARAMETERS).build()
        self.view = ComponentGeometryView(self.plotter, assembly)

    def tearDown(self):
        self.plotter.close()

    def test_user_color_override_updates_actor_property(self):
        self.view.set_group_color("Breeder", "#112233")
        breeder = next(
            component
            for component in self.view.assembly.components
            if component.component_group == "Breeder"
        )
        actor = self.plotter.renderer.actors[f"parametric_csg_{breeder.component_id}"]
        self.assertAlmostEqual(actor.GetProperty().GetColor()[0], 0x11 / 255.0)
        self.assertAlmostEqual(actor.GetProperty().GetColor()[1], 0x22 / 255.0)
        self.assertAlmostEqual(actor.GetProperty().GetColor()[2], 0x33 / 255.0)

    def test_visibility_toggle_hides_and_restores_group(self):
        self.view.set_group_visibility("Coolant", False)
        coolant_actors = [
            self.plotter.renderer.actors[f"parametric_csg_{component.component_id}"]
            for component in self.view.assembly.components
            if component.component_group == "Coolant"
        ]
        self.assertTrue(coolant_actors)
        self.assertTrue(all(actor.GetVisibility() == 0 for actor in coolant_actors))

        self.view.set_group_visibility("Coolant", True)
        self.assertTrue(all(actor.GetVisibility() == 1 for actor in coolant_actors))

    def test_clipping_adds_non_destructive_mapper_plane(self):
        self.view.set_clipping(ClippingConfig(enabled=True, axis="X", position_mm=10.0))
        actor = next(iter(self.plotter.renderer.actors.values()))
        self.assertEqual(actor.GetMapper().GetNumberOfClippingPlanes(), 1)
        self.assertGreater(self.view.assembly.component_count, 0)

        self.view.reset_clipping()
        self.assertEqual(actor.GetMapper().GetNumberOfClippingPlanes(), 0)


if __name__ == "__main__":
    unittest.main()
