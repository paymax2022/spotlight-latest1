# Module: Onboarding (Merchant / Role-Upgrade)

**Risk tier:** 2 &nbsp;·&nbsp; **Money-path:** no &nbsp;·&nbsp; **Feature flag:** `FEATURE_ONBOARDING_ENABLED`
**Code:** `backend/internal/onboarding/` (`routes.go`, `handler.go`, `service.go`, `model.go`, `repository.go`, `validate.go`, `grant.go`, `README.md`); route wiring `backend/internal/app/finance_routes.go` (§"Merchant Onboarding & Role-Upgrade routes", ~L1909-1959, incl. optional `SetBusinessGate`).
**Slug:** `ONBOARDING` (uppercase, used in Case IDs)

## 1. Overview & scope

Onboarding is the cross-cutting merchant / role-upgrade flow: a signed-in customer picks a
super-app **module** (vertical) and a **merchant type** (a role they can apply for), fills a
**versioned, multi-step form schema**, submits an application, and — after admin review — is
granted an RBAC **role** and an activated **merchant profile**. It is a catalogue + application
state machine, not a money path (no ledger, no kobo). The security weight sits in three places:
(1) **object-level ownership** — a customer may act only on their own application (owner checks in
`service.go`, IDOR risk on `:id` routes); (2) the **grant side-effect** on approval — `grant.go`
writes to the shared `public.user_roles` + `onb_merchant_profile` tables, so approval must be
idempotent (no double grant) and audited; (3) the optional **CAC business gate** that blocks
merchant grants for merchant types flagged `requires_business`.

Routes split into three trust zones (all behind the feature flag):
customer routes under `/api/v1/onboarding` + `/api/v1/me` require only an authenticated session
(`RequireAuthContext`); admin **review** routes require `RequirePermission("onboarding.review")`;
admin **config** routes require `RequirePermission("onboarding.configure")`. Identity always comes
from the resolved auth context (`middleware.GetAuthenticatedUser` → `userID(c)`), never the body.

Cross-cutting invariants apply and are **not** repeated here: auth
(`../cross-cutting/authentication.md`), RBAC (`../cross-cutting/rbac-and-permissions.md`),
flags/audit (`../cross-cutting/feature-flags-and-audit.md`), KYC/tiers
(`../cross-cutting/kyc-and-tiers.md` — note: `requiredKycTier` is carried on the merchant type
model but is **not** enforced in `service.go`; assert that gap explicitly rather than assuming a
tier block). No money-invariants file applies — there is no money mutation in this module.

## 2. Services / endpoints in scope

19 endpoints. Customer group `/api/v1/onboarding` + `/api/v1/me` (auth only); admin group
`/api/admin/onboarding` (auth + RBAC permission).

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| List open modules | `GET /api/v1/onboarding/modules` | auth | no |
| List merchant types for a module | `GET /api/v1/onboarding/modules/:id/merchant-types` | auth | no |
| Get merchant type | `GET /api/v1/onboarding/merchant-types/:id` | auth | no |
| Get form schema | `GET /api/v1/onboarding/form-schemas/:id` | auth | no |
| Create application (DRAFT) | `POST /api/v1/onboarding/applications` | auth + owner | no |
| Save draft data | `PATCH /api/v1/onboarding/applications/:id` | auth + owner | no |
| Submit application | `POST /api/v1/onboarding/applications/:id/submit` | auth + owner + `Idempotency-Key` | no |
| Resubmit after info request | `POST /api/v1/onboarding/applications/:id/resubmit` | auth + owner | no |
| Get own application | `GET /api/v1/onboarding/applications/:id` | auth + owner | no |
| Aggregate capabilities | `GET /api/v1/me/capabilities` | auth | no |
| Review queue | `GET /api/admin/onboarding/review-queue` | `onboarding.review` | no |
| Admin get application | `GET /api/admin/onboarding/applications/:id` | `onboarding.review` | no |
| Approve → grant role + activate profile | `POST /api/admin/onboarding/applications/:id/approve` | `onboarding.review` | no |
| Reject (reason required) | `POST /api/admin/onboarding/applications/:id/reject` | `onboarding.review` | no |
| Request more info (checklist) | `POST /api/admin/onboarding/applications/:id/request-info` | `onboarding.review` | no |
| Escalate | `POST /api/admin/onboarding/applications/:id/escalate` | `onboarding.review` | no |
| Create module | `POST /api/admin/onboarding/modules` | `onboarding.configure` | no |
| Create merchant type | `POST /api/admin/onboarding/merchant-types` | `onboarding.configure` | no |
| Publish form schema version | `POST /api/admin/onboarding/merchant-types/:id/form-schemas` | `onboarding.configure` | no |

