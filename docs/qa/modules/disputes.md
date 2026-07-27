# Module: Disputes

**Risk tier:** 1 &nbsp;·&nbsp; **Money-path:** no (complaint tickets — does NOT touch the ledger/escrow) &nbsp;·&nbsp; **Feature flag:** `FEATURE_DISPUTES_ENABLED`
**Code:** `backend/internal/finance/disputes/` (`handler.go`, `service.go`, `model.go`, `model_test.go`); mounted in `backend/internal/app/finance_routes.go`
**Slug:** `DISPUTES` (uppercase, used in Case IDs)

## 1. Overview & scope

This is a lightweight **user complaint-ticket** system — distinct from the money-moving escrow disputes in `escrow.md`. A user opens a dispute against a transaction/order reference; an admin resolves it. `disputes.NewService(pool)` has **no ledger, no escrow, no audit** dependency; `ResolutionRefunded` is only a status string — no refund is actually posted. Because it looks money-adjacent but is not, the key QA targets are **authorization** (does the admin-resolve route actually check admin permission?), input validation, and object scoping. Cross-cutting refs: `../cross-cutting/authentication.md`, `../cross-cutting/rbac-and-permissions.md`, `../cross-cutting/feature-flags-and-audit.md`.

**Findings to test (from code read):** (1) `AdminResolve` is mounted with `requireUserID()` only — **no RBAC/admin-permission middleware**; `adminID` is captured but never persisted or checked. (2) `Resolve` hard-codes `status='resolved'` with no FSM guard (resolves any id in any state) and reports `{resolved:true}` even for a **non-existent** id (0 rows is not an error). (3) The resolution string is cast to `Resolution` without enum validation. (4) `Open` has no object-level check that the caller relates to `Reference` (abuse/DoS vector, though `UserID` is the caller's own).

## 2. Services / endpoints in scope

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| Open dispute | `POST /api/finance/disputes` | `requireUserID()` (token) | no |
| List own disputes | `GET /api/finance/disputes?limit&offset` | `requireUserID()` (scoped `WHERE user_id`) | no |
| Admin resolve | `POST /api/finance/admin/disputes/:id/resolve` | `requireUserID()` **only (no RBAC — finding)** | no |

`OpenRequest`: `reference` (required), `module_type` (required), `type` (required, `DisputeType`), `description` (required, `min=20`). Admin body: `resolution` (required), `admin_note`. Statuses: `open`, `in_review`, `resolved`, `closed` (only `open`/`resolved` are ever set). Resolutions: `refunded`, `settled`, `dismissed`. Types: `failed_payment`, `non_delivery`, `wrong_item`, `no_show`, `fake_campaign`, `unauthorised`, `other`.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Status/resolution/type constants distinct | unit | `internal/finance/disputes/model_test.go` | AUTOMATED |
| Description min-length documented | unit | `model_test.go` (`TestOpenRequestMinDescriptionLength`, `len()` only) | PARTIAL |
| Lifecycle terminal ≠ entry | unit | `model_test.go` (`TestDisputeLifecycle`) | PARTIAL (no real transition logic exists) |
| Open/List/Resolve service behavior | int | — | TODO |
| AdminResolve authorization | authz | — (finding) | TODO |
| Binding validation via gin | con | — | TODO |
| List pagination clamp / negative offset | con | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `DISPUTES-INT-001` | Open dispute happy path | P1 | flag on, `qa-user-a` | `POST /disputes` valid body | desc ≥20 chars | 201; row `status=open`, `user_id`=token id |
| `DISPUTES-INT-002` | List own disputes | P1 | seeded disputes for A | `GET /disputes?limit=10` | — | 200 `{data, count}`; only A's rows (`WHERE user_id`) |
| `DISPUTES-UNIT-001` | Description min 20 rejected | P1 | — | `POST /disputes` `description="too short"` | <20 | 400 (binding `min=20`) |
| `DISPUTES-UNIT-002` | Missing required field | P1 | — | omit `reference`/`module_type`/`type` | missing | 400 |
| `DISPUTES-CON-001` | limit clamp | P2 | — | `GET /disputes?limit=9999` | 9999 | Clamped to 20 (limit≤0 or >100 → 20) |
| `DISPUTES-CON-002` | Negative offset (finding) | P2 | — | `GET /disputes?offset=-5` | -5 | Offset not clamped → passes to SQL; assert no error/leak |
| `DISPUTES-AUTHZ-001` | List is owner-scoped (IDOR) | P0 | A and B each have disputes | B calls `GET /disputes` | B token | Only B's disputes; never A's — RBAC-AUTHZ-007 |
| `DISPUTES-AUTHZ-002` | Open uses token identity | P0 | A token | `POST /disputes` | — | `user_id`=A regardless of body; no spoofable field |
| `DISPUTES-AUTHZ-003` | Admin-resolve lacks RBAC (finding) | P0 | non-admin authenticated user | `POST /admin/disputes/:id/resolve` | any dispute id | **Currently succeeds** (only `requireUserID()`) — file S2 authz defect; target: 403 via `RequirePermission` (e.g. `finance.disputes.manage`) |
| `DISPUTES-AUTHZ-004` | Admin-resolve allowed w/ permission | P0 | admin holds the dispute-manage permission | same | — | 200 `{resolved:true}` once guard exists — RBAC-AUTHZ-002 |
| `DISPUTES-SEC-001` | Resolve invalid resolution string (finding) | P1 | admin | `POST …/resolve` `resolution="banana"` | invalid | Currently cast + stored unchecked; target: 400 (enum validation) |
| `DISPUTES-SEC-002` | Resolve non-existent id (finding) | P1 | admin | `POST /admin/disputes/does-not-exist/resolve` | bogus id | Currently 200 `{resolved:true}` (0 rows ≠ error); target: 404 |
| `DISPUTES-SEC-003` | Flag off → routes not mounted | P0 | `FEATURE_DISPUTES_ENABLED` off | `POST /disputes` | — | 404 — FLAG-SEC-001 |
| `DISPUTES-SEC-004` | Resolve records actor (finding) | P2 | admin | resolve a dispute | — | `adminID` currently NOT persisted; target: audit event with actor — AUDIT-INT-002 |

## 5. State-machine transitions

The FSM is **declared but not enforced** — there is no transition table or `canTransition`. Only two implemented transitions:

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| (none) | `Open` | `open` | INSERT (hard-coded `open`) | `DISPUTES-INT-001` |
| any (unchecked) | `Resolve` | `resolved` | UPDATE hard-coded `resolved` + resolution + admin_note | `DISPUTES-AUTHZ-004` |

`in_review` and `closed` are never set by any code path. `Resolve` does not require the dispute to currently be `open` — re-resolving overwrites resolution/note (effectively idempotent on status but not guarded). **Recommend** adding a real guard: only `open`/`in_review` → `resolved`, terminal states rejected (`DISPUTES-SEC-002`).

## 6. Security & abuse cases

- **Missing admin RBAC (`DISPUTES-AUTHZ-003`):** the headline finding — admin resolve is only `requireUserID()`-gated. Confirm the intended `RequirePermission` guard and enforce before go-live.
- **No enum validation (`DISPUTES-SEC-001`):** arbitrary resolution strings persist.
- **Success on non-existent id (`DISPUTES-SEC-002`):** masks bad requests; should 404.
- **Open abuse:** any authenticated user can open a dispute against any `reference` (no relation check) — rate-limit / abuse consideration, not classic IDOR (`user_id` is the caller).
- **No money path:** confirm `ResolutionRefunded` triggers NO ledger movement here (refunds happen in settlement/escrow, not this module).

## 7. Automated specs to add

- `internal/finance/disputes/handler_test.go` — httptest: Open validation (min=20, required fields), List owner-scoping + pagination clamp, AdminResolve authorization (asserts the RBAC guard once added), invalid-resolution 400, non-existent-id 404. (DISPUTES-UNIT/CON/AUTHZ/SEC)
- `internal/app/finance_routes_disputes_authz_test.go` — regression that the admin-resolve route carries `RequirePermission` (currently a gap).
- `internal/finance/disputes/service_test.go` — `Resolve` FSM guard once implemented (open→resolved allowed, resolved→resolved rejected).

## 8. Coverage target & exit criteria

Tier-1: pure-logic ≥ 70%. Exit: admin-resolve RBAC gap resolved (`DISPUTES-AUTHZ-003` no longer succeeds for a non-admin); List owner-scoping proven; input validation enforced (min-length, required, resolution enum); non-existent-id returns 404; flag-off returns 404. Because this module handles no money, a failing case is a tracked defect for the affected feature rather than an S1 — **except** `DISPUTES-AUTHZ-003`, which is a security blocker.
