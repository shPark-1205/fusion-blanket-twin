"""Start one viewer stage, verify HTTP response, then stop it."""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
import urllib.request


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=("basic", "primitive", "heating", "full"))
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--timeout", type=float, default=35.0)
    args = parser.parse_args(argv)

    process = subprocess.Popen(
        [
            sys.executable,
            "main.py",
            "--viewer",
            "--ui-stage",
            args.stage,
            "--port",
            str(args.port),
            "--host",
            "localhost",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        ok, error = _wait_for_http(args.port, args.timeout)
        if ok:
            print(f"{args.stage}: http://localhost:{args.port} returned HTTP 200")
            return 0
        print(f"{args.stage}: failed to respond: {error}", file=sys.stderr)
        if process.stdout is not None:
            print(process.stdout.read(), file=sys.stderr)
        return 1
    finally:
        process.terminate()
        try:
            process.wait(timeout=8.0)
        except subprocess.TimeoutExpired:
            process.kill()


def _wait_for_http(port: int, timeout: float) -> tuple[bool, str]:
    deadline = time.time() + timeout
    last_error = ""
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://localhost:{port}", timeout=2.0) as response:
                if response.status == 200:
                    return True, ""
                last_error = f"HTTP {response.status}"
        except Exception as exc:
            last_error = str(exc)
            time.sleep(1.0)
    return False, last_error


if __name__ == "__main__":
    raise SystemExit(main())