Behavioral notes to assert:
- **Error mapping** (`handler.go` `fail`): `*ValidationError` → **422** `{error,fields}`;
  `ErrNotFound` → 404; `ErrForbidden` → 403; `ErrDuplicate`/`ErrConflict`/`ErrModuleClosed` → 409;
  `ErrMissingIdemKey` → 400; `ErrValidation` → 422; default → 500.
- **Submit** requires the `Idempotency-Key` **header** (not a body field); empty/whitespace →
  `ErrMissingIdemKey` → 400. Replay with the same key on an already-`SUBMITTED`/`UNDER_REVIEW`
  row returns the current state (200) — the repo `UPDATE … WHERE status='DRAFT' OR (submit_idem_key=$key AND status IN(SUBMITTED,UNDER_REVIEW))`.
- **Submit** pins the merchant type's **currently published** schema version and derives
  server-side `checks` from `document` fields — the client cannot choose the schema version.
- **Approve** is legal from `SUBMITTED`, `UNDER_REVIEW`, **or** `APPROVED` (retry); it always
  re-runs the idempotent profile activation + role grant, but writes the `application.approved`
  audit **only** when the status was not already `APPROVED` (no duplicate audit on replay).
- **Capabilities** `kycTier` is read from the `kyc_tier` gin string via `strconv.Atoi` (0 on
  absent/garbage) — a display value, not an access gate.

## 3. Test matrix by layer

