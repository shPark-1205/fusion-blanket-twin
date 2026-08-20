"""Print context around a string in a served JavaScript bundle."""

from __future__ import annotations

import argparse
import urllib.request


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("term")
    parser.add_argument("--context", type=int, default=1200)
    args = parser.parse_args()

    text = urllib.request.urlopen(args.url, timeout=10).read().decode("utf-8", "replace")
    index = text.find(args.term)
    if index < 0:
        print(f"not found: {args.term}")
        return 1
    start = max(0, index - args.context)
    end = min(len(text), index + len(args.term) + args.context)
    print(text[start:end])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

