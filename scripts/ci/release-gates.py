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
  noop_docs_only  a push produced no ci.yml run AND every file the commit
                  changed sits inside ci.yml's paths-ignore
                  ['**.md','docs/**'] — so there was nothing to build
  superseded      a required check reported cancelled AND main's tip is a
                  different commit, so that newer push owns this release
  failed          something reported failure/timed_out/action_required, or a
                  quiet verdict could not prove itself
  timeout         the budget ran out with gates still unsettled
  waiting         internal: keep polling

Only `proceed` deploys. `noop_docs_only` and `superseded` exit 0 and deploy
nothing, which makes them the two ways this gate can end a release in silence —
so neither is taken from an absence any more. "No ci.yml run" used to be read as
"docs-only" on the strength of ci.yml's paths-ignore alone, but a commit that
DOES touch deployable code and never got a run looks identical from a run list,
and under that inference it exited 0, deployed nothing, and no later push ever
revisited its SHA. A cancellation was likewise assumed to mean a newer commit
owns the release, even when this commit is still main's tip and nothing will.
So the commit's file list is read before `noop_docs_only` is granted and main's
tip before `superseded`, and either fact being unreadable fails loudly.

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

# The verdicts allowed to exit 0 without deploying anything. Pinned by
# test-release-gates.py: a third entry here is a new way to stop a release
# quietly, which is what this file's proof-carrying verdicts exist to prevent.
SILENT = ("proceed", "noop_docs_only", "superseded")

# ci.yml's `on.push.paths-ignore`, copied. The copy is checked against the
# workflow file by test-release-gates.py, so editing one without the other goes
# red in CI instead of silently changing which pushes can deploy.
DOCS_IGNORE_GLOBS = ("**.md", "docs/**")

_UNSET = object()


class Verdict(NamedTuple):
    decision: str
    reason: str
    unsettled: tuple


def is_docs_path(path):
    """One changed file against DOCS_IGNORE_GLOBS, matched the way GitHub does:
    `**.md` is any file ending in .md at any depth, `docs/**` is anything under
    docs/ — including a non-markdown file there, because that is what the filter
    ignores and this gate has to agree with the filter, not with a theory of what
    counts as documentation.
    """
    return path.endswith(".md") or path.startswith("docs/")


def all_docs(paths):
    """True only for a NON-EMPTY list that is entirely inside the ignore set.

    Empty proves nothing — it is also what a commit whose file list could not be
    read looks like — so it is the caller's job to treat it as unknown, not to
    fall through to "docs-only".
    """
    return bool(paths) and all(is_docs_path(p) for p in paths)


def same_sha(left, right):
    """Equal as SHAs, tolerating either side arriving abbreviated."""
    left, right = (left or "").lower(), (right or "").lower()
    return bool(left) and bool(right) and (
        left == right or left.startswith(right) or right.startswith(left))


def listing(paths, limit=8):
    shown = ", ".join(f"`{p}`" for p in paths[:limit])
    if len(paths) > limit:
        shown += f", +{len(paths) - limit} more"
    return shown


def superseded(reason, main_tip, sha):
    """`superseded` exits 0 and deploys nothing, so it must name its successor."""
    if not main_tip:
        return Verdict("failed",
                       f"{reason} — but main's current commit could not be read, so no "
                       "newer push is proven to own this release.", ())
    if same_sha(main_tip, sha):
        return Verdict("failed",
                       f"{reason} — but this commit IS still main's tip, so no newer push "
                       "owns this release and nothing will revisit it. Re-run CI for this "
                       "SHA, or dispatch a release with skip_gates.", ())
    return Verdict("superseded", f"{reason}; main is now at {main_tip[:9]}", ())


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


