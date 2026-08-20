"""Search installed trame/wslink package files for diagnostic terms."""

from __future__ import annotations

from pathlib import Path
import sys


def main(argv: list[str] | None = None) -> int:
    terms = [term.lower() for term in (argv or sys.argv[1:])]
    if not terms:
        terms = ["paraview", "launcher"]

    root = Path(".venv") / "Lib" / "site-packages"
    files = [
        path
        for path in root.rglob("*")
        if path.is_file()
        and path.suffix.lower() in {".py", ".js", ".html", ".mjs"}
        and ("trame" in str(path).lower() or "wslink" in str(path).lower())
    ]
    for term in terms:
        print(f"TERM {term}")
        for path in files:
            try:
                text = path.read_text(encoding="utf-8", errors="ignore").lower()
            except Exception:
                continue
            if term in text:
                print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

