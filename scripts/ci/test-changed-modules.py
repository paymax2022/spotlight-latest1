#!/usr/bin/env python3
"""Pins the routing behaviour of changed-modules.py. Runs in ci.yml's hygiene job.

Cheap (no network, no runner start of its own) and it protects three properties
that are easy to break silently: correct glob semantics, fail-open on an unknown
diff, and rejection of brace patterns.
"""

import collections
import importlib.util
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("cm", ROOT / "scripts/ci/changed-modules.py")
cm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cm)

failures = []


def check(name, got, want):
    if got != want:
        failures.append(f"{name}: got {got!r}, want {want!r}")


def m(pattern, path):
    return bool(cm.glob_to_regex(pattern).match(path))


# --- glob semantics: ** crosses /, * does not -------------------------------
check("** crosses /", m("backend/internal/savings/**", "backend/internal/savings/a/b.go"), True)
check("** direct child", m("backend/internal/savings/**", "backend/internal/savings/model.go"), True)
check("** no false sibling", m("backend/internal/savings/**", "backend/internal/savingsx/model.go"), False)
check("* stops at /", m("supabase/migrations/*assoc*.sql", "supabase/migrations/20260101_assoc.sql"), True)
check("* does not cross /", m("supabase/migrations/*.sql", "supabase/migrations/sub/x.sql"), False)
check("exact file", m("backend/internal/config/config.go", "backend/internal/config/config.go"), True)
check("exact file negative", m("backend/internal/config/config.go", "backend/internal/config/other.go"), False)
check("dot is literal", m("frontend-web/src/lib/feature-flags.ts", "frontend-web/src/lib/feature-flagsXts"), False)
check("/**/ collapses", m("a/**/b.go", "a/b.go"), True)
check("/**/ nested", m("a/**/b.go", "a/x/y/b.go"), True)

# --- braces must be rejected, never silently match nothing (7c0c7886, PR #115)
try:
    cm.glob_to_regex("backend/internal/{savings,escrow}/**")
    failures.append("brace pattern was accepted; it must raise")
except ValueError:
    pass

# --- the shared filter file must stay brace-free and compile -----------------
filters = json.load(open(ROOT / ".github/module-filters.json"))
for module, patterns in filters.items():
    if not patterns:
        failures.append(f"{module}: empty pattern list would never select the lane")
    for p in patterns:
        try:
            cm.glob_to_regex(p)
        except ValueError as exc:
            failures.append(f"{module}: {exc}")

# --- routing: a savings-only change must select top5 ------------------------
# The exact case the dead brace pattern used to miss (commit 7c0c7886).
savings_only = ["backend/internal/savings/vault_service.go"]
selected = {
    mod: any(cm.glob_to_regex(p).match(f) for f in savings_only for p in pats)
    for mod, pats in filters.items()
}
check("savings change selects top5", selected["top5"], True)
check("savings change skips doctor", selected["doctor"], False)
check("savings change skips stays", selected["stays"], False)

# --- routing: a docs-only change selects nothing -----------------------------
docs_only = ["docs/adr/ADR-027.md", "README.md"]
any_docs = {
    mod: any(cm.glob_to_regex(p).match(f) for f in docs_only for p in pats)
    for mod, pats in filters.items()
}
check("docs-only selects no module", any(any_docs.values()), False)

# --- no concrete file may wake more than one lane ----------------------------
# A single shared file listed by many lanes cannot distinguish which module
# changed — as a filter it only ever means "something shared moved", so it wakes
# all of them. `config.go` alone used to wake 9 of 14. Either an unconditional
# ci.yml job already covers the file (then no lane needs it), or exactly one lane
# owns it. 55a98125 applied this to finance_routes.go; it holds generally.
concrete = collections.Counter(
    p for pats in filters.values() for p in pats if not any(c in p for c in "*?[")
)
for path, n in concrete.items():
    if n > 1:
        owners = sorted(m for m, pats in filters.items() if path in pats)
        failures.append(
            f"{path} is listed by {n} lanes ({', '.join(owners)}); "
            "give it one owner or cover it with an unconditional ci.yml job"
        )

# --- every module in the filter file is actually wired into ci.yml -----------
# A filter set with no caller job is dead config: the lane would never run and
# nothing would say so.
ci = (ROOT / ".github/workflows/ci.yml").read_text()
for module in filters:
    if f"./.github/workflows/{module}-ci.yml" not in ci:
        failures.append(f"{module}: in module-filters.json but ci.yml never calls it")
    if f"outputs.{module.replace('-', '_')}" not in ci:
        failures.append(f"{module}: ci.yml has no `changes` output gating it")

# --- every required status check still exists as a job in ci.yml -------------
# Branch protection matches the check-run name EXACTLY. Rename a job and the old
# context never reports again: PRs hang on "Expected — waiting for status" with
# nothing in the UI explaining it, and merges stop. Fail here instead.
req = ROOT / ".github/required-checks.txt"
if req.exists():
    ci_names = set(re.findall(r"^\s*name:\s*(.+?)\s*$", ci, re.M))
    for line in req.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        # "<caller job name> / <job id inside the reusable>" -> the caller's name:
        caller = line.split(" / ", 1)[0]
        if caller not in ci_names:
            failures.append(
                f"required check {line!r} has no job named {caller!r} in ci.yml — "
                "renaming a required job blocks every PR; update "
                ".github/required-checks.txt and re-apply branch protection"
            )

# --- GitHub allows at most 20 unique reusable workflows per caller ------------
# Hitting it breaks the whole pipeline at startup, so fail here instead.
reusables = set(re.findall(r"uses:\s*(\./\.github/workflows/[\w.-]+)", ci))
if len(reusables) > 20:
    failures.append(f"ci.yml calls {len(reusables)} reusable workflows; GitHub's limit is 20")

# --- fail-open when the diff cannot be established ---------------------------
class _Args:
    files_from = None
    event = "push"
    before = "0" * 40
    sha = "HEAD"
    base = None


check("unknown diff is fail-open", cm.changed_files(_Args()), None)

if failures:
    print("FAIL")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print(f"ok — {len(filters)} module filter sets, all assertions passed")
