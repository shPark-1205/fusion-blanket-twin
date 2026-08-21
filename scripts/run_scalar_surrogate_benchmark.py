"""Run the scalar surrogate benchmark and write local artifacts."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from fusion_blanket_twin.data.case_registry import CaseRegistry  # noqa: E402
from fusion_blanket_twin.surrogate.benchmark import run_benchmark_from_registry  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Benchmark scalar surrogates on 100 MCNP cases.")
    parser.add_argument(
        "--inputs",
        type=Path,
        default=ROOT / "data" / "local" / "mcnp_inputs",
    )
    parser.add_argument(
        "--workbook",
        type=Path,
        default=ROOT / "data" / "local" / "fusion_blanket_twin_100case_results_parsed.xlsx",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=ROOT / "data" / "local" / "surrogate_benchmark",
    )
    args = parser.parse_args(argv)

    registry = CaseRegistry.from_input_directory(args.inputs).with_scalar_results(args.workbook)
    result = run_benchmark_from_registry(registry, args.output_dir)
    summary = result["summary"]
    print(f"Wrote benchmark artifacts to: {args.output_dir}")
    for output_name, best in summary["best_models"].items():
        print(
            f"{output_name}: best={best['model']} "
            f"rmse={best['rmse']:.6g} mae={best['mae']:.6g}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

