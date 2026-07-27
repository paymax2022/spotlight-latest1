# Module: Property Management Suite

**Risk tier:** 1 &nbsp;·&nbsp; **Money-path:** no (read-only aggregation over estate/realtor money tables; owns no ledger mutation) &nbsp;·&nbsp; **Feature flag:** `FEATURE_PROPERTY_SUITE_ENABLED` (config field `FeaturePropertySuiteEnabled`, default `false`)
**Code:** `backend/internal/property/context.go`, `backend/internal/property/handler.go`, `backend/internal/property/rentpassport.go`; routes in `backend/internal/app/finance_routes.go` (lines 1138–1162). No `*_test.go` present in the module or `backend/tests`.
**Slug:** `PROPERTY` (uppercase, used in Case IDs)

## 1. Overview & scope

The Property Management suite is a read-mostly unification umbrella that turns the existing estate (visitor access) module and the realtor agency/portfolio plane into sub-modules under a single `/api/finance/property` surface. It exposes three capabilities: (a) **role context** — an aggregation of the caller's role assignments across estates, individual properties, and agencies, derived by reading existing tables only (`estate_residents`, `estates.admin_id`, `estate_properties`, `realtor_portfolios`); (b) **active-context switch** — a metadata-only upsert into `property_active_context` guarded by a fail-closed membership check; and (c) the **rent passport** — a portable, read-only trust profile (score 0–100, on-time ratio, lifetime paid in kobo) computed from historical successful rent/dues payments across the estate and realtor money paths.

Per the package doc the module **owns no money path**: `TotalPaidKobo` and per-payment `AmountKobo` are read as integer kobo out of `estate_payments` / `realtor_payments` and never mutated. All context/passport reads for the caller's own data are scoped to the authenticated `user_id` (set by the `mapsAuth` wrapper, which applies `RequireAuthContext`). The cross-user screening lookup is RBAC-gated by `RequirePermission(rbac, "property.manage")`. Testing priorities: object-level authorization (the lookup endpoint is a screening view of *another* user's payment history — IDOR/permission enforcement is the top risk), fail-closed membership on context switch, deterministic score computation, and flag-off routing.

Cross-cutting files that apply: `../cross-cutting/authentication.md`, `../cross-cutting/rbac-and-permissions.md`, `../cross-cutting/feature-flags-and-audit.md`. Kobo integrity references `../cross-cutting/money-invariants.md` even though this module only *reads* those amounts.

## 2. Services / endpoints in scope

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| Get role context (self) | `GET /api/finance/property/context` | `mapsAuth` (`RequireAuthContext`), owner-scoped to `user_id` | no |
| Switch active context | `POST /api/finance/property/context/switch` | `mapsAuth`, owner-scoped; fail-closed membership check in `SwitchContext` | no |
| Get own rent passport | `GET /api/finance/property/rent-passport/me` | `mapsAuth`, owner-scoped to `user_id` | no (read-only over money tables) |
| Lookup another user's rent passport | `GET /api/finance/property/rent-passport/lookup/:userId` | `mapsAuth` + `RequirePermission(rbac, "property.manage")` | no (read-only over money tables) |

Request/enum surface:
- `SwitchContext` body: `{ "contextType": <string, required>, "contextId": <string, required>}`. Valid `contextType` (`validContextTypes`): `estate` \| `property` \| `agency` \| `org`.
- Aggregated roles per entity: `resident`, `estate_admin`, `landlord`, `tenant`, `agency_owner` (merged, de-duplicated).
- `RecentPayment.Source`: `estate` \| `realtor`. `Category`: `rent` \| `service_charge` \| `lease` \| `other` (estate invoice category, `other` fallback; realtor rows hard-coded `lease`). `recentPayments` capped at 20, most-recent-first.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| `computeRentScore` formula (base + tenure, clamp, comparable==0 ⇒ 0) | UNIT | — | TODO |
| Role merge / de-dup across estate + property + agency sources | UNIT | — | TODO |
| `TotalPaidKobo` = exact integer-kobo sum, no float drift | INV | — | TODO |
| On-time ratio excludes rows with NULL due date | INV | — | TODO |
| Context switch rejects a context the caller has no role in (fail-closed) | AUTHZ | — | TODO |
| Lookup requires `property.manage`; denied caller blocked | AUTHZ | — | TODO |
| Realtor-schema-absent tolerance (estate-only deployment) | INT | — | TODO |
| Endpoints 404/absent when `FEATURE_PROPERTY_SUITE_ENABLED=false` | SEC | — | TODO |
| Full request→response over live DB | E2E | — | TODO |

