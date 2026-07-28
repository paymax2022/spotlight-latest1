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
- DB integration tests (when added) must run against an ephemeral database and
  roll back / reset between tests.

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
