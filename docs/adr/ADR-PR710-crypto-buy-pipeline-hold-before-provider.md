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

## Consequences
- A `confirming` swap with a hold and no provider id is the crash window; the reconciler (next slice)
  must mark stale ones `needs_review` after ~2 minutes, as the spec requires.
- Provider-side idempotency of confirm per quote id is assumed (the quote carries a `confirmed` flag) and
  must be verified in the sandbox before go-live; resume relies on it.
- No HTTP surface yet: step-up auth, rate limits and `Idempotency-Key` header plumbing belong to the
  handler slice.
