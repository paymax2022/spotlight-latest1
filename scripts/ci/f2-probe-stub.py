#!/usr/bin/env python3
"""Minimal fake Railway GraphQL edge for ``test-f2-token-probe.sh``.

Why a stub instead of only unit-testing the classifier: the probe's verdict
depends on plumbing the classifier cannot see — the HTTP code has to survive the
``body=$(gql …)`` command substitution, the token has to be masked on the way
out, and cell 4 has to diff a *new* row id against the baseline. Those are the
three ways this probe can print a confident, wrong answer, and none of them are
visible to a payload-level test.

Scenarios are selected by argv so the same server can prove both the green cell
and its red controls::

    ok            reads 200 + data, mutation accepted, second row SUCCESS
    unauthorized  HTTP 200 + errors[].message "Not Authorized"  (the measured
                  real rejection — status-code-only logic reads this as success)
    undecodable   HTTP 200 + a non-JSON body                    (the F2 shape)

The port is printed on stdout once the socket is bound so the caller can wait
for readiness instead of sleeping.
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

scenario = sys.argv[1]
calls = {"serviceInstance": 0}


def body_for(query: str) -> tuple[int, bytes]:
    if scenario == "unauthorized":
        return 200, json.dumps({
            "errors": [{"message": "Not Authorized",
                        "extensions": {"code": "INTERNAL_SERVER_ERROR"}}],
            "data": None,
        }).encode()
    if scenario == "undecodable":
        return 200, b"<html><body>502 Bad Gateway</body></html>"

    if "serviceInstanceDeploy(" in query:
        return 200, json.dumps({"data": {"serviceInstanceDeploy": True}}).encode()
    if "serviceInstance(" in query:
        # First read is the baseline; every read after that is the new deployment
        # the accepted mutation is expected to have created.
        calls["serviceInstance"] += 1
        if calls["serviceInstance"] == 1:
            row = {"id": "bbbb0000-0000-0000-0000-000000000000",
                   "createdAt": "2026-11-21T00:00:00.000Z", "status": "SUCCESS",
                   "meta": {"commitHash": "dead000"}}
        else:
            row = {"id": "cccc1111-1111-1111-1111-111111111111",
                   "createdAt": "2026-11-22T00:00:00.000Z", "status": "SUCCESS",
                   "meta": {"commitHash": "cafe000"}}
        return 200, json.dumps({"data": {"serviceInstance":
                                        {"latestDeployment": row}}}).encode()
    if "project(" in query:
        return 200, json.dumps({"data": {"project": {"id": "stub", "name": "stub"}}}).encode()
    return 400, json.dumps({"errors": [{"message": "unrecognised document"}]}).encode()


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802 - http.server name is fixed
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode()
        try:
            query = json.loads(raw).get("query", "")
        except json.JSONDecodeError:
            query = ""
        code, payload = body_for(query)
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):  # silent: CI logs are for verdicts, not hits
        pass


server = HTTPServer(("127.0.0.1", int(sys.argv[2])), Handler)
print(server.server_address[1], flush=True)
server.serve_forever()