No automated coverage exists today — every row is MANUAL/TODO until the specs in §7 land.

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `PROPERTY-INT-001` | Context aggregates all four sources | P0 | Flag on; user is a resident of estate E1, `admin_id` of estate E2, landlord of property P1, tenant of P2, owner of agency A1 | `GET /context` | user with rows in `estate_residents`, `estates`, `estate_properties`, `realtor_portfolios` | 200; `contexts` has E1(roles⊇resident), E2(estate_admin), P1(landlord), P2(tenant), A1(agency_owner); each entity appears once |
| `PROPERTY-UNIT-002` | Dual role on one entity merges, not duplicates | P1 | User is both landlord and tenant of same property P3, and both resident + admin of E1 | `GET /context` | landlord_id=tenant_id=user on P3; resident row + admin_id on E1 | P3 entity has roles `[landlord, tenant]`; E1 has `[resident, estate_admin]`; no duplicate entity keys |
| `PROPERTY-INT-003` | Empty graph returns empty contexts | P2 | Fresh user with no property relationships | `GET /context` | user with zero rows anywhere | 200; `contexts: []`; `activeContext: null` |
| `PROPERTY-INT-004` | Active context echoed when persisted | P1 | User has a `property_active_context` row for estate E1 | `GET /context` | existing active-context row | 200; `activeContext: {type:"estate", id:E1}` |
| `PROPERTY-AUTHZ-005` | Switch into a held context succeeds | P0 | Flag on; user holds landlord role on property P1 | `POST /context/switch` `{contextType:"property", contextId:P1}` | valid membership | 200; `activeContext:{type:"property",id:P1}`; upsert row present with `updated_at` bumped |
| `PROPERTY-AUTHZ-006` | Switch into a NON-held context is fail-closed | P0 | User holds NO role in agency A9 | `POST /context/switch` `{contextType:"agency", contextId:A9}` | A9 not in caller's contexts | 403 `caller has no role in agency A9`; no row written/changed |
| `PROPERTY-VAL-007` | Invalid contextType rejected | P1 | Flag on, authed | `POST /context/switch` `{contextType:"vehicle", contextId:X}` | type ∉ {estate,property,agency,org} | 403/400; `invalid context_type "vehicle"`; no write |
| `PROPERTY-VAL-008` | Missing contextId / contextType rejected | P1 | Flag on, authed | `POST /context/switch` `{}` and `{contextType:"estate"}` | binding `required` violated | 400 (bind error); no write |
| `PROPERTY-UNIT-009` | Rent score = 0 for user with no comparable payments | P0 | User has zero successful payments, or only payments with NULL due date | `GET /rent-passport/me` | comparable==0 | 200; `score:0`, `onTimeRate:0`; `paymentsCount` may be >0 but score stays 0 (fail-closed, absence ≠ good credit) |
| `PROPERTY-UNIT-010` | Perfect punctuality + long tenure scores near 100 | P1 | User with all payments on/before due date, oldest tenancy > 30 months | `GET /rent-passport/me` | onTimeRate=1.0, months≥30 ⇒ tenure=10 | 200; `score:100` (base round(1.0×90)=90 + tenure 10, clamped) |
| `PROPERTY-INV-011` | TotalPaidKobo is exact integer-kobo sum | P0 | User with successful estate payment 150000 kobo + realtor payment 2500000 kobo | `GET /rent-passport/me` | amounts in kobo | `totalPaidKobo:2650000` exactly; no rounding/float; `amountKobo` per row echoes source integer |
| `PROPERTY-INT-012` | recentPayments capped at 20, most-recent-first | P2 | User with 25 successful payments | `GET /rent-passport/me` | 25 rows | `recentPayments` length 20; ordered by `paidAt` desc; `paymentsCount:25` (count is uncapped) |
| `PROPERTY-INT-013` | Realtor schema absent is tolerated | P1 | Estate-only deployment (no realtor tables) | `GET /rent-passport/me` for user with estate payments | realtor query errors | 200; passport built from estate history only; no 500 |
| `PROPERTY-AUTHZ-014` | Lookup allowed for `property.manage` holder | P0 | Caller has `property.manage`; target userT has payment history | `GET /rent-passport/lookup/:userT` | RBAC granted | 200; passport of userT (screening view), scoped to `:userId` param not caller |
| `PROPERTY-AUTHZ-015` | Lookup denied without permission (IDOR guard) | P0 | Caller lacks `property.manage` | `GET /rent-passport/lookup/:userT` | RBAC denied | 403/permission-denied per `../cross-cutting/rbac-and-permissions.md`; no passport body leaked |
| `PROPERTY-SEC-001` | All routes gone when flag off | P0 | `FEATURE_PROPERTY_SUITE_ENABLED=false` | Call each of the 4 endpoints | flag off | Routes not registered → 404; see `../cross-cutting/feature-flags-and-audit.md` |
| `PROPERTY-SEC-002` | Unauthenticated request rejected | P0 | Flag on; no/invalid bearer token | `GET /context`, `GET /rent-passport/me` | `user_id` empty | 401 `authentication required`; see `../cross-cutting/authentication.md` |

