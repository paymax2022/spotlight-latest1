#!/usr/bin/env python3
"""Decide which module lanes a change needs, from one shared filter file.

`.github/module-filters.json` is the single source of truth for every module's
paths. ci.yml calls each module lane as a reusable workflow gated on this
script's output, so one push produces one pipeline instead of fourteen.

Fail-open by design: if the changed-file set cannot be determined (shallow
clone, force-push, unknown base, git error), every module is selected. A CI
gate that silently skips itself is worse than one that runs too much.

Glob semantics follow GitHub's filter patterns, NOT the shell's:
  **  matches any characters, including /
  *   matches any characters except /
  ?   matches a single character except /
Brace expansion is NOT supported by GitHub and is rejected here — a braced
pattern silently matches nothing (see 7c0c7886 / PR #115).

Usage:
  changed-modules.py --event push --before <sha> --sha <sha>
  changed-modules.py --event pull_request --base <ref>
  changed-modules.py --files-from -        # read paths on stdin (testing)
"""

import argparse
import json
import os
import re
import subprocess
import sys

FILTERS = ".github/module-filters.json"
ZERO_SHA = "0" * 40


def glob_to_regex(pattern: str) -> "re.Pattern[str]":
    """Translate a GitHub filter pattern into an anchored regex."""
    if "{" in pattern or "}" in pattern:
        raise ValueError(
            f"brace expansion is not supported by GitHub path filters: {pattern!r}"
        )
    out, i = [], 0
    while i < len(pattern):
        c = pattern[i]
        if c == "*":
            if pattern.startswith("**", i):
                # '/**/' collapses so that a/**/b also matches a/b
                if out and out[-1] == "/" and pattern.startswith("**/", i):
                    out[-1] = "/(?:.*/)?"
                    i += 3
                    continue
                out.append(".*")
                i += 2
                continue
            out.append("[^/]*")
        elif c == "?":
            out.append("[^/]")
        else:
            out.append(re.escape(c))
        i += 1
    return re.compile("^" + "".join(out) + "$")


def run(cmd):
    return subprocess.run(
        cmd, capture_output=True, text=True, check=True
    ).stdout.splitlines()


def changed_files(args):
    """Return the changed paths, or None when they cannot be established."""
    if args.files_from:
        src = sys.stdin if args.files_from == "-" else open(args.files_from)
        return [ln.strip() for ln in src if ln.strip()]
    try:
        if args.event == "pull_request":
            if not args.base:
                return None
            base = f"origin/{args.base}"
            run(["git", "rev-parse", "--verify", base])
            # three-dot: compare against the merge base, not the moving branch tip
            return run(["git", "diff", "--name-only", f"{base}...HEAD"])
        if not args.before or args.before == ZERO_SHA:
            return None  # new branch: no previous tip to diff against
        run(["git", "rev-parse", "--verify", args.before])
        return run(["git", "diff", "--name-only", args.before, args.sha or "HEAD"])
    except (subprocess.CalledProcessError, OSError) as exc:
        print(f"::warning::could not determine changed files ({exc}); running all lanes")
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--event", default="push")
    ap.add_argument("--before")
    ap.add_argument("--sha")
    ap.add_argument("--base")
    ap.add_argument("--files-from")
    args = ap.parse_args()

    filters = json.load(open(FILTERS))
    compiled = {m: [glob_to_regex(p) for p in pats] for m, pats in filters.items()}

    files = changed_files(args)
    if files is None:
        selected = dict.fromkeys(filters, True)
        print("changed files: UNKNOWN — selecting every module (fail-open)")
    else:
        selected = {
            m: any(rx.match(f) for f in files for rx in rxs)
            for m, rxs in compiled.items()
        }
        print(f"changed files: {len(files)}")
        for f in sorted(files)[:40]:
            print(f"  {f}")
        if len(files) > 40:
            print(f"  … and {len(files) - 40} more")

    print("\nmodule lanes:")
    for m in sorted(selected):
        print(f"  {'RUN ' if selected[m] else 'skip'} {m}")

    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as fh:
            for m, on in selected.items():
                # A '-' would parse as subtraction inside a GitHub expression
                # (needs.changes.outputs.visitor-election), so emit underscores.
                fh.write(f"{m.replace('-', '_')}={'true' if on else 'false'}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
