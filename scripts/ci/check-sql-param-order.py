#!/usr/bin/env python3
"""Scan SQL for the Postgres rule 'a parameter without a DEFAULT may not follow
one with a DEFAULT'. Prints every offending parameter so the whole migration can
be fixed in one pass instead of one error at a time."""
import re
import sys

path = sys.argv[1]
text = open(path, encoding="utf-8").read()

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

problems = 0
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
            print(f"{name}: {ident} has no DEFAULT but follows defaulted {seen_default}")
            problems += 1
            seen_default = None
print(f"offending parameters: {problems}")
sys.exit(1 if problems else 0)
