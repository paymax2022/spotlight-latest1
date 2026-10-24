# Cluster A — Identity / RBAC / Upgrades

**Cases attempted:** 63  |  **Pass:** 4  |  **Fail:** 13  |  **Blocked:** 34  |  **N/A:** 12  _(updated by Phase 5 Wave 2 rerun below; the per-row table keeps the Phase 3 verdicts)_

Source: UAT workbook lines 377-1160 (RST-UAT-0001..0063; the range holds 63 cases, not ~70).
Spec: `mobile-app/reactnative/tests/e2e/food-uat/cluster-a-identity-rbac.spec.ts` (63 tests x 2 projects listed).

## Run notes (read first)

- Playwright is not installed in this worktree (no `node_modules`). It ran using the main checkout's binary:
  `NODE_PATH=<main>/mobile-app/reactnative/node_modules E2E_BASE_URL=http://127.0.0.1:8083 <main>/node_modules/.bin/playwright test ... --project=desktop-chrome`.
- Last run (desktop-chrome): 5 passed (0011, 0056, 0057, 0059, 0062 — API legs, no fixtures), 54 skipped (Blocked / N/A / known-defect declarations), 4 failed (0005 UI leg since removed from the spec; 0013, 0052, 0053).
- The 3 UI failures are **harness**, not product: `loginAs()` times out waiting for "Explore Services" on `/home`, and the existing `tests/e2e/modules/food.spec.ts` fails identically against the live :8083 Metro (it renders no app content for the seeded session). Those cases are recorded **Blocked (harness)** — orchestrator should confirm :8083 serves this worktree's bundle / correct env.
- No seeded multi-actor fixtures exist (customer/owner/staff/rider/admin tokens, SMS/email OTP gateway), so authenticated RBAC legs are Blocked. Where code evidence exists it is cited; `go test ./internal/restaurant -run 'KYB|Staff|Authz|Can'` passes.
- **Fail** = defect proven by code read of the cited path (not executed end to end). Each carries a `test.fixme` in the spec.
- Rider onboarding/verification is not in the Food module: Food dispatch consumes the shared transport `drivers` table (`backend/internal/restaurant/dispatch.go:80`, `delivery.go:709-717`). The upgrade flow lives in `app/mobility/driver/onboarding.tsx` and `backend/internal/transport/admin.go`; those cases are N/A for Food and belong to Mobility UAT.

