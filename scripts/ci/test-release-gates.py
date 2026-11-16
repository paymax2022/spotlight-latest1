#!/usr/bin/env python3
"""Pins the verdict logic of release-gates.py. Runs in ci.yml's secret-hygiene job.

release-gates.py is the only thing between a push to main and a production deploy,
and it decides by polling an API — so its verdicts are driven here by fixtures
instead of being discovered during a release. Sub-second, no network.
"""

import contextlib
import importlib.util
import io
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("rg", ROOT / "scripts/ci/release-gates.py")
rg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rg)

failures = []
CI = rg.CI_WORKFLOW
INTEG = rg.INTEG_WORKFLOW
REQ = rg.required_names()


def check(name, got, want):
    if got != want:
        failures.append(f"{name}: got {got!r}, want {want!r}")


def cr(name, conclusion="success", status="completed", id=1):
    return {"name": name, "conclusion": conclusion, "status": status, "id": id}


def run(path, conclusion="success", status="completed", event="push", id=1):
    return {"path": path, "conclusion": conclusion, "status": status,
            "event": event, "id": id}


def green_set():
    """The fixture that means 'everything this commit needs is green'."""
    return ([cr(n, id=i) for i, n in enumerate(REQ, start=1)],
            [run(CI, id=900), run(INTEG, id=901)])


def decide(check_runs, runs, event="push", absence_settled=True):
    return rg.classify(check_runs, runs, REQ, event, absence_settled)


class _Clock:
    """Deterministic time so `wait` can be driven to a timeout without sleeping."""

    def __init__(self, step):
        self.now = 0.0
        self.step = step
        self.sleeps = 0

    def __call__(self):
        self.now += self.step
        return self.now

    def sleep(self, _seconds):
        self.sleeps += 1


def quiet(argv):
    """Run main() with both streams captured AND the runner's output files
    detached — otherwise the test appends a stray `verdict=proceed` line to the
    real GITHUB_OUTPUT of whichever ci.yml job runs it."""
    saved = {k: os.environ.pop(k, None) for k in ("GITHUB_OUTPUT", "GITHUB_STEP_SUMMARY")}
    try:
        with contextlib.redirect_stdout(io.StringIO()), \
                contextlib.redirect_stderr(io.StringIO()):
            return rg.main(argv)
    finally:
        for k, v in saved.items():
            if v is not None:
                os.environ[k] = v


# --- the happy path ----------------------------------------------------------
crs, runs = green_set()
check("all green -> proceed", decide(crs, runs).decision, "proceed")

# --- unsettled states must WAIT, not pass ------------------------------------
# Would break if classify() treated a missing required name as satisfied.
check("missing required name -> waiting",
      decide(crs[:-1], runs).decision, "waiting")
# Would break if classify() read status only, or conclusion only.
check("in_progress -> waiting",
      decide([cr(REQ[0], status="in_progress", conclusion=None)] + crs[1:], runs).decision,
      "waiting")

# --- red must FAIL -----------------------------------------------------------
# Would break if classify() let one red name ride along with eight green ones.
check("one failure -> failed",
      decide([cr(REQ[0], conclusion="failure")] + crs[1:], runs).decision, "failed")
check("integ run failed -> failed",
      decide(crs, [run(CI, id=900), run(INTEG, conclusion="failure", id=901)]).decision,
      "failed")

# --- cancelled means a NEWER commit owns this release ------------------------
# Would break if classify() reported cancelled as failed: that would page a human
# about a release that was correctly superseded.
check("required name cancelled -> superseded",
      decide([cr(REQ[0], conclusion="cancelled")] + crs[1:], runs).decision, "superseded")
check("ci run cancelled -> superseded",
      decide(crs, [run(CI, conclusion="cancelled", id=900), run(INTEG, id=901)]).decision,
      "superseded")
check("integ run cancelled -> superseded",
      decide(crs, [run(CI, id=900), run(INTEG, conclusion="cancelled", id=901)]).decision,
      "superseded")

# --- a non-required lane going red must NOT stop a release -------------------
# `security` (CodeQL/gitleaks/trivy) and ci-optimized.yml both fire on a main push
# and are in .github/required-checks.txt's absence. Would break if classify()
# iterated all check-runs instead of only the required names.
check("non-required red -> proceed",
      decide(crs + [cr("security / codeql", conclusion="failure", id=99)], runs).decision,
      "proceed")

# --- docs-only pushes produce ZERO check-runs, and that is not a failure -----
# ci.yml and integration-verify.yml both carry paths-ignore ['**.md','docs/**'] on
# push to main, so a docs-only commit has nothing to build. Would break if the
# absence of a ci.yml run were read as "still starting".
check("no ci run, absence not settled -> waiting",
      decide([], [], absence_settled=False).decision, "waiting")
check("no ci run, settled, push -> noop_docs_only",
      decide([], [], absence_settled=True).decision, "noop_docs_only")
# THE DANGEROUS ONE. On a dispatch the SHA may be old enough that its runs are past
# retention; reading that as "docs-only" would silently skip the rollback the
# operator asked for. Would break if classify() ignored `event`.
check("no ci run, settled, dispatch -> failed",
      decide([], [], event="workflow_dispatch", absence_settled=True).decision, "failed")

