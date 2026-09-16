# ADR-039 — Vote engine: universal is canonical; legacy deprecated; v2 cut-over

**Status:** Accepted
**Date:** 2026-07-30
**Deciders:** QA + Product Engineering
**Relates to:** ADR-004, ADR-035 (vote bridge)

---

## Context

Two vote engines exist in the database (documented in the `vote-bridge` skill,
"Dual vote engine status"):

- **Legacy:** `contestant_votes`, `vote_allocations`; SQL RPCs `cast_free_vote()`,
  `cast_paid_votes()`, `cast_referral_vote()`
  (`supabase/migrations/20260404240000_voting_engine.sql`).
- **Universal (live for web):** `votes`, `vote_totals`, `vote_transactions`,
  `voter_daily_limits`, `voter_contestant_daily_limits`; TypeScript services in
  `frontend-web/src/server/voting/`.

The universal engine is what the web app reads and writes. With ADR-035 the web
free-vote path now routes through the atomic bridge (`claim_free_vote`). We need a
recorded decision on which engine is authoritative and how the cut-over ships
without breaking production.

Local verification (empty dev DB) confirms both engines' tables exist and neither
`contestant_votes` nor `votes` is receiving traffic in isolation; the production
zero-write check below is the authoritative gate.

## Decision

1. **The universal engine is canonical.** `contestant_votes` / `vote_allocations`
   and the `cast_*_vote()` RPCs are **deprecated** — no new writes. They are
   retained read-only for historical data until a separate archival decision.

2. **Web client cut-over (done):** `components/voting/VoteModal.tsx` now POSTs to
   `/api/v2/votes/free` with an `X-Idempotency-Key`, engaging the atomic bridge.
   Dev enables `VOTES_BRIDGE_ENABLED=true` (`.env.example`, `.env.local`).

3. **Mobile cut-over (pending, gateway-owned):** the RN app calls
   `POST /voting/vote/free` (with `Idempotency-Key`) on its API gateway — a
   different base than the Next.js route. The gateway owner must repoint that path
   to the bridge v2 route. Mobile already sends an idempotency key, so it is
   bridge-ready; no app change is required beyond the gateway mapping.

4. **Production enablement runbook (gated — do NOT enable the flag first):**
   1. Deploy migration `20260730120000_vote_bridge_free_vote.sql`
      (adds `claim_free_vote` + `bridge_idempotency_keys`).
   2. Confirm the legacy engine is quiescent:
      `SELECT count(*) FROM contestant_votes WHERE created_at > now() - interval '7 days';`
      must be **0** (no new legacy writes).
   3. Set `VOTES_BRIDGE_ENABLED=true` in the production environment.
   4. Monitor `bridge_idempotency_keys` growth and free-vote error rate; schedule
      the 24h TTL sweep (still outstanding per ADR-004).

## Consequences

### Positive
- Single source of truth for tallies; the atomic path (ADR-035) becomes the live
  web behavior once the flag is on.
- Legacy data preserved; no destructive migration.

### Negative / trade-offs
- Two engines coexist until legacy is archived; contributors must not add
  `contestant_votes` writes.
- Mobile remains on the legacy gateway path until the gateway mapping changes —
  mobile free votes are not yet on the atomic path.

### Risks
- **Enabling the flag before the migration ships → every free vote 500s**
  (`claim_free_vote` missing). Mitigated by the runbook ordering and the explicit
  comment in `.env.production.example`.
- The v2 route falls through to the racy legacy `castFreeVote` when the flag is
  off, so a half-configured environment (client on v2, flag off) silently keeps
  the old bugs. Mitigated by dev default-on and the runbook.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Big-bang cutover (delete legacy, force v2) | High risk on a live, money-adjacent path; no rollback. |
| Dual-write both engines | Doubles the surface for the exact concurrency bugs we're fixing. |
| Keep everything on v1, edit the protected service | Forbidden by the brownfield hook; loses the ADR-035 atomicity. |
| Leave the flag off, ship code only | Doesn't deliver the fix to production — the whole point of the cut-over. |
