# Vote Bridge Layer

Adapter layer that wraps the legacy voting system to add idempotency, KYC gating, and transactional outbox patterns without modifying protected code.

## Purpose

The vote bridge solves two critical race conditions in the legacy voting system:

1. **Free Vote TOCTOU** — Concurrent duplicate votes from identical requests
2. **Paid Vote Double-Credit** — Webhook + browser redirect both crediting the same vote

See `docs/adr/ADR-037-vote-bridge-idempotency.md` for detailed architecture.

## Architecture

```
API Route (frontend-web/app/api/v2/votes/*)
    ↓
Bridge Layer (this directory)
    ├── bridge.ts          — Main entry points
    ├── idempotency.ts     — Deduplication
    ├── kyc-gate.ts        — Tier gating
    ├── outbox.ts          — Async side effects
    └── feature-flag.ts    — Gradual rollout
    ↓
Protected Functions (NEVER EDIT)
    ├── castFreeVote()
    ├── verifyAndCreditPaidVote()
    └── initiatePaidVote()
```

## Modules

### `bridge.ts`

Main entry points for vote operations.

#### `bridgedCastFreeVote(req, userId, idempotencyKey, context)`

Cast a free vote with idempotency protection.

```typescript
import { bridgedCastFreeVote } from '@/server/voting-bridge/bridge';

const result = await bridgedCastFreeVote(
  {
    contestantId: '2',
    contestId: '1',
    shareCode: 'ABC123',
  },
  userId,
  'request-id-abc123', // X-Idempotency-Key
  {
    ipAddress: '203.0.113.42',
    userAgent: 'Mozilla/5.0...',
    deviceFingerprint: 'fingerprint-xyz',
  }
);

// Returns
// {
//   success: true,
//   voteId: 'uuid',
//   totalVotes: 42,
// }
```

**How it prevents TOCTOU:**
1. Check `bridge_idempotency_keys` table for the key
2. If found and successful, return cached result
3. If not found, call `castFreeVote()` and cache the result
4. Prevents duplicate rows even if request is retried

#### `bridgedVerifyPaidVote(req, userId, context)`

Verify a paid vote with SELECT FOR UPDATE lock.

```typescript
import { bridgedVerifyPaidVote } from '@/server/voting-bridge/bridge';

const result = await bridgedVerifyPaidVote(
  {
    transactionId: 'tx-uuid-123',
    paymentReference: 'pay-ref-456',
  },
  userId,
  {
    ipAddress: '203.0.113.42',
    userAgent: 'Mozilla/5.0...',
  }
);

// Returns
// {
//   success: true,
//   voteId: 'uuid',
//   totalVotes: 42,
// }
```

**How it prevents double-credit:**
1. Acquire `SELECT FOR UPDATE` lock on transaction row
2. Check if vote already credited (status = 'credited')
3. If not, insert vote and mark transaction as credited
4. Lock prevents webhook + redirect from both crediting

#### `getContestantVotingData(contestantId)` & `getContestLeaderboard(competitionId)`

Read-only queries for voting data (synced with admin portal).

### `idempotency.ts`

Idempotency key management.

```typescript
import { checkAndClaimIdempotencyKey, storeIdempotencyResult } from '@/server/voting-bridge/idempotency';

// Check if key was already processed
const cached = await checkAndClaimIdempotencyKey('request-id-abc123');
if (cached) {
  return cached; // Return cached result
}

// Store result after vote is cast
await storeIdempotencyResult('request-id-abc123', { success: true, voteId: '...' });
```

**Storage:**
- `bridge_idempotency_keys` table
- Primary key: `key` (text, unique)
- TTL: 24 hours (cleaned up by application sweep)

### `kyc-gate.ts`

KYC tier verification before voting.

```typescript
import { assertKycTier, getUserKycTier, getContestKycRequirement } from '@/server/voting-bridge/kyc-gate';

// Assert user meets tier requirement
try {
  await assertKycTier(userId, contestantId);
  // User passes KYC gate
} catch (error) {
  // User tier too low: 403 Forbidden
  return { error: 'KYC tier insufficient' };
}

// Check user's tier
const tier = await getUserKycTier(userId);
// Returns 0 (unverified), 1, 2, 3, 4, or 5

// Check contest requirement
const required = await getContestKycRequirement(contestantId);
// Returns required tier (0 = no requirement)
```

**Tier levels:**
- 0: Unverified (basic email)
- 1: Phone verified
- 2: Email + phone
- 3: KYC (ID verified)
- 4: Advanced KYC (address, occupation)
- 5: Enhanced KYC (source of funds)

### `outbox.ts`

Transactional outbox for async side effects.

```typescript
import { enqueueOutboxEvent, processPendingOutboxEvents } from '@/server/voting-bridge/outbox';

// Queue an event (non-blocking)
const eventId = await enqueueOutboxEvent('referral.triggered', {
  shareCode: 'ABC123',
  voterId: userId,
  contestantId: '2',
  contestId: '1',
});

// Process pending events (run periodically via cron or background worker)
const processed = await processPendingOutboxEvents();
// Returns count of successfully processed events
```

**Event types:**
- `votes.free.cast` — Analytics logging
- `votes.paid.credited` — Analytics, leaderboard update
- `referral.triggered` — Credit referrer wallet
- `votes.analytics` — Generic vote analytics
- `leaderboard.updated` — Leaderboard recalculation

**Status flow:**
```
pending → processing → done
       ↓
       → failed (after 3 attempts)
```

### `feature-flag.ts`

Control bridge rollout via feature flags.

