"""Primitive CSG geometry parameters for the current MCNP blanket family."""

from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class PrimitiveCSGParameters:
    """Independently stored primitive MCNP CSG surface values.

    Values are in MCNP geometry units, centimeters. This class intentionally
    does not encode the current two-variable DOE coupling; mappings and
    constraints belong in a separate digital-model layer.
    """

    pz_206: float
    pz_207: float
    pz_208: float
    pz_209: float
    cz_301_radius: float
    cz_302_radius: float
    cz_303_radius: float
    cz_304_radius: float

    def as_dict(self) -> dict[str, float]:
        return asdict(self)

    @property
    def pz_spacings_cm(self) -> tuple[float, float, float]:
        return (
            self.pz_207 - self.pz_206,
            self.pz_208 - self.pz_207,
            self.pz_209 - self.pz_208,
        )

    @property
    def cz_radial_spacings_cm(self) -> tuple[float, float, float]:
        return (
            self.cz_301_radius - self.cz_302_radius,
            self.cz_302_radius - self.cz_303_radius,
            self.cz_303_radius - self.cz_304_radius,
        )

