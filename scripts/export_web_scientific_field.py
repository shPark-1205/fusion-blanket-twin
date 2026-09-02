"""Export authoritative MCNP fields to the local browser representation."""

from __future__ import annotations

import argparse
from pathlib import Path

from fusion_blanket_twin.mcnp.web_field import export_web_scientific_dataset


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export the canonical MCNP rectilinear cell grid and scalar fields for the web viewer."
    )
    parser.add_argument("--input", type=Path, default=Path("data/sample/test.vtkhdf"))
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("web/public/scientific/generated/reference-mcnp"),
    )
    args = parser.parse_args()
    manifest = export_web_scientific_dataset(args.input, args.output)
    print(f"Exported {len(manifest['fields'])} MCNP fields to {args.output}")
    print(f"Cells: {manifest['mesh']['cell_count']:,}")
    for field_key in manifest["field_order"]:
        field = manifest["fields"][field_key]
        print(
            f"{field['display_name']}: {field['values']['byte_length']:,} bytes "
            f"({field['values']['dtype']}), range {field['web_range']} {field['display_units']}"
        )
    consistency = manifest["consistency_checks"]["nuclear_heating_equals_neutron_plus_photon"]
    print(
        "Nuclear heating consistency: "
        f"max abs {consistency['maximum_absolute_error']:.6g}, "
        f"mean abs {consistency['mean_absolute_error']:.6g}"
    )


if __name__ == "__main__":
    main()
