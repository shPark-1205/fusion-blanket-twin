from pathlib import Path
import tempfile
import unittest

from fusion_blanket_twin.geometry.csg import PrimitiveCSGParameters
from fusion_blanket_twin.mcnp.csg_parser import (
    DuplicateSurfaceError,
    RequiredSurfaceMissingError,
    SurfaceTypeMismatchError,
    parse_primitive_csg_parameters,
    parse_surface_card,
)


REPRESENTATIVE_INPUT = Path("data/local/mcnp_inputs/INDEX_104-A.inp")


class McnpCsgParserTests(unittest.TestCase):
    def test_parse_normal_pz_card(self):
        card = parse_surface_card("  206   PZ    2.6  $ breeder boundary", 12)
        self.assertIsNotNone(card)
        self.assertEqual(card.surface_number, 206)
        self.assertEqual(card.surface_type, "PZ")
        self.assertEqual(card.value, 2.6)
        self.assertEqual(card.line_number, 12)

    def test_parse_normal_cz_card(self):
        card = parse_surface_card("301 CZ 3.6", 4)
        self.assertIsNotNone(card)
        self.assertEqual(card.surface_number, 301)
        self.assertEqual(card.surface_type, "CZ")
        self.assertEqual(card.value, 3.6)

    def test_extract_all_required_surfaces_from_representative_input(self):
        params = parse_primitive_csg_parameters(REPRESENTATIVE_INPUT)
        self.assertEqual(
            params,
            PrimitiveCSGParameters(
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

    def test_missing_required_surface_fails(self):
        text = "\n".join(
            [
                "206 PZ 2.6",
                "207 PZ 2.7",
                "208 PZ 2.9",
                "209 PZ 3.0",
                "301 CZ 3.6",
                "302 CZ 3.5",
                "303 CZ 3.3",
            ]
        )
        with self.assertRaises(RequiredSurfaceMissingError):
            parse_primitive_csg_parameters(_write_temp_input(text))

    def test_incorrect_surface_type_fails(self):
        text = _minimal_required_input().replace("206 PZ 2.6", "206 PX 2.6")
        with self.assertRaises(SurfaceTypeMismatchError):
            parse_primitive_csg_parameters(_write_temp_input(text))

    def test_duplicate_required_surface_fails(self):
        text = _minimal_required_input() + "\n206 PZ 9.9\n"
        with self.assertRaises(DuplicateSurfaceError):
            parse_primitive_csg_parameters(_write_temp_input(text))


def _minimal_required_input() -> str:
    return "\n".join(
        [
            "206 PZ 2.6",
            "207 PZ 2.7",
            "208 PZ 2.9",
            "209 PZ 3.0",
            "301 CZ 3.6",
            "302 CZ 3.5",
            "303 CZ 3.3",
            "304 CZ 3.2",
        ]
    )


def _write_temp_input(text: str) -> Path:
    temp_dir = tempfile.TemporaryDirectory()
    path = Path(temp_dir.name) / "case.inp"
    path.write_text(text, encoding="utf-8")
    _TEMP_DIRS.append(temp_dir)
    return path


_TEMP_DIRS: list[tempfile.TemporaryDirectory] = []


if __name__ == "__main__":
    unittest.main()

