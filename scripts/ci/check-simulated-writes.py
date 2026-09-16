#!/usr/bin/env python3
"""Fail the build when an admin service fakes a write.

The defect this exists to catch, found four times by accident:

    export async function approvePayout(id) {
      if (USE_MOCK) { await delay(); return { ok: true }; }   // <-- lies
      return sendJson('POST', `/finance/payouts/${id}/approve`, ...);
    }

An operator clicks Approve, sees success, and nothing happens server-side. It is
worse than a broken button: a broken button gets reported, while one that reports
success trains people to trust it, and the divergence surfaces much later — or
never. In this repo it reached money and compliance decisions (creator payouts,
escrow fraud, KYC bypass, crypto withdrawals) and, in two services, returned text
asserting an immutable audit record had been written.

TWO CHECKS
  1. CLAIMS (hard failure, no baseline). A fixture branch must not assert that a
     control ran: audit records, gate evaluations, state machines, solvency. These
     were all removed, so this starts clean and must stay clean.
  2. SIMULATED WRITES (ratchet). A mutation whose fixture branch returns instead
     of throwing. ~200 of these predate the guard, so they are recorded in a
     baseline and only ADDITIONS fail. Existing debt is visible and can only
     shrink.

A mutation is identified by the HTTP method on its live path, not by its name —
names are unreliable (`setEventOfferStatus` writes, `getCampaign` does not).
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVICES = os.path.join(ROOT, 'frontend-admin', 'src', 'services')
BASELINE = os.path.join(ROOT, 'scripts', 'ci', 'simulated-writes-baseline.txt')

# Phrases asserting that a control actually ran. Deliberately narrow: this fires
# only on claims of enforcement, not on ordinary fixture prose.
CLAIM_PATTERNS = [
    r'Recorded to immutable audit',
    r'gate \(NL-\d+\) passed',
    r'State machine [A-Z_→\- ]+ enforced',
    r'never funds the gap',
    r'Holds only, never lends',
]

FIXTURE_RE = re.compile(r'if \((USE_MOCK|USE_FIXTURES)\)')
# Spans end at the next top-level function, EXPORTED OR NOT. Ending only at
# exported ones let a read's span bleed into a following private helper and pick
# up its POST — which is how getApplication/getCampaign first showed up as
# "simulated writes".
FUNC_RE = re.compile(r'^(?:export )?(?:async )?function (\w+)\s*\(', re.M)
WRITE_METHOD_RE = re.compile(r"""(method:\s*['"](POST|PATCH|PUT|DELETE)['"]|sendJson[^(]*\(\s*['"](POST|PATCH|PUT|DELETE)['"])""")


def function_spans(src):
    """(name, start, end) for each exported function, end-delimited by the next one."""
    marks = [(m.group(1), m.start()) for m in FUNC_RE.finditer(src)]
    for i, (name, start) in enumerate(marks):
        end = marks[i + 1][1] if i + 1 < len(marks) else len(src)
        yield name, start, end


def fixture_block(body):
    """The text of the first fixture branch, or None."""
    m = FIXTURE_RE.search(body)
    if not m:
        return None
    i = body.find('{', m.end())
    if i == -1:
        # single-statement form: if (USE_MOCK) return x;
        return body[m.end():body.find('\n', m.end())]
    depth, j = 1, i + 1
    while j < len(body) and depth:
        if body[j] == '{':
            depth += 1
        elif body[j] == '}':
            depth -= 1
        j += 1
    return body[i:j]


def scan():
    claims, simulated = [], []
    for fname in sorted(os.listdir(SERVICES)):
        if not fname.endswith('.ts') or fname.endswith('.test.ts'):
            continue
        src = open(os.path.join(SERVICES, fname), encoding='utf-8').read()
        for name, start, end in function_spans(src):
            body = src[start:end]
            fx = fixture_block(body)
            if fx is None:
                continue
            live = body[body.find(fx) + len(fx):] if fx in body else body
            for pat in CLAIM_PATTERNS:
                if re.search(pat, fx):
                    claims.append(f'{fname}::{name} — claims: {pat}')
            # A mutation: the LIVE path performs a write.
            if not WRITE_METHOD_RE.search(live):
                continue
            # Honest fixture branches either throw or return nothing.
            if 'throw ' in fx:
                continue
            if re.search(r'\breturn\b', fx):
                simulated.append(f'{fname}::{name}')
    return claims, sorted(set(simulated))


def main():
    claims, simulated = scan()
    failed = False

    if claims:
        failed = True
        print('::error::A fixture branch claims a control ran when it did not:')
        for c in claims:
            print(f'  {c}')
        print('  These are assertions about audit records, gates or state machines that')
        print('  the fixture path never performed. Remove the claim.')

    baseline = set()
    if os.path.exists(BASELINE):
        baseline = {l.strip() for l in open(BASELINE) if l.strip() and not l.startswith('#')}

    current = set(simulated)
    added = sorted(current - baseline)
    fixed = sorted(baseline - current)

    if added:
        failed = True
        print('::error::New simulated write(s) — a mutation whose fixture branch returns success:')
        for a in added:
            print(f'  {a}')
        print('  The operator sees success while nothing happens server-side.')
        print('  Either point it at a real endpoint, or throw so the control fails honestly.')
        print('  See docs/audit/ADMIN_SIMULATED_WRITES.md.')

    if fixed:
        print(f'::notice::{len(fixed)} baseline entr{"y" if len(fixed)==1 else "ies"} fixed — '
              f'please remove from {os.path.relpath(BASELINE, ROOT)}:')
        for f in fixed[:20]:
            print(f'  {f}')

    if not failed:
        print(f'simulated-writes guard passed — {len(current)} known, {len(baseline)} baselined, '
              f'0 new, 0 fabricated claims.')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
