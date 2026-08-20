import unittest

from fusion_blanket_twin.mcnp.transforms import bounds_cm_to_mm, cm_to_mm


class McnpTransformTests(unittest.TestCase):
    def test_cm_to_mm(self):
        self.assertEqual(cm_to_mm(92.1), 921.0)

    def test_bounds_cm_to_mm(self):
        self.assertEqual(
            bounds_cm_to_mm((-7.3, 7.3, -6.3, 6.3, 0.0, 92.1)),
            (-73.0, 73.0, -63.0, 63.0, 0.0, 921.0),
        )


if __name__ == "__main__":
    unittest.main()