No `*_test.go` currently exists in `internal/onboarding/` — the entire matrix below is TODO,
which is itself a finding for a Tier-2 module with a role-grant side-effect.

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Form-schema validation rules (`validate.go`) | unit | — | TODO |
| Conditional `visibleWhen` skips validation | unit | — | TODO |
| `buildChecks` derives document checks | unit | — | TODO |
| Handler error→status mapping (`fail`) | con | — | TODO |
| Application lifecycle transitions | fsm | — | TODO |
| Submit idempotent-replay (no double transition/audit) | inv | — | TODO |
| Approve idempotent grant (no double role/profile/audit) | inv | — | TODO |
| Owner-only / IDOR on `:id` routes | authz | — | TODO |
| Admin RBAC permission gates | authz | `../cross-cutting/rbac-and-permissions.md` (shared) | PARTIAL |
| Audit emission on submit/decision/approve | int | `../cross-cutting/feature-flags-and-audit.md` AUDIT-INT-002/004 (shared) | PARTIAL |
| CAC business gate blocks merchant grant | authz/sec | — | TODO |
| Flag-off → routes not mounted | sec | `../cross-cutting/feature-flags-and-audit.md` FLAG-SEC-001 (shared) | PARTIAL |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `ONBOARDING-INT-001` | Create application → DRAFT | P0 | flag on; open merchant type `mt-rider`; `qa-user-a` has no active app for it | `POST /applications` | `{merchantTypeId:"mt-rider",data:{}}` | 201; `data.status="DRAFT"`, `userId=qa-user-a` |
| `ONBOARDING-INT-002` | Save draft data | P1 | DRAFT app `app-1` owned by `qa-user-a` | `PATCH /applications/app-1` | `{data:{fullName:"Ada"}}` | 200; `data.data.fullName="Ada"` persisted |
| `ONBOARDING-INT-003` | Submit valid draft → SUBMITTED | P0 | DRAFT `app-1`, published schema has required fields all filled | `POST /applications/app-1/submit` + `Idempotency-Key: sub-1` | valid data | 200; `status="SUBMITTED"`, `formSchemaVersion` pinned, `checks` populated; audit `application.submitted` |
| `ONBOARDING-INT-004` | Approve → grant role + activate profile | P0 | `app-1` SUBMITTED; reviewer holds `onboarding.review`; role slug provisioned | `POST /admin/.../app-1/approve` | — | 200; `status="APPROVED"`; row in `user_roles` (global) for `qa-user-a`; `onb_merchant_profile` ACTIVE; audit `application.approved` with `roleGranted` |
| `ONBOARDING-INT-005` | Catalogue reads return arrays | P2 | flag on; ≥1 open module | `GET /modules`, `/modules/:id/merchant-types` | — | 200; `data` is a JSON array (never null) |
| `ONBOARDING-INT-006` | Capabilities aggregate | P1 | `qa-user-a` has 1 profile + 1 active app | `GET /me/capabilities` | — | 200; `customer=true`, `merchants[]`, `activeApplications[]`, `kycTier` echoes `kyc_tier` |
| `ONBOARDING-INT-007` | Reject with reason | P0 | `app-2` UNDER_REVIEW; reviewer perm | `POST /admin/.../app-2/reject` | `{reason:"blurry ID"}` | 200; `status="REJECTED"`, `decisionReason` set; audit `application.rejected` |
| `ONBOARDING-INT-008` | Request info then resubmit | P1 | `app-3` SUBMITTED | `POST request-info {checklist:["re-upload ID"]}` then owner `POST resubmit` | checklist | request-info→`NEEDS_MORE_INFO`; resubmit→`UNDER_REVIEW`; audits `info_requested` + `resubmitted` |
| `ONBOARDING-CON-001` | Create missing `merchantTypeId` | P1 | flag on | `POST /applications` no `merchantTypeId` | `{data:{}}` | 400 (binding `required`); nothing inserted |
| `ONBOARDING-CON-002` | Create for closed merchant type | P1 | `mt-closed` status≠`open` | `POST /applications` | `{merchantTypeId:"mt-closed"}` | 409 `merchant type not open` (`ErrModuleClosed`) |
| `ONBOARDING-CON-003` | Duplicate active application | P0 | `qa-user-a` already has DRAFT for `mt-rider` | `POST /applications` same type | `{merchantTypeId:"mt-rider"}` | 409 duplicate message (`ErrDuplicate`; also caught by unique partial index on race) |
| `ONBOARDING-CON-004` | Submit without `Idempotency-Key` header | P0 | DRAFT `app-1` | `POST submit` with no/blank header | valid data | 400 `Idempotency-Key header required`; status stays `DRAFT` |
| `ONBOARDING-CON-005` | Submit fails schema validation | P0 | DRAFT `app-1` missing a required schema field | `POST submit` + header | data missing `email` | 422 `{error:"validation failed",fields:{email:"required"}}`; status stays `DRAFT`; no audit |
| `ONBOARDING-CON-006` | Field-type validation | P1 | schema with `email`+`phone`+`select` | `POST submit` with bad values | `{email:"nope",phone:"12",role:"x"}` | 422 with per-field messages (`invalid email` / `invalid phone` / `not an allowed option`) |
| `ONBOARDING-CON-007` | Reject missing reason | P1 | `app-2` reviewable | `POST reject` empty body / blank reason | `{}` | 400 `reason is required` (blank reason also → 422 `ErrValidation` at service) |
| `ONBOARDING-CON-008` | Request-info empty checklist | P1 | `app-2` reviewable | `POST request-info` | `{checklist:[]}` | 400 `checklist is required`; state unchanged |
| `ONBOARDING-CON-009` | Publish schema missing `steps`/`version` | P2 | reviewer holds `onboarding.configure` | `POST merchant-types/:id/form-schemas` | `{}` | 400 (binding `required`) |
| `ONBOARDING-AUTHZ-001` | Unauthenticated rejected | P0 | no token | `GET /modules` | — | 401 (see `../cross-cutting/authentication.md`) |
| `ONBOARDING-AUTHZ-002` | SaveDraft on another user's app (IDOR) | P0 | `app-1` owned by `qa-user-a`; token `qa-user-b` | `PATCH /applications/app-1` | `{data:{}}` | 403 `forbidden` (`ErrForbidden`); nothing written |
| `ONBOARDING-AUTHZ-003` | Get another user's application (IDOR) | P0 | `app-1` owner `qa-user-a`; token `qa-user-b` | `GET /applications/app-1` | — | 403 `forbidden`; no data leaked |
| `ONBOARDING-AUTHZ-004` | Review route without `onboarding.review` | P0 | authed user lacking perm | `GET /admin/onboarding/review-queue` | — | 403 fail-closed (see `../cross-cutting/rbac-and-permissions.md`) |
| `ONBOARDING-AUTHZ-005` | Config route without `onboarding.configure` | P0 | user with `onboarding.review` only | `POST /admin/onboarding/modules` | valid module | 403 (config perm required, distinct from review) |
| `ONBOARDING-AUTHZ-006` | Spoofed body `user_id` ignored | P0 | token `qa-user-a` | `POST /applications` with extra `user_id:"qa-user-b"` | body has victim id | Application owned by `qa-user-a` (identity from auth context, not body) |
| `ONBOARDING-INV-001` | Submit idempotent replay | P0 | DRAFT `app-1` | `POST submit` twice, same `Idempotency-Key: sub-r1` | valid data | 2nd returns current SUBMITTED state (200); no second transition; single `application.submitted` audit |
| `ONBOARDING-INV-002` | Approve replay → no double grant/audit | P0 | `app-1` already APPROVED | `POST approve` again | — | 200; `user_roles`/`onb_merchant_profile` unchanged (idempotent upserts); **no** second `application.approved` audit (written only when status≠APPROVED) |
| `ONBOARDING-INV-003` | Illegal transition rejected | P1 | `app-1` SUBMITTED | `PATCH /applications/app-1` (SaveDraft) | `{data:{}}` | 409 `ErrConflict` (SaveDraft legal only from DRAFT) |
| `ONBOARDING-SEC-001` | Flag off → routes not mounted | P0 | `FEATURE_ONBOARDING_ENABLED=false` | Call any onboarding route | valid | 404 (Register returns nil, routes skipped); never 500 (see `../cross-cutting/feature-flags-and-audit.md` FLAG-SEC-001) |
| `ONBOARDING-SEC-002` | Business gate blocks merchant grant at submit | P0 | `mt-merchant.requiresBusiness=true`; gate injected; `qa-user-a` has no verified CAC business | `POST submit` | valid data | 422 `{fields:{business:"…verified CAC business is required…"}}`; status stays DRAFT (see §6) |
| `ONBOARDING-SEC-003` | Business gate re-checked at approve (defense-in-depth) | P0 | as above but app already SUBMITTED (gate added later); reviewer approves | `POST approve` | — | 422 business error; **no** role granted, **no** profile activated (gate uses applicant id, not reviewer) |

