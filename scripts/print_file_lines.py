"""Print a line range from a text file."""

from __future__ import annotations

import argparse
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path)
    parser.add_argument("--start", type=int, required=True)
    parser.add_argument("--end", type=int, required=True)
    args = parser.parse_args()

    lines = args.path.read_text(encoding="utf-8", errors="replace").splitlines()
    for number in range(args.start, min(args.end, len(lines)) + 1):
        print(f"{number}: {lines[number - 1]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