| ID | Title | Priority | Core/Cond | Scope | Status | Evidence (spec test name / HTTP code / UI selector) | Defect ID |
| --- | --- | --- | --- | --- | --- | --- | --- |
| RST-UAT-0001 | Register using valid contact and OTP | P0 | Core | In-Scope | Blocked | Needs OTP gateway. `app/(auth)/signup.tsx` exists | — |
| RST-UAT-0002 | Block duplicate phone registration | P0 | Core | In-Scope | Blocked | Needs verified fixture + OTP gateway | — |
| RST-UAT-0003 | Reject invalid or expired OTP | P0 | Core | In-Scope | Blocked | Needs live OTP; `app/(auth)/verify-otp.tsx`, `internal/otp` attempt ceiling | — |
| RST-UAT-0004 | Enforce OTP resend controls | P1 | Core | In-Scope | Blocked | Needs OTP gateway; limiters at `backend/internal/app/router.go:155-169` | — |
| RST-UAT-0005 | Login via password or configured method | P0 | Core | In-Scope | Blocked | Invalid creds: `POST :8080/api/auth/login` -> 401 `invalid credentials` (pass, spec test). Valid-login/logout leg needs fixture | — |
| RST-UAT-0006 | Reject disabled account login | P0 | Core | In-Scope | Blocked | Needs admin-disabled account (`platform_users` gate in `auth_service.go`) | — |
| RST-UAT-0007 | Reset credentials safely | P0 | Core | In-Scope | Blocked | Needs email OTP gateway | — |
| RST-UAT-0008 | Protect session on token expiry | P0 | Core | In-Scope | Blocked | Needs real session with controllable expiry | — |
| RST-UAT-0009 | Update customer profile | P1 | Core | In-Scope | Blocked | Needs real session + R2 | — |
| RST-UAT-0010 | Manage saved addresses | P1 | Core | In-Scope | Blocked | Needs real session, two devices | — |
| RST-UAT-0011 | Prevent insecure account enumeration | P1 | Core | In-Scope | Pass | Spec test passed live: `POST /api/auth/request-password-reset` unknown email -> 200 "If your email exists, reset instructions were sent."; login unknown -> 401 generic. (Only the unknown-identifier side was probed; existing-account parity not compared.) | — |
| RST-UAT-0012 | Handle revoked second device session | P0 | Core | In-Scope | Blocked | Needs two live sessions + global sign-out | — |
| RST-UAT-0013 | Find merchant upgrade from customer profile | P0 | Core | In-Scope | Blocked | Harness. Code: `app/food/index.tsx:413-430` label "Sell food on Paymax — set up your restaurant" -> `/food/restaurant`, same session, no separate sign-up | — |
| RST-UAT-0014 | Preserve identity and history after upgrade | P0 | Core | In-Scope | Blocked | Needs seeded history. By construction `restaurants.owner_id` = auth user id | — |
| RST-UAT-0015 | Save partially completed application | P1 | Core | In-Scope | Blocked | Needs owner token. `SaveKYB` draft upsert (`kyb.go:198`) | — |
| RST-UAT-0016 | Enforce required application fields | P0 | Core | In-Scope | Blocked | Needs owner token. `validateKYBForSubmit` unit tests pass (`go test -run KYB`) | — |
| RST-UAT-0017 | Upload valid ownership documents | P0 | Core | In-Scope | Blocked | Needs owner token + R2 creds (falls back to link when unset) | — |
| RST-UAT-0018 | Reject malformed oversized or unsafe upload | P0 | Core | In-Scope | Fail | `kyb_documents.go:126-176` validates extension vs content-type only; no size cap, no content sniffing | FOOD-UAT-A-005 |
| RST-UAT-0019 | Submit application for review | P0 | Core | In-Scope | Blocked | Needs owner token | — |
| RST-UAT-0020 | Prevent duplicate applications | P0 | Core | In-Scope | Fail | `SubmitKYB` (`kyb.go:286`) has no Idempotency-Key; replay errors (submitted->submitted denied) rather than returning the first result | FOOD-UAT-A-009 |
| RST-UAT-0021 | Track status and review feedback | P1 | Core | In-Scope | Blocked | Needs owner token. `kyb.tsx:295-303` status banners exist | — |
| RST-UAT-0022 | Block merchant actions before approval | P0 | Core | In-Scope | Fail | Opening store (`delivery.go:580`) and payouts (`payout.go:759`) are KYB-gated, but a pending applicant can still create categories/items | FOOD-UAT-A-010 |
| RST-UAT-0023 | Approve from admin without account split | P0 | Core | In-Scope | Blocked | Needs admin creds. `AdminDecideApplication` opens the same restaurants row | — |
| RST-UAT-0024 | Reject application and request correction | P0 | Core | In-Scope | Fail | Backend supports `needs_info`; admin console `onboarding/page.tsx` offers only Approve/Reject | FOOD-UAT-A-008 |
| RST-UAT-0025 | Reconcile approval notification delivery | P1 | Core | In-Scope | Blocked | Needs offline-device simulation + admin approval | — |
| RST-UAT-0026 | Verify mandatory business evidence | P0 | Core | In-Scope | N/A | No per-jurisdiction checklist in `onboarding/page.tsx` / `admin_repo.go` | FOOD-UAT-A-011 |
| RST-UAT-0027 | Review owner/business name match | P0 | Core | In-Scope | N/A | No name-match comparison or mismatch flag anywhere in `kyb*.go` / `admin_repo.go` | FOOD-UAT-A-011 |
| RST-UAT-0028 | Check approval separation of duties | P0 | Core | In-Scope | Fail | `admin_repo.go:215` no applicant != reviewer check; route gated by permission only | FOOD-UAT-A-002 |
| RST-UAT-0029 | Approve complete KYB | P0 | Core | In-Scope | Fail | Approve succeeds with no KYB record (`admin_repo.go:261-276`); no audit event written, only best-effort notify | FOOD-UAT-A-003, FOOD-UAT-A-004 |
| RST-UAT-0030 | Reject with documented reason | P0 | Core | In-Scope | Blocked | Needs admin creds. Code enforces note on non-approve (`admin_repo.go:234`) and notifies owner | — |
| RST-UAT-0031 | Resubmit expired documentation | P1 | Core | In-Scope | Fail | `AddKYBDocument` UPSERT on (restaurant, doc_type) overwrites; no version/evidence history | FOOD-UAT-A-007 |
| RST-UAT-0032 | Avoid public exposure of KYB evidence | P0 | Core | In-Scope | Blocked | Needs two merchant tokens. KYB tables not serialised by `GetRestaurant`; docs are private R2 keys | — |
| RST-UAT-0033 | Start rider upgrade using customer login | P0 | Core | In-Scope | N/A | No entry under `app/food/` (`rider/index.tsx` is offers only); flow is `app/mobility/driver/onboarding.tsx` | FOOD-UAT-A-012 |
| RST-UAT-0034 | Retain customer purchases after approval | P0 | Core | In-Scope | Blocked | Needs approved-driver fixture. `drivers.user_id` is the customer auth id | — |
| RST-UAT-0035 | Capture vehicle mode and service areas | P0 | Core | In-Scope | N/A | Owned by Mobility `app/mobility/driver/onboarding.tsx` | — |
| RST-UAT-0036 | Reject missing rider KYC | P0 | Core | In-Scope | N/A | Owned by Mobility onboarding / transport admin | — |
| RST-UAT-0037 | Enforce document size/type | P0 | Core | In-Scope | N/A | Owned by Mobility `uploadDriverDocumentFile` | — |
| RST-UAT-0038 | Submit and track rider application | P0 | Core | In-Scope | N/A | Owned by Mobility onboarding status step | — |
| RST-UAT-0039 | Approve rider to activate provider role | P0 | Core | In-Scope | Blocked | Needs admin + driver fixtures. Food gate `delivery.go:709-717` requires `verification_status='approved'` | — |
| RST-UAT-0040 | Reject and resubmit rider application | P0 | Core | In-Scope | N/A | Owned by `backend/internal/transport/admin.go:137` | — |
| RST-UAT-0041 | Do not create duplicate riders on repeated submission | P0 | Core | In-Scope | N/A | Owned by Mobility onboarding | — |
| RST-UAT-0042 | Handle expired licence after activation | P0 | Core | In-Scope | Fail | No document-expiry check in `transport/admin.go` SetVerification, Food dispatch or AcceptDelivery | FOOD-UAT-A-013 |
| RST-UAT-0043 | Validate identity evidence | P0 | Core | In-Scope | Blocked | Needs admin creds. `SetVerification` writes audit via `writeAudit` | — |
| RST-UAT-0044 | Validate transport credentials by mode | P0 | Core | In-Scope | Fail | `SetVerification` accepts any status; no credential/expiry validation | FOOD-UAT-A-013 |
| RST-UAT-0045 | Restrict rider bank edits | P0 | Core | In-Scope | Blocked | Needs approved-rider token. No payout-account cooling-off found in `withdrawal.go` / `handler_withdrawal.go` (not verified live) | — |
| RST-UAT-0046 | Prevent reviewer self-approval | P0 | Core | In-Scope | Fail | `PATCH /api/transport/admin/drivers/:id/verification` (`finance_routes.go:2327`) permission-gated only | FOOD-UAT-A-002 |
| RST-UAT-0047 | Track training or equipment readiness | P1 | Conditional | Conditional - Deferred | N/A | No induction/helmet/food-handling model in `backend/internal/restaurant`, `transport`, `app/food` (grep empty) | — |
| RST-UAT-0048 | Suspend merchant account | P0 | Core | In-Scope | Fail | No suspend state. Admin force-close is reversible by owner via `PATCH /:id/availability` (`delivery.go:580-600`, kyb_status stays approved); menu edits unaffected | FOOD-UAT-A-006 |
| RST-UAT-0049 | Suspend rider during active delivery | P0 | Core | In-Scope | Fail | `SetVerification` only sets `drivers.status='offline'`; `orders.rider_id` / offers untouched, no reassignment | FOOD-UAT-A-001 |
| RST-UAT-0050 | Reinstate after verification | P0 | Core | In-Scope | Blocked | Needs admin creds. `admin.go:146` allows suspended->approved with no re-verification | — |
| RST-UAT-0051 | Withdraw pending provider application | P1 | Core | In-Scope | N/A | No withdraw route: only GET/PUT kyb, documents, submit (`finance_routes.go:1750-1757`) | FOOD-UAT-A-014 |
| RST-UAT-0052 | Switch customer to restaurant owner mode | P0 | Core | In-Scope | Blocked | Harness (food.spec baseline fails too). Spec: `getByLabel('Restaurant owner dashboard')` -> `/food/restaurant` | — |
| RST-UAT-0053 | Switch customer to rider mode | P0 | Core | In-Scope | Blocked | Harness. Spec: `/food/rider` shows "Rider · Offers" | — |
| RST-UAT-0054 | Support dual merchant and rider approval policy | P1 | Conditional | Conditional - Deferred | N/A | No dual-role policy config; independent `restaurants.owner_id` / `drivers.user_id` | — |
| RST-UAT-0055 | Revoke provider role without deleting customer | P0 | Core | In-Scope | Fail | No revoke-merchant-role operation (admin routes `finance_routes.go:1891-1903` only edit/close). Rider revoke exists via SetVerification | FOOD-UAT-A-006 |
| RST-UAT-0056 | Deny customer access to merchant APIs | P0 | Core | In-Scope | Blocked | Unauth + forged-token legs PASS live: POST menu/items and PATCH order status -> 401. Customer-token 403 leg needs fixture | — |
| RST-UAT-0057 | Deny merchant access to rider-only APIs | P0 | Core | In-Scope | Blocked | Unauth + forged-token legs PASS live: accept/pickup/handoff -> 401. Merchant-token leg needs fixture | — |
| RST-UAT-0058 | Prevent tenant crossover | P0 | Core | In-Scope | Blocked | Needs two merchant tokens. Code: `AssertStaffPermission` per restaurantID (`staff_roles.go:157`) | — |
| RST-UAT-0059 | Limit rider access to assigned delivery | P0 | Core | In-Scope | Blocked | Unauth + forged legs PASS (GET order, rider/offers -> 401). Code: `GetOrder` participant-only, `maskPODCodes`, `AcceptDelivery` needs open offer | — |
| RST-UAT-0060 | Constrain restaurant staff delegation | P0 | Core | In-Scope | Blocked | Needs owner + kitchen tokens. Matrix tests pass (`go test -run Staff`) | — |
| RST-UAT-0061 | Revoke staff permission instantly | P0 | Core | In-Scope | Blocked | Needs live staff session. `ResolveStaffRole` reads DB per request (no cache) | — |
| RST-UAT-0062 | Protect admin access | P0 | Core | In-Scope | Blocked | Unauth + forged legs PASS: `/api/restaurant/admin/{onboarding,payouts,withdrawals,disputes}` and `onboarding/:id/approve` -> 401; `:3001/admin/restaurant/onboarding` redirects. Support-agent vs finance-admin leg needs creds | — |
| RST-UAT-0063 | Handle cross-role stale session | P0 | Core | In-Scope | Blocked | Needs rider-then-customer session pair. Authorisation is per user id per request (no role claim to go stale) | — |

