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

# --- every required status check still exists, AND still RUNS where required --
# Branch protection matches the check-run name EXACTLY. Rename a job and the old
# context never reports again: PRs hang on "Expected — waiting for status" with
# nothing in the UI explaining it, and merges stop. Fail here instead.
#
# Two assertions, because there are two ways to produce that identical hang:
#   1. the name no longer exists as a check-run in ANY gated workflow (a rename), and
#   2. the name exists but its workflow's `pull_request` trigger does not fire on the
#      branch that requires it. ci-optimized.yml fires on main only, so its five
#      contexts must stay in the @main section — promoting one to @all would leave
#      every develop PR permanently unmergeable, silently, with a green CI tab.
rc_spec = importlib.util.spec_from_file_location("rc", ROOT / "scripts/ci/required-checks.py")
rc = importlib.util.module_from_spec(rc_spec)
rc_spec.loader.exec_module(rc)

# Workflows whose jobs are eligible to be required status checks.
GATED_WORKFLOWS = ("ci.yml", "ci-optimized.yml")


def job_check_names(text):
    """Check-run names GitHub would report for this workflow's jobs.

    A job reports its `name:` if it sets one, otherwise its job id — and only one of
    the two. Crediting the id as well is what makes this assertion toothless: ci.yml's
    `backend` job is *named* "backend (go build + vet)", so a validator that accepted
    the bare id would also accept ci-optimized.yml's `backend` and lose the per-file
    attribution the trigger check above depends on. Step-level `name:` fields are not
    check-run names either, hence the two fixed indent levels.
    """
    names, pending = set(), None

    def flush():
        nonlocal pending
        if pending:
            names.add(pending)
            pending = None

    in_jobs = False
    for line in text.splitlines():
        if not in_jobs:
            in_jobs = bool(re.match(r"^jobs:\s*$", line))
            continue
        if re.match(r"^[A-Za-z0-9_-]+:", line):  # dedent to column 0: the jobs block is over
            break
        if line.startswith("  #") or not line.strip():
            continue
        job = re.match(r"^  ([A-Za-z0-9_-]+):\s*(#.*)?$", line)
        if job:
            flush()
            pending = job.group(1)
            continue
        named = re.match(r"^    name:\s*(.+?)\s*$", line)
        if named and pending:
            names.add(named.group(1))
            pending = None
    flush()
    return names


def pull_request_branches(text):
    """Branches the workflow's `pull_request` trigger fires on. None = unreadable."""
    block = re.search(r"^(\s*)pull_request:\s*$", text, re.M)
    if not block:
        inline = re.search(r"^pull_request:\s*(\{.*\})?\s*$", text, re.M)
        return None if inline else set()  # no pull_request trigger => never reports on a PR
    body = text[block.end():]
    match = re.search(r"^\s{2,}branches(-ignore)?:\s*\[([^\]]*)\]", body, re.M)
    if not match:
        return None  # block-style or absent list: not something to guess at
    if match.group(1):  # branches-ignore: the required set is unknowable from here
        return None
    return {b.strip().strip("'\"") for b in match.group(2).split(",") if b.strip()}


reports_on = {}  # check-run name -> branches whose PRs can ever see it
for workflow in GATED_WORKFLOWS:
    text = (ROOT / ".github/workflows" / workflow).read_text()
    branches = pull_request_branches(text)
    if branches is None:
        failures.append(
            f"{workflow}: cannot read its pull_request branch list — a required check "
            "gated on it could hang any branch's PRs, so this test refuses to assume"
        )
        branches = set()
    for name in job_check_names(text):
        reports_on.setdefault(name, set()).update(branches)

req = ROOT / ".github/required-checks.txt"
if req.exists():
    try:
        sections = rc.parse_sections(req.read_text(), req.name)
        # An @<branch> header is the declaration that the branch is gated, so the file
        # itself decides what to validate — no second list here to fall out of step.
        # @all alone gates nothing, which is worth saying out loud.
        gated = [b for b in sections if b != "all"]
        if not gated:
            failures.append(
                "required-checks.txt has no @<branch> sections, so it declares no gated "
                "branch; @all on its own requires nothing on anywhere"
            )
        for branch in gated:
            for line in rc.contexts_for(sections, branch, req.name):
                # "<caller job name> / <job id inside the reusable>" -> the caller's name:
                caller = line.split(" / ", 1)[0]
                where = reports_on.get(caller)
                if where is None:
                    failures.append(
                        f"required check {line!r} has no job reporting {caller!r} in "
                        f"{' or '.join(GATED_WORKFLOWS)} — renaming a required job blocks "
                        "every PR; update .github/required-checks.txt and re-apply "
                        "branch protection"
                    )
                elif branch not in where and "*" not in where:
                    failures.append(
                        f"required check {line!r} is required on {branch!r} but its "
                        f"workflow only starts PRs on {sorted(where)} — GitHub would "
                        'wait forever on "Expected — waiting for status"; keep it in the '
                        "section for a branch that actually runs it"
                    )
    except rc.ChecksFileError as exc:
        failures.append(f"required-checks.txt: {exc}")

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