# --- integration-verify is waited on as a RUN, not a check-run name ----------
# No check-run named `integration-verify` exists; the workflow produces check-runs
# named for its own jobs. Would break if the gate looked for that name instead.
check("integ run missing -> waiting and names it",
      INTEG + " run" in decide(crs, [run(CI, id=900)]).unsettled, True)
# A skipped run is satisfied: integration-verify has no paths filter, but a
# workflow_dispatch-only run of it would legitimately report skipped.
check("integ run skipped -> proceed",
      decide(crs, [run(CI, id=900), run(INTEG, conclusion="skipped", id=901)]).decision,
      "proceed")
# A pull_request run of the same path is a DIFFERENT commit's evidence.
check("only a pull_request integ run -> waiting",
      decide(crs, [run(CI, id=900),
                   run(INTEG, event="pull_request", id=901)]).decision, "waiting")

# --- re-runs: the LATEST attempt decides, not the greenest -------------------
# A re-run creates a NEW check-run id. "Any green attempt wins" would let a re-run
# hide the very failure that prompted it.
check("older failure + newer success -> proceed",
      decide([cr(REQ[0], conclusion="failure", id=5)] +
             [cr(REQ[0], conclusion="success", id=50)] + crs[1:], runs).decision,
      "proceed")
check("older success + newer failure -> failed",
      decide([cr(REQ[0], conclusion="success", id=5)] +
             [cr(REQ[0], conclusion="failure", id=50)] + crs[1:], runs).decision,
      "failed")
check("latest_run picks the greatest id",
      rg.latest_run([run(CI, conclusion="failure", id=5),
                     run(CI, conclusion="success", id=50)], CI)["id"], 50)

# --- `skipped` satisfies a required name ------------------------------------
# Module lanes are gated on the router and report skipped when their module did
# not change; GitHub itself treats a skipped required check as satisfied.
check("required name skipped -> proceed",
      decide([cr(REQ[0], conclusion="skipped")] + crs[1:], runs).decision, "proceed")

# --- --paginate CONCATENATES object-valued pages ----------------------------
# gh api --paginate merges into one array only when each page IS an array. Both
# endpoints used here return objects, so the blob arrives as `{...}{...}` and
# json.loads() would raise on the second brace. A commit here returns 50
# check-runs, so this path is exercised on the very first real run.
check("pages walks concatenated objects",
      [p["n"] for p in rg.pages('{"n": 1}\n{"n": 2}')], [1, 2])
check("pages handles one page",
      [p["n"] for p in rg.pages('{"n": 1}')], [1])
check("pages handles a trailing newline",
      [p["n"] for p in rg.pages('{"n": 1}\n')], [1])
check("pages handles empty input",
      list(rg.pages("")), [])

# --- the required-checks file itself -----------------------------------------
# Would break if required_names() kept blank lines or comment lines, which would
# make every gate wait forever on a name that can never report.
check("required_names count", len(REQ), 9)
check("required_names unique", len(set(REQ)), 9)
check("required_names has no empties", "" in REQ, False)
check("required_names includes actionlint",
      "workflows (actionlint)" in REQ, True)

# --- wait() must return at once when green, and time out deterministically ---
crs, runs = green_set()
clock = _Clock(0)
got = rg.wait("a" * 40, REQ, "push", 2400, 300,
              lambda sha: crs, lambda sha: runs,
              sleep=clock.sleep, clock=clock, log=lambda *_: None)
check("wait returns immediately on green", got.decision, "proceed")
check("wait did not sleep on green", clock.sleeps, 0)

clock = _Clock(30)  # each iteration advances 30s; POLL_SECONDS is 30
got = rg.wait("a" * 40, REQ, "push", 120, 30,
              lambda sha: [],                      # nothing has reported yet
              lambda sha: [run(CI, status="in_progress", conclusion=None, id=1)],
              sleep=clock.sleep, clock=clock, log=lambda *_: None)
# Would break if wait() ignored budget_s and polled forever — that is a hung
# release job holding the concurrency slot, which blocks every later main push.
check("wait times out", got.decision, "timeout")
check("wait slept 4 times before a 120s budget", clock.sleeps, 4)
check("timeout names the unsettled integ run", INTEG + " run" in got.unsettled, True)

# --- skip_gates is a ROLLBACK input, never a bypass --------------------------
# A push event cannot carry inputs, so --skip-gates on a push is not a rollback.
# Would break if main() dropped the event check and let any caller assert green.
check("skip-gates on a push is a usage error",
      quiet(["--sha", "a" * 40, "--event", "push", "--skip-gates"]), 2)
check("skip-gates on a dispatch proceeds",
      quiet(["--sha", "a" * 40, "--event", "workflow_dispatch", "--skip-gates"]), 0)
check("missing --repo is a usage error",
      quiet(["--sha", "a" * 40, "--event", "push", "--repo", ""]), 2)

if failures:
    print("FAIL")
    for line in failures:
        print("  " + line)
    sys.exit(1)
print(f"ok — release-gates verdict logic pinned ({len(REQ)} required checks)")
