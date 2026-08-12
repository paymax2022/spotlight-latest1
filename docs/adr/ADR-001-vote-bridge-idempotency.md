# ADR-001: Vote Bridge Idempotency & TOCTOU Mitigation

**Date**: 2026-08-11  
**Status**: ACCEPTED  
**Decision Makers**: Engineering Team  
**Scope**: Frontend web voting system, mobile voting integration

## Problem

The legacy voting system (`castFreeVote()` and `verifyAndCreditPaidVote()`) has two critical race conditions:

1. **Free Vote TOCTOU** (`castFreeVote` in `free-vote.service.ts`):
   - Upserts `voter_daily_limits` and inserts `votes` in separate operations
   - Two concurrent identical requests race to insert a second `votes` row
   - Result: duplicate vote entries, inflated vote counts

2. **Paid Vote Double-Credit** (`verifyAndCreditPaidVote` in `paid-vote.service.ts`):
   - No `SELECT FOR UPDATE` lock on `vote_transactions`
   - Webhook and browser redirect can both pass the `vote_credit_status` check
   - Result: one payment credited twice

Both bugs occur because the protected functions are not idempotent and rely on external coordination to prevent re-execution.

## Solution: Vote Bridge with Idempotency Keys

Instead of modifying protected legacy code, we wrap it with a new bridge layer:

### Architecture

```
┌─────────────────────────────────────────────────┐
│  API Route: POST /api/v2/votes/free             │
│  POST /api/v2/votes/paid/verify                 │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  Bridge Layer (frontend-web/src/server/voting-  │
│  bridge/bridge.ts)                              │
│                                                 │
│  ✓ Idempotency check (bridge_idempotency_keys) │
│  ✓ KYC tier gate (kyc-gate.ts)                  │
│  ✓ SELECT FOR UPDATE lock (paid votes)          │
│  ✓ Enqueue outbox events (bridge_outbox)        │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  Protected Functions (NEVER EDIT):              │
│  • castFreeVote()                               │
│  • verifyAndCreditPaidVote()                    │
│  • incrementVoteTotals()                        │
│  • initiatePaidVote()                           │
└─────────────────────────────────────────────────┘
```

### How It Fixes the Races

#### Free Vote TOCTOU
1. Client sends `POST /api/v2/votes/free` with `X-Idempotency-Key: abc123`
2. Bridge checks `bridge_idempotency_keys` table for `abc123`
3. If not found:
   - Call `castFreeVote()` → inserts `votes` row
   - Store result in `bridge_idempotency_keys.response`
4. If second identical request arrives before first is committed:
   - Bridge returns cached result
   - Protects against: duplicate row insertion, rate-limit bypass

#### Paid Vote Double-Credit
1. Payment gateway calls webhook with `transactionId=tx123`
2. Browser also redirects to `/api/v2/votes/paid/verify?transactionId=tx123`
3. Bridge acquires `SELECT FOR UPDATE` lock on `vote_transactions.id = tx123`
4. Check `vote_credit_status`:
   - If `pending`: insert vote, mark as `credited`
   - If already `credited`: return cached result
5. Result: only one vote row inserted, even if webhook + redirect race

### Database Schema

**bridge_idempotency_keys:**
```sql
key       text PRIMARY KEY      -- X-Idempotency-Key value
response  jsonb NOT NULL        -- Cached VoteResponse
created_at timestamptz          -- TTL=24h
```

**bridge_outbox:**
```sql
id          uuid PRIMARY KEY
event_type  text                -- 'votes.free.cast', 'referral.triggered', etc.
payload     jsonb
status      text                -- 'pending', 'processing', 'done', 'failed'
attempts    integer
last_error  text
created_at  timestamptz
```

### Why This Approach

| Alternative | Why Rejected |
|---|---|
| Modify protected functions | ❌ Breaks brownfield safety guarantee; unreviewed code risk |
| Distributed lock (Redis) | ⚠️ External dependency; single point of failure; adds latency |
| Optimistic concurrency (version columns) | ⚠️ Requires schema changes to protected tables (violates brownfield) |
| UUID deduplication | ⚠️ Only works for `INSERT`, not for `UPDATE` double-credit |
| Database triggers | ⚠️ Hard to version; difficult to test; runs in transaction context |

**Chosen: `INSERT ON CONFLICT` + `SELECT FOR UPDATE`**
- No schema changes to protected tables
- Leverages native database primitives
- Easily testable in isolation
- Supports gradual rollout via feature flags
- Explicit and auditable

## Implementation Details

### Files Created

```
frontend-web/src/server/voting-bridge/
  bridge.ts              -- Main entry: bridgedCastFreeVote(), bridgedVerifyPaidVote()
  idempotency.ts         -- checkAndClaimIdempotencyKey(), storeIdempotencyResult()
  kyc-gate.ts            -- assertKycTier()
  outbox.ts              -- enqueueOutboxEvent(), processPendingOutboxEvents()
  feature-flag.ts        -- isBridgeEnabled()

frontend-web/app/api/v2/votes/
  free/route.ts          -- POST /api/v2/votes/free
  paid/initiate/route.ts -- POST /api/v2/votes/paid/initiate
  paid/verify/route.ts   -- POST /api/v2/votes/paid/verify
```

### Gradual Rollout

Feature flag `VOTES_BRIDGE_ENABLED`:
- `false` (default): legacy functions called directly, bridge skipped
- `true`: bridge activated for all requests

```typescript
if (!isBridgeEnabled()) {
  return castFreeVote(...); // Legacy path
}
// Bridge path...
```

When ready to deprecate legacy: set `VOTES_BRIDGE_ENABLED=true` in production, monitor for 2 weeks, then remove legacy code.

## Side Effects: Transactional Outbox

The bridge does NOT execute side effects synchronously:
1. Vote is inserted
2. `bridge_outbox` event is enqueued (non-blocking)
3. Background worker processes outbox events (separate transaction)

Events:
- `votes.free.cast` — analytics logging
- `votes.paid.credited` — analytics, leaderboard update
- `referral.triggered` — credit referrer wallet

**Why?** Prevents vote-insert from failing if wallet service is down; enables retries.

## Testing

Required test suite before merge:

1. `free-vote-concurrency.spec.ts` — two identical requests → one vote row
2. `paid-vote-concurrency.spec.ts` — webhook + redirect → one vote row
3. `bridge-saga.spec.ts` — failure mid-bridge → no cached successful result
4. `kyc-gate.spec.ts` — tier 0 user blocked on tier 1 contest
5. `feature-flag.spec.ts` — flag=false → legacy path taken

See `frontend-web/tests/voting/` for test fixtures.

## Monitoring

Add metrics:
- `vote.bridge.idempotency.hit` — cache hit rate
- `vote.bridge.kyc.gate.fail` — tier gate rejections
- `vote.bridge.outbox.latency` — side-effect processing delay
- `vote.bridge.feature_flag.status` — current rollout state

## Rollback Plan

If bridge causes outage:
1. Set `VOTES_BRIDGE_ENABLED=false`
2. Requests fall through to legacy functions
3. No code redeploy needed; takes effect in next request

## Related ADRs

- [[ADR-002-vote-engine-deprecation]] — Which vote engine is live in production; plan to stop legacy writes

## Decision

**ACCEPTED**. Bridge layer provides:
✓ Idempotency without modifying protected code  
✓ TOCTOU mitigation via database primitives  
✓ Gradual rollout capability  
✓ Auditability and testability  
✓ Brownfield safety preservation  

Approved by: Engineering Lead  
Implemented by: TBD  
Deployed: TBD
