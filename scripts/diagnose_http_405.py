"""Probe trame HTTP endpoints for 405 Method Not Allowed responses."""

from __future__ import annotations

import argparse
import http.client


DEFAULT_PATHS = (
    "/",
    "/index.html",
    "/logo.png",
    "/vue.global.js",
    "/assets/index-DBTNMoYm.js",
    "/assets/index-faLoIDve.css",
    "/loading.tpl",
    "/ws",
    "/wslink",
    "/paraview",
    "/api",
)
DEFAULT_METHODS = ("GET", "HEAD", "POST", "OPTIONS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="localhost")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()

    for path in DEFAULT_PATHS:
        for method in DEFAULT_METHODS:
            status, reason = _request(args.host, args.port, method, path)
            print(f"{method:7s} {path:32s} {status} {reason}")
    return 0


def _request(host: str, port: int, method: str, path: str) -> tuple[str, str]:
    conn = http.client.HTTPConnection(host, port, timeout=5)
    try:
        conn.request(method, path)
        response = conn.getresponse()
        response.read()
        return str(response.status), response.reason
    except Exception as exc:
        return "ERR", f"{type(exc).__name__}: {exc}"
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())