## Defects

### FOOD-UAT-A-001 — Suspending a rider does not reassign their in-flight delivery
- Severity: Major
- Area: backend
- Repro: approve a driver, assign them an order (`orders.rider_id` set), `PATCH /api/transport/admin/drivers/:id/verification {status:'suspended'}`.
- Expected: no new jobs; in-flight job reassigned/escalated by policy.
- Actual: `SetVerification` (`backend/internal/transport/admin.go:137-160`) only updates `drivers.verification_status` and `drivers.status='offline'`. `orders.rider_id`, `restaurant_delivery_offers` and `rider_candidate_id` are untouched; the suspended rider keeps the order (and can still `pickup`/`handoff` since those check only `orders.rider_id`).
- Evidence: code read (`admin.go`, `delivery.go:678`, `dispatch.go:148`). Not executed (no fixtures).

### FOOD-UAT-A-002 — No separation of duties on approvals (merchant KYB and rider verification)
- Severity: Major
- Area: backend
- Repro: as an admin holding `restaurant.admin.onboarding` who also owns a restaurant, `POST /api/restaurant/admin/onboarding/<own restaurant id>/approve`. Same for `PATCH /api/transport/admin/drivers/<own driver id>/verification`.
- Expected: self-approval blocked.
- Actual: `AdminDecideApplication` (`admin_repo.go:215`) and `SetVerification` never compare the actor with the applicant; permission is the only gate.
- Evidence: code read; routes `finance_routes.go:1936-1943`, `:2327`.