## 5. State-machine transitions

Application status lifecycle (`onb_application.status`). Guarded transitions live in
`service.go` + `repository.go` (`SubmitApplication`, `ResubmitApplication`, `TransitionStatus`).
Every guarded `UPDATE … WHERE status IN (fromStates)` returns rows-affected `0` on an illegal
source state, which the service maps to `ErrConflict` → **409**.

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| DRAFT | Submit (valid, idem key) | SUBMITTED | schema version pinned; `checks` built; audit `submitted` | `ONBOARDING-FSM-001` |
| SUBMITTED / UNDER_REVIEW | RequestInfo (checklist) | NEEDS_MORE_INFO | checklist stored; audit `info_requested` | `ONBOARDING-FSM-002` |
| NEEDS_MORE_INFO | Resubmit (owner) | UNDER_REVIEW | audit `resubmitted` | `ONBOARDING-FSM-003` |
| SUBMITTED / UNDER_REVIEW | Escalate | UNDER_REVIEW | audit `escalated`; ownership unchanged | `ONBOARDING-FSM-004` |
| SUBMITTED / UNDER_REVIEW | Approve | APPROVED | **grant role + activate profile**; audit `approved` | `ONBOARDING-FSM-005` |
| SUBMITTED / UNDER_REVIEW / NEEDS_MORE_INFO | Reject (reason) | REJECTED | reason stored; audit `rejected` | `ONBOARDING-FSM-006` |
| APPROVED | Approve (retry) | APPROVED | idempotent re-grant; **no** new audit | `ONBOARDING-FSM-007` |

Illegal transitions to assert are rejected with 409 `ErrConflict` (rows-affected 0):
- `ONBOARDING-FSM-008` — SaveDraft from any non-DRAFT state (also `ONBOARDING-INV-003`).
- `ONBOARDING-FSM-009` — Resubmit from a state other than NEEDS_MORE_INFO.
- `ONBOARDING-FSM-010` — Approve from DRAFT / NEEDS_MORE_INFO / REJECTED (not in legal set).
- `ONBOARDING-FSM-011` — Reject from DRAFT or already-terminal REJECTED/APPROVED.
- `ONBOARDING-FSM-012` — Re-entering terminal REJECTED via any admin action is a no-op/409,
  never a silent second decision. APPROVED re-entry is the only idempotent terminal (FSM-007).

## 6. Security & abuse cases

- **Object-level ownership / IDOR** — every customer `:id` route re-fetches the application and
  compares `app.UserID` to the token user (`ErrForbidden` → 403). Covered by
  `ONBOARDING-AUTHZ-002/003`. Admin `GetApplication` passes `isReviewer=true` to bypass the owner
  check — assert that bypass is reachable **only** behind `onboarding.review`.
