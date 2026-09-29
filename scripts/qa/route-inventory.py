#!/usr/bin/env python3
"""
scripts/qa/route-inventory.py — build the GET-route inventory that the AI
exploratory QA stage reasons about, from the committed OpenAPI contracts.

WHY THE CONTRACTS ARE THE SOURCE
The running backend has no route-list endpoint, and scraping one out of the Go
source would describe what the code DECLARES rather than what the release
PROMISES. contracts/*.yaml is the promise, it is already linted on every PR by
_reusable-openapi-validate.yml, and a mismatch between it and the deployed build
is itself the finding this stage can surface (a documented route answering 404).

WHY GET ONLY
The exploratory stage fires unauthenticated traffic at a shared environment. A
GET cannot mutate. A POST "expected to be rejected with 401" performs a real
write at exactly the moment auth is broken — which is the one moment you least
want to be firing mutations at staging, where provider sandboxes and ledgers are
wired up (docs/qa/TEST_PLAN.md §2: synthetic data only). Authorization on
mutation paths is covered where it can be tested safely: the Go middleware unit
tests and scripts/qa-auth-rbac-e2e.sh against a throwaway local user.

WHY IT EXITS NON-ZERO ON AN EMPTY INVENTORY
If contract parsing silently yielded nothing, the AI stage would have no routes
to probe, would "pass" having tested nothing, and would look identical to a real
pass. Same discipline as the anti-skip canary in _reusable-go-verify.yml and
npm-audit-gate.mjs: an empty result must never be mistaken for a clean one.

WHAT IS EMITTED (and what is not)
Names and types only — parameter NAMES, `in`, `required`, schema type, and the
documented response status codes. Never `example`/`default` VALUES, never
security scheme contents, never anything from .env. This JSON is sent to an
external model, so it must be shape without data.

Usage:  python3 scripts/qa/route-inventory.py [--contracts-dir contracts] [--max-routes N]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover
    sys.stderr.write(
        "PyYAML is required (preinstalled on GitHub ubuntu runners).\n"
        "  local: python3 -m pip install pyyaml\n"
    )
    sys.exit(2)

# Paths under these slugs are the brownfield legacy contest modules protected by
# the PreToolUse hook (TEST_PLAN.md §2). They are tagged, not dropped: probing
# them read-only is "observable behavior only", which the guardrail permits, but
# the report must say they were touched so a reviewer can see it.
PROTECTED_SLUGS = ("contest", "voting", "applicant", "visitor", "election")

SAFE_RESPONSE_STATUSES = {"200", "201", "202", "204", "400", "401", "403", "404", "409", "422", "429", "500", "503"}


def param_shape(param: dict) -> dict | None:
    """Reduce a parameter object to name/location/type/required — no values."""
    if not isinstance(param, dict):
        return None
    name = param.get("name")
    if not isinstance(name, str) or not name:
        return None
    schema = param.get("schema") if isinstance(param.get("schema"), dict) else {}
    ptype = schema.get("type") or param.get("type") or "string"
    fmt = schema.get("format")
    enum = schema.get("enum")
    return {
        "name": name,
        "in": param.get("in") or "query",
        "type": str(ptype),
        "format": str(fmt) if fmt else None,
        "required": bool(param.get("required")),
        # Enum MEMBERS are part of the contract's shape, not data, and they are
        # what makes an exploratory "value just outside the enum" case possible.
        "enum": [str(e) for e in enum][:12] if isinstance(enum, list) else None,
    }


def is_protected(path: str) -> bool:
    lowered = path.lower()
    return any(slug in lowered for slug in PROTECTED_SLUGS)


def extract(contract_path: Path) -> tuple[list[dict], list[str]]:
    routes: list[dict] = []
    problems: list[str] = []
    try:
        doc = yaml.safe_load(contract_path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        return [], [f"{contract_path.name}: unparseable YAML ({exc.__class__.__name__})"]
    if not isinstance(doc, dict):
        return [], [f"{contract_path.name}: top level is not a mapping"]

    paths = doc.get("paths")
    if not isinstance(paths, dict):
        return [], [f"{contract_path.name}: no paths mapping"]

    for raw_path, item in paths.items():
        if not isinstance(raw_path, str) or not raw_path.startswith("/"):
            problems.append(f"{contract_path.name}: skipping non-path key {raw_path!r}")
            continue
        if not isinstance(item, dict):
            continue
        get = item.get("get")
        if not isinstance(get, dict):
            continue  # GET-only stage: a route with no GET is out of scope

        params = [p for p in (param_shape(x) for x in (get.get("parameters") or [])) if p]
        # Path-level parameters apply to every method, so a route can look
        # parameterless while still requiring one.
        for x in item.get("parameters") or []:
            shaped = param_shape(x)
            if shaped and shaped["name"] not in {p["name"] for p in params}:
                params.append(shaped)

        responses = get.get("responses") or {}
        statuses = sorted(
            {str(code) for code in responses.keys() if str(code) in SAFE_RESPONSE_STATUSES or str(code).lower() == "default"}
        )

        routes.append(
            {
                "contract": contract_path.name,
                "path": raw_path,
                "operationId": get.get("operationId") or None,
                "summary": (get.get("summary") or "")[:160] or None,
                "params": params,
                "documentedStatuses": statuses,
                "protected": is_protected(raw_path),
            }
        )
    return routes, problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--contracts-dir", default="contracts")
    ap.add_argument("--max-routes", type=int, default=400, help="cap the inventory sent to the model")
    ap.add_argument("--out", default="-", help="output file, or - for stdout")
    args = ap.parse_args()

    cdir = Path(args.contracts_dir)
    if not cdir.is_dir():
        sys.stderr.write(f"contracts directory not found: {cdir}\n")
        return 2

    contracts = sorted(p for p in cdir.glob("*.yaml"))
    if not contracts:
        sys.stderr.write(f"no *.yaml contracts under {cdir}\n")
        return 2

    all_routes: list[dict] = []
    all_problems: list[str] = []
    for c in contracts:
        routes, problems = extract(c)
        all_routes.extend(routes)
        all_problems.extend(problems)

    # Deduplicate on (path) — several contracts describe overlapping surfaces and
    # a duplicated route would just spend the model's attention twice.
    seen: dict[str, dict] = {}
    for r in all_routes:
        prev = seen.get(r["path"])
        if prev is None or len(r["params"]) > len(prev["params"]):
            seen[r["path"]] = r
    unique = list(seen.values())

    if not unique:
        sys.stderr.write(
            "REFUSING to emit an empty route inventory: every contract parsed to zero GET routes.\n"
            "An empty inventory would let the AI exploratory stage pass without probing anything.\n"
            f"Contracts scanned: {len(contracts)}. Problems: {all_problems[:10]}\n"
        )
        return 1

    unique.sort(key=lambda r: (r["protected"], r["contract"], r["path"]))
    capped = unique[: args.max_routes]

    payload = {
        "generatedFrom": [c.name for c in contracts],
        "routeCount": len(capped),
        "totalGetRoutes": len(unique),
        "cappedAt": args.max_routes if len(unique) > len(capped) else None,
        "protectedRouteCount": sum(1 for r in capped if r["protected"]),
        "parseProblems": all_problems[:20],
        "routes": capped,
    }

    text = json.dumps(payload, indent=None, separators=(",", ":"))
    if args.out == "-":
        sys.stdout.write(text + "\n")
    else:
        Path(args.out).write_text(text + "\n", encoding="utf-8")
        sys.stderr.write(
            f"inventory: {len(capped)} GET routes from {len(contracts)} contracts "
            f"({len(text)} bytes) -> {args.out}\n"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
