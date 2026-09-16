# Vote Bridge Test Suite

Comprehensive test coverage for the vote bridge adapter layer. Tests verify:
- ✅ Idempotency (no duplicate votes)
- ✅ TOCTOU race prevention (free votes)
- ✅ Double-credit prevention (paid votes)
- ✅ KYC tier gating
- ✅ Gradual feature rollout

## Test Files

### 1. `free-vote-concurrency.spec.ts` (6 tests)
**What it tests**: Free vote idempotency via `X-Idempotency-Key` header

**Scenario**: User clicks "vote" button twice rapidly, or retry logic sends duplicate request.

**Tests**:
```typescript
✓ should insert exactly one vote when identical requests arrive concurrently
✓ should cache the response after first request completes
✓ should return cached result on second identical request
✓ should reject vote without idempotency key
✓ should handle database errors gracefully
```

**Why it matters**: Fixes TOCTOU race in `castFreeVote()` where concurrent requests could insert duplicate vote rows. Idempotency key in `bridge_idempotency_keys` table prevents this.

---

### 2. `paid-vote-concurrency.spec.ts` (6 tests)
**What it tests**: Paid vote verification with `SELECT FOR UPDATE` lock

**Scenario**: Payment gateway sends webhook while user redirects back. Both arrive within milliseconds trying to credit same transaction.

**Tests**:
```typescript
✓ should credit vote only once when webhook and redirect race
✓ should require SELECT FOR UPDATE lock before crediting
✓ should handle lock acquisition failure
✓ should reject vote if transaction not found
✓ should verify payment reference matches before crediting
✓ should insert exactly one vote row even with concurrent calls
```

**Why it matters**: Fixes double-credit race in `verifyAndCreditPaidVote()`. SELECT FOR UPDATE lock (`lock_vote_transaction` RPC) ensures only one path credits the vote.

---

### 3. `bridge-saga.spec.ts` (7 tests)
**What it tests**: Failure handling and idempotent result storage

**Scenario**: `castFreeVote()` throws error after KYC gate passes. Result should NOT be cached.

**Tests**:
```typescript
✓ should not cache failed vote attempts
✓ should allow retry after failed vote
✓ should handle KYC gate failures without caching
✓ should handle race between failure and cache storage
✓ should enqueue outbox events only on success
```

**Why it matters**: Ensures failed operations don't pollute the idempotency cache. Retries can re-attempt, but successful results are only cached on success.

---

### 4. `kyc-gate.spec.ts` (10 tests)
**What it tests**: KYC tier verification before voting

**Scenario**: Tier 0 user tries to vote in Tier 2 contest → blocked. Tier 2 user → allowed.

**Tests**:
```typescript
✓ should allow user with sufficient tier
✓ should block user with insufficient tier
✓ should allow vote when contest has no tier requirement
✓ should handle user not found (404)
✓ should handle contestant not found (404)
✓ should handle tier levels 0-5 with correct gating
✓ getUserKycTier: returns user tier
✓ getContestKycRequirement: returns requirement
✓ should handle database errors gracefully
```

**Tier Levels**:
- 0: Unverified (basic email)
- 1: Phone verified
- 2: Email + phone
- 3: KYC (ID verified)
- 4: Advanced KYC (address, occupation)
- 5: Enhanced KYC (source of funds)

**Why it matters**: Ensures users meet contest eligibility requirements before voting. Prevents unverified accounts from voting in restricted contests.

---

### 5. `feature-flag.spec.ts` (12 tests)
**What it tests**: Gradual feature rollout control

**Scenario**: VOTES_BRIDGE_ENABLED env var controls whether bridge is active. Enables canary deployments and rollback.

**Tests**:
```typescript
✓ should default to disabled for gradual rollout
✓ should read VOTES_BRIDGE_ENABLED environment variable
✓ should support manual enable/disable/reset
✓ should support per-user feature flags (foundation for LaunchDarkly)
✓ getBridgeRolloutPercentage: returns rollout %
✓ should support 0% rollout (all users on legacy)
✓ should support 100% rollout (all users on bridge)
✓ should allow canary deployment (partial rollout)
✓ should prefer environment variable over cached value
✓ should allow temporary enable for testing
✓ should allow temporary disable for compatibility testing
✓ production rollout phases: deploy → canary → full → deprecate
```

