"""Export one authoritative MCNP field to the local browser representation."""

from __future__ import annotations

import argparse
from pathlib import Path

from fusion_blanket_twin.mcnp.web_field import export_web_scientific_field


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export the Total Nuclear Heating rectilinear cell grid for the web viewer."
    )
    parser.add_argument("--input", type=Path, default=Path("data/sample/test.vtkhdf"))
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("web/public/scientific/generated/reference-mcnp/nuclear-heating"),
    )
    args = parser.parse_args()
    manifest = export_web_scientific_field(args.input, args.output)
    print(f"Exported {manifest['field']['display_name']} to {args.output}")
    print(f"Cells: {manifest['mesh']['cell_count']:,}")
    print(f"Values: {manifest['values']['byte_length']:,} bytes ({manifest['values']['dtype']})")
    print(f"Range: {manifest['field']['web_range']} {manifest['field']['display_units']}")


if __name__ == "__main__":
    main()
