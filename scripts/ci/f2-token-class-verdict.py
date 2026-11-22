#!/usr/bin/env python3
"""Render the token-class comparison table and verdict.

WHY THIS IS A FILE AND NOT A HEREDOC
.github/workflows/ci-railway-token-class.yml collects the samples; this decides
what they mean. Kept separate so the branch logic can be driven from recorded
sample sets in scripts/ci/test-f2-token-probe.sh — the same reason
f2-probe-verdict.py exists. The alternative was a heredoc that only ever runs on
a GitHub runner holding three live credentials, so every rule in it would be
shipped unexecuted, and this script's rules are the ones that tell someone
whether to rotate a secret.

Usage:
    f2-token-class-verdict.py [--glob GLOB] [--out FILE]

Sample files are /tmp/class-<label>-<attempt>.txt, written one per attempt by the
workflow steps. Only the lines the probe prints matter:

    CLASS_CELL label=<label> attempt=<n>   (echoed by the step)
    PROBE_CELL auth=<value>                (cell 1: the `project` read)
    PROBE_CELL baseline=<value>            (cell 2: the staging serviceInstance)

Input shapes that come from measurement, not invention: both #1143 probe runs
refused the staging project token — read-only at 09:49:38Z printed
`auth=token-rejected (http=200)`, and the write-cell run at 09:57:10Z printed
`auth=token-rejected` plus `mutation=token-rejected`. Nothing observed so far is
intermittent; the mixed shape is a defensive branch, and the only verdict whose
job is to stop someone rotating a secret on a single reading.
"""
import argparse
import glob
import os
import re
import sys
from collections import defaultdict

ORDER = ["anonymous", "development", "staging", "production"]
TOKENS = ["development", "staging", "production"]


def cell(text, key):
    hits = re.findall(r"PROBE_CELL %s=(\S+)" % key, text)
    return hits[-1] if hits else "no-output"


def samples(pattern):
    """Return {label: [(attempt, auth, baseline), …]} keyed by credential.

    The attempt is stripped before grouping. Keying by the whole basename yields
    `staging-1`, `staging-2`, `staging-3` as three separate credentials: the table
    fills up with rows that look like evidence, every verdict branch reads
    `missing`, and the run reports `undecided` on data that would have answered
    the question.
    """
    found = defaultdict(list)
    for path in sorted(glob.glob(pattern)):
        name = os.path.basename(path)
        name = name[len("class-"):] if name.startswith("class-") else name
        name = name[:-len(".txt")] if name.endswith(".txt") else name
        label, _, attempt = name.rpartition("-")
        if not label or not attempt.isdigit():
            label, attempt = name, "0"
        try:
            txt = open(path, encoding="utf-8", errors="replace").read()
        except OSError:
            txt = ""
        found[label].append((int(attempt), cell(txt, "auth"), cell(txt, "baseline")))
    return found


def rate(rows):
    """(ok_count, total, shape) for one credential's attempts."""
    vals = [auth for _, auth, _ in rows]
    okc = sum(1 for a in vals if a == "ok")
    if okc == len(vals):
        shape = "all-ok"
    elif okc == 0:
        shape = "all-refused"
    else:
        shape = "mixed"
    return okc, len(vals), shape


