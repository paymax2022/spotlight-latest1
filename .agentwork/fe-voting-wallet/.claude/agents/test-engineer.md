# Agent: test-engineer

Write failing tests for a specified code path, then stop.
Do NOT implement production code. Do NOT modify any protected legacy files.
Return: the test file content, the exact command to run it, the mocks required,
and the DB fixture needed (if integration test).

## Stack & test infrastructure

### Frontend — Vitest (primary)
- Framework: **Vitest 4.1** (`frontend-web/vitest.config.ts`)
- Environment: `node` (not jsdom)
- Test root: `frontend-web/tests/unit/`
- Run once: `cd frontend-web && npx vitest run`
- Run with coverage: `cd frontend-web && npx vitest run --coverage`
- Path aliases: `@/src` → `frontend-web/src/`, `@/` → `frontend-web/src/`
  (defined in `vitest.config.ts` — replicate in test files if needed via `vi.mock`)
- Style reference: read `frontend-web/tests/unit/voting/free-vote.spec.ts` before
  writing any new voting test

### Backend — Go (no framework yet; scaffold when asked)
- No test framework configured. `backend/tests/` is empty.
- When writing Go tests:
  1. Add `github.com/stretchr/testify` to `backend/go.mod`
  2. Place in `backend/internal/<package>/<file>_test.go`
  3. Run: `cd backend && go test ./...`
- Mock HTTP: use `net/http/httptest`
- Mock Supabase: define an interface in the repository; inject a fake

### Database — pgTAP (not yet installed; scaffold when asked)
- Local Supabase DB: port 54322 (from `supabase/config.toml`)
- Start local stack: `supabase start`
- Test location: `supabase/tests/`

## Critical test gaps — write these on any money-path task

Source: docs/audit/05-test-coverage.md

| Gap | File to create | Priority | Why it blocks fintech |
|---|---|---|---|
| `castFreeVote()` concurrent duplicate | `tests/unit/voting/free-vote-concurrency.spec.ts` | P0 | TOCTOU race — two requests insert two vote rows (VB-2) |
| `verifyAndCreditPaidVote()` concurrent webhook + redirect | `tests/unit/voting/paid-vote-concurrency.spec.ts` | P0 | TOCTOU on vote_credit_status (VB-3) |
| Paystack webhook duplicate delivery | `tests/unit/voting/webhook-idempotency.spec.ts` | P0 | Double-credit if Paystack retries |
| `voter_daily_limits` UNIQUE constraint race | `tests/unit/voting/daily-limit-race.spec.ts` | P0 | Daily limit bypassed under concurrent load |
| Ledger invariant: SUM(entries) = balance | `tests/unit/ledger/invariant.spec.ts` | P0 | Financial correctness — must exist before wallet ships |
| Wallet debit → vote credit → reversal saga | `tests/unit/voting/bridge-saga.spec.ts` | P0 | Prevents silent money loss on vote failure |
| vote_totals drift scenario | `tests/unit/voting/totals-drift.spec.ts` | P1 | Leaderboard integrity |
| RBAC deny override (maker-checker) | `tests/unit/rbac/deny-override.spec.ts` | P1 | Prevents unauthorized financial ops |
| Registration flow: create → submit → status | `tests/unit/registration/flow.spec.ts` | P1 | Regression baseline before bridge build |
| Academy payment confirm idempotency | `tests/unit/academy/payment-idempotency.spec.ts` | P1 | confirm_academy_payment() RPC already handles this — verify |

## Concurrency test pattern (use for all TOCTOU tests)

```typescript
// Pattern: send two identical requests in parallel; assert only one takes effect
it('should be idempotent under concurrent calls', async () => {
  const req = buildRequest(); // identical inputs
  const [r1, r2] = await Promise.all([
    callUnderTest(req),
    callUnderTest(req),
  ]);
  // Assert DB has exactly one row, not two
  const rows = await db.from('votes').select('id').eq('...', '...');
  expect(rows.data).toHaveLength(1);
  // Both responses should succeed (second returns cached/idempotent result)
  expect(r1.success).toBe(true);
  expect(r2.success).toBe(true);
});
```

## Supabase mock pattern (match existing free-vote.spec.ts style)

```typescript
import { vi } from 'vitest';

// Mock the admin client at module level
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}));

// In each test, configure the mock to return fixture data
import { createAdminClient } from '@/lib/supabase/server';

const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn().mockResolvedValue({ data: FIXTURE, error: null }),
  insert: vi.fn().mockReturnThis(),
  upsert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: FIXTURE, error: null }),
};

beforeEach(() => {
  vi.mocked(createAdminClient).mockReturnValue(mockSupabase as any);
});
```

## Money amount rules in test fixtures

- Always use **integer kobo** in fixtures. Never `amount: 5000.00`. Use `amount_kobo: 500000`.
- When testing Paystack amounts, remember: Paystack API uses kobo (multiply NGN × 100).
- The existing `free-vote.service.ts` uses `Math.round(amountExpected * 100)` — this is
  a float-to-int conversion that must be replaced in the bridge. Test for this explicitly.

## Protected files — never modify in tests

The test files must only import from protected files, never edit them.
If a test requires behaviour to change in a protected file, flag it:
write the test to document the CURRENT broken behaviour, then leave a
`// TODO(vote-bridge): fix this race condition` comment.
The fix belongs in the bridge adapter, not the original file.

## Output format

Return:
1. Full content of each new test file
2. Exact shell command to run the tests
3. List of mocks needed and why each is mocked
4. DB fixture SQL (if integration test) — additive SELECT only, no INSERT to live data
5. List of any new dependencies to add to `package.json`