- **RBAC fail-closed** — review vs configure are **separate** permissions on nested groups;
  holding one must not grant the other (`ONBOARDING-AUTHZ-004/005`; see
  `../cross-cutting/rbac-and-permissions.md`).
- **Identity spoofing** — `user_id` sourced only from `middleware.GetAuthenticatedUser`; a body
  `user_id` is ignored (`ONBOARDING-AUTHZ-006`; see `../cross-cutting/authentication.md`).
- **Idempotency / replay of the grant** — approval touches shared RBAC tables; the idempotent
  upserts (`ON CONFLICT` in `grant.go`) plus the audit-only-on-first-approve guard prevent double
  grants/audits (`ONBOARDING-INV-002`; see `../cross-cutting/feature-flags-and-audit.md`
  AUDIT-INT-004). Submit replay guarded by `submit_idem_key` (`ONBOARDING-INV-001`).
- **Merchant-upgrade gate** — `requires_business` merchant types must not be granted without a
  verified CAC business; enforced at **both** submit and approve using the **applicant's** id, not
  the reviewer's (`ONBOARDING-SEC-002/003`). A nil gate disables the check (legacy behavior) —
  assert that the gate is actually wired in the target env before relying on it.
- **Missing `requiredKycTier` enforcement** — the merchant type carries `requiredKycTier` but no
  code path enforces it; document as a design gap (flag in report) rather than assuming a block.
- **Injection on free-text inputs** — `data` (arbitrary JSON), `reason`, `note`, `checklist[]`
  are stored via parameterized pgx queries (`$n`); assert no interpolation. `writeAudit` casts
  `target_user_id` via `NULLIF(...)::uuid` — a non-UUID applicant id would surface as a DB error,
  not silent success.
- **Fail-closed on flag off** — `ONBOARDING-SEC-001` (404, never 500).
- **Unknown role slug on approve** — if `mt.RoleToGrant` is not a provisioned active role,
  `grantRole` returns `granted=false` and Approve errors (`role not provisioned`) **before**
  status flips to APPROVED — assert no half-approval. Add as `ONBOARDING-SEC-004` when specced.

## 7. Automated specs to add

- `internal/onboarding/validate_test.go` — table-driven `ValidateSubmission`: required/empty,
  each field type (text/email/phone/number+min/max/currency/boolean/date/select/multiselect+maxSelections/address/document),
  `visibleWhen` conditional skipping, `buildChecks` document-field derivation. Pure logic, no DB.
- `internal/onboarding/handler_test.go` — httptest table over `fail()` mapping: 400/403/404/409/422
  for each sentinel + `*ValidationError` shape `{error,fields}`; Submit-missing-header → 400;
  spoofed-body-`user_id` ignored. Fake `*Service` seam via `httptest.NewRecorder`.
- `backend/tests/onboarding_lifecycle_test.go` — DB-backed (gated on `TEST_DATABASE_URL`):
  full FSM (§5) incl. illegal transitions → 409; submit idempotent replay (single audit);
  approve idempotent grant (one `user_roles` row, one `onb_merchant_profile`, one audit on replay);
  owner/IDOR 403; business-gate block at submit + approve. Mirrors existing `backend/tests/`
  domain-suite convention.
- `internal/onboarding/grant_test.go` — assert `grantRole` returns `false` for unknown slug and
  is a no-op on the `ON CONFLICT` retry; `activateProfile` upsert idempotency.

Mark all four TODO in the traceability matrix (§3).

## 8. Coverage target & exit criteria

Tier-2 module: target ≥ 75% on `validate.go` + `service.go` transition/guard logic (pure and
DB-guard paths). **Exit criteria (all must be green before release):** ONBOARDING-INT-003,
ONBOARDING-INT-004, ONBOARDING-INV-001, ONBOARDING-INV-002, ONBOARDING-AUTHZ-002,
ONBOARDING-AUTHZ-003, ONBOARDING-AUTHZ-004, ONBOARDING-AUTHZ-005, ONBOARDING-SEC-001,
ONBOARDING-SEC-003, and the illegal-transition FSM set (ONBOARDING-FSM-008..012). Any red among
these — especially a double role grant, a cross-user application mutation, or an admin route
reachable without its RBAC permission — is a **do-not-ship** blocker.