### FOOD-UAT-A-003 — Restaurant admin decisions write no audit event
- Severity: Major
- Area: backend
- Repro: approve/reject/needs_info an application or force-open/close a store; inspect audit tables.
- Expected: immutable audit row (actor, target, reason, before/after) per CLAUDE.md iron rule.
- Actual: `AdminDecideApplication` only updates `restaurant_kyb`/`restaurants` and sends a best-effort notification (`admin_repo.go:291-306`); `grep -i audit backend/internal/restaurant/*.go` finds no audit write for these paths (transport admin does use `writeAudit`). When no KYB row exists, even `reviewed_by`/`decided_at` are not recorded.
- Evidence: code read.

### FOOD-UAT-A-004 — Approval allowed with no KYB submission or evidence
- Severity: Major
- Area: backend / admin portal
- Repro: create a restaurant, never submit KYB; `POST /api/restaurant/admin/onboarding/<id>/approve`.
- Expected: approval requires a submitted, complete KYB with mandatory checks decided.
- Actual: the "no restaurant_kyb row" branch (`admin_repo.go:261-276`) sets `kyb_status='approved'` and `is_open=true` anyway, opening the store for orders and unblocking payouts with no documents or settlement account on file.
- Evidence: code read (documented there as a FOOD-003 workaround).

