#!/usr/bin/env python3
"""Decide whether a `serviceInstanceDeploy(commitSha:)` actually deployed.

This is the post-mutation half of ``railway-deploy.sh``'s mutation mode. It lives
in its own pure-python file because it is the part that can be wrong in a way
nobody can see from a runner log, and this repo's rule is that a decision rule
gets executed by a test — see ``scripts/ci/test-staging-deploy-watch.sh``, wired
into the ``secret-hygiene`` job.

The failure modes it is written against, all measured on this project:

* **``true`` read as success.** ``serviceInstanceDeploy`` answers the boolean
  ``true`` for a git-less service instance while creating no row at all —
  measured on production ``frontend-admin``, ``reason=redeploy``, the service
  left running an 18 November hand upload. A leg that exits 0 on ``true``
  reports a deploy that did not happen. So the answer here is always a ROW.
* **A pre-existing row read as the new one.** Diffing on "is the newest row
  SUCCESS" is not enough in either direction: staging already held a SUCCESS row
  for the commit the probe redeployed, and other Qoder sessions upload to
  staging. So the baseline row id captured before the mutation is excluded, AND
  the candidate must name the requested commit.
* **A row for someone else's commit.** ``meta.commitHash`` is checked, not just
  "a row appeared". A leg that goes green while the environment serves a
  different tree is worse than a red leg, because the next person reads the
  green as evidence about this commit.
* **A short sha.** ``commitSha:"d563144"`` minted row ``a0f80410`` in ``FAILED``
  for a commit that does not exist (measured 2026-11-23, 12:56:43Z). Mutation
  mode refuses a non-40-hex SHA in the shell before asking for anything.
* **A row that predates this attempt.** "names the sha and is not the baseline
  row" is still not enough, because the same sha can be in flight twice:
  ``release.yml`` has no workflow-level concurrency, so two trains can deploy
  one commit, and a re-run of a Release does it to the same commit. The other
  train's row then names this sha, is not my baseline, and a SUCCESS on it reads
  ``deployed`` for a mutation that minted nothing. The optional ``since``
  cutoff — the instant the mutation was fired — makes a row that was already
  there part of the scenery rather than part of the evidence. Without it the
  behaviour is exactly as before, which is why every existing fixture still
  passes.

``since`` compares ``createdAt`` at second resolution, both sides UTC, and the
cutoff's own second counts as this attempt's. If either side does not look like
an ISO instant the row is treated as new: an unrecognised time format must never
filter out a real deploy. The failure direction is the safe one anyway —
over-filtering yields ``no-new-row`` / ``mutation-is-noop``, a loud red, and
never a green.

Row identity comes from ``Deployment.meta``, which is a FLAT JSON scalar through
``railway deployment list --json`` and ``railway api`` on this tenant — selecting
``meta { commitHash }`` is refused with ``type "DeploymentMeta" has no
subfields`` — so ``meta`` is read as text and parsed here.
"""
import json
import sys

TERMINAL_OK = ("SUCCESS",)
TERMINAL_BAD = ("FAILED", "CRASHED", "REMOVED")


def _meta(row):
    """``Deployment.meta`` arrives either as an object or as a JSON string."""
    m = row.get("meta")
    if isinstance(m, str):
        try:
            m = json.loads(m)
        except json.JSONDecodeError:
            return {}
    return m if isinstance(m, dict) else {}


def row_sha(row):
    """The commit this row was built from, whichever field the platform filled.

    A CLI upload puts the sha in ``meta.cliMessage`` — that is what the upload
    path of this very script has always matched on; a ``serviceInstanceDeploy``
    puts it in ``meta.commitHash`` and leaves ``cliMessage`` null. Both spellings
    are accepted because both were seen on real rows of this project in the same
    API response on 2026-11-23.
    """
    m = _meta(row)
    return m.get("commitHash") or m.get("cliMessage") or ""


def _same_commit(seen, want):
    """Full-sha equality, tolerating a platform that stores a short hash."""
    if not seen or not want:
        return False
    return seen == want or seen.startswith(want) or want.startswith(seen)


def _sec(value):
    """An ISO instant to second resolution, or '' when it is not one.

    ``2026-11-23T14:29:10.500Z`` -> ``2026-11-23T14:29:10``. Same length and same
    UTC basis on both sides of the compare, so a plain string comparison is a
    chronological one; truncating the milliseconds is also what stops a row
    created in the same second as the cutoff from ordering *before* it (".500"
    sorts below "Z").
    """
    s = str(value or "").strip()
    if len(s) < 19 or s[4:5] != "-" or s[10:11] != "T":
        return ""
    return s[:19]


def _predates(row, since_sec):
    """True only when the row is positively known to predate the cutoff.

    Strictly: the cutoff's OWN second belongs to this attempt, because the row
    our mutation mints can land in the same second the cutoff was taken (the
    cutoff is taken moments before the call, and a fast edge answers inside a
    second). Treating that second as stale would turn a real deploy into
    ``mutation-is-noop`` — a red that blames Railway for our own clock.
    """
    if not since_sec:
        return False
    seen = _sec(row.get("createdAt"))
    return bool(seen) and seen < since_sec


def parse_rows(raw):
    try:
        rows = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return None
    return rows if isinstance(rows, list) else None


