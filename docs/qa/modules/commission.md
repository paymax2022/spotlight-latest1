# Module: Commission & Profit

**Risk tier:** 1 &nbsp;·&nbsp; **Money-path:** yes (realized-earnings ledger recognition) &nbsp;·&nbsp; **Feature flag:** `FEATURE_COMMISSION_ENABLED`
**Code:** `backend/internal/finance/commission/` (`routes.go`, `handler.go`, `service.go`, `model.go`, `recorder.go`, `repository.go`); mounted via `commission.RegisterCommission(...)` in `backend/internal/app/finance_routes.go`
**Slug:** `COMMISSION` (uppercase, used in Case IDs)

## 1. Overview & scope

Commission is the **central rate registry + fee calculator + realized-earnings ledger** — the source of truth for what Spotlight earns on every service. It holds an audited config table (per `service_category/service/subtype`: commission bps, platform-charge bps, convenience + fixed kobo, fee model, fee payer), a pure fee-math core (`computeBreakdown`, integer kobo/bps with **floor division**, no floats), and an idempotent `RecordEarning`/`RecordExact` path that appends an immutable earning row and (when a ledger is wired) recognizes revenue `DR provider_clearing → CR commission`. Config writes require RBAC `finance.commission.manage`; reads/calculate require `finance.commission.read`. Cross-cutting: `../cross-cutting/money-invariants.md` (floor-division / no-float), `../cross-cutting/rbac-and-permissions.md`, `../cross-cutting/feature-flags-and-audit.md` (config-mutation audit).

## 2. Services / endpoints in scope

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| List config | `GET /api/finance/commission/config?category&active` | `finance.commission.read` | no |
| Create config | `POST /api/finance/commission/config` | `finance.commission.manage` | no (audited) |
| Update config | `PUT /api/finance/commission/config/:id` | `finance.commission.manage` | no (audited) |
| Toggle active | `POST /api/finance/commission/config/:id/toggle` | `finance.commission.manage` | no (audited) |
| Calculate fee | `POST /api/finance/commission/calculate` | `finance.commission.read` | no |
| Profit report | `GET /api/finance/commission/report?from&to&groupBy` | `finance.commission.read` | no |
| List earnings | `GET /api/finance/commission/earnings?from&to&category&limit` | `finance.commission.read` | no |
| Record earning (lib) | `RecordEarning(ctx, EarningInput, idemKey)` | library (source modules) | yes |
| Record exact fee (lib) | `RecordExact(ctx, cat, svc, sub, gross, revenue, mod, ref, uid, idemKey)` | library | yes |

Fee math (`computeBreakdown`): `commission = gross*commissionBps/10000` (floor); `platformCharge = gross*platformChargeBps/10000` (floor); `spotlightRevenue = commission + platformCharge + convenience + fixed`; `customerTotal = gross + convenience + fixed (+ platformCharge only when feePayer=customer)`.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Fee breakdown (bps floor division) | unit | — (no `_test.go` in package) | TODO |
| Earning idempotency (dup key → same row) | inv | — | TODO |
| Revenue recognition DR clearing → CR commission | inv | — | TODO |
| Config mutation audited (before/after) | int | — | TODO |
| RBAC read vs manage split | authz | — | TODO |
| fee_model/fee_payer validation | con | — (validated in handler) | TODO |

