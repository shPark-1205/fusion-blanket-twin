"""Shared project settings for the v0.1 scientific viewer."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[3]
SAMPLE_DATA_DIR = PROJECT_ROOT / "data" / "sample"

SAMPLE_CAD_PATH = SAMPLE_DATA_DIR / "test_blanket.stp"
SAMPLE_MCNP_PATH = SAMPLE_DATA_DIR / "test_total_heating.vtkhdf"

MCNP_TO_PROJECT_LENGTH_SCALE = 10.0
REQUIRED_MCNP_FIELD = "Total heating (W_cm3)"


@dataclass(frozen=True)
class RepresentativeCase:
    breeder_ratio: float = 0.326
    coolant: str = "water"
    pressure_mpa: float = 15.5
    inlet_temperature_c: float = 295.0
    expected_outlet_temperature_c: float = 325.0
    nwl_w_cm2: float = 134.0
    nwl_mw_m2: float = 1.34
    tbr: float = 1.233
    mass_flow: str = "N/A - not simulated"


REPRESENTATIVE_CASE = RepresentativeCase()