def classify(check_runs, runs, required, event, absence_settled,
             changed_paths=None, main_tip=None, sha=""):
    """Pure verdict logic. No I/O, no clock — the test drives it with fixtures.

    `changed_paths` (this commit's files) and `main_tip` (the commit at the head
    of main) are what the two silent verdicts are granted on, so they arrive
    optional and are only demanded on the branches that need them. Either being
    None there is a failure, never a fallback: the silence is the bug.
    """
    latest = latest_by_name(check_runs)
    ci_run = latest_run(runs, CI_WORKFLOW)

    if ci_run is None:
        if not absence_settled:
            return Verdict("waiting", f"no {CI_WORKFLOW} run for this SHA yet", ())
        if event != "push":
            return Verdict("failed",
                           f"no {CI_WORKFLOW} run for this SHA, and this is a "
                           "workflow_dispatch. The commit may be old enough that its "
                           "runs are past retention. Re-dispatch with skip_gates=true "
                           "to assert CI was green when this SHA was main.", ())
        if changed_paths is None:
            return Verdict("failed",
                           f"no {CI_WORKFLOW} run for this SHA, and the commit's changed "
                           "files could not be read to check whether that is legitimate.", ())
        if not changed_paths:
            return Verdict("failed",
                           f"no {CI_WORKFLOW} run for this SHA, and the commit reported no "
                           "changed files at all, which says nothing about it.", ())
        if all_docs(changed_paths):
            return Verdict("noop_docs_only",
                           f"no {CI_WORKFLOW} run because all {len(changed_paths)} file(s) "
                           f"this commit changed sit inside its own paths-ignore "
                           f"{list(DOCS_IGNORE_GLOBS)}: {listing(changed_paths)}. "
                           "Nothing to build, nothing to deploy.", ())
        deployable = [p for p in changed_paths if not is_docs_path(p)]
        return Verdict("failed",
                       f"no {CI_WORKFLOW} run for a push that changes deployable paths: "
                       f"{listing(deployable)}. Nothing verified this tree, so it will not "
                       "deploy — and it will not be called docs-only either.", ())

    if ci_run.get("conclusion") == "cancelled":
        return superseded(f"the {CI_WORKFLOW} run was cancelled", main_tip, sha)

    cancelled = sorted(n for n in required
                       if latest.get(n, {}).get("conclusion") == "cancelled")
    if cancelled:
        return superseded("a required check reported cancelled: " + ", ".join(cancelled),
                          main_tip, sha)

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
        return superseded(f"{INTEG_WORKFLOW} was cancelled", main_tip, sha)
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

    def fetch_commit_files(sha):
        """The commit's own changed paths — what ci.yml's paths-ignore is applied
        to, and therefore the only honest evidence that a missing run is fine.
        Paginated because GitHub splits the file list into pages like anything
        else; a commit here that is docs-only is far from the 300-file cap.
        """
        names = []
        for page in pages(gh(f"repos/{repo}/commits/{sha}?per_page=100")):
            names.extend(f.get("filename") for f in (page.get("files") or [])
                         if f.get("filename"))
        return names

    def fetch_main_tip():
        for page in pages(gh(f"repos/{repo}/commits/main")):
            if page.get("sha"):
                return page["sha"]
        return None

    return fetch_check_runs, fetch_runs, fetch_commit_files, fetch_main_tip


def maybe_cancelled(check_runs, runs):
    """Conservative pre-check for fetching main's tip: ANY cancelled row or run
    for these two workflows, not only the latest attempt classify() will settle
    on. Over-fetching costs one API call; under-fetching would hand classify() a
    None tip and turn a legitimate superseded into a failure.
    """
    if any(row.get("conclusion") == "cancelled" for row in check_runs):
        return True
    return any(row.get("conclusion") == "cancelled" for row in runs
               if row.get("path") in (CI_WORKFLOW, INTEG_WORKFLOW)
               and row.get("event") == "push")


def wait(sha, required, event, budget_s, absence_budget_s,
         fetch_check_runs, fetch_runs,
         fetch_commit_files=None, fetch_main_tip=None,
         sleep=time.sleep, clock=time.monotonic, log=print):
    start = clock()
    absence_deadline = start + absence_budget_s
    paths = tip = _UNSET
    while True:
        now = clock()
        settled = now >= absence_deadline
        check_runs = fetch_check_runs(sha)
        runs = fetch_runs(sha)
        # Each fact is read once, and only on a SHA that is heading for a verdict
        # that needs it — a healthy release keeps polling the two calls it always
        # made. If these guards and classify()'s branches ever drift apart,
        # classify() receives None and fails; a missed fetch cannot re-open the
        # silence this replaced.
        if paths is _UNSET and settled and event == "push" \
                and latest_run(runs, CI_WORKFLOW) is None:
            paths = fetch_commit_files(sha) if fetch_commit_files else None
        if tip is _UNSET and fetch_main_tip is not None \
                and maybe_cancelled(check_runs, runs):
            tip = fetch_main_tip()
        verdict = classify(check_runs, runs, required, event, settled,
                           changed_paths=None if paths is _UNSET else paths,
                           main_tip=None if tip is _UNSET else tip,
                           sha=sha)
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
    # Matches release.yml's call, so a local run and the real gate cannot diverge.
    ap.add_argument("--budget-minutes", type=int, default=75)
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
        fetch_check_runs, fetch_runs, fetch_commit_files, fetch_main_tip = \
            make_fetchers(args.repo)
        verdict = wait(args.sha, required_names(), args.event,
                       args.budget_minutes * 60, args.absence_budget_minutes * 60,
                       fetch_check_runs, fetch_runs,
                       fetch_commit_files, fetch_main_tip)

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

    # The silent verdicts exit 0: a newer commit owns the release, or this
    # commit's own diff says there was nothing to build. Neither is a failure and
    # neither deploys — every downstream job tests `verdict == 'proceed'`. Both
    # had to prove it above, because that silence is also the only way a release
    # can stop without anyone being told.
    return 0 if verdict.decision in SILENT else 1


if __name__ == "__main__":
    sys.exit(main())
