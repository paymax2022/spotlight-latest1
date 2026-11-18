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
import re
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


# The commit this gate is judging, and the two facts the quiet verdicts now have
# to prove instead of assume.
SHA = "a" * 40
OTHER = "b" * 40
DOCS = ["docs/devops/deployment-matrix.md", "README.md"]
CODE = ["backend/internal/telemedicine/service.go", "README.md"]


def green_set():
    """The fixture that means 'everything this commit needs is green'."""
    return ([cr(n, id=i) for i, n in enumerate(REQ, start=1)],
            [run(CI, id=900), run(INTEG, id=901)])


def decide(check_runs, runs, event="push", absence_settled=True,
           paths=None, tip=None, sha=SHA):
    return rg.classify(check_runs, runs, REQ, event, absence_settled,
                       changed_paths=paths, main_tip=tip, sha=sha)


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
      decide([cr(REQ[0], conclusion="cancelled")] + crs[1:], runs, tip=OTHER).decision,
      "superseded")
check("ci run cancelled -> superseded",
      decide(crs, [run(CI, conclusion="cancelled", id=900), run(INTEG, id=901)],
             tip=OTHER).decision, "superseded")
check("integ run cancelled -> superseded",
      decide(crs, [run(CI, id=900), run(INTEG, conclusion="cancelled", id=901)],
             tip=OTHER).decision, "superseded")

# THE OTHER HALF OF THE SILENCE. `superseded` exits 0 and deploys nothing, so it
# is only honest if a newer commit really does own the release. Two ways that can
# be false: the cancelled commit is still main's tip (nothing superseded it, and
# no later push will ever revisit it), or main's tip could not be read at all.
# Would break if classify() kept asserting a successor it never checked for.
check("cancelled while still main's tip -> failed",
      decide([cr(REQ[0], conclusion="cancelled")] + crs[1:], runs, tip=SHA).decision,
      "failed")
check("cancelled with an unreadable tip -> failed",
      decide([cr(REQ[0], conclusion="cancelled")] + crs[1:], runs, tip=None).decision,
      "failed")
check("superseded names the successor",
      OTHER[:9] in decide([cr(REQ[0], conclusion="cancelled")] + crs[1:], runs,
                          tip=OTHER).reason, True)

# --- a non-required lane going red must NOT stop a release -------------------
# `security` (CodeQL/gitleaks/trivy) and ci-optimized.yml both fire on a main push
# and are in .github/required-checks.txt's absence. Would break if classify()
# iterated all check-runs instead of only the required names.
check("non-required red -> proceed",
      decide(crs + [cr("security / codeql", conclusion="failure", id=99)], runs).decision,
      "proceed")

# --- a docs-only push is PROVEN from the commit's own diff -------------------
# ci.yml ignores ['**.md','docs/**'] on push to main, so a docs-only commit
# legitimately produces zero check-runs. It used to be inferred from that
# absence alone — and a commit that DOES touch code but lost its CI run looks
# identical from the run list, so it too would exit 0 and deploy nothing, with
# nothing later ever revisiting that SHA. Would break if classify() went back to
# reading "no ci.yml run" as "docs-only".
check("no ci run, absence not settled -> waiting",
      decide([], [], absence_settled=False, paths=DOCS).decision, "waiting")
check("docs diff, settled, push -> noop_docs_only",
      decide([], [], absence_settled=True, paths=DOCS).decision, "noop_docs_only")
check("noop names the diff it read",
      DOCS[1] in decide([], [], absence_settled=True, paths=DOCS).reason, True)
# THE ONE THAT MATTERS: same shape as the line above, one deployable path added.
check("code diff, settled, push -> failed",
      decide([], [], absence_settled=True, paths=CODE).decision, "failed")
check("failure names the deployable path",
      CODE[0] in decide([], [], absence_settled=True, paths=CODE).reason, True)
# A diff that cannot be read, and a diff that is empty, prove nothing in either
# direction. Both must be loud: silence is the failure being fixed.
check("unreadable diff, settled, push -> failed",
      decide([], [], absence_settled=True, paths=None).decision, "failed")
check("empty diff, settled, push -> failed",
      decide([], [], absence_settled=True, paths=[]).decision, "failed")
# And each says which of the two happened, because "no ci.yml run and no changed
# files" is a different thing to go and look at than "the API would not answer".
check("unreadable diff says it could not read the files",
      "could not be read" in decide([], [], absence_settled=True, paths=None).reason,
      True)
check("empty diff says it saw no files",
      "no changed files" in decide([], [], absence_settled=True, paths=[]).reason,
      True)
