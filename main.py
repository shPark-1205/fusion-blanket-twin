"""PyCharm entry point for Fusion Blanket Twin."""

from __future__ import annotations

import sys

from app.app import main as data_check_main
from app.viewer import main as viewer_main


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if args and args[0] == "--viewer":
        return viewer_main(args[1:])
    return data_check_main(args)


if __name__ == "__main__":
    raise SystemExit(main())
