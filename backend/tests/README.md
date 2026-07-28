# backend/tests — cross-cutting test harness

This package holds the **cross-cutting, package-independent** Go tests for the
Paymax financial core: money-path invariants, API contract checks, the canonical
table-driven example, and pending per-vertical settlement scaffolds. Tests that
belong to a single package (e.g. a service's unit tests) live next to that
package as `*_test.go`; this directory is for tests that span packages or that
must stay decoupled from packages under active edit.

## Files

| File | Purpose |
|---|---|
| `ledger_invariants_test.go` | DB-free reference ledger; double-entry, idempotency replay + concurrent same-key, overdraw rejection, reversal-restores-balance, no-float. Executable spec for the pgx repository. |
| `settlement_split_test.go` | Payout split **conservation** invariant (platform+rider+provider == total) across amounts/percentages, incl. rounding. |
| `transfer_fees_example_test.go` | **Canonical table-driven test** (house style) pinning the transfer fee schedule boundaries. |
| `contract_finance_test.go` | API contract tests: Go DTOs ↔ `contracts/openapi.yaml` field names + status enums; documents the WalletTransfer status drift. |
| `vertical_settlement_pending_test.go` | `t.Skip`'d spec scaffolds for telemedicine/estate/transport/restaurant settlement, tied to owning modules. |
| `TEST_STRATEGY.md` | Pyramid, what-to-test-where, critical paths, CI quality gates, coverage policy, gap list. |

## Run

```bash
cd backend
go test ./tests/...                 # this harness
go test ./tests/... -v              # see every case + skips
go test ./internal/finance/... ./internal/middleware/... ./tests/...
```

Per CLAUDE.md, run **specific packages** while other modules are mid-edit; avoid
whole-tree `go test ./...` until the tree settles.

## Note on the DB-free reference ledger

`ledger_invariants_test.go` mirrors the projection logic of
`internal/finance/ledger/repository.go` because a live Postgres pool cannot be
provisioned in this lane. If the production SQL projection ever diverges from the
reference model, that is a defect — the model is the spec. Real DB integration
tests are the top item on the coverage-gap list in `TEST_STRATEGY.md`.