### FOOD-UAT-A-005 — KYB document upload has no size limit or content validation
- Severity: Major
- Area: backend
- Repro: `POST /api/finance/restaurant/:id/kyb/documents/presign` with `file_name=evil.png`, `content_type=image/png`; PUT any executable or multi-GB body to the returned URL.
- Expected: oversized/disguised/unsafe files rejected.
- Actual: presign checks extension and declared content-type only (`kyb_documents.go:126-176`); no `Content-Length` bound in the signature, no magic-byte scan after upload, and `AddKYBDocument` also accepts any http(s) link.
- Evidence: code read.

### FOOD-UAT-A-006 — No real merchant suspension or role revocation; owner can reopen an admin-closed store
- Severity: Major
- Area: backend / admin portal
- Repro: admin `PATCH /api/restaurant/admin/restaurants/:id/availability {is_open:false}`; then owner `PATCH /api/finance/restaurant/:id/availability {is_open:true}`.
- Expected: suspended merchant privileges revoked until reinstated.
- Actual: `SetAvailability` (`delivery.go:580-600`) only requires `kyb_status='approved'`, which suspension does not change, so the owner reopens at will; menu/staff/banking edits stay permitted. There is no suspend/revoke state or operation for restaurants at all.
- Evidence: code read.

### FOOD-UAT-A-007 — Replacing a KYB document destroys the previous evidence
- Severity: Minor
- Area: backend
- Repro: attach `cac_certificate`, get returned `needs_more_info`, attach a replacement.
- Expected: version/evidence history retained.
- Actual: `INSERT ... ON CONFLICT (restaurant_id, doc_type) DO UPDATE SET file_url=...` (`kyb.go` AddKYBDocument) overwrites the row.
- Evidence: code read.

