# Paymax × Spotlight — Test Strategy & Coverage Gates

Owner: QA Engineering. Status: living document.

This is the contract for *what we test, where, and what must be green before a
merge or deploy*. It implements the QA-engineering skill's pyramid for this repo.

## The pyramid (apply per change)

```
              ╱ e2e ╲            few — whole-journey smoke (admin RBAC, topup→spend)
            ╱─────────╲
          ╱ integration ╲        some — DB queries, handlers+DB, webhook handlers,
        ╱─────────────────╲             provider adapters (mocked at network edge)
      ╱     unit (most)     ╲     many — pure logic: ledger projection, fee/split
    ╱─────────────────────────╲          math, tier limits, state machines, RBAC scope
```

Anti-pattern to avoid: the ice-cream cone (mostly slow e2e). Push logic down.

## What to test, and at which level

| Concern | Level | Where it lives today |
|---|---|---|
| Ledger double-entry / balance projection | unit | `backend/tests/ledger_invariants_test.go` (DB-free reference model) |
| Idempotency replay + same-key single-row | unit | `backend/tests/ledger_invariants_test.go` |
| Reversal-on-failure restores balance | unit | `backend/tests/ledger_invariants_test.go` |
| No-float / positive-integer kobo | unit | `backend/tests/ledger_invariants_test.go`, `frontend-web/.../money-invariants.spec.ts` |
| Settlement split conservation (payout math) | unit | `backend/tests/settlement_split_test.go` |
| Transfer fee schedule (boundaries) | unit | `backend/tests/transfer_fees_example_test.go`, `internal/finance/transfers/fee_test.go` |
| Tier limit config | unit | `internal/finance/tiers/service_test.go` |
| RBAC scope isolation + deny-by-default (personas) | integration | `internal/middleware/authorization_personas_test.go` |
| RBAC service guards (last super-admin, system role/perm) | unit | `internal/services/rbac_service_test.go` |
| API DTO ↔ openapi shape/enum | contract | `backend/tests/contract_finance_test.go` |
| Webhook HMAC verification | unit | `frontend-web/.../money-invariants.spec.ts` |

### Still owed (gaps — see "Coverage gaps" at bottom)
- **DB integration tests** for `ledger`, `transfers`, `settlement`, `tiers`
  against a real Postgres (testcontainers / `supabase db reset`). The DB-free
  reference model in `ledger_invariants_test.go` is the executable spec these
  must satisfy, but it does not exercise the actual SQL / unique constraints /
  advisory locks.
- **Tier fail-closed at the DB seam**: `EnforceWalletDebitLimit` returning an
  error (and therefore blocking) when the tier lookup or daily-debit query fails
  is asserted only at the config level; the DB-error branch needs an integration
  test with a faked/erroring pool.
- **Concurrent same-key at the DB level**: the in-memory test proves the logic;
  a real test must fire N goroutines at the unique constraint + advisory lock.
- **e2e**: admin RBAC operations, and a wallet topup→spend→statement journey.

## Critical paths (deepest coverage — never ship these red)

1. **Money movement** — topup, wallet transfer, bank transfer, settlement,
   reversal. Invariants: balanced double-entry, balance == ledger projection,
   no overdraw, idempotent, integer kobo, reversal restores prior balance.
2. **Authorization** — deny-by-default, scope isolation (a grant in scope A must
   not leak to scope B), last-super-admin / system-role / system-permission
   protection, critical-permission assignment restricted to super-admin.
3. **Auth/session** — token validation, suspended/locked accounts blocked.
4. **Webhooks** — HMAC verification; idempotent application of provider events.

## Test data & isolation

- Tests create the state they need; no order dependence, no shared mutable
  fixtures, no real PII. Money tests use synthetic kobo amounts.
- DB integration tests run against an ephemeral database — see the live-DB gate
  below.

## Live-DB suites: the `TEST_DATABASE_URL` gate

46 test files across 26 packages talk to a real Postgres, gated on
`TEST_DATABASE_URL`. Three rules keep them honest:

**1. Gate on `TEST_DATABASE_URL` only — never fall back to `DATABASE_URL`.**
The root `.env` points `DATABASE_URL` at the PRODUCTION Supabase pooler, and
these suites INSERT fixtures and move money. A fallback writes to production.

```go
dsn := os.Getenv("TEST_DATABASE_URL")
if dsn == "" {
    t.Skip("TEST_DATABASE_URL not set — skipping live-DB test")
}
```

This is now enforced: `scripts/ci/check-live-db-gate.sh` fails the build if any
`*_test.go` under `backend/` reads `os.Getenv("DATABASE_URL")`, and runs on every
PR from `ci.yml`. Module-specific test vars (`MARKETPLACE_TEST_DATABASE_URL`,
`DOCTOR_TEST_DATABASE_URL`) are fine — only bare `DATABASE_URL` is rejected.
Non-test code (`cmd/` binaries) reads it legitimately and is not scanned.

