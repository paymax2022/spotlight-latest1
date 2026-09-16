# ADR-004 — Vote Bridge Idempotency and KYC Gate

**Status:** Accepted  
**Date:** 2026-06-13  
**Deciders:** Prince Chuks (lead)

---

## Context

The existing vote service functions (`castFreeVote`, `verifyAndCreditPaidVote`) have two concurrency defects:

1. **`castFreeVote` TOCTOU**: The upsert on `voter_daily_limits` and the insert on `votes` are not atomic. Two concurrent calls with the same voter/contestant/contest can both pass the daily-limit check and insert two `votes` rows.

2. **`verifyAndCreditPaidVote` TOCTOU**: The read of `vote_credit_status` and the update to `'credited'` are not in the same `SELECT FOR UPDATE`. A webhook and a browser redirect arriving within milliseconds can both pass the guard and double-credit.

These functions are in protected legacy files. The brownfield rule prohibits editing them. The bridge layer provides mitigations at the wrapper level.

---

## Decision

### Bridge architecture

New module: `frontend-web/src/server/voting-bridge/`. New routes: `/api/v2/votes/*`. The bridge is activated by `VOTES_BRIDGE_ENABLED=true`. When false, v2 routes call legacy functions directly (gradual rollout).

### Idempotency mechanism

`bridge_idempotency_keys` table with a `TEXT PRIMARY KEY` (the idempotency key). Clients send `X-Idempotency-Key` header. The bridge:

1. `INSERT { key, response: {} }` — atomically claims the key.
2. If `23505` (UNIQUE violation): another request claimed it. SELECT and return the stored response.
3. On success: call the vote service. Store result. Return it.
4. Failed calls are NOT stored — client can retry with the same key.

### Known concurrency gap — RESOLVED by ADR-035 (2026-07-30)

True sub-millisecond races (same key sent simultaneously) can both proceed if the race-loser fetches `response: {}` before the claimer stores the result. Probability is very low for human-speed interaction. The proper fix — `SELECT FOR UPDATE` wrapping the entire vote transaction — requires modifying the protected service functions. This is deferred to a future refactor once the legacy modules are decomissioned.

> **Update (ADR-035):** the deferral above is resolved for the free-vote path. Rather than edit the protected function, the bridge now calls a new additive stored procedure `claim_free_vote` that row-locks the per-contestant cap (`SELECT … FOR UPDATE`) and upserts totals atomically — verified against Postgres with a 20-way concurrency test. See [ADR-035](ADR-035-atomic-free-vote-claim.md). The paid-vote `verifyAndCreditPaidVote` TOCTOU (PV-005) remains open.

### KYC gate

`assertKycGate(userId)` runs before every bridged vote:
- `suspended` status → 403 (account suspended)
- All other statuses → permitted

Per-tier vote volume limits (e.g. Tier 1 = 500 paid votes/day) are enforced in Block 7.

### Outbox events

Non-blocking side effects enqueued to `bridge_outbox`:
- `votes.free.cast` — every successful free vote (for analytics)
- `votes.paid.credited` — every verified paid vote (for receipt emails)
- `referral.triggered` — when a `shareCode` is present (for referral credit)

Outbox failures are silently swallowed — they never fail the vote response.

---

## Consequences

**Good:**
- No edits to protected files — brownfield guardian passes.
- Handles human-speed retries (accidental double-clicks, page refreshes).
- Adds KYC gate and referral outbox without touching any legacy code.
- Gradual rollout via `VOTES_BRIDGE_ENABLED` flag.

**Bad / trade-offs:**
- True concurrent TOCTOU not fixed (requires stored procedure refactor, planned post-legacy-deprecation).
- `bridge_idempotency_keys` table grows unboundedly — needs a sweep job (TTL = 24h, not yet implemented).
- v2 routes require `X-Idempotency-Key` when bridge is on — clients must be updated.
