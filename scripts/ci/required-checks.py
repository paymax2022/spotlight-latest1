#!/usr/bin/env python3
"""Parse .github/required-checks.txt and report the required contexts for one branch.

The single parser for that file, so the two things that read it cannot disagree about
what it means:

  scripts/ci/apply-branch-protection.sh   PUTs a branch's set to GitHub (admin token)
  scripts/ci/test-changed-modules.py      validates every name that set contains

This script writes nothing and calls no API. ``--branch main`` is a safe local preview
of what the apply script WOULD send, which matters because the apply script needs a
repo-admin token most of us do not have in the shell.

  python3 scripts/ci/required-checks.py --branch main
  python3 scripts/ci/required-checks.py --branch develop --json
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_FILE = ROOT / ".github/required-checks.txt"

# @all, @main, @feature/x ... — branch names may contain '/', so this is permissive on
# purpose. What must never slip through is an empty or space-laden directive, which is
# how a typo'd section header would otherwise silently swallow the checks under it.
DIRECTIVE = re.compile(r"^@([A-Za-z0-9._/-]+)$")


class ChecksFileError(Exception):
    """Malformed file, or a branch resolving to no checks.

    Both fail closed on purpose. A half-parsed list silently REMOVES a gate, and a
    protection payload with an empty context list is an unprotected branch — the exact
    drift (AUD-TEST-003) that this file exists to stop.
    """


def parse_sections(text: str, source: str = "required-checks.txt") -> dict[str, list[str]]:
    """Map section name -> contexts, in file order. ``all`` plus one per @<branch>."""
    sections: dict[str, list[str]] = {}
    current: str | None = None

    for lineno, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("@"):
            match = DIRECTIVE.match(line)
            if not match:
                raise ChecksFileError(
                    f"{source}:{lineno}: bad section directive {line!r} "
                    "(expected @all or @<branch>, with no spaces)"
                )
            current = match.group(1)
            sections.setdefault(current, [])
            continue
        if current is None:
            raise ChecksFileError(
                f"{source}:{lineno}: required check {line!r} appears before any "
                "@all/@<branch> section header"
            )
        sections[current].append(line)

    if not sections:
        raise ChecksFileError(f"{source}: no @all/@<branch> sections found")
    return sections


def contexts_for(
    sections: dict[str, list[str]], branch: str, source: str = "required-checks.txt"
) -> list[str]:
    """The set GitHub should require for ``branch``: @all plus @<branch>.

    De-duplicated, first appearance wins, so a context can sit in @all and still be
    listed under @<branch> for emphasis without producing a duplicate entry.
    """
    out: list[str] = []
    seen: set[str] = set()
    for ctx in [*sections.get("all", []), *sections.get(branch, [])]:
        if ctx not in seen:
            seen.add(ctx)
            out.append(ctx)
    if not out:
        known = ", ".join("@" + name for name in sorted(sections))
        raise ChecksFileError(
            f"{source}: no required checks resolve for branch {branch!r} "
            f"(sections present: {known}); refusing to apply an empty gate"
        )
    return out


def load(path: pathlib.Path = DEFAULT_FILE) -> dict[str, list[str]]:
    return parse_sections(path.read_text(), path.name)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Print required status checks for a branch.")
    parser.add_argument("--branch", required=True, help="protected branch to resolve, e.g. main")
    parser.add_argument("--file", type=pathlib.Path, default=DEFAULT_FILE)
    parser.add_argument("--json", action="store_true", help='print {"branch": …, "contexts": […]}')
    parser.add_argument(
        "--sections", action="store_true", help="dump every section as JSON (used by the drift test)"
    )
    args = parser.parse_args(argv)

    try:
        sections = load(args.file)
        if args.sections:
            print(json.dumps(sections))
            return 0
        contexts = contexts_for(sections, args.branch, args.file.name)
    except ChecksFileError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps({"branch": args.branch, "contexts": contexts}))
    else:
        for ctx in contexts:
            print(ctx)
    return 0


if __name__ == "__main__":
    sys.exit(main())
