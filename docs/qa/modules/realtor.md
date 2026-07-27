# Module: Realtor

**Risk tier:** 1 &nbsp;·&nbsp; **Money-path:** no (the control plane posts NO ledger entries — moderation & verification are status-column updates only; payments & escrow are read-only kobo projections) &nbsp;·&nbsp; **Feature flag:** `FeatureRealtorEnabled` (env `FEATURE_REALTOR_ENABLED`, default `false`; `backend/internal/config/config.go`)
**Code:** `backend/internal/realtor/` — `routes.go`, `admin.go`, `repository.go`, `stays.go`. Mounted in `backend/internal/app/finance_routes.go`: admin control plane via `realtor.Register(r, …)` (~line 2553) at `/api/realtor/admin/*`; the stays→gate-pass bridge (~lines 1170-1192) at `/api/finance/realtor/stays/:bookingId/gate-pass`. No in-package `*_test.go` (no realtor test coverage anywhere in the repo).
**Slug:** `REALTOR` (uppercase, used in Case IDs)

## 1. Overview & scope

Realtor exposes two distinct surfaces. (1) An **admin control plane** under `/api/realtor/admin` — overview dashboard, listing-moderation queue + decision, property-verification queue + decision, and read-only payments/escrow views. Every admin route is fail-closed behind the `realtor.manage` RBAC permission (`middleware.RequirePermission`, applied group-wide after `RequireAuthContext`); grant it to Property-Ops / Trust-&-Safety / Finance / Super-Admin. The mobile/marketplace data plane (listing creation, bookings, leases, payments) is served directly from Supabase RPCs and is **out of scope** here — this Go module is control-plane + one bridge only. (2) The **stays→gate-pass bridge** (cross-cutting flow #4, "the moat flow") under `/api/finance/realtor` — a member-facing endpoint that lazily and idempotently auto-issues an estate visitor gate pass for a confirmed shortlet/hotel booking whose unit physically sits inside a managed estate, reusing the estate pass-issuance seam. This surface uses `mapsAuth()` + a **non-blocking** `estate.manage` probe (`estateStaffProbe`), not `realtor.manage`. All monetary values are BIGINT minor units (kobo); the control plane never mutates them. Cross-cutting: `../cross-cutting/authentication.md`, `../cross-cutting/rbac-and-permissions.md`, `../cross-cutting/feature-flags-and-audit.md` (money-invariants apply only weakly — no ledger writes here).

## 2. Services / endpoints in scope

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| Dashboard overview (counts + kobo aggregates) | `GET /api/realtor/admin/overview` | `realtor.manage` | no (read-only kobo projection) |
| Listing moderation queue | `GET /api/realtor/admin/listings/pending?limit=&offset=` | `realtor.manage` | no |
| Moderation decision | `POST /api/realtor/admin/listings/:id/decision` `{decision, reason}` | `realtor.manage` | no (status column only) |
| Verification queue | `GET /api/realtor/admin/verifications?limit=&offset=` | `realtor.manage` | no |
| Verification decision | `POST /api/realtor/admin/verifications/:id/decision` `{status, reason}` | `realtor.manage` | no (verification column only) |
| Payments list (read-only) | `GET /api/realtor/admin/payments?limit=&offset=` | `realtor.manage` | no (read-only) |
| Escrow list (read-only) | `GET /api/realtor/admin/escrow?limit=&offset=` | `realtor.manage` | no (read-only) |
| Booking gate-pass (auto-issue + read) | `GET /api/finance/realtor/stays/:bookingId/gate-pass` | member (token `user_id`); owner OR `estate.manage` staff (non-blocking probe) | no (issues an estate pass, not money) |

Enums: **listing decision** = `approved` \| `rejected` \| `changes_requested`; **verification status** = `approved` \| `rejected` \| `more_info`. Underlying **listing status** = `draft` / `pending_verification` / `published` / `suspended`; **verification** = `unverified` / `document_backed` / `inspected` / `verified`. **Payment status** (mapped) = `paid` / `processing` / `failed`. **Escrow status** = `held` / `release_requested` / `disputed`. **Booking status** gate for issuance = `confirmed` \| `checked_in`.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| All 7 admin routes require `realtor.manage` (fail-closed 403 without it) | authz | — | TODO |
| Admin routes require authentication (401 without token) | authz | — | TODO |
| Listing decision maps `approved→published/document_backed`, `rejected→suspended/unverified`, `changes_requested→draft/unverified` | fsm | — | TODO |
| Verification decision maps `approved→verified`, `rejected→unverified+suspended`, `more_info→no-op` | fsm | — | TODO |
| Invalid decision/status enum → 400 (server-side allow-list) | unit | — | TODO |
| Decision on non-existent id → 404 (`ErrNotFound`) | int | — | TODO |
| Every decision writes an immutable `realtor_admin_audit_log` row (before/after) | int | — | TODO |
| Overview/escrow kobo aggregates are integer-exact (COALESCE SUM, never float) | inv | — | TODO |
| Pagination `limit`/`offset` clamp (limit≤0 or >200 → default; offset<0 → 0) | unit | — | TODO |
| Gate pass issued only for `confirmed`/`checked_in` bookings inside a managed estate; idempotent on `estate_pass_id` | int | — | TODO |
| Gate pass authz: guest owner OR `estate.manage` staff; other callers → 404 (IDOR-safe) | authz | — | TODO |
| Flag-off: admin control plane + bridge not mounted | sec | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `REALTOR-INT-001` | Overview dashboard | P1 | flag on; caller has `realtor.manage`; seeded listings/leases/escrow/payments | `GET /admin/overview` | — | 200 JSON with `listingsLive`, `pendingModeration`, `pendingVerification`, `activeLeases`, `escrowHeldKobo`, `payoutsDueKobo`, `gmvKobo`, `openDisputes`, `fraudFlags`; kobo fields are integers |
| `REALTOR-INT-002` | Pending-listings queue, oldest-first | P1 | ≥3 listings `status=pending_verification` | `GET /admin/listings/pending?limit=2` | `limit=2` | 200 `{data:[…]}`; exactly 2 rows, ordered `created_at ASC`; each has `priceKobo` (int), `verification`, `submittedAt` (RFC3339) |
| `REALTOR-INT-003` | Approve a listing (happy) | P0 | listing `id=L1` status `pending_verification` | `POST /admin/listings/L1/decision {decision:"approved", reason:"looks good"}` | `approved` | 200 `{id:"L1", status:"published"}`; row now `status=published`, `verification=document_backed`; one `realtor_admin_audit_log` row (`action=listing.decision`, old vs new) |
| `REALTOR-INT-004` | Approve a verification (happy) | P0 | listing `id=L2` `verification=unverified` | `POST /admin/verifications/L2/decision {status:"approved"}` | `approved` | 200 `{id:"L2", status:"approved"}`; row now `verification=verified`; audit row (`action=verification.decision`) |
| `REALTOR-INT-005` | Payments & escrow are read-only projections | P1 | seeded `realtor_payments`, `realtor_escrow_deposits` | `GET /admin/payments`; `GET /admin/escrow` | — | 200 `{data:[…]}`; `amountKobo`/`escrowHeldKobo` integers; payment `status` mapped to `paid/processing/failed`; no state mutated; no audit row written |
| `REALTOR-VAL-001` | Invalid listing decision rejected | P1 | listing `L1` | `POST /admin/listings/L1/decision {decision:"maybe"}` | `maybe` | 400 "decision must be one of approved, rejected, changes_requested"; listing unchanged; no audit row |
| `REALTOR-VAL-002` | Invalid verification status rejected | P1 | listing `L2` | `POST /admin/verifications/L2/decision {status:"pending"}` | `pending` | 400 "status must be one of approved, rejected, more_info"; unchanged |
| `REALTOR-VAL-003` | Decision on missing listing → 404 | P1 | id not present | `POST /admin/listings/does-not-exist/decision {decision:"approved"}` | bogus id | 404 "listing not found"; no audit row (existence checked before mutate) |
| `REALTOR-UNIT-001` | Pagination clamp | P2 | queue non-empty | `GET /admin/listings/pending?limit=9999&offset=-5` | `limit=9999,offset=-5` | 200; server clamps `limit` to default 50 (≤0 or >200 ⇒ default) and `offset` to 0 |
| `REALTOR-AUTHZ-001` | Missing `realtor.manage` → denied | P0 | authed caller WITHOUT `realtor.manage` | `GET /admin/overview` (and each admin route) | — | 403 fail-closed on every admin route; no data leaked. See `../cross-cutting/rbac-and-permissions.md` (RBAC-SEC-001) |
| `REALTOR-AUTHZ-002` | Unauthenticated → 401 | P0 | no/invalid token | `GET /admin/overview` | — | 401 (`RequireAuthContext` before the permission gate); never 500 |
| `REALTOR-INT-006` | Gate pass auto-issue + idempotent | P0 | flag on; booking `B1` `status=confirmed`, unit inside managed estate; caller is booking guest | `GET /finance/realtor/stays/B1/gate-pass` twice | `B1` | 200 estate `VisitorPass` both times; `estate_pass_id` persisted on the booking after first call; second call returns the SAME pass (no duplicate issuance) |
| `REALTOR-AUTHZ-003` | Gate pass IDOR — non-owner guest denied | P0 | booking `B1` owned by user A; caller is user B, no `estate.manage` | `GET /finance/realtor/stays/B1/gate-pass` as B | `B1` | 404 "no gate pass for this booking" (owner mismatch collapses to 404; no pass revealed) |
| `REALTOR-AUTHZ-004` | Estate staff may view any booking's pass | P1 | caller holds `estate.manage`; booking `B1` guest is someone else, in a managed estate, confirmed | `GET /finance/realtor/stays/B1/gate-pass` | `B1` | 200 pass returned; `estateStaffProbe` set `property_estate_staff=true` (non-blocking) |
| `REALTOR-SEC-001` | Booking not in a managed estate → 404 | P1 | booking `B2` confirmed but unit has no `estate_id` and no override | `GET /finance/realtor/stays/B2/gate-pass` (guest) | `B2` | 404 (no pass applies); no estate pass issued |
| `REALTOR-SEC-002` | Non-live booking → no issuance | P1 | booking `B3` in estate but `status=cancelled`/`pending`, no existing `estate_pass_id` | `GET /finance/realtor/stays/B3/gate-pass` (guest) | `B3` | 404; issuance gate is `confirmed`/`checked_in` only; nothing written |
| `REALTOR-SEC-003` | Flag-off — admin plane not mounted | P0 | `FEATURE_REALTOR_ENABLED=false` | call any `/api/realtor/admin/*` route | — | 404 (routes not registered — `Register` logs skip); never 500. See `../cross-cutting/feature-flags-and-audit.md` (FLAG-SEC-001) |
| `REALTOR-SEC-004` | Flag-off — bridge not mounted | P0 | `FEATURE_REALTOR_ENABLED=false` | `GET /finance/realtor/stays/:id/gate-pass` | — | 404 (bridge group not registered). See `../cross-cutting/feature-flags-and-audit.md` (FLAG-SEC-001) |

## 5. State-machine transitions

The listing/verification decisions drive small status machines (no `statemachine.go` file — transitions live inline in `repository.go`).

| From (status/verification) | Event (decision/status) | To | Side effect | Case ID |
|---|---|---|---|---|
| `pending_verification` | listing `approved` | `published`, verification `document_backed` | audit row | `REALTOR-FSM-001` |
| `pending_verification` | listing `rejected` | `suspended`, verification `unverified` | audit row | `REALTOR-FSM-002` |
| `pending_verification` | listing `changes_requested` | `draft`, verification `unverified` | sent back to owner; audit row | `REALTOR-FSM-003` |
| verification `unverified` | verification `approved` | verification `verified` | audit row | `REALTOR-FSM-004` |
| verification `unverified` | verification `rejected` | verification `unverified`, status `suspended` | audit row | `REALTOR-FSM-005` |
| verification `unverified` | verification `more_info` | (no change) | existence-check only, no mutation, no state recorded | `REALTOR-FSM-006` |

Illegal events (`REALTOR-VAL-001`/`002`) are rejected server-side by the `isValidListingDecision`/`isValidVerificationStatus` allow-lists (400) before any UPDATE — a client cannot force an arbitrary status string. `more_info` is a benign no-op (idempotent by construction). Decisions on a missing id are rejected 404 (`REALTOR-VAL-003`) rather than silently creating a row.

## 6. Security & abuse cases

- **RBAC fail-closed:** `REALTOR-AUTHZ-001` — all 7 admin routes sit under one group-level `RequirePermission(realtor.manage)`; a caller lacking it gets 403 on every route (including reads). Reference `../cross-cutting/rbac-and-permissions.md` for the guard-gated pattern and the seeded super-admin grant (migration `20260621060000_realtor_admin_rbac.sql`).
- **Gate-pass IDOR:** `REALTOR-AUTHZ-003` — access is `booking.user_id == callerID` OR `estate.manage`; any mismatch collapses to `ErrNoGatePass` → 404, so the endpoint never confirms a booking's existence to a stranger.
- **Non-blocking staff probe:** `estateStaffProbe` must annotate only (`property_estate_staff`) and never abort — a plain guest without `estate.manage` is still served as the booking owner, not rejected. Verify it does not fail closed (`REALTOR-AUTHZ-004` vs `REALTOR-AUTHZ-003`).
- **Issuance gate:** `REALTOR-SEC-001`/`002` — a pass is issued only for a live (`confirmed`/`checked_in`) booking physically inside a managed estate; otherwise 404 with no side effect.
- **Idempotent issuance:** `REALTOR-INT-006` — the `estate_pass_id` link is persisted with `WHERE estate_pass_id IS NULL`, so concurrent/replayed reads cannot mint duplicate passes.
- **Injection on inputs:** `id`/`bookingId` flow only into parameterised pgx queries; `decision`/`status` pass a fixed allow-list — assert no SQL injection via path/body.
- **Audit integrity:** every mutation writes an immutable `realtor_admin_audit_log` row keyed to the authenticated `adminID` (from `RequireAuthContext`, not client input); reads write none. See `../cross-cutting/feature-flags-and-audit.md` (AUDIT-SEC-001).
- **No money path:** the control plane posts NO ledger entries; payments/escrow are read-only kobo projections. Money-invariant cases do not apply, but assert no route can mutate a kobo column.

## 7. Automated specs to add

- `internal/realtor/admin_test.go` — table-driven unit tests for `isValidListingDecision`, `isValidVerificationStatus`, and `adminPage` clamp logic (`limit≤0`/`>200`→default, `offset<0`→0). Pure, no DB. TODO (`REALTOR-UNIT-001`, `REALTOR-VAL-001/002`).
- `internal/realtor/repository_live_db_test.go` — live-DB (gated on `TEST_DATABASE_URL`): `DecideListing`/`DecideVerification` status-machine transitions (`REALTOR-FSM-001…006`), `ErrNotFound` on missing id, and an `InsertAudit` row assertion per decision. TODO.
- `internal/realtor/stays_test.go` — live-DB: gate-pass issuance gate (status/estate membership), owner-vs-estate-staff authz (`REALTOR-AUTHZ-003/004`), and idempotency on `estate_pass_id` using a stub `EstatePassIssuer` (the interface is already a seam). TODO (`REALTOR-INT-006`, `REALTOR-SEC-001/002`).
- Route-inventory / RBAC assertion (in the router parity check) that all `/api/realtor/admin/*` routes carry the `realtor.manage` gate and that both surfaces are absent when `FeatureRealtorEnabled=false` (`REALTOR-AUTHZ-001`, `REALTOR-SEC-003/004`). TODO.

## 8. Coverage target & exit criteria

Tier 1 pure-logic floor ≥ 75% on the decision allow-lists, pagination clamp, and status-transition mapping in `repository.go`. Exit criteria (release-ready): `REALTOR-AUTHZ-001`/`002` (RBAC fail-closed + auth) green on all admin routes; `REALTOR-INT-003`/`004` + `REALTOR-FSM-001…006` (moderation/verification transitions + audit rows) green; gate-pass `REALTOR-INT-006` (idempotent issuance) and `REALTOR-AUTHZ-003` (IDOR) green; flag-off `REALTOR-SEC-003`/`004` verified (404, never 500).