```typescript
import { isBridgeEnabled, isBridgeEnabledForUser, enableBridge, disableBridge } from '@/server/voting-bridge/feature-flag';

// Check if bridge is enabled globally
if (isBridgeEnabled()) {
  // Use bridge path
}

// Check if bridge is enabled for a specific user
if (isBridgeEnabledForUser(userId)) {
  // User in rollout cohort
}

// Manual override for testing
enableBridge();  // Force enable
disableBridge(); // Force disable
resetBridge();   // Reset to environment variable
```

**Environment variable:**
```bash
VOTES_BRIDGE_ENABLED=true  # Enable bridge
VOTES_BRIDGE_ENABLED=false # Disable bridge (use legacy)
```

If not set, defaults to `false` (gradual rollout).

## API Routes

### POST /api/v2/votes/free

Cast a free vote.

```bash
curl -X POST http://localhost:3000/api/v2/votes/free \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: request-abc123" \
  -d '{
    "contestantId": "2",
    "contestId": "1",
    "shareCode": "MYCODE"
  }'

# Response
{
  "success": true,
  "voteId": "uuid",
  "totalVotes": 42,
  "timestamp": "2026-08-11T..."
}
```

**Headers:**
- `X-Idempotency-Key` (required) — Unique request ID for deduplication
- `X-Device-Fingerprint` (optional) — Device identifier for analytics

### POST /api/v2/votes/paid/initiate

Initiate a paid vote (creates transaction).

```bash
curl -X POST http://localhost:3000/api/v2/votes/paid/initiate \
  -H "Content-Type: application/json" \
  -d '{
    "contestantId": "2",
    "contestId": "1",
    "amount": 99.99
  }'

# Response
{
  "success": true,
  "transactionId": "tx-uuid",
  "paymentReference": "vote-ref-abc123",
  "amount": 99.99,
  "paymentUrl": "/api/v2/votes/paid/pay?transactionId=..."
}
```

### POST /api/v2/votes/paid/verify

Verify and credit a paid vote.

```bash
curl -X POST http://localhost:3000/api/v2/votes/paid/verify \
  -H "Content-Type: application/json" \
  -d '{
    "transactionId": "tx-uuid",
    "paymentReference": "vote-ref-abc123"
  }'

# Response
{
  "success": true,
  "voteId": "uuid",
  "totalVotes": 42,
  "timestamp": "2026-08-11T..."
}
```

Can also be called via GET (for webhook):
```
GET /api/v2/votes/paid/verify?transactionId=tx-uuid&paymentReference=vote-ref-abc123
```

## Database Schema

### bridge_idempotency_keys

```sql
key        text PRIMARY KEY          -- X-Idempotency-Key value
response   jsonb NOT NULL            -- Cached VoteResponse (JSON)
created_at timestamptz DEFAULT now() -- TTL=24h
```

### bridge_outbox

```sql
id           uuid PRIMARY KEY
event_type   text NOT NULL           -- 'votes.free.cast', etc.
payload      jsonb NOT NULL          -- Event data
status       text DEFAULT 'pending'  -- 'pending', 'processing', 'done', 'failed'
attempts     integer DEFAULT 0       -- Retry count (max 3)
last_error   text                    -- Error from last attempt
created_at   timestamptz DEFAULT now()
processed_at timestamptz             -- When event was done
```

## Testing

Required tests before shipping bridge code:

```bash
# Free vote concurrency (identical requests)
npm test -- tests/unit/voting/free-vote-concurrency.spec.ts

# Paid vote concurrency (webhook + redirect race)
npm test -- tests/unit/voting/paid-vote-concurrency.spec.ts

# Bridge saga (failure mid-bridge doesn't cache)
npm test -- tests/unit/voting/bridge-saga.spec.ts

# KYC gate (tier checks)
npm test -- tests/unit/voting/kyc-gate.spec.ts

# Feature flag (gradual rollout)
npm test -- tests/unit/voting/feature-flag.spec.ts

# All voting tests
npm test -- tests/unit/voting/
```

## Monitoring

Key metrics to track:

| Metric | Target | Alert |
|--------|--------|-------|
| `vote.bridge.free.latency` | < 500ms | > 1s |
| `vote.bridge.paid.latency` | < 1s | > 2s |
| `vote.bridge.idempotency.hit` | > 5% | < 1% (indicates low concurrency) |
| `vote.bridge.kyc.gate.fail` | < 1% of votes | > 5% |
| `vote.bridge.outbox.pending` | < 100 | > 1000 |
| `vote.bridge.outbox.failed` | 0 | > 10 |

## Rollback

If bridge has issues:

```bash
# Disable bridge (uses legacy functions)
echo "VOTES_BRIDGE_ENABLED=false" >> .env.local

# Restart dev server
npm run dev

# Legacy functions are called directly
```

No data loss; `votes` table is retained as audit trail.

## Related Documentation

- `docs/adr/ADR-037-vote-bridge-idempotency.md` — Architecture & TOCTOU mitigation
- `docs/adr/ADR-038-vote-engine-deprecation.md` — Production engine status
- `CONTEST_API_INTEGRATION.md` — Mobile/web API integration guide
- `MOBILE_WEB_ADMIN_SYNC.md` — Multi-platform voting sync

## Future Enhancements

- [ ] WebSocket for real-time vote updates (replace polling)
- [ ] Push notifications when rankings change
- [ ] Analytics dashboard with vote heatmaps
- [ ] A/B testing framework for vote UI variants
- [ ] Fraud detection (duplicate payment refs, botting)