def verdict(found):
    """The one line that decides the next action. Order is load-bearing.

    CONTROL BROKEN before everything: an authenticating anonymous row means a
    token and no token looked identical, so no other reading in the table is
    evidence.

    INTERMITTENT before VALUE and CLASS: it is the only verdict that forbids an
    action, and rotating a live secret is a production change. Two identical
    calls that disagree also invalidate the clean-cut readings, so it has to be
    settled first. Neither #1143 run showed it — both refused everything — which
    is why it is a branch and not a conclusion.
    """
    shapes = {}
    for label in ORDER:
        if label in found:
            shapes[label] = rate(sorted(found[label]))[2]

    anon = shapes.get("anonymous", "missing")
    dev = shapes.get("development", "missing")
    stg = shapes.get("staging", "missing")
    prod = shapes.get("production", "missing")

    if anon == "all-ok":
        return ("**Verdict: CONTROL BROKEN.** The no-credential row authenticated, "
                "so `Not Authorized` from a token was not distinguishable from "
                "`Not Authorized` from nothing. Nothing in this table is evidence — "
                "fix the classifier before reading it.")
    if any(shapes.get(k) == "mixed" for k in TOKENS):
        return ("**Verdict: INTERMITTENT, not class and not value.** At least one "
                "project token authenticates on some attempts and is refused on "
                "others, so `Not Authorized` is neither a scope grant nor a dead "
                "secret — it is what the edge does to this bearer some of the time. "
                "That is F2's own signature: one request in the staging leg either "
                "returns a decodable body or it does not. **Do NOT rotate the secret "
                "on this evidence, and do not open a CI change.** The question for "
                "Railway is what an HTTP-200 `Not Authorized` means for a project "
                "token, and how two identical calls minutes apart can answer "
                "differently.")
    if dev == "all-ok" and stg == "all-refused":
        return ("**Verdict: VALUE, not class.** A project token *can* drive GraphQL "
                "reads — `development` was 3/3 ok — while the staging one was 0/3, "
                "so `RAILWAY_TOKEN_STAGING` is the variable: stale, rotated out, or "
                "mistyped. Rotate it and re-dispatch the F2 probe. This is also the "
                "only explanation that reaches F2 directly, because the request that "
                "obtains the upload destination carries that credential.")
    if dev == stg == prod == "all-refused":
        return ("**Verdict: CLASS.** No project token reads the deployment graph, so "
                "`serviceInstanceDeploy` is unreachable from CI whatever the secret "
                "value says. The mutation lane cannot replace `railway up` here "
                "without a credential-class change — a user-scoped token in CI, or a "
                "scope grant from Railway.")
    if dev == "all-ok" and stg == "all-ok":
        return ("**Verdict: neither.** Both tokens authenticated on every attempt, "
                "which contradicts both #1143 runs, where the staging token was "
                "refused on every cell. Read the raw bodies above before acting on "
                "anything.")
    return ("**Verdict: undecided** — the rates do not match any shape above (a "
            "credential is usually missing from the table entirely). Read the table "
            "before acting.")


def render(found, repeats):
    labels = [k for k in ORDER if k in found]
    labels += sorted(k for k in found if k not in ORDER)
    out = ["**Read-only cells per credential, %s attempt(s) each** — `project` = does "
           "the class *and* value authenticate for GraphQL at all; `serviceInstance` = "
           "the staging environment row, so a credential that passes the first and "
           "fails the second is scoped to another environment, not broken." % repeats,
           ""]
    if not labels:
        out.append("No sample files were read. Every credential step failed before "
                   "writing, so the comparison did not run.")
        out.append("")
        out.append(verdict(found))
        return "\n".join(out)

    out.append("| credential | `project` read, per attempt | ok/N | `serviceInstance` read |")
    out.append("|---|---|---|---|")
    for label in labels:
        rows = sorted(found[label])
        okc, n, shape = rate(rows)
        auths = " ".join("`%s`" % a for _, a, _ in rows)
        bases = " ".join("`%s`" % b for _, _, b in rows)
        out.append("| `%s` | %s | **%d/%d %s** | %s |" % (label, auths, okc, n, shape, bases))
    out.append("")
    out.append(verdict(found))
    out.append("")
    out.append("Per-attempt detail: `gh run view <id> --log | grep -E 'CLASS_CELL|PROBE_CELL'`.")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--glob", default="/tmp/class-*.txt", dest="pattern")
    ap.add_argument("--out", default=None, help="append the rendering here (GITHUB_STEP_SUMMARY)")
    args = ap.parse_args()
    repeats = os.environ.get("PROBE_CLASS_REPEATS", "?")
    text = render(samples(args.pattern), repeats)
    if args.out:
        with open(args.out, "a", encoding="utf-8") as fh:
            fh.write(text + "\n")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
