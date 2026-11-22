#!/usr/bin/env python3
"""Classify one F2-probe cell into a machine-readable verdict token.

Kept separate from ``f2-token-probe.sh`` so the mapping can be tested offline
(see ``scripts/ci/test-f2-token-probe.sh``) with recorded payloads instead of a
live Railway token. That matters because the decisive question — can the
project token CI holds perform ``serviceInstanceDeploy`` — can only be answered
from inside a runner, and a verdict function that is only exercised in CI is a
verdict function nobody can trust.

Measured fact this encodes (2026-11-22, unauthenticated POST to
``https://backboard.railway.com/graphql/v2``): a rejected token arrives as
**HTTP 200** with ``errors[].message = "Not Authorized"`` and
``extensions.code = INTERNAL_SERVER_ERROR``. Railway does not use the status
code for auth, so anything that keys on HTTP alone reads a token failure as
success. The F2 fault is different again — the CLI never gets a parseable body
at all ("error decoding response body"), which is why eleven earlier episodes
could not surface a status code.
"""
import json
import sys

NOT_AUTHED = ("not authorized", "unauthorized", "invalid token", "login state is corrupt")
FORBIDDEN = ("forbidden", "not permitted", "permission")


def _payload(raw: str):
    """Return (parsed_json_or_None, lowered_error_text) for a cell response."""
    try:
        return json.loads(raw or ""), (raw or "").lower()
    except json.JSONDecodeError:
        return None, (raw or "").lower()


def classify_read(raw: str, http: str) -> str:
    """Verdict for an auth/read cell (project query, serviceInstance query)."""
    if http in ("", "000"):
        return "transport-error-no-response"
    if http.startswith("5"):
        return f"transport-error-{http}"
    if http.startswith("4"):
        return f"edge-rejected-{http}"
    doc, low = _payload(raw)
    if doc is None:
        # The body is not JSON a client can parse: the F2 fingerprint, seen from
        # the GraphQL side rather than the upload side.
        return "body-undecodable"
    errors = doc.get("errors") or []
    if errors:
        text = json.dumps(errors).lower()
        if any(m in text for m in NOT_AUTHED):
            return "token-rejected"
        if any(m in text for m in FORBIDDEN):
            return "token-not-permitted"
        return "query-error"
    return "ok"


def classify_mutation(raw: str, http: str) -> str:
    """Verdict for the ``serviceInstanceDeploy`` cell itself."""
    if http in ("", "000"):
        return "transport-error-no-response"
    if http.startswith("4") or http.startswith("5"):
        return f"edge-rejected-{http}"
    doc, _ = _payload(raw)
    if doc is None:
        return "body-undecodable"
    if doc.get("errors"):
        text = json.dumps(doc["errors"]).lower()
        if any(m in text for m in NOT_AUTHED):
            return "token-rejected"
        if any(m in text for m in FORBIDDEN):
            return "token-not-permitted"
        return "mutation-error"
    data = doc.get("data") or {}
    if data.get("serviceInstanceDeploy") is True:
        return "accepted"
    if "serviceInstanceDeploy" in data:
        # A non-true scalar: the field answered but did nothing.
        return "returned-falsy"
    return "mutation-shape-drift"


def classify_readback(rows_json: str) -> str:
    """Verdict for the deployment-row watch that follows an accepted mutation.

    ``rows_json`` is a JSON array of ``{status, isNew}`` objects collected while
    polling. A mutation that returns ``true`` and produces **no new row** is the
    silent no-op already measured on the git-less production ``frontend-admin``
    instance, so this cell is what separates "the token can deploy" from "the
    token called a no-op".
    """
    try:
        rows = json.loads(rows_json or "[]")
    except json.JSONDecodeError:
        return "readback-unparseable"
    for r in rows:
        status = (r.get("status") or "").upper()
        if r.get("isNew") and status == "SUCCESS":
            return "build-success"
        if r.get("isNew") and status == "FAILED":
            return "build-failed"
    if rows and any(r.get("isNew") for r in rows):
        return "build-pending-or-cancelled"
    return "no-new-row"


def final_verdict(auth: str, baseline: str, mutation: str, build: str, mode: str) -> str:
    """The one line the operator and the doc read."""
    if auth != "ok":
        if auth == "token-rejected":
            return f"token-cannot-authenticate ({auth})"
        if auth.startswith("transport-error") or auth.startswith("edge-rejected") \
                or auth == "body-undecodable":
            # A read that never got a parseable answer says nothing about the
            # token's scope. Calling this "token-cannot-authenticate" would
            # blame the secret for what is the same decode fault being studied,
            # so it gets its own verdict: the fault reached the plain read.
            return f"read-path-fault ({auth})"
        return f"token-read-unexpected ({auth})"
    # Read-only is consulted AFTER auth, and that ordering is load-bearing: a
    # read-only dispatch whose reads already fail to decode is F2 arriving on
    # the cheapest possible path, and answering "read-only-ran" for it would
    # report a clean run. Proven by the undecodable stub case in the test.
    if mode == "read-only":
        return "read-only-ran"
    if mutation == "accepted":
        if build == "build-success":
            return "project-token-can-deploy"
        if build == "build-failed":
            return "token-deployed-but-build-failed"
        if build == "no-new-row":
            return "mutation-is-noop-for-project-token"
        return f"accepted-awaiting-build ({build})"
    if mutation == "token-not-permitted":
        return "token-scope-blocks-mutation"
    if mutation == "token-rejected":
        return "token-rejected-at-graphql"
    if mutation == "body-undecodable":
        return "f2-reproduces-on-the-mutation-path"
    return f"undecided ({baseline}/{mutation}/{build})"


def main() -> int:
    cell = sys.argv[1]
    args = sys.argv[2:]
    if cell == "read":
        print(classify_read(args[0], args[1]))
    elif cell == "mutation":
        print(classify_mutation(args[0], args[1]))
    elif cell == "readback":
        print(classify_readback(args[0]))
    elif cell == "final":
        print(final_verdict(*args[:5]))
    else:
        print(f"unknown cell: {cell}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
