# Conventions

Coding, API, idempotency, error, and testing conventions. Match existing Paymax conventions first;
the below are defaults where this module stands alone.

## API

- REST/JSON. Resource-oriented paths, plural nouns: `/v1/exam-arenas/{id}/attempts`.
- Versioned (`/v1`). Pagination: cursor-based. Filtering via query params.
- Auth via the Paymax identity token; capability/role checked per endpoint (see RBAC).
- Time is UTC ISO-8601. Money is **minor units (integer)** + currency code — never floats.

## Idempotency (mandatory for money/reward ops)

```
POST /v1/rewards/credits
Idempotency-Key: <client-generated-uuid>
```

- Persist `(idempotency_key, request_hash) -> result_ref`.
- Same key + same request → return the original result, no new effect.
- Same key + different request body → `409 idempotency_key_reused`.
- Keys retained ≥ 24h (longer for financial flows).

## Error shape

```json
{
  "error": {
    "code": "reward_pool_exhausted",
    "message": "Human-readable, safe to surface.",
    "retryable": false,
    "details": { "poolId": "..." }
  }
}
```

Use stable machine codes (snake_case). Never leak provider errors or PII in messages.

## State-machine guard pattern

```
function transition(entity, event):
    allowed = MACHINE[entity.state].get(event)
    if not allowed: reject("illegal_transition", entity.state, event)  # + audit
    runGuards(entity, event)        # business preconditions
    entity.state = allowed.target
    emit(allowed.events)            # progress, reward eligibility, notifications
    audit(actor, entity, from, to)
```

Illegal transitions are **rejected and logged**, never silently ignored.

## Ledger entry (shape)

```
RewardLedgerEntry {
  id, userId, poolId?, type: credit|redemption|reversal,
  amountMinor, currency|points, reason, sourceEvent, idempotencyKey,
  createdAt        # immutable; balances are derived by summation
}
```

## Money & rewards rules

- No reward credit without a funded `RewardPool` (pre-check pool balance atomically).
- Per-user and per-campaign caps enforced before credit.
- All charges/refunds go through the payments rail adapter; entitlements flip via state machine.

## RBAC

- Staff roles: `super_admin, content, curriculum, assessment, finance, operations,
  sponsor_manager, moderator, support, analyst, read_only`.
- Least privilege; every protected action checks capability + logs to audit.
- Support impersonation is explicit, time-boxed, and audited.

## Testing pyramid (what to cover)

- **Unit:** guards, scoring, XP/streak math, ledger summation, idempotency replay.
- **Integration:** state-machine paths (happy + illegal), rail adapters (mocked), offline sync.
- **Contract:** Paymax rail contracts; exam blueprint scoring.
- **E2E (critical paths):** onboarding+consent, lesson→mastery→reward, CBT attempt→score,
  purchase/BNPL→entitlement, EduPay payment→disbursement, credential→earning-bridge.
- **Security/abuse:** authz on every endpoint, reward-fraud velocity, exam anti-cheat.
- Prioritise **behaviour and risk** (money, authz, progression) over implementation detail.

## Naming & data

- Entities as in `data-model.md`. Curriculum is **data, not code** — never hardcode subject/trade lists.
- Feature-flag new surfaces; default off until phase-ready.
- Emit analytics events per `nfr.md` taxonomy at each meaningful transition.
