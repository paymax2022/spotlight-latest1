# Skill: vote-bridge

Build the adapter layer that wraps the existing vote-recording functions so wallet debits,
KYC tier checks, idempotency keys, and referral rewards can be added without modifying
any protected legacy code. Load this skill before any work on `/api/v2/votes/*` or any
code that connects voting to payments.

**Before starting:** confirm `brownfield-guardian` passes on your proposed file list.

## Protected functions — import and call, never edit

| Function | File | Idempotent? | Known defect |
|---|---|---|---|
| `castFreeVote()` | `frontend-web/src/server/voting/free-vote.service.ts:119` | ❌ NO | TOCTOU race between `voter_daily_limits` upsert and `votes` insert — two concurrent calls insert two rows |
| `verifyAndCreditPaidVote()` | `frontend-web/src/server/voting/paid-vote.service.ts:152` | ⚠️ PARTIAL | No `SELECT FOR UPDATE` on `vote_transactions` — webhook + browser redirect can both pass the `vote_credit_status` guard and double-insert |
| `incrementVoteTotals()` | `frontend-web/src/server/voting/totals.service.ts` | ✅ YES | Called outside vote insert transaction — crash between steps leaves totals stale |
| `initiatePaidVote()` | `frontend-web/src/server/voting/paid-vote.service.ts:35` | ✅ YES | Safe — inserts a new `vote_transactions` row with unique `payment_reference` |

**Hook reminder:** `.claude/hooks/protect-legacy.sh` will block any Edit/Write to these files.
If blocked, you are touching the wrong file. Create a new file in `frontend-web/src/server/voting-bridge/` instead.

## Dual vote engine status (DG-3)

Two engines exist in the database:
- **Legacy (inactive for web):** `contestant_votes`, `vote_allocations`; SQL RPCs
  `cast_free_vote()`, `cast_paid_votes()`, `cast_referral_vote()`
  in `supabase/migrations/20260404240000_voting_engine.sql`
- **Universal (active for web):** `votes`, `vote_totals`, `vote_transactions`,
  `voter_daily_limits`; TypeScript services in `frontend-web/src/server/voting/`

**The bridge wraps the universal engine only.** Before shipping, query production to confirm
`contestant_votes` is receiving zero new rows, then document the result in
`docs/adr/ADR-XXX-vote-engine-deprecation.md`.

## New files to create (never edit existing)

```
frontend-web/src/server/voting-bridge/
  bridge.ts              ← main entry point; exports bridgedCastFreeVote(), bridgedVerifyPaidVote()
  idempotency.ts         ← bridge_idempotency_keys table helpers
  kyc-gate.ts            ← tier check before vote is allowed
  outbox.ts              ← bridge_outbox insert helpers
  feature-flag.ts        ← reads VOTES_BRIDGE_ENABLED env var / LaunchDarkly

frontend-web/app/api/v2/votes/
  free/route.ts          ← new route; calls bridgedCastFreeVote()
  paid/initiate/route.ts ← new route; calls initiatePaidVote() directly (no bridge needed)
  paid/verify/route.ts   ← new route; calls bridgedVerifyPaidVote()

supabase/migrations/
  YYYYMMDDHHMMSS_vote_bridge_idempotency.sql    ← bridge_idempotency_keys table
  YYYYMMDDHHMMSS_vote_bridge_outbox.sql         ← bridge_outbox table
```

## Required database migrations (additive-only)

Load the `db-migrations` skill before writing SQL. File naming:
`supabase migration new vote_bridge_idempotency` → timestamped automatically.

```sql
-- Migration 1: bridge_idempotency_keys
CREATE TABLE IF NOT EXISTS public.bridge_idempotency_keys (
  key          text        PRIMARY KEY,
  response     jsonb       NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- No RLS needed — service_role only (same as votes table)
COMMENT ON TABLE public.bridge_idempotency_keys IS
  'Dedup store for bridge vote calls. TTL enforced by application sweep (24h).';

-- Migration 2: bridge_outbox
CREATE TABLE IF NOT EXISTS public.bridge_outbox (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   text        NOT NULL,  -- 'votes.free.cast' | 'votes.paid.credited' | 'referral.triggered'
  payload      jsonb       NOT NULL,
  status       text        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','processing','done','failed')),
  attempts     integer     NOT NULL DEFAULT 0,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_bridge_outbox_pending
  ON public.bridge_outbox (status, created_at)
  WHERE status = 'pending';
COMMENT ON TABLE public.bridge_outbox IS
  'Transactional outbox for async side effects: referral credits, analytics, notifications.';
```

## Bridge implementation guide

### `bridgedCastFreeVote()` — fixes castFreeVote() idempotency

