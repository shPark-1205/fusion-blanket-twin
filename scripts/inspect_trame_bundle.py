"""Inspect served trame JavaScript bundle for network-related calls."""

from __future__ import annotations

import argparse
import re
import urllib.request


PATTERNS = (
    "fetch(",
    "XMLHttpRequest",
    "WebSocket",
    "POST",
    "method",
    "wslink",
    "/ws",
    "loading.tpl",
    "logo.png",
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    args = parser.parse_args()

    text = urllib.request.urlopen(args.url, timeout=10).read().decode("utf-8", "replace")
    print(f"length={len(text)}")
    for pattern in PATTERNS:
        print(f"{pattern}: {text.find(pattern)}")

    regex = re.compile(
        r".{0,90}(fetch\(|XMLHttpRequest|WebSocket|POST|method|wslink|/ws|loading\.tpl|logo\.png).{0,140}"
    )
    for match in regex.finditer(text):
        print("---")
        print(match.group(0))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