### FOOD-UAT-A-008 — Admin console cannot return an application for correction
- Severity: Minor
- Area: admin portal
- Repro: open `/admin/restaurant/onboarding`, Review an application.
- Expected: option to request more information.
- Actual: only Approve and Reject are rendered, although the backend accepts `needs_info` (`admin_repo.go:229`).
- Evidence: `frontend-admin/app/admin/restaurant/onboarding/page.tsx`.

### FOOD-UAT-A-009 — KYB submit is not idempotent
- Severity: Minor
- Area: backend
- Repro: `POST /:id/kyb/submit` twice.
- Expected: second call returns the same result.
- Actual: second call fails the FSM (`submitted -> submitted` not in `kybTransitions`) and returns an error; no Idempotency-Key is read.
- Evidence: `kyb.go:286-313`, `kybTransitions`.

### FOOD-UAT-A-010 — Pending applicant can build a menu before approval
- Severity: Minor (product decision needed; may be intended onboarding UX)
- Area: backend
- Repro: owner with `kyb_status` draft/submitted calls `POST /:id/menu/categories` and `/menu/items`.
- Expected per workbook: merchant endpoints deny until verified active role.
- Actual: allowed; only opening the store and withdrawals are gated.
- Evidence: `finance_routes.go:1764-1770`, `delivery.go:580`.

### FOOD-UAT-A-011 — No KYB checklist or owner/business name-match control (feature gap)
- Severity: Minor
- Area: admin portal / backend
- Expected: per-jurisdiction checklist of decisions; mismatch flagged/escalated.
- Actual: reviewer sees documents and records a single approve/reject + note.
- Evidence: `onboarding/page.tsx`, `admin_repo.go`, `kyb.go` contain neither.

### FOOD-UAT-A-012 — No rider-upgrade entry point inside Food (feature gap)
- Severity: Minor
- Area: user-facing
- Actual: `/food/rider` is offers-only; a customer wanting to deliver food must find Mobility driver onboarding (`app/mobility/driver/onboarding.tsx`) separately. Cases 0035-0041 are therefore N/A here and should be run in Mobility UAT.
- Evidence: `app/food/rider/index.tsx`, `delivery.go:709-717`.

### FOOD-UAT-A-013 — Rider approval and dispatch ignore document/licence expiry
- Severity: Major
- Area: backend
- Repro: approve a driver whose licence is past validity, or advance the clock after approval, then dispatch.
- Expected: ineligible/expired credentials cannot be approved; policy restriction applies until re-verification.
- Actual: `SetVerification` takes any status without checks; `AcceptDelivery` and dispatch candidate selection use `verification_status='approved'` only (`delivery.go:709`, `dispatch.go:67-84`). No expiry logic found in `backend/internal/transport/admin.go` or driver files.
- Evidence: code read.

### FOOD-UAT-A-014 — Applicant cannot withdraw a pending KYB application (feature gap)
- Severity: Minor
- Area: backend / user-facing
- Actual: KYB routes are GET/PUT/documents/submit only (`finance_routes.go:1750-1757`); no cancel/withdraw.
- Evidence: route table.

## Phase 5 Wave 1 verify — FOOD-UAT-A-004 reconciliation

Verifier: V4. Zero product-code changes. Probe fixtures (two `a4a40000-...` restaurants) were deleted afterwards.

### Code read
- `AdminDecideApplication` (`backend/internal/restaurant/admin_repo.go:215`):
  - KYB row exists: the decision must be a legal `kybCanTransition`. It writes `restaurant_kyb.status` and then `restaurants.kyb_status`.
  - No KYB row, `approve`/`reject`: it writes `restaurants.kyb_status` directly to `approved` or `rejected`. This is the branch A-004 flags, and it is deliberate (FOOD-003 Part B).
  - No KYB row, `needs_info`: refused.
  - After the status write, `approve` sets `is_open=true` and `reject` sets `is_open=false`.