def mine(rows, baseline_id, sha, since=""):
    """Rows that are ours: not the baseline, they name this commit, and they
    were created after the mutation fired.

    The page is newest-first — the same assumption ``railway-deploy.sh``'s
    ``--limit 10`` has always rested on.
    """
    since_sec = _sec(since)
    out = []
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        if baseline_id and r.get("id") == baseline_id:
            continue
        if _predates(r, since_sec):
            continue
        if _same_commit(row_sha(r), sha):
            out.append(r)
    return out


def newest_other(rows, baseline_id, since=""):
    """The newest row that is not the baseline.

    Only reached after ``mine()`` came back empty, so whatever this returns is
    by construction NOT a row naming the requested commit — which is why no sha
    test belongs here. Two shapes land in it and ``describe()`` separates them
    for the log: a row whose ``meta`` names a different commit (a concurrent
    train, or a connection ignoring ``commitSha``) and a row whose ``meta``
    carries no commit at all (someone deployed from the console). Both are
    "not this leg's deploy"; neither is a no-op, and none of them may read
    green.

    ``since`` is honoured here for the same reason as in ``mine()``: scenery
    that predates the mutation says nothing about this attempt.
    """
    since_sec = _sec(since)
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        if baseline_id and r.get("id") == baseline_id:
            continue
        if _predates(r, since_sec):
            continue
        return r
    return None


def watch(rows_json, baseline_id, sha, since=""):
    """Classify a page of deployment rows against the pre-mutation baseline.

    Returns one of:

      ``deployed``          a row naming this sha (not the baseline) reached SUCCESS
      ``build-failed``      such a row ended FAILED / CRASHED / REMOVED
      ``pending``            such a row exists and is still building
      ``no-new-row``        no row names this sha — the silent no-op shape
      ``other-commit``      a newer-than-baseline row exists, naming a different commit
      ``rows-unparseable``  the page was not a JSON array (a CLI error printed
                            instead — which must not read as "no new row")

    A row that predates ``since`` is scenery, not evidence, and does not change
    any of these: it can neither read ``deployed`` nor ``build-failed`` nor
    ``other-commit``. It is still printed by ``describe()`` so the log shows what
    the leg dismissed.
    """
    rows = parse_rows(rows_json)
    if rows is None:
        return "rows-unparseable"
    found = mine(rows, baseline_id, sha, since)
    if found:
        status = (found[0].get("status") or "").upper()
        if status in TERMINAL_OK:
            return "deployed"
        if status in TERMINAL_BAD:
            return "build-failed"
        return "pending"
    # Nothing naming this commit. Distinguish "Railway made no row" from "Railway
    # made a row for a different tree": the first is the no-op this mode was
    # built to catch, the second says the instance's git connection is not
    # honouring commitSha and that claim must not be silent.
    if newest_other(rows, baseline_id, since) is not None:
        return "other-commit"
    return "no-new-row"


def describe(rows_json, baseline_id, sha, since=""):
    """One line of evidence for the job log: what the watch actually looked at."""
    rows = parse_rows(rows_json)
    if rows is None:
        return "\t".join(["-", "-", "-", "rows-unparseable"])
    found = mine(rows, baseline_id, sha, since)
    r = (found or [{}])[0]
    if not found:
        # The row the verdict dismissed, then — if there was none after the
        # cutoff — the newest scenery row, cutoff included. A leg that goes red
        # with "-" in every column tells nobody anything; a leg that prints the
        # stale SUCCESS it refused to trust is a five-minute diagnosis.
        r = newest_other(rows, baseline_id, since) or newest_other(rows, baseline_id) or {}
    return "\t".join([str(r.get("id") or "-"), str(r.get("status") or "-"),
                      row_sha(r) or "-", "mine" if found else "other"])


def final(mutation_verdict, watch_verdict):
    """One line for the leg, composed from the two cells.

    ``mutation_verdict`` comes from ``f2-probe-verdict.py mutation`` so a leg and
    the probe spell the same refusal with the same word. The probe answered
    ``accepted`` on 2026-11-23; this function is what stops that word ending the
    story.
    """
    if mutation_verdict != "accepted":
        return f"mutation-refused ({mutation_verdict})"
    if watch_verdict == "deployed":
        return "deployed"
    if watch_verdict == "build-failed":
        return "build-failed"
    if watch_verdict == "other-commit":
        return "row-naming-another-commit"
    if watch_verdict == "no-new-row":
        return "mutation-is-noop"
    if watch_verdict == "rows-unparseable":
        return "watch-blind"
    return f"timeout-pending ({watch_verdict})"


def main():
    cell = sys.argv[1]
    args = sys.argv[2:]
    # `since` is optional so a caller that has no trustworthy cutoff gets the
    # pre-cutoff behaviour instead of a crash — the leg always passes one.
    since = args[3] if len(args) > 3 else ""
    if cell == "watch":
        print(watch(args[0], args[1], args[2], since))
    elif cell == "describe":
        print(describe(args[0], args[1], args[2], since))
    elif cell == "final":
        print(final(args[0], args[1]))
    elif cell == "row-sha":
        print(row_sha(json.loads(args[0])))
    elif cell == "stale":
        print("stale" if _predates(json.loads(args[0]), _sec(args[1])) else "new")
    else:
        print(f"unknown cell: {cell}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
