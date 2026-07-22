#!/usr/bin/env python3
"""Loopback-only GenAI.mil bridge for Odyssey.

Use this only when the Odyssey Chrome/Edge extension cannot be installed.
The bridge never stores a STARK key and only forwards Odyssey's two documented
GenAI.mil API paths to the fixed https://api.genai.mil/v1 origin.
"""

import argparse
import json
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 43127
GENAI_MIL_BASE_URL = "https://api.genai.mil/v1"
MAX_BODY_BYTES = 4 * 1024 * 1024
DEFAULT_ALLOWED_ORIGINS = {
    "https://asterias.ssag.nps.edu",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
}


class RelayServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, handler, allowed_origins):
        super().__init__(address, handler)
        self.allowed_origins = allowed_origins


class RelayHandler(BaseHTTPRequestHandler):
    server_version = "OdysseyGenAiMilRelay/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, message, *args):
        sys.stdout.write("[%s] %s\n" % (self.log_date_time_string(), message % args))
        sys.stdout.flush()

    def _allowed_origin(self):
        origin = self.headers.get("Origin", "").strip()
        return origin if origin in self.server.allowed_origins else None

    def _cors_headers(self, origin):
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin, Access-Control-Request-Private-Network")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Expose-Headers", "Content-Type, Retry-After, X-Odyssey-GenAI-Transport")
        self.send_header("Cache-Control", "no-store")

    def _send_bytes(self, status, body, content_type, origin=None, retry_after=None):
        self.send_response(status)
        self._cors_headers(origin)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Odyssey-GenAI-Transport", "localhost")
        if retry_after:
            self.send_header("Retry-After", retry_after)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _send_json(self, status, payload, origin=None):
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self._send_bytes(status, body, "application/json; charset=utf-8", origin)

    def do_OPTIONS(self):
        origin = self._allowed_origin()
        if not origin:
            self._send_json(403, {"error": "This Odyssey origin is not allowed."})
            return
        self.send_response(204)
        self._cors_headers(origin)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        origin = self._allowed_origin()
        if self.path == "/health":
            self._send_json(200, {"status": "ok", "transport": "localhost"}, origin)
            return
        if self.path != "/v1/models":
            self._send_json(404, {"error": "Not found."}, origin)
            return
        self._forward("GET", "/models", origin)

    def do_POST(self):
        origin = self._allowed_origin()
        if self.path != "/v1/chat/completions":
            self._send_json(404, {"error": "Not found."}, origin)
            return
        self._forward("POST", "/chat/completions", origin)

    def _forward(self, method, api_path, origin):
        if not origin:
            self._send_json(403, {"error": "This Odyssey origin is not allowed."})
            return

        authorization = self.headers.get("Authorization", "").strip()
        if not (authorization.startswith("Bearer STARK_") or authorization.startswith("Bearer STARK-")):
            self._send_json(401, {"error": "A valid STARK bearer key is required."}, origin)
            return

        request_body = None
        if method == "POST":
            try:
                content_length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self._send_json(400, {"error": "Invalid Content-Length."}, origin)
                return
            if content_length <= 0 or content_length > MAX_BODY_BYTES:
                self._send_json(413, {"error": "Request body is empty or too large."}, origin)
                return
            request_body = self.rfile.read(content_length)

        headers = {
            "Accept": "application/json",
            "Authorization": authorization,
            "User-Agent": "Odyssey-GenAI-mil-Workstation-Relay/1.0",
        }
        if request_body is not None:
            headers["Content-Type"] = "application/json"

        upstream_request = urllib.request.Request(
            GENAI_MIL_BASE_URL + api_path,
            data=request_body,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(upstream_request, timeout=280) as response:
                body = response.read(MAX_BODY_BYTES + 1)
                if len(body) > MAX_BODY_BYTES:
                    self._send_json(502, {"error": "GenAI.mil response exceeded the relay limit."}, origin)
                    return
                self._send_bytes(
                    response.status,
                    body,
                    response.headers.get("Content-Type", "application/json"),
                    origin,
                    response.headers.get("Retry-After"),
                )
        except urllib.error.HTTPError as error:
            body = error.read(MAX_BODY_BYTES + 1)
            if len(body) > MAX_BODY_BYTES:
                body = b'{"error":"GenAI.mil error response exceeded the relay limit."}'
            self._send_bytes(
                error.code,
                body,
                error.headers.get("Content-Type", "application/json"),
                origin,
                error.headers.get("Retry-After"),
            )
        except Exception as error:
            self._send_json(502, {
                "error": "The workstation relay could not reach GenAI.mil.",
                "detail": str(error)[:500],
            }, origin)


def main():
    parser = argparse.ArgumentParser(description="Run Odyssey's loopback-only GenAI.mil workstation relay.")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--allow-origin", action="append", default=[], help="Add a trusted Odyssey browser origin.")
    args = parser.parse_args()
    if args.port < 1024 or args.port > 65535:
        parser.error("--port must be between 1024 and 65535")

    allowed_origins = DEFAULT_ALLOWED_ORIGINS.union(origin.rstrip("/") for origin in args.allow_origin)
    server = RelayServer((DEFAULT_HOST, args.port), RelayHandler, allowed_origins)
    print("Odyssey GenAI.mil relay is ready.")
    print("Listening only on http://%s:%d" % (DEFAULT_HOST, args.port))
    print("Keep this window open while using GenAI.mil in Odyssey. Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping relay.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
