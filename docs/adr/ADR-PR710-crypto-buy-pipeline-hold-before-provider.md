# ADR-PR710: Crypto buy pipeline — hold the NGN before the provider executes

Status: accepted (flag-off, no routes yet)

## Context
A buy spends the user's NGN (ledger, ADR-PR709) to execute a swap at the provider. Two systems, no
shared transaction: the order of the two writes decides which failure loses money.

## Decision
1. **Hold first, provider second.** Confirm claims `quoted -> confirming`, posts the NGN hold, and only
   then calls the provider. A provider execution therefore never happens without the money parked. The
   alternative (provider first) can leave an executed swap the user has not paid for.
2. **Outcomes after the provider call:**
   - definitive refusal (4xx): nothing executed -> release the hold, `confirming -> failed`;
   - unknown outcome (5xx, timeout, dropped connection): it may have executed -> keep the hold, park in
     `needs_review` for the reconciler / a human;
   - success: record the provider swap id (never overwriting a different one), `-> processing`, then
     resolve at once from the provider's authoritative state in case it already finished.
3. **A refused hold fails the swap before the provider is touched** (insufficient funds, tier cap, wallet
   disabled). Transient hold errors leave it `confirming` for a retry.
4. **Resumable, not repeatable.** Confirm runs under a per-swap lock and every step is idempotent (hold
   key, provider swap id set-once, conditional transitions). A crash between hold and provider call
   resumes with the same hold and one provider call.
5. **Quotes:** idempotent per `Idempotency-Key` (a different body under the same key conflicts); the
   provider quote must equal the requested NGN exactly and have life left; the fee bps is resolved at
   quote time and stored. Expired quotes are never held. The provider sub-account is created once per
   (user, provider) under a lock, backed by a unique index.
6. **Trade gate fails closed:** no gate configured means no trading.

## Hardening from the independent audit (two blockers, two highs)
- **A released hold is never resumed into a provider call.** `HoldBuy` refuses once the release exists
  (`ErrSettlementConflict`), and `execute` checks first and finishes the failure. State writes that must
  land (`mustTo`) run on a cancellation-proof context with retries and surface their errors.
- **A provider call of unknown outcome is never repeated or refunded.** `execute_attempted_at` is stamped
  immediately before `ConfirmSwap`. A confirming swap with the stamp and no provider swap id is parked in
  `needs_review` with the hold kept; it never re-calls the provider (a 4xx on a re-call would look like
  "not executed" and refund a swap that did execute). Recording the provider swap id is retried on a
  detached context, and if it still fails the id goes into the review reason.
- **Only an allowlist of provider answers proves "not executed":** 400, 404, 422, 429, 444. 401/403/408/409/425,
  every 5xx and every transport failure are ambiguous and keep the hold.
- **The locker is mandatory** (no locker, no trading). `PGSwapLocker` pins one connection per held lock; it MUST run on its own pool
  (`NewPGSwapLockerPool`, at least ~2x concurrent confirms). CI proved this: with the locker on the shared 4-connection
  pool, 8 concurrent confirms deadlocked until the test timeout. The live tests now use a small shared pool plus a
  dedicated lock pool, which reproduces the hang if the wiring regresses.
- The trade gate also runs when resuming a claimed swap that has not reached the provider; if it refuses there,
  any hold already posted is released and the swap fails (nothing reached the provider, so it is safe).
- **Must exist before this is enabled:** a stamped swap with no provider swap id (process died after the stamp, or a
  swallowed write error) is parked in `needs_review` with the hold kept. That is safe but the user's NGN stays held
  until a provider lookup by quote id (reconciler) or an admin hold-release action resolves it. Neither is built;
  the feature flag must stay off until one is.

## Consequences
- A `confirming` swap with a hold and no provider id is the crash window; the reconciler (next slice)
  must mark stale ones `needs_review` after ~2 minutes, as the spec requires.
- Resume no longer depends on provider idempotency: a swap whose provider call may have happened is parked.
  Still unbuilt: a provider lookup by quote id so `needs_review` swaps without a swap id can resolve themselves;
  until then they need an admin. A reused quote Idempotency-Key returns the earlier row even if it is expired or
  failed (the client must use a fresh key).
- No HTTP surface yet: step-up auth, rate limits and `Idempotency-Key` header plumbing belong to the
  handler slice.
