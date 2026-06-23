# Spotlight — Test Coverage Report
> Audit date: 2026-06-13

---

## Framework

- **Frontend:** Vitest (`frontend-web/vitest.config.ts`)
- **Backend:** No test framework configured; `backend/tests/` is empty (README.md only)

---

## Existing Test Files

### `frontend-web/tests/unit/voting/free-vote.spec.ts` (538 lines, 20 scenarios)

| # | Test Description | Passing | Notes |
|---|---|---|---|
| 1 | Rate limiter allows request within limit | ✅ Unit | |
| 2 | Rate limiter blocks request over limit | ✅ Unit | |
| 3 | Rate limiter key isolation (different users) | ✅ Unit | |
| 4 | Voting window: disabled | ✅ Unit | |
| 5 | Voting window: before start | ✅ Unit | |
| 6 | Voting window: after end | ✅ Unit | |
| 7 | Voting window: open | ✅ Unit | |
| 8 | Free votes remaining calculation (multiple edge cases) | ✅ Unit | |
| 9 | Payment amount mismatch detection | ✅ Unit | |
| 10 | Vote credit idempotency: already credited | ✅ Unit | |
| 11 | Vote credit idempotency: pending status | ✅ Unit | |
| 12 | Vote credit idempotency: failed status | ✅ Unit | |
| 13 | Vote totals formula: sum | ✅ Unit | |
| 14 | Vote totals formula: zero floor on reversals | ✅ Unit | |
| 15 | Disposable email detection (mailinator, yopmail, gmail, company domains) | ✅ Unit | |
| 16 | Leaderboard tie-breaker: total votes | ✅ Unit | |
| 17 | Leaderboard tie-breaker: paid votes | ✅ Unit | |
| 18 | Leaderboard tie-breaker: first vote chronologically | ✅ Unit | |
| 19 | Free vote reset time calculation | ✅ Unit | |
| 20 | Admin adjustment validation (reason min length, quantity > 0) | ✅ Unit | |

**Additional coverage found in spec (beyond the 20 named):**
- Paystack webhook HMAC signature verification (tamper + valid)
- Vote type enum validation
- Vote status state machine transitions
- Receipt number format (prefix, uniqueness)
- Share code generation (length, uniqueness)
- CSV export (headers, escaping, empty array)
- RBAC hasPermission logic
- Slugify function
- Voting window edge cases (exact deadline, 1ms after, no end date)
- Contest-configurable defaults (override, fallback)

---

## Coverage by Critical Path

### Registration Flow
| Test | Coverage | Gap |
|---|---|---|
| User signup → user_profiles auto-create | ❌ None | No test for trigger or backfill |
| Contest application create/submit | ❌ None | No API route test |
| File upload to R2 | ❌ None | |
| Application status transitions | ❌ None | |

### Contest Entry (Contestant)
| Test | Coverage | Gap |
|---|---|---|
| Contestant create + approval | ❌ None | |
| voting_link_slug uniqueness | ❌ None | |
| Contestant status flow | ❌ None | |

### Voting — Free
| Test | Coverage | Gap |
|---|---|---|
| Happy path: cast_free_vote() | ✅ Partial (unit, no DB) | No integration; no actual Supabase call |
| Daily limit enforcement | ✅ Unit only | Race condition between limit upsert and vote insert not tested |
| Anonymous voting (device/IP scope) | ❌ None | |
| Fraud quarantine flow | ❌ None | run_fraud_checks() RPC not tested |
| Duplicate free vote prevention | ❌ None | Missing unique constraint means this can silently fail |

### Voting — Paid
| Test | Coverage | Gap |
|---|---|---|
| initiatePaidVote() happy path | ❌ None | No unit or integration test |
| Paystack webhook verification (HMAC) | ✅ Unit | Actual webhook handler not tested end-to-end |
| verifyAndCreditPaidVote() idempotency | ✅ Unit (credit status check) | Race condition (webhook + redirect simultaneously) not tested |
| Amount mismatch detection | ✅ Unit | |
| Abandoned transaction cleanup | ❌ None | |
| Refund flow | ❌ None | |

### Leaderboard & Results
| Test | Coverage | Gap |
|---|---|---|
| vote_totals ↔ votes consistency | ❌ None | No test for drift scenario |
| recompute_leaderboard_ranks() correctness | ❌ None | |
| Tie-breaker logic | ✅ Unit | |
| Leaderboard freeze | ❌ None | |

### Auth & RBAC
| Test | Coverage | Gap |
|---|---|---|
| requireRequestUser() | ❌ None | |
| RequireAuthContext middleware | ❌ None | No backend handler tests at all |
| user_has_permission() | ✅ Unit (hasPermission helper) | Actual RPC not tested |
| Role scoping (contest, state) | ❌ None | |
| Maker-checker enforcement | ❌ None | |

### Payments (Academy)
| Test | Coverage | Gap |
|---|---|---|
| confirm_academy_payment() idempotency | ❌ None | |
| Installment plan completion trigger | ❌ None | |

---

## Backend Test Coverage

**Status: 0% — no test files exist**

All Go handler, service, repository, middleware, and integration layers are untested.

Missing:
- Auth handler tests (register, login, JWT validation)
- RBAC handler tests (role assignment, permission checks)
- Admin dashboard handler tests
- STEM endpoint tests
- Rate limiter tests (StemRateLimit)
- RequirePermission middleware tests
- Supabase client integration tests

---

## Test Gaps Blocking Fintech Build

Per PRD §10.5, these must be green before any fintech commit merges:

| Required Test | Priority | Why It Blocks Fintech |
|---|---|---|
| Golden-path E2E: registration → contest entry → voting → results | P0 | Regression detection for the voting bridge (PRD §10.3) |
| Contract test: vote-recording function signature + behavior | P0 | Bridge wraps this; must pin current behavior |
| Voting bridge: wallet debit → vote credit → compensating reversal on vote failure | P0 | Core saga correctness |
| Paystack webhook: duplicate delivery → idempotent result | P0 | Double-credit prevention |
| Concurrent free votes: race condition on voter_daily_limits | P1 | Balance integrity |
| RBAC permission check: deny override works | P1 | Maker-checker correctness |
| Ledger invariant: SUM(entries) = balance | P0 | Financial correctness |
| vote_totals drift detection | P1 | Leaderboard integrity |

---

## Recommended Test Stack

```
Frontend (existing Vitest):
  └── Add: integration tests with Supabase test instance
  └── Add: API route handler tests (MSW for external APIs)
  └── Add: E2E (Playwright) for registration + voting flows

Backend (Go):
  └── Add: testify + gomock for unit tests
  └── Add: httptest for handler integration tests
  └── Add: Docker Compose with test Supabase for DB integration

Database:
  └── Add: pgTAP for RPC/trigger tests
  └── Test: increment_vote_totals atomicity under concurrent load
  └── Test: voter_daily_limits UNIQUE constraint under concurrent upserts
```
