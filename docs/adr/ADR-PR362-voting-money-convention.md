# ADR-PR362: Money Convention Boundary — Voting Float NGN vs Ledger Integer Kobo

**Status:** Proposed
**Date:** 2026-09-30
**Deciders:** Paymax fintech team
**Audit ref:** AUD-DB-003

## Context

Two money conventions coexist in the codebase:

- **`internal/finance/*` (ledger path):** integer minor units (kobo). Iron rule —
  never floats, never strings for math.
- **`frontend-web/src/server/voting/*` (legacy Spotlight path):** `amountExpected`
  is a `number` in NGN through pricing, comparison, and `vote_transactions`
  storage; conversion to kobo happens at the Paystack boundary via
  `Math.round(amountExpected * 100)`, and verification tolerates up to ₦1 drift
  (`paid-vote.service.ts:215-218`).

The legacy files are brownfield-protected — they may not be edited directly.
Float NGN inside the voting module is a *bounded cosmetic* risk today (worst
case: sub-kobo rounding on a vote price, absorbed by the ₦1 tolerance). The
real risk is **convention drift**: a new feature copying the voting module's
float style into a wallet path, where sub-kobo error becomes real money.

## Decision

**Keep the legacy convention inside the protected module. Enforce the
boundary at the adapter layer.**

1. **Legacy stays as-is.** `src/server/voting/*` remains float-NGN — it is
   protected, self-contained, and its only external money surface is Paystack
   (kobo conversion at the boundary is already correct, `Math.round` on the
   way out, ₦1 tolerance on verify).

2. **All new code touching money uses integer kobo.** Any adapter,
   bridge, or service that *reads* a voting amount and *moves* money
   (wallet debit, settlement, refund, ledger posting) converts at the seam:
   `kobo = Math.round(ngn * 100)` on ingress, and never re-derives NGN from
   kobo downstream. `voting-bridge/` already does this — it is the reference.

3. **Lint/review rule, not a rewrite.** Reviewers reject float `number` money
   fields in any file under `internal/finance/`, `voting-bridge/`, or any new
   module. A grep-guard (`\bamount\w*: number` outside `src/server/voting/`)
   can be added to CI if the convention is violated once.

4. **Non-goal:** re-platforming the voting module onto kobo. If the module is
   ever rewritten, it adopts integer kobo then — a conversion-only refactor of
   protected files buys nothing and risks the protected-path boundary.

## Consequences

- The drift is contained to files the protection hook already gates; the
  audit risk ("copying the wrong convention") is mitigated by making the
  boundary explicit rather than by rewriting legacy code.
- Vote pricing keeps its existing (bounded) float error; nothing user-visible
  changes.
- New modules have an unambiguous rule: integer kobo, convert at the seam.