```typescript
// frontend-web/src/server/voting-bridge/bridge.ts
import { castFreeVote } from '@/server/voting/free-vote.service';
import { checkAndClaimIdempotencyKey } from './idempotency';
import { assertKycTier } from './kyc-gate';
import { enqueueOutboxEvent } from './outbox';
import { isBridgeEnabled } from './feature-flag';

export async function bridgedCastFreeVote(
  req: CastFreeVoteRequest,
  ipAddress: string,
  deviceFingerprint: string,
  userAgent: string,
  userId?: string,
  idempotencyKey?: string,   // from X-Idempotency-Key header — REQUIRED
): Promise<CastFreeVoteResponse> {
  if (!isBridgeEnabled()) {
    // Feature flag off: fall through to original (for gradual rollout)
    return castFreeVote(req, ipAddress, deviceFingerprint, userAgent, userId);
  }

  if (!idempotencyKey) throw new ApiError('X-Idempotency-Key header is required', 400);

  // Step 1: Idempotency check — INSERT ON CONFLICT DO NOTHING
  const cached = await checkAndClaimIdempotencyKey(idempotencyKey);
  if (cached) return cached as CastFreeVoteResponse;

  // Step 2: KYC tier gate (new — does not touch any protected file)
  if (userId) await assertKycTier(userId, req.contestId);

  // Step 3: Call the protected function (import only, never edit)
  const result = await castFreeVote(req, ipAddress, deviceFingerprint, userAgent, userId);

  // Step 4: Store result against idempotency key
  await storeIdempotencyResult(idempotencyKey, result);

  // Step 5: Enqueue outbox event for referral + analytics (async, non-blocking)
  if (req.shareCode) {
    await enqueueOutboxEvent('referral.triggered', {
      shareCode: req.shareCode,
      voterId: userId,
      contestantId: req.contestantId,
      contestId: req.contestId,
    });
  }

  return result;
}
```

### `bridgedVerifyPaidVote()` — fixes verifyAndCreditPaidVote() TOCTOU

```typescript
// The SELECT FOR UPDATE must be issued as a Supabase RPC (raw SQL)
// because the JS client does not expose advisory locks or FOR UPDATE directly.

export async function bridgedVerifyPaidVote(
  req: VerifyPaidVoteRequest,
  actorId: string,
  ipAddress: string,
  userAgent: string,
): Promise<VerifyPaidVoteResponse> {
  const supabase = createAdminClient();

  // Step 1: Lock the transaction row (prevents webhook + redirect double-credit)
  // This must be a stored procedure — create in a new migration:
  //   CREATE OR REPLACE FUNCTION lock_vote_transaction(tx_id uuid)
  //   RETURNS void LANGUAGE sql AS $$ SELECT 1 FROM vote_transactions WHERE id = tx_id FOR UPDATE; $$;
  const { error: lockErr } = await supabase.rpc('lock_vote_transaction', { tx_id: req.transactionId });
  if (lockErr) throw new ApiError('Could not acquire transaction lock', 500);

  // Step 2: Delegate to protected function (which now safely reads credit_status under lock)
  return verifyAndCreditPaidVote(req, actorId, ipAddress, userAgent);
}
```

## Tests required before bridge ships

Delegate to `test-engineer` agent. These must be green before any bridge code merges:

1. `tests/unit/voting/free-vote-concurrency.spec.ts`
   — send identical request twice concurrently; assert one `votes` row, one `bridge_idempotency_keys` row.

2. `tests/unit/voting/paid-vote-concurrency.spec.ts`
   — simulate webhook + redirect arriving within 10ms; assert one `votes` row,
   `vote_credit_status = 'credited'` exactly once.

3. `tests/unit/voting/bridge-saga.spec.ts`
   — mock `castFreeVote()` to throw after KYC gate passes; assert `bridge_idempotency_keys`
   row is NOT stored (failed calls must not be cached as successful).

4. `tests/unit/voting/kyc-gate.spec.ts`
   — Tier-0 user calling Tier-1 contest → 403. Tier-1 user → passes gate.

5. `tests/unit/voting/feature-flag.spec.ts`
   — `VOTES_BRIDGE_ENABLED=false` → `castFreeVote()` called directly, bridge skipped.

## Saga: wallet debit → vote credit (PRD §EPIC 1 + §10.3)

When a wallet debit is wired (Phase 2), the sequence must be:

```
BEGIN TRANSACTION
  1. Debit ledger: INSERT INTO ledger_entries (account_id, type='DEBIT', amount_kobo, ...)
  2. Update ledger balance projection (derived — never direct UPDATE on balance column)
COMMIT

  3. Call bridgedVerifyPaidVote() [acquires FOR UPDATE lock]
     → on success: INSERT bridge_outbox (event: 'votes.paid.credited')
     → on failure: compensating reversal:
        INSERT INTO ledger_entries (type='REVERSAL', amount_kobo, ref=original_entry_id)
        INSERT bridge_outbox (event: 'wallet.reversal.queued')
```

Never debit the wallet and credit votes in the same database transaction — they are
on different logical domains (fintech ledger vs voting engine). Use the outbox + saga pattern.

## ADRs required before ship

1. `docs/adr/ADR-001-vote-engine-deprecation.md` — document which engine is live in production
   and the plan to stop `contestant_votes` writes.
2. `docs/adr/ADR-002-vote-bridge-idempotency.md` — document why `INSERT ON CONFLICT` +
   `SELECT FOR UPDATE` was chosen over distributed locks or optimistic concurrency.