# THE DANGEROUS ONE. On a dispatch the SHA may be old enough that its runs are past
# retention; reading that as "docs-only" would silently skip the rollback the
# operator asked for. Would break if classify() ignored `event`.
check("no ci run, settled, dispatch -> failed",
      decide([], [], event="workflow_dispatch", absence_settled=True,
             paths=DOCS).decision, "failed")

# --- the ignore list is a checked copy, not a hand-synced one ----------------
# classify() decides with ci.yml's own paths-ignore. If someone edits the
# workflow and not the gate, every docs-only push changes verdict on a silent
# release and nothing else notices. Would break on that drift.
_push_block = re.search(r"\n  push:\n(.*?)\n  pull_request:",
                        (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8"),
                        re.S).group(1)
check("ci.yml paths-ignore matches the gate's copy",
      re.findall(r"^\s*-\s*'([^']+)'", _push_block, re.M), list(rg.DOCS_IGNORE_GLOBS))
for path, want in [("docs/devops/a.md", True), ("README.md", True),
                   ("docs/a/b/c.md", True), ("notes.md", True),
                   ("backend/internal/x.go", False), (".github/workflows/ci.yml", False),
                   ("CLAUDE.md", True),
                   # `docs/**` is what ci.yml ignores, so a non-markdown file under
                   # docs/ really does skip CI. The predicate mirrors the filter, not
                   # a theory of what counts as documentation — anything else drifts.
                   ("docs/x.go", True)]:
    check(f"is_docs_path({path!r})", rg.is_docs_path(path), want)

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
# make every gate wait forever on a name that can never report. The file is sectioned
# now (@all / @<branch>), so the same failure mode has a new trigger: a leaked section
# directive. And this gate deploys nothing until ALL of these are green, so a private
# parse that missed the five ci-optimized contexts would release under a red secrets
# scan — the count is pinned, not merely observed.
check("required_names count", len(REQ), 14)
check("required_names unique", len(set(REQ)), 14)
check("required_names has no empties", "" in REQ, False)
check("required_names includes actionlint",
      "workflows (actionlint)" in REQ, True)
check("required_names includes the ci-optimized secrets gate",
      "secrets-scan" in REQ, True)
check("required_names excludes section directives",
      [n for n in REQ if n.startswith("@")], [])

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

# --- wait() must FETCH the evidence classify() now demands -------------------
# Pure logic that is never wired into the polling loop would fix nothing on a
# real release. 600s steps clear the 300s absence budget on the first poll.
got = rg.wait(SHA, REQ, "push", 2400, 300,
              lambda sha: [], lambda sha: [],
              fetch_commit_files=lambda sha: CODE,
              sleep=_Clock(600).sleep, clock=_Clock(600), log=lambda *_: None)
check("wait reads the diff before calling an absent CI docs-only",
      got.decision, "failed")
got = rg.wait(SHA, REQ, "push", 2400, 300,
              lambda sha: [], lambda sha: [],
              fetch_commit_files=lambda sha: DOCS,
              sleep=_Clock(600).sleep, clock=_Clock(600), log=lambda *_: None)
check("wait still no-ops a genuinely docs-only push",
      got.decision, "noop_docs_only")

cancelled = [cr(REQ[0], conclusion="cancelled", id=1)] + \
            [cr(n, id=i) for i, n in enumerate(REQ[1:], start=2)]
got = rg.wait(SHA, REQ, "push", 2400, 300,
              lambda sha: cancelled,
              lambda sha: [run(CI, id=900), run(INTEG, id=901)],
              fetch_main_tip=lambda: OTHER,
              sleep=_Clock(600).sleep, clock=_Clock(600), log=lambda *_: None)
check("wait fetches main's tip so superseded can name a successor",
      got.decision, "superseded")
got = rg.wait(SHA, REQ, "push", 2400, 300,
              lambda sha: cancelled,
              lambda sha: [run(CI, id=900), run(INTEG, id=901)],
              sleep=_Clock(600).sleep, clock=_Clock(600), log=lambda *_: None)
check("a cancelled check with no tip fetcher is not silently superseded",
      got.decision, "failed")

# --- which verdicts are allowed to exit 0 without deploying ------------------
# The two quiet verdicts are only safe because each now proves itself. A third
# silent verdict would be a new way for a release to stop without anyone being
# told. Would break if someone added one.
check("exactly these verdicts stay silent",
      rg.SILENT, ("proceed", "noop_docs_only", "superseded"))

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