- `SetAvailability` (`delivery.go:580`): opening requires `kyb_status = 'approved'`, so NULL or any other value returns `ErrKYBNotApproved` (HTTP 403). Closing is always allowed.
- Payout gate (`payout.go:221`, `:706`): `kyb_status = 'approved'` is required.
- Invariant tests:
  - `TestLiveDB_SetAvailability_RequiresApprovedKYBToOpen` (`kyb_gate_live_db_test.go`).
  - `TestLiveDB_AdminListApplications_StatusReflectsRealKYBState` (`kyb_gate_live_db_test.go`).
  - `TestLiveDB_AdminApproveWithNoKYBRowMakesOutletPayable` (`kyb_live_db_test.go:137`).
  - All three PASS against local Postgres (`TEST_DATABASE_URL=...:54322`, `-count=1`).

### Live probe transcript
Setup: admin@spotlight.internal, with a GoTrue token from the documented dev password. Restaurant A has `kyb_status` NULL and 0 `restaurant_kyb` rows. Restaurant B has `kyb_status='submitted'`.
```
seeded:   A | V4 NoKYB Kitchen   | <NULL>    | is_open=f
          B | V4 Pending Kitchen | submitted | is_open=f
PATCH /api/finance/restaurant/A/availability {is_open:true}  -> 403 "business verification must be approved before opening for orders"
PATCH /api/finance/restaurant/B/availability {is_open:true}  -> 403 (same)
rows unchanged: A NULL/f, B submitted/f
POST  /api/restaurant/admin/onboarding/A/approve (admin)     -> 200 {"ok":true}
after:    A | approved | is_open=t        B | submitted | f
payout gate (kyb_status='approved') for A -> payable = t
owner PATCH availability A false -> 200 (is_open=false); true -> 200 (is_open=true)   (now approved, so allowed)
POST  /api/restaurant/admin/onboarding/B/reject {note}       -> 200; B = rejected / f
owner PATCH availability B true                              -> 403
```
- An order cannot succeed against an unapproved restaurant. `PlaceOrder` requires `is_open`, and an unapproved restaurant cannot reach `is_open=true`: the owner gets 403, and only the admin decision path sets it. I did not place a live order. The conclusion rests on the `is_open` gate plus these probes.

### Verdict: **A-004 CONFIRMED but under narrower conditions** (re-severity: Minor/Advisory, not a Blocker)
- Cluster F was right. FOOD-003 and FOOD-010 hold:
  - An unapproved restaurant cannot be opened by its owner (403 for NULL, `submitted` and `rejected`).
  - It cannot be paid out, because the payout gate needs `kyb_status='approved'`.
  - Nothing outside an admin decision can set `approved`.
- A-004's literal claim is true, but it is not a bypass. An authenticated admin approving a restaurant that has no `restaurant_kyb` row sets `kyb_status='approved'` and `is_open=true` without any documents or settlement account on file. The code documents this as an intentional trade-off: the owner KYB submission routes were not wired, so the console decision is the verification.
- Narrow loophole: the approval is a human-judgement gate only. The server does not require documents, a submitted KYB or a settlement account. If an admin misclicks, the outlet becomes payable immediately. Additionally, the `restaurant_kyb` audit row and the reviewer note are not written on this path (the note is discarded).
- Recommended hardening, owed as a decision (not done here): require `hasKYB && status in (under_review|submitted)` for `approve`, or at minimum require a documents/settlement-account precondition once the owner KYB routes ship. Keep a flagged "console-only approve" escape hatch if product wants it.
- Data observation: local restaurant `65a5a4d5-cf5a-4fde-b4a5-8d112ac834f3` has `kyb_status='submitted'` and `is_open=true`. This is seed or legacy data that predates the FOOD-010 gate, because the API gate cannot produce it. It was not changed. A production data audit for `is_open AND kyb_status IS DISTINCT FROM 'approved'` is worth running.
- Disposition: **A-004 narrowed to an admin-policy advisory (Minor). The Major severity is discredited.** Mark it Closed as a security finding and carry the hardening item as a follow-up.


## Phase 5 Wave 2 UI rerun

