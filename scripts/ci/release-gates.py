#!/usr/bin/env python3
"""Decide whether a commit's CI is green enough to release.

release.yml calls this instead of embedding the verdict in bash-in-YAML, which
cannot be unit-tested. Same split as changed-modules.py / test-changed-modules.py.

The gate waits on two things by the mechanism that actually reports them
(spec Decision C):
  1. every check-run NAME in .github/required-checks.txt reaches
     completed/success — GET commits/{sha}/check-runs, --paginate MANDATORY
     (one commit here returns 50 check-runs; an unpaged read is a false green).
  2. the integration-verify WORKFLOW RUN for that SHA reaches
     completed/success — GET actions/runs?head_sha={sha}, filtered to that
     path and event == "push". It has no single check-run name to wait on.

Verdicts, all real on this repo:
  proceed         every required name green + integration-verify green
  noop_docs_only  a push produced no ci.yml run: both lanes carry
                  paths-ignore ['**.md','docs/**'], so a docs-only commit has
                  nothing to build
  superseded      a required check reported cancelled: both lanes use
                  cancel-in-progress on a per-ref group, so a newer main
                  commit owns this release
  failed          something reported failure/timed_out/action_required
  timeout         the budget ran out with gates still unsettled
  waiting         internal: keep polling

`noop_docs_only` is valid ONLY for a push. On a workflow_dispatch rollback the
SHA may be old enough that its runs are past retention, and reading that as
"docs-only" would silently skip the rollback the operator asked for — so a
dispatch with no CI run fails loudly unless skip_gates was passed. A push
event can never set skip_gates.

Usage:
  release-gates.py --sha <sha> --event push --repo <owner/repo>
  release-gates.py --sha <sha> --event workflow_dispatch --skip-gates
"""

import argparse
import json
import os
import pathlib
import subprocess
import sys
import time
from typing import NamedTuple

ROOT = pathlib.Path(__file__).resolve().parents[2]
CI_WORKFLOW = ".github/workflows/ci.yml"
INTEG_WORKFLOW = ".github/workflows/integration-verify.yml"
REQUIRED_CHECKS = str(ROOT / ".github/required-checks.txt")

# `skipped` satisfies: module lanes are gated on the router and report skipped
# when their module did not change, and GitHub itself treats a skipped
# required check as satisfied.
GREEN = frozenset({"success", "skipped", "neutral"})
BAD = frozenset({"failure", "timed_out", "action_required", "startup_failure"})
POLL_SECONDS = 30


class Verdict(NamedTuple):
    decision: str
    reason: str
    unsettled: tuple


def required_names(path=REQUIRED_CHECKS):
    names = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#"):
                names.append(line)
    return names


def latest_by_name(check_runs):
    latest = {}
    for row in check_runs:
        name = row.get("name")
        if not name:
            continue
        prev = latest.get(name)
        # A re-run creates a NEW check-run id, so the greatest id is the latest
        # attempt. "Any green attempt wins" would let a re-run hide the failure
        # that prompted it.
        if prev is None or int(row.get("id") or 0) > int(prev.get("id") or 0):
            latest[name] = row
    return latest


def latest_run(runs, path):
    match = [r for r in runs if r.get("path") == path and r.get("event") == "push"]
    if not match:
        return None
    return max(match, key=lambda r: int(r.get("id") or 0))


def classify(check_runs, runs, required, event, absence_settled):
    """Pure verdict logic. No I/O, no clock — the test drives it with fixtures."""
    latest = latest_by_name(check_runs)
    ci_run = latest_run(runs, CI_WORKFLOW)

    if ci_run is None:
        if not absence_settled:
            return Verdict("waiting", f"no {CI_WORKFLOW} run for this SHA yet", ())
        if event == "push":
            return Verdict("noop_docs_only",
                           f"no {CI_WORKFLOW} run for this SHA. {CI_WORKFLOW} and "
                           f"{INTEG_WORKFLOW} both carry paths-ignore "
                           "['**.md','docs/**'] on push to main, so a docs-only "
                           "commit produces zero check-runs: nothing to build, "
                           "nothing to deploy.", ())
        return Verdict("failed",
                       f"no {CI_WORKFLOW} run for this SHA, and this is a "
                       "workflow_dispatch. The commit may be old enough that its "
                       "runs are past retention. Re-dispatch with skip_gates=true "
                       "to assert CI was green when this SHA was main.", ())

    if ci_run.get("conclusion") == "cancelled":
        return Verdict("superseded",
                       f"the {CI_WORKFLOW} run was cancelled by a newer main commit", ())

    cancelled = sorted(n for n in required
                       if latest.get(n, {}).get("conclusion") == "cancelled")
    if cancelled:
        return Verdict("superseded",
                       "cancelled by a newer main commit: " + ", ".join(cancelled), ())

    bad, unsettled = [], []
    for name in required:
        row = latest.get(name)
        if row is None or row.get("status") != "completed":
            unsettled.append(name)
        elif row.get("conclusion") in BAD:
            bad.append(f"{name} ({row.get('conclusion')})")
        elif row.get("conclusion") not in GREEN:
            unsettled.append(f"{name} ({row.get('conclusion')})")

    integ = latest_run(runs, INTEG_WORKFLOW)
    if integ is None or integ.get("status") != "completed":
        unsettled.append(f"{INTEG_WORKFLOW} run")
    elif integ.get("conclusion") == "cancelled":
        return Verdict("superseded",
                       f"{INTEG_WORKFLOW} was cancelled by a newer main commit", ())
    elif integ.get("conclusion") in BAD:
        bad.append(f"{INTEG_WORKFLOW} ({integ.get('conclusion')})")
    elif integ.get("conclusion") not in GREEN:
        unsettled.append(f"{INTEG_WORKFLOW} ({integ.get('conclusion')})")

    if bad:
        return Verdict("failed", "red: " + ", ".join(bad), tuple(unsettled))
    if unsettled:
        return Verdict("waiting", f"{len(unsettled)} gate(s) unsettled", tuple(unsettled))
    return Verdict("proceed",
                   f"{len(required)} required checks green + {INTEG_WORKFLOW} green", ())


