"""Capture Chrome netlog for the viewer page and print 405 responses."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time


DEFAULT_CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("--netlog", type=Path, default=Path("chrome_netlog.json"))
    parser.add_argument("--dump", type=Path, default=Path("chrome_dump.html"))
    parser.add_argument("--profile", type=Path, default=Path("tmp_chrome_profile"))
    parser.add_argument("--show-localhost", action="store_true")
    args = parser.parse_args(argv)

    chrome = shutil.which("chrome") or str(DEFAULT_CHROME)
    if not Path(chrome).exists():
        print(f"Chrome executable not found: {chrome}", file=sys.stderr)
        return 1

    if args.netlog.exists():
        args.netlog.unlink()
    args.profile.mkdir(exist_ok=True)

    with args.dump.open("w", encoding="utf-8") as stdout:
        result = subprocess.run(
            [
                chrome,
                "--headless=new",
                "--disable-gpu",
                "--no-first-run",
                f"--user-data-dir={args.profile.resolve()}",
                f"--log-net-log={args.netlog.resolve()}",
                "--net-log-capture-mode=IncludeSensitive",
                "--dump-dom",
                args.url,
            ],
            stdout=stdout,
            stderr=subprocess.PIPE,
            text=True,
            timeout=45,
            check=False,
        )

    if not args.netlog.exists():
        print(result.stderr, file=sys.stderr)
        print("Chrome did not write a netlog.", file=sys.stderr)
        return 1

    # Chrome may finish before the OS flushes the complete JSON file.
    time.sleep(1.0)
    events = json.loads(args.netlog.read_text(encoding="utf-8")).get("events", [])
    urls_by_source: dict[int, str] = {}
    methods_by_source: dict[int, str] = {}
    status_by_source: dict[int, int] = {}

    for event in events:
        source_id = event.get("source", {}).get("id")
        params = event.get("params", {})
        if source_id is None:
            continue
        url = params.get("url")
        method = params.get("method")
        if url:
            urls_by_source[source_id] = url
        if method:
            methods_by_source[source_id] = method
        headers = params.get("headers")
        if isinstance(headers, list):
            for header in headers:
                if isinstance(header, str) and header.startswith("HTTP/"):
                    parts = header.split()
                    if len(parts) >= 2 and parts[1].isdigit():
                        status_by_source[source_id] = int(parts[1])

    found = False
    if args.show_localhost:
        for source_id, url in sorted(urls_by_source.items()):
            if "localhost:" in url:
                print(
                    f"request source={source_id} "
                    f"method={methods_by_source.get(source_id, 'unknown')} "
                    f"status={status_by_source.get(source_id, 'unknown')} "
                    f"url={url}"
                )
    for source_id, status in sorted(status_by_source.items()):
        if status == 405:
            found = True
            print(
                f"405 source={source_id} "
                f"method={methods_by_source.get(source_id, 'unknown')} "
                f"url={urls_by_source.get(source_id, 'unknown')}"
            )
    if not found:
        print("No 405 response found in Chrome netlog.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
