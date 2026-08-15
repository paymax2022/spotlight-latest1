# ADR-035 — Atomic free-vote claim (resolves ADR-004's deferred TOCTOU)

**Status:** Accepted
**Date:** 2026-07-30
**Deciders:** QA + Product Engineering
**Relates to:** ADR-004 (vote-bridge idempotency) — resolves its "Known concurrency gap"

---

## Context

ADR-004 built the vote bridge (`/api/v2/votes/*`, `VOTES_BRIDGE_ENABLED`) with
idempotency + KYC gate, but explicitly **deferred** the real concurrency fix:

> "True concurrent TOCTOU not fixed (requires stored procedure refactor, planned
> post-legacy-deprecation)."

The QA sweep against `Voting_Contest_Test_Plan.md` found three release-blocking
defects in the free-vote path that this gap leaves open, all inside the
hook-protected `free-vote.service.ts` / `totals.service.ts` (cannot edit):

- **D-001** — the daily bucket is computed in **UTC** (`getVoteDateUTC`), so free
  votes reset at the wrong wall-clock time for any non-UTC contest (e.g. a
  00:30 Africa/Lagos vote was bucketed into the previous day).
- **D-002** — the per-contestant cap is a non-atomic read-modify-write
  (`upsert → select used → … → update used+n`) with no idempotency key: two
  concurrent votes both read `used=0` and double-count.
- **D-003 / D-007** — `vote_totals` is written via a non-atomic RMW fallback, and
  the shared `increment_vote_totals` RPC uses `ON CONFLICT (…, round_id)` which
  never matches a **NULL** `round_id` (the free-vote case) and inserts duplicate
  totals rows.

We chose not to wait for legacy decommission: the fix can be delivered
**additively**, without editing any protected file, by having the bridge call a
new stored procedure instead of the protected `castFreeVote` core.

## Decision

Add `public.claim_free_vote(...)` (migration
`20260730120000_vote_bridge_free_vote.sql`) and route the bridge's free-vote
core (`voting-bridge/free-vote-atomic.ts` → `castFreeVoteAtomic`) through it.

The procedure, in one transaction:
1. Ensures the per-`(contest, contestant, voter, day)` cap row exists (`INSERT … ON CONFLICT DO NOTHING`).
2. **Locks that row (`SELECT … FOR UPDATE`)** — concurrent claims serialize here.
3. Grants `min(qty, limit − used)`, inserts the append-only `votes` row, advances the cap counter.
4. Upserts `vote_totals` **atomically and NULL-round-correctly**
   (`pg_advisory_xact_lock` per contest+contestant, matched with `IS NOT DISTINCT FROM`).

The **timezone-correct day bucket** (`p_vote_date`) is computed in TypeScript
(`voting-bridge/vote-window.ts`, DST-aware via the Intl tz DB) and passed in, so
the boundary math is unit-testable and the SQL stays simple. App-side concerns
(settings guards, voter identity, fraud scoring, audit) remain at parity with the
legacy path — only the count/insert/totals core moves into the atomic RPC.

**Why `SELECT … FOR UPDATE` (row lock):** the cap requires read-then-conditional
grant (`grant = min(qty, limit − used)`), not a blind increment, so a row lock is
the correct primitive. Totals use an advisory lock because a NULL `round_id`
defeats `ON CONFLICT` (D-007), and an advisory lock serializes the
UPDATE-then-INSERT without any schema change to the shared `vote_totals` table.

## Consequences

### Positive
- **Resolves ADR-004's deferred TOCTOU** — verified against Postgres: 20 concurrent
  claims at cap 5 → exactly 5 votes / `total_confirmed = 5`, 1 totals row.
- D-001 fixed (contest-timezone/DST day boundary), D-003 fixed for the free path
  (atomic, NULL-round-correct totals).
- No edits to protected files; migration is additive-only.

### Negative / trade-offs
- Re-implements the cap/insert/totals core in SQL, so it can drift from the legacy
  `castFreeVote` — mitigated by `free-vote-atomic.spec.ts` + the DB concurrency test.
- `SECURITY DEFINER` function — reviewed for injection (all inputs are typed params).
- Active only on the v2 bridge path (behind `VOTES_BRIDGE_ENABLED`).

### Risks
- The **legacy** `increment_vote_totals` still fragments NULL-round totals (D-007);
  the legacy `/api/votes/free` path is unaffected by this fix and needs a separate
  partial-unique-index + consolidation migration.
- `advisory_xact_lock` key is `hashtextextended(contest||':'||contestant)` — hash
  collisions would over-serialize (correctness safe, throughput cost only).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Edit `free-vote.service.ts` in place | Hook-protected brownfield file — forbidden. |
| Advisory-lock wrap around the existing `castFreeVote` | Fixes D-002 but NOT D-001 (UTC bucket is computed inside the protected function). |
| Distributed lock (Redlock) | Unnecessary for a single Postgres; adds Redis failure modes to the vote path. |
| Optimistic concurrency + retry loop | More complex; row lock is simpler and contention is per-voter-per-contestant (low). |
| Add a partial unique index on `vote_totals` for the legacy path | Risks failing on pre-existing prod duplicate rows; deferred to the D-007 fix with consolidation. |
