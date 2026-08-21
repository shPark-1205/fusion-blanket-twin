"""Minimum MCNP surface-card parser for blanket primitive CSG parameters."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re

from fusion_blanket_twin.geometry.csg import PrimitiveCSGParameters


REQUIRED_SURFACE_TYPES: dict[int, str] = {
    206: "PZ",
    207: "PZ",
    208: "PZ",
    209: "PZ",
    301: "CZ",
    302: "CZ",
    303: "CZ",
    304: "CZ",
}

_SURFACE_CARD_RE = re.compile(
    r"^\s*[*+]?(?P<number>\d+)\s+(?P<surface_type>[A-Za-z]+)\b(?P<args>.*)$"
)
_NUMBER_RE = re.compile(
    r"^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[Ee][+-]?\d+)?$"
)


class McnpSurfaceParseError(ValueError):
    """Base error for required MCNP surface parsing failures."""


class RequiredSurfaceMissingError(McnpSurfaceParseError):
    """Raised when a required surface number is not present."""


class DuplicateSurfaceError(McnpSurfaceParseError):
    """Raised when a required surface card appears more than once."""


class SurfaceTypeMismatchError(McnpSurfaceParseError):
    """Raised when a required surface has the wrong MCNP surface type."""


class SurfaceValueError(McnpSurfaceParseError):
    """Raised when a required surface value cannot be parsed."""


@dataclass(frozen=True)
class ParsedSurfaceCard:
    surface_number: int
    surface_type: str
    value: float
    line_number: int
    raw_line: str


def parse_surface_card(line: str, line_number: int = 1) -> ParsedSurfaceCard | None:
    """Parse a single simple MCNP surface card.

    Only surface cards with an alphabetic surface type token are parsed. This
    prevents ordinary cell cards from being interpreted as required surfaces.
    """
    stripped = _remove_inline_comment(line).strip()
    if not stripped or _is_comment_line(stripped):
        return None

    match = _SURFACE_CARD_RE.match(stripped)
    if match is None:
        return None

    surface_number = int(match.group("number"))
    surface_type = match.group("surface_type").upper()
    value = _parse_first_numeric_argument(match.group("args"), line_number, line)
    return ParsedSurfaceCard(
        surface_number=surface_number,
        surface_type=surface_type,
        value=value,
        line_number=line_number,
        raw_line=line.rstrip("\n"),
    )


def parse_primitive_csg_parameters(path: Path) -> PrimitiveCSGParameters:
    """Extract required PZ/CZ primitive CSG values from an MCNP input file."""
    cards = parse_required_surface_cards(path)
    return PrimitiveCSGParameters(
        pz_206=cards[206].value,
        pz_207=cards[207].value,
        pz_208=cards[208].value,
        pz_209=cards[209].value,
        cz_301_radius=cards[301].value,
        cz_302_radius=cards[302].value,
        cz_303_radius=cards[303].value,
        cz_304_radius=cards[304].value,
    )


def parse_required_surface_cards(path: Path) -> dict[int, ParsedSurfaceCard]:
    """Parse only the project-required MCNP PZ/CZ surface cards."""
    if not path.exists():
        raise FileNotFoundError(f"MCNP input file not found: {path}")
    if not path.is_file():
        raise ValueError(f"MCNP input path is not a file: {path}")

    found: dict[int, ParsedSurfaceCard] = {}
    with path.open("r", errors="replace") as stream:
        for line_number, line in enumerate(stream, start=1):
            card = parse_surface_card(line, line_number)
            if card is None or card.surface_number not in REQUIRED_SURFACE_TYPES:
                continue

            expected_type = REQUIRED_SURFACE_TYPES[card.surface_number]
            if card.surface_type != expected_type:
                raise SurfaceTypeMismatchError(
                    f"{path}:{line_number}: surface {card.surface_number} "
                    f"expected {expected_type}, found {card.surface_type}"
                )
            if card.surface_number in found:
                previous = found[card.surface_number]
                raise DuplicateSurfaceError(
                    f"{path}:{line_number}: surface {card.surface_number} appears "
                    f"more than once; first seen on line {previous.line_number}"
                )
            found[card.surface_number] = card

    missing = sorted(set(REQUIRED_SURFACE_TYPES) - set(found))
    if missing:
        missing_text = ", ".join(str(number) for number in missing)
        raise RequiredSurfaceMissingError(
            f"{path}: missing required MCNP surfaces: {missing_text}"
        )
    return found


def _remove_inline_comment(line: str) -> str:
    return line.split("$", 1)[0]


def _is_comment_line(stripped_line: str) -> bool:
    return stripped_line[:1].lower() == "c" and (
        len(stripped_line) == 1 or stripped_line[1].isspace()
    )


def _parse_first_numeric_argument(
    args: str,
    line_number: int,
    raw_line: str,
) -> float:
    tokens = args.strip().split()
    if not tokens:
        raise SurfaceValueError(
            f"line {line_number}: surface card has no numeric argument: {raw_line.rstrip()}"
        )
    token = tokens[0]
    if _NUMBER_RE.match(token) is None:
        raise SurfaceValueError(
            f"line {line_number}: expected first surface argument to be numeric, "
            f"found {token!r}: {raw_line.rstrip()}"
        )
    return float(token)