def pages(blob):
    """`gh api --paginate` CONCATENATES object-valued pages ({...}{...}); it only
    merges into one array when each page is itself an array. Both endpoints used
    here return objects, so the concatenation must be walked, not json.load'd.
    """
    decoder = json.JSONDecoder()
    idx, end = 0, len(blob)
    while idx < end:
        while idx < end and blob[idx].isspace():
            idx += 1
        if idx >= end:
            break
        obj, idx = decoder.raw_decode(blob, idx)
        yield obj


def gh(url):
    proc = subprocess.run(["gh", "api", "--paginate", url],
                          capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"gh api {url} failed ({proc.returncode}): "
                           f"{proc.stderr.strip()[:400]}")
    return proc.stdout


def make_fetchers(repo):
    def fetch_check_runs(sha):
        rows = []
        for page in pages(gh(f"repos/{repo}/commits/{sha}/check-runs")):
            rows.extend(page.get("check_runs") or [])
        return rows

    def fetch_runs(sha):
        rows = []
        for page in pages(gh(f"repos/{repo}/actions/runs?head_sha={sha}&per_page=100")):
            rows.extend(page.get("workflow_runs") or [])
        return rows

    return fetch_check_runs, fetch_runs


def wait(sha, required, event, budget_s, absence_budget_s,
         fetch_check_runs, fetch_runs,
         sleep=time.sleep, clock=time.monotonic, log=print):
    start = clock()
    absence_deadline = start + absence_budget_s
    while True:
        now = clock()
        verdict = classify(fetch_check_runs(sha), fetch_runs(sha), required, event,
                           absence_settled=now >= absence_deadline)
        if verdict.decision != "waiting":
            return verdict
        elapsed = int(now - start)
        if elapsed > budget_s:
            return Verdict("timeout",
                           f"CI did not settle within {budget_s // 60} minutes "
                           f"({verdict.reason})",
                           verdict.unsettled)
        log(f"  +{elapsed}s — {verdict.reason}"
            + (f": {', '.join(verdict.unsettled)}" if verdict.unsettled else ""))
        sleep(POLL_SECONDS)


def summary(verdict, sha):
    lines = [f"### Release gate: **{verdict.decision}**", "",
             f"- commit: `{sha}`", f"- reason: {verdict.reason}"]
    if verdict.unsettled:
        lines.append("- unsettled: " + ", ".join(f"`{u}`" for u in verdict.unsettled))
    return "\n".join(lines) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--sha", required=True)
    ap.add_argument("--event", required=True, choices=["push", "workflow_dispatch"])
    ap.add_argument("--skip-gates", action="store_true",
                    help="rollback only: assert CI was green when this SHA was main")
    ap.add_argument("--budget-minutes", type=int, default=40)
    ap.add_argument("--absence-budget-minutes", type=int, default=5)
    ap.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", ""))
    args = ap.parse_args(argv)

    # A push event cannot carry inputs, so skip_gates on a push is not a
    # rollback — it is a bypass, and the point of this change is that the
    # normal path has none.
    if args.skip_gates and args.event != "workflow_dispatch":
        print("::error::--skip-gates is a rollback input; a push event can never set it",
              file=sys.stderr)
        return 2

    if args.skip_gates:
        verdict = Verdict("proceed",
                          "operator asserted CI was green when this SHA was main", ())
    else:
        if not args.repo:
            print("::error::--repo or GITHUB_REPOSITORY is required", file=sys.stderr)
            return 2
        fetch_check_runs, fetch_runs = make_fetchers(args.repo)
        verdict = wait(args.sha, required_names(), args.event,
                       args.budget_minutes * 60, args.absence_budget_minutes * 60,
                       fetch_check_runs, fetch_runs)

    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as fh:
            fh.write(f"verdict={verdict.decision}\n")
    text = summary(verdict, args.sha)
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(text)
    print(text)

    # `superseded` and `noop_docs_only` exit 0: a newer commit owns the release,
    # or there was nothing to build. Neither is a failure and neither deploys —
    # every downstream job tests `verdict == 'proceed'`.
    return 0 if verdict.decision in ("proceed", "noop_docs_only", "superseded") else 1


if __name__ == "__main__":
    sys.exit(main())