**Rollout Phases**:
1. **Phase 0**: Deploy with `VOTES_BRIDGE_ENABLED=false` (all legacy)
2. **Phase 1**: Canary `VOTES_BRIDGE_ENABLED=true` for 10% (via LaunchDarkly)
3. **Phase 2**: Expand to 50% of users
4. **Phase 3**: Full rollout 100% of users
5. **Phase 4**: Deprecate legacy engine after 2 weeks stability

**Why it matters**: Safe production deployment. Can enable/disable without redeploying. Easy rollback if issues arise.

---

## Running Tests

### Run all bridge tests:
```bash
npm run test -- tests/unit/voting/
```

### Run specific test file:
```bash
npm run test -- tests/unit/voting/free-vote-concurrency.spec.ts
npm run test -- tests/unit/voting/paid-vote-concurrency.spec.ts
npm run test -- tests/unit/voting/bridge-saga.spec.ts
npm run test -- tests/unit/voting/kyc-gate.spec.ts
npm run test -- tests/unit/voting/feature-flag.spec.ts
```

### Run with coverage:
```bash
npm run test -- tests/unit/voting/ --coverage
```

### Watch mode (for development):
```bash
npm run test -- tests/unit/voting/ --watch
```

---

## Test Framework

**Framework**: Vitest 4.1  
**Assertions**: Expect (built-in)  
**Mocking**: `vi.mock()` for Supabase client  

### Key Mocking Patterns

**Mocking Supabase**:
```typescript
import { createAdminClient } from '@/lib/supabase/admin';
import { vi } from 'vitest';

vi.mock('@/lib/supabase/admin');

const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValueOnce({ data, error }),
};

(createAdminClient as any).mockReturnValue(mockSupabase);
```

**Simulating Concurrency**:
```typescript
// Send two requests concurrently
const [result1, result2] = await Promise.all([
  bridgedCastFreeVote(...),
  bridgedCastFreeVote(...),
]);
```

**Simulating Failures**:
```typescript
mockSupabase.single.mockResolvedValueOnce({
  data: null,
  error: { message: 'Database error' },
});
```

---

## Test Results

### Expected Passes
All 41 tests should pass:
- Free vote concurrency: 6 tests ✓
- Paid vote concurrency: 6 tests ✓
- Bridge saga: 7 tests ✓
- KYC gate: 10 tests ✓
- Feature flag: 12 tests ✓

### Failure Diagnostics

**If free vote tests fail**:
- Check idempotency cache implementation
- Verify `bridge_idempotency_keys` table exists
- Check X-Idempotency-Key header parsing

**If paid vote tests fail**:
- Check `lock_vote_transaction` RPC exists
- Verify SELECT FOR UPDATE lock on vote_transactions
- Check vote_credit_status enum values

**If KYC gate tests fail**:
- Verify profiles table has kyc_tier column
- Check competitions table has required_kyc_tier column
- Verify tier level validation (0-5)

**If feature flag tests fail**:
- Check VOTES_BRIDGE_ENABLED env var parsing
- Verify enableBridge() / disableBridge() override logic
- Check resetBridge() clears cached state

---

## Continuous Integration

Add to CI/CD pipeline:

```yaml
- name: Run vote bridge tests
  run: npm run test -- tests/unit/voting/
  
- name: Check test coverage
  run: npm run test -- tests/unit/voting/ --coverage
  
- name: Verify no skipped tests
  run: npm run test -- tests/unit/voting/ --forbid.skip
```

---

## Pre-Merge Checklist

- [ ] All 41 tests pass
- [ ] Coverage > 90% (critical path)
- [ ] No `.only()` tests left
- [ ] No pending `.skip()` tests
- [ ] Mocks clean up after each test
- [ ] No console errors/warnings
- [ ] Tests run in < 10 seconds
- [ ] Tests work on CI environment

---

## Future Test Enhancements

- [ ] Integration tests with real Supabase
- [ ] Performance tests (latency benchmarks)
- [ ] Load tests (1000s concurrent votes)
- [ ] Chaos tests (random failures, network delays)
- [ ] A/B testing of bridge vs legacy
- [ ] Security tests (SQL injection, XSS in idempotency keys)

---

## Related Documentation

- `docs/adr/ADR-037-vote-bridge-idempotency.md` — Architecture & race condition fixes
- `docs/adr/ADR-038-vote-engine-deprecation.md` — Production migration plan
- `frontend-web/src/server/voting-bridge/README.md` — Bridge implementation guide
- `VOTE_BRIDGE_IMPLEMENTATION.md` — Deployment checklist