> Commission ships with **no `_test.go` in the package** — all rows are gaps. The pure `computeBreakdown` core is highly testable and should be the first spec.

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `COMMISSION-UNIT-001` | Commission bps floor division | P0 | active config commissionBps=250 | `POST /calculate` gross `100_000` | 2.5% | `commissionKobo = 100000*250/10000 = 2500` (floor) |
| `COMMISSION-UNIT-002` | Floor division rounds down | P0 | commissionBps=333 | `calculate` gross `100_003` | odd | `100003*333/10000 = 3330` (floor, remainder dropped) |
| `COMMISSION-UNIT-003` | Platform charge + convenience + fixed sum | P0 | config with all four | `calculate` gross `500_000` | mixed | `spotlightRevenue == commission+platformCharge+convenience+fixed`; kobo-exact |
| `COMMISSION-UNIT-004` | feePayer=customer adds platform charge | P1 | config feePayer=customer, platform bps | `calculate` | — | `customerTotal` includes platformCharge; provider payer → excludes it |
| `COMMISSION-UNIT-005` | Zero gross | P1 | active config | `calculate` gross `0` | 0 | All-zero breakdown; no error |
| `COMMISSION-UNIT-006` | Negative gross rejected | P0 | — | `calculate` gross `-1` | negative | 400 `gross amount must be non-negative` |
| `COMMISSION-CON-001` | No active config → 404 | P1 | no config for key | `calculate` unknown service | — | 404 `no active config for service` |
| `COMMISSION-CON-002` | Invalid fee_model/fee_payer | P1 | manage perm | `POST /config` fee_model=`weird` | invalid | 400 `invalid fee_model or fee_payer` |
| `COMMISSION-INV-001` | RecordEarning idempotent | P0 | active config, ledger wired | `RecordEarning` twice same key | same key | 2nd returns original row; no duplicate earning; no double ledger post — MONEY-INV-006 |
| `COMMISSION-INV-002` | Earning breakdown derived server-side | P0 | active config | `RecordEarning(gross)` | — | Breakdown from resolved config, never caller-supplied (input has no fee fields) |
| `COMMISSION-INV-003` | Revenue recognition balanced | P0 | ledger wired, revenue>0 | `RecordEarning` | — | `DR provider_clearing → CR commission` for `spotlightRevenue`; `ledger_ref` stored on row |
| `COMMISSION-INV-004` | RecordExact writes exact fee | P0 | fixed-fee module (FX/transfers) | `RecordExact(gross, revenue=5000)` | 5000 | Row `spotlight_revenue_kobo=5000` (attributed to platform_charge); not `%×gross` |
| `COMMISSION-INV-005` | Missing idempotency key rejected | P0 | — | `RecordEarning` empty key | "" | Error `idempotency key required` — MONEY-INV-008 |
| `COMMISSION-INV-006` | Ledger failure does not orphan earning | P0 | ledger post fails | `RecordEarning` | — | Returns error; no earning row claiming a ledger_ref it never got |
| `COMMISSION-AUTHZ-001` | Read denied w/o read perm | P0 | user w/o perm | `GET /commission/config` | — | 403 `forbidden` — RBAC-AUTHZ-001 |
| `COMMISSION-AUTHZ-002` | Create denied w/o manage perm | P0 | holds read only | `POST /commission/config` | — | 403 (manage required, not read) |
| `COMMISSION-AUTHZ-003` | Manage allowed w/ perm | P0 | holds `finance.commission.manage` | `POST /commission/config` valid | — | 201; config saved |
| `COMMISSION-AUTHZ-004` | RBAC fail-closed on error | P0 | force CheckPermission error | any config route | — | 403 (never allow-on-error) — RBAC-AUTHZ-004 |
| `COMMISSION-INT-001` | Config create/update audited | P1 | manage perm | create then update a config | — | Audit rows with before/after + changedBy (`../cross-cutting/feature-flags-and-audit.md`) |
| `COMMISSION-INT-002` | Update non-existent config | P2 | manage perm | `PUT /config/:bogus` | bogus id | 404 `config not found` (`ErrConfigNotFound`) |
| `COMMISSION-SEC-001` | Flag off → routes not mounted | P0 | `FEATURE_COMMISSION_ENABLED` off | `GET /commission/config` | — | 404 (RegisterCommission returns early) — FLAG-SEC-001 |
| `COMMISSION-SEC-002` | Report date-range validation | P2 | read perm | `GET /report?from=notadate` | bad | 400 `invalid 'from' date` |

## 5. State-machine transitions

Not applicable — no FSM. Config rows have an `active` boolean toggled via `ToggleConfig`; earnings are append-only immutable rows.

## 6. Security & abuse cases

- **RBAC read vs manage split (`COMMISSION-AUTHZ-001/002/003`):** reads/calculate need `finance.commission.read`; config writes need `finance.commission.manage`; deny-by-default + fail-closed (`COMMISSION-AUTHZ-004`) — `../cross-cutting/rbac-and-permissions.md`.
- **Server-side fee derivation (`COMMISSION-INV-002`):** the earning breakdown always comes from the resolved config, never the caller — a source module cannot inflate/deflate its own recorded profit.
- **Floor division / no-float (`COMMISSION-UNIT-001/002`):** all bps math is integer floor division — `../cross-cutting/money-invariants.md` I1.
- **Idempotent earnings (`COMMISSION-INV-001/005`):** immutable append-only table + idempotency key; ledger recognition posted before the row so `ledger_ref` is never claimed falsely (`COMMISSION-INV-006`).
- **Config-mutation audit (`COMMISSION-INT-001`):** every create/update/toggle appends a before/after audit entry with `changedBy`.

## 7. Automated specs to add

- `internal/finance/commission/service_test.go` — table-driven `computeBreakdown`: bps floor division, feePayer branches, zero/negative gross, convenience+fixed sums (COMMISSION-UNIT-001..006). Pure-logic, no DB — highest priority since the package has zero tests.
- `internal/finance/commission/earning_test.go` — fake ledger seam: idempotent `RecordEarning`/`RecordExact`, balanced recognition, ledger-failure-no-orphan (COMMISSION-INV-001..006).
- `internal/finance/commission/handler_test.go` — RBAC read/manage split + fee_model/fee_payer validation + report date parsing (COMMISSION-AUTHZ-*, CON-002, SEC-002).

## 8. Coverage target & exit criteria

Tier-1: pure-logic ≥ 80% (fee math is the critical path). Exit: `computeBreakdown` proven kobo-exact across bps/floor/fee-payer cases; earning idempotency + balanced recognition proven; RBAC read/manage split + fail-closed proven; config mutations audited; flag-off returns 404. A mis-stated fee breakdown or a non-idempotent earning is a release blocker.