Until 2026-08-14, 48 of the 49 live-DB test files reached `DATABASE_URL`: 44 as a
fallback, and 4 under `internal/trading` (including 5 money-path tests) with no
test-var escape at all. All now gate on `TEST_DATABASE_URL` alone.

The fallback also hid the failure mode this section exists to prevent. Because CI
set only `DATABASE_URL`, the two suites that correctly declined to fall back —
`internal/savings` (9 tests) and `internal/handlers` (24 admin-console tests) —
skipped silently and gated nothing, for months. Nobody noticed until someone set
`TEST_DATABASE_URL` and watched them fail — the admin-console suite still carried
mock-era assertions and expected rows only a developer's populated database had,
and three of the store queries behind it had been 500ing in production the whole
time. Which brings us to rule 2.

**2. Self-seed. Never depend on ambient rows.**
A suite that expects rows a developer happened to have is a suite that skips in
CI and fails the day someone runs it for real. Create fixtures with fresh UUIDs
per run and assert against *those*:

- Seed `auth.users (id, email, created_at)` for anything user-scoped. `email` is
  required (an `on_auth_user_created` trigger mirrors into `user_profiles`, whose
  `email` is NOT NULL) — use an RFC 2606 `.invalid` address. Set `created_at`
  explicitly: real Supabase declares it with **no default**, and NULL sorts
  differently from `now()` under `ORDER BY ... DESC`.
- Reference pattern: `internal/savings/list_balance_live_db_test.go`,
  `internal/savings/balance_authz_penalty_live_db_test.go`, and
  `internal/handlers/admin_console_handler_test.go` (global, unscoped reads).

**3. For GLOBAL reads, assert presence — not counts.**
Endpoints that read every user / payout / audit row have no owner to scope to,
and `go test ./...` runs packages concurrently against one database. Asserting
`Len(rows, 2)` is a statement about the whole database and will flake or rot.
Seed identifiable fixtures, look them up by id, and assert their shape. Where an
aggregate must be checked, assert a lower bound, not an exact value or a
before/after delta.

Also: pair any indexed read (`rows[0]`) with `require.Len`, not `assert.Len` —
`assert` records the failure and continues, so the index panics and takes the
whole package down instead of failing one test.

**CI wiring.** `integration-verify.yml` sets `TEST_DATABASE_URL` at job level to
the same ephemeral Postgres service as `DATABASE_URL`, so `make test` runs every
live-DB suite. Reproduce locally against local Supabase — never the pooler:

```bash
cd backend && TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
  RAILS_MODE=fake go test ./... -race -count=1
```

Separate gates exist and are NOT covered by the above:
`MARKETPLACE_TEST_DATABASE_URL` (`tests/marketplace`, still unwired — several
suites skip unconditionally with a documented reason) and
`DOCTOR_TEST_DATABASE_URL` (`internal/doctor`).

## When a bug escapes

Write the failing (or `t.Skip`-with-TODO) reproducing test FIRST, tie it to the
owning module, then fix. The suite is the team's memory — every fixed bug keeps
its regression test. Drift currently tracked this way:
- `TestContract_WalletTransferStatusEnum_DRIFT` — wallet-transfer status
  `"completed"` vs openapi enum `[successful,failed,reversed]`.
- `money-invariants.spec.ts` DRIFT note — paid-vote mismatch uses naira-float
  ±₦1 tolerance instead of kobo-exact equality.

## CI quality gates (recommended)

Block **merge** on every PR:

```bash
# Backend
cd backend && go vet ./...
cd backend && go build ./...
cd backend && go test ./internal/finance/... ./internal/middleware/... \
                      ./internal/services/... ./tests/...
# Frontend
cd frontend-web && npx tsc --noEmit
cd frontend-web && npx vitest run
cd frontend-admin && npm run type-check
# Legacy safety nets (per CLAUDE.md)
npm run test:regression     # golden-path, must stay green
npm run test:money          # ledger/idempotency/limits invariants
npm run contract:check      # implementation vs contracts/openapi.yaml
```

Gate the **deploy** pipeline additionally on:
- a smoke e2e (admin login + one RBAC op + one wallet read),
- a dependency/security scan,
- once DB integration tests exist: run them against an ephemeral Postgres.

**Coverage policy:** enforce coverage *where it matters* — the money path
(`internal/finance/...`) and authorization (`internal/middleware`,
`internal/services` RBAC) — not a blanket repo percentage. Suggested floor:
ledger/transfers/settlement/tiers and the RBAC middleware/service ≥ 85% line
coverage on the pure-logic functions; do not chase coverage on trivial DTOs.

## Coverage gaps (honest list, prioritised)

1. DB integration tests for the money path (highest risk — invariants only
   proven against the reference model, not the real SQL).
2. Tier fail-closed DB-error branch.
3. Concurrent-same-key against the real unique constraint + advisory lock.
4. e2e: admin RBAC + wallet topup→spend journey.
5. Per-vertical settlement integration (telemedicine/estate/transport/restaurant)
   once those modules stabilise — currently only the split *math* is covered.
```
