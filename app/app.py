"""Command-line v0.1 data registration check for Fusion Blanket Twin."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from fusion_blanket_twin.config.settings import (  # noqa: E402
    REPRESENTATIVE_CASE,
    REQUIRED_MCNP_FIELD,
    SAMPLE_CAD_PATH,
    SAMPLE_MCNP_PATH,
)
from fusion_blanket_twin.geometry.loader import read_step_summary  # noqa: E402
from fusion_blanket_twin.mcnp.loader import read_mcnp_summary  # noqa: E402
from fusion_blanket_twin.mcnp.probe import McnpRawVoxelProbe  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Validate CAD/MCNP loading and cm-to-mm registration."
    )
    parser.add_argument("--cad", type=Path, default=SAMPLE_CAD_PATH)
    parser.add_argument("--mcnp", type=Path, default=SAMPLE_MCNP_PATH)
    parser.add_argument("--probe", nargs=3, type=float, metavar=("X_MM", "Y_MM", "Z_MM"))
    args = parser.parse_args(argv)

    cad = read_step_summary(args.cad)
    mcnp = read_mcnp_summary(args.mcnp, REQUIRED_MCNP_FIELD)

    print("Fusion Blanket Twin v0.1 data check")
    print(f"CAD file: {cad.path}")
    print(f"CAD solids: {cad.solid_count}")
    print(f"CAD bounds mm: {cad.bounds_mm}")
    print(f"MCNP file: {mcnp.path}")
    print(f"MCNP cells: {mcnp.cell_count}")
    print(f"MCNP points: {mcnp.point_count}")
    print(f"MCNP bounds cm: {mcnp.bounds_cm}")
    print(f"MCNP bounds mm: {mcnp.bounds_mm}")
    print(f"MCNP field: {mcnp.field_name}")
    print(f"MCNP field range: {mcnp.field_range}")
    print(
        "Representative case: "
        f"TBR={REPRESENTATIVE_CASE.tbr}, "
        f"NWL={REPRESENTATIVE_CASE.nwl_mw_m2} MW/m2, "
        f"breeder_ratio={REPRESENTATIVE_CASE.breeder_ratio}, "
        f"coolant={REPRESENTATIVE_CASE.coolant}, "
        f"pressure={REPRESENTATIVE_CASE.pressure_mpa} MPa, "
        f"Tin={REPRESENTATIVE_CASE.inlet_temperature_c} C, "
        f"Tout_expected={REPRESENTATIVE_CASE.expected_outlet_temperature_c} C, "
        f"mass_flow={REPRESENTATIVE_CASE.mass_flow}"
    )

    if args.probe:
        probe = McnpRawVoxelProbe(args.mcnp, REQUIRED_MCNP_FIELD)
        result = probe.probe(tuple(args.probe))
        print(f"Raw probe: {result}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

