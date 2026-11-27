#!/usr/bin/env python3
"""Scan SQL files for the Postgres rule 'a parameter without a DEFAULT may not
follow one with a DEFAULT'. Takes file paths or directories (a directory means
its `*.sql`, sorted) and defaults to `supabase/migrations`. Prints every
offending parameter, so a whole migration can be fixed in one pass instead of one
error at a time, and exits 1. Silent and exit 0 when clean, because `ci.yml` runs
this over all 760 migrations and a wall of 'offending parameters: 0' would hide
the one line that matters."""
import os
import re
import sys

sig_re = re.compile(
    r"create or replace function public\.(\w+)\s*\((.*?)\)\s*returns",
    re.IGNORECASE | re.DOTALL,
)


def params(blob):
    out, depth, cur = [], 0, ""
    for ch in blob:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            out.append(cur)
            cur = ""
            continue
        cur += ch
    if cur.strip():
        out.append(cur)
    return out


def scan(path):
    """Returns the offending parameters of one file, as `path: message` lines."""
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    findings = []
    for name, blob in sig_re.findall(text):
        seen_default = None
        for raw in params(blob):
            line = " ".join(raw.split())
            if not line:
                continue
            # strip a trailing mode/keyword noise, keep the identifier
            ident = line.split()[0]
            has_default = " default " in (" " + line.lower() + " ")
            if has_default:
                if seen_default is None:
                    seen_default = ident
            elif seen_default is not None:
                findings.append(
                    f"{path}: {name}: {ident} has no DEFAULT but follows defaulted {seen_default}"
                )
                seen_default = None
    return findings


def targets(argv):
    """Every SQL file named or contained in the arguments, in sort order.

    A directory is expanded rather than skipped because the CI step passes
    `supabase/migrations`, and one process over 760 files costs a fraction of
    760 `python3` launches — which is what made this scanner runnable in a lane
    at all."""
    out = []
    for arg in argv:
        if os.path.isdir(arg):
            out.extend(
                os.path.join(arg, f)
                for f in sorted(os.listdir(arg))
                if f.endswith(".sql")
            )
        else:
            out.append(arg)
    return out


problems = 0
for path in targets(sys.argv[1:] or ["supabase/migrations"]):
    for finding in scan(path):
        print(finding)
        problems += 1
if problems:
    print(f"offending parameters: {problems}")
sys.exit(1 if problems else 0)