## 5. State-machine transitions

No explicit FSM. Active-context selection (`property_active_context`) is a single-row per-user metadata upsert (`ON CONFLICT (user_id) DO UPDATE`), not a status machine — there are no states, events, or terminal transitions to enumerate. The only state rule is the fail-closed membership precondition, covered by `PROPERTY-AUTHZ-005/006`.

## 6. Security & abuse cases

- **Object-level authz on lookup (top risk):** `/rent-passport/lookup/:userId` returns *another* user's payment history and trust score. Enforcement is `RequirePermission(rbac, "property.manage")` only — there is no per-target ownership relationship checked. Verify: (1) denied caller blocked (`PROPERTY-AUTHZ-015`); (2) a granted operator cannot be tricked into leaking via path injection on `:userId`; (3) no passport body on the error path. Defer permission-matrix specifics to `../cross-cutting/rbac-and-permissions.md`.
- **Fail-closed context switch:** membership is re-derived from `GetContext` inside `SwitchContext`, so a forged `contextId` for an entity the caller has no role in must 403 (`PROPERTY-AUTHZ-006`). Do not trust client-supplied `contextType`/`contextId` beyond the enum + membership check.
- **Injection on inputs:** `contextType`/`contextId` and `:userId` flow into parameterized pgx queries (`$1`, cast `::TEXT`) — assert no SQL injection via crafted ids; malformed UUID should error cleanly, not 500 with a stack.
- **Kobo integrity (read side):** amounts are surfaced as integer kobo; assert no float coercion or precision loss in `totalPaidKobo`/`amountKobo` (`PROPERTY-INV-011`). Reference `../cross-cutting/money-invariants.md`.
- **Fail-closed on dependency error:** estate-payments query failure returns an error (no partial passport); realtor-query failure is deliberately tolerated as "no history" (`PROPERTY-INT-013`) — confirm this asymmetry is intended and does not silently zero a user's estate score.
- **Flag gate & audit:** flag-off removes the whole surface (`PROPERTY-SEC-001`). Auth gate (`PROPERTY-SEC-002`). See `../cross-cutting/feature-flags-and-audit.md`. Note: this read-only module emits no audit events itself — screening-lookup auditing, if required, is a gap to raise.

## 7. Automated specs to add

- `backend/internal/property/rentpassport_test.go` — table-driven unit tests for `computeRentScore` (comparable==0⇒0; base rounding at R=0.5; tenure buckets at 6/12/…/30+ months; clamp at 100; negative guard). Pure logic, no DB. **TODO**
- `backend/internal/property/context_test.go` — role merge/de-dup logic and `validContextTypes` gate; drive `GetContext`/`SwitchContext` against a seeded live DB behind `TEST_DATABASE_URL` (per `backend/tests/TEST_STRATEGY.md`). **TODO**
- `backend/tests/property_authz_test.go` — integration authz: `property.manage` allowed vs denied on the lookup endpoint; fail-closed context switch; flag-off 404. Follow the existing finance module integration convention. **TODO**
- `backend/tests/property_money_invariant_test.go` — INV: `totalPaidKobo` exact-sum over seeded estate+realtor payments; on-time ratio excludes NULL-due rows; recentPayments cap=20. **TODO**

## 8. Coverage target & exit criteria

Tier 1 target: ≥ 75% line coverage on pure logic (`computeRentScore`, role merge, `validContextTypes` gate) once §7 unit specs land; authz and flag paths covered by integration specs. Exit criteria before release-ready: **P0 cases must pass** — `PROPERTY-INT-001`, `PROPERTY-AUTHZ-005/006`, `PROPERTY-UNIT-009`, `PROPERTY-INV-011`, `PROPERTY-AUTHZ-014/015`, `PROPERTY-SEC-001/002`. Specifically, the lookup endpoint must be proven fail-closed against callers lacking `property.manage`, and context switch must be proven fail-closed against non-held contexts, before the flag is enabled in any environment carrying real payment data.