Run (desktop-chrome, workers=1, Metro :8083 with patched `auth.ts`/`common.ts`):
`npx playwright test tests/e2e/food-uat/cluster-a-identity-rbac.spec.ts --project=desktop-chrome` -> **9 passed, 54 skipped, 0 failed** (final run). First run: 8 passed / 1 failed (0053, `Rider · Offers` not visible within the default 10s expect on a cold Metro compile of `/food/rider`; passes in 36s on re-run; spec now uses a 45s expect for that one assertion — documented flake, not a product defect).

Method note: no test in this spec was skipped because of the harness itself. The spec's 54 skips are (a) fixture-blocked (SMS/email OTP gateway, owner/staff/rider/admin tokens, two-device sessions), (b) N/A with code-path citations, or (c) `test.fixme` KNOWN DEFECT declarations for backend/admin behaviour proven by code read. Un-skipping those would just fail on a missing fixture, so they were deliberately left as-is rather than converted to false greens/reds. The only rows the broken harness had touched were the three UI rows (0013, 0052, 0053), which now run live.

| ID | Phase 3 verdict | Phase 5 rerun verdict | Change reason |
| --- | --- | --- | --- |
| RST-UAT-0013 | Blocked (harness) | **Pass** (DISSOLVED) | Live: `/food` shows "Sell food on Paymax — set up your restaurant"; click -> `/food/restaurant`, same session, URL not signup/register |
| RST-UAT-0052 | Blocked (harness) | **Pass** (DISSOLVED) | Live: "Restaurant owner dashboard" -> `/food/restaurant`; back to `/food` shows "Food & Delivery" and "My orders" with the same session |
| RST-UAT-0053 | Blocked (harness) | **Pass** (DISSOLVED) | Live: `/food/rider` renders "Rider · Offers", "Available offers", empty state on a customer session (no role gate on the client); `/food` reachable again. One cold-compile timeout on the first run, green on re-run and final run |
| RST-UAT-0005 | Blocked | Blocked (unchanged) | Invalid-credential leg passes (401 `invalid credentials`); valid-login leg needs a fixture credential |
| RST-UAT-0011 | Pass | Pass (unchanged) | Re-confirmed live |
| RST-UAT-0056 / 0057 / 0059 / 0062 | Blocked | Blocked (unchanged; unauth+forged legs re-confirmed passing) | Customer/merchant/rider/admin-token legs still need seeded multi-actor fixtures |
| RST-UAT-0001-0004, 0006-0010, 0012 | Blocked | Blocked (unchanged) | OTP gateway / disabled-account / expiring-session / two-device fixtures absent |
| RST-UAT-0014-0017, 0019, 0021, 0023, 0025, 0030, 0032 | Blocked | Blocked (unchanged) | Need owner and/or admin tokens (and R2 for 0017) |
| RST-UAT-0034, 0039, 0043, 0045, 0050 | Blocked | Blocked (unchanged) | Need approved-driver / admin fixtures |
| RST-UAT-0058, 0060, 0061, 0063 | Blocked | Blocked (unchanged) | Need two merchants / staff sessions / role-switch session pair |
| RST-UAT-0018, 0020, 0022, 0024, 0028, 0029, 0031, 0042, 0044, 0046, 0048, 0049, 0055 (13) | Fail (code read) | Fail (unchanged, not dissolved) | Backend/admin defects with no UI surface reachable without admin/owner credentials; each remains `test.fixme` with its FOOD-UAT-A-xxx id. Nothing in the live run contradicts the code-read evidence |
| 12 N/A rows (0026, 0027, 0033, 0035-0038, 0040, 0041, 0047, 0051, 0054) | N/A | N/A (unchanged) | Capability absent / owned by Mobility; code-path citations retained |

Net for Cluster A: **3 statuses changed (Blocked -> Pass, all DISSOLVED), 0 dissolved Fail -> Pass, 13 Fail remain, 3 of 37 Blocked resolved (34 still Blocked on missing fixtures, not harness).** Revised totals: Pass 4, Fail 13, Blocked 34, N/A 12.
