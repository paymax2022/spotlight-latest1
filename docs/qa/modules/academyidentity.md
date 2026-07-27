# Module: Academy Identity (Identity Bridge)

**Risk tier:** 2 &nbsp;·&nbsp; **Money-path:** no &nbsp;·&nbsp; **Feature flag:** `FEATURE_ACADEMY_ENABLED` (registered unconditionally in `RegisterAcademy`; member base `/api/finance`, admin base `/api`)
**Code:** `backend/internal/academy/identity/` — `handler.go`, `service.go`, `model.go`, `repository.go`, `identity_test.go`; wiring in `backend/internal/app/academy_routes.go` (`RegisterAcademyIdentity`).
**Slug:** `ACADEMYIDENTITY`

## 1. Overview & scope

Identity bridge that layers **additive** academy roles (learner/parent/tutor/staff) onto the single
Paymax `auth.users` record — never a parallel auth store. It manages academy profiles, guardian
links (a guarded FSM `pending → active → revoked`), and immutable consent records. Minors require an
active `GuardianLink` + a `ConsentRecord` before value-bearing/social capabilities unlock; the pure
gate `canUnlock` combines KYC tier (min tier 1 for purchases/community/data_sharing) and consent.
Every mutation writes to `public.audit_logs`. Member routes resolve the caller from the token; admin
routes are gated by `academy.identity`.

Applicable cross-cutting: `../cross-cutting/authentication.md`,
`../cross-cutting/rbac-and-permissions.md` (admin `academy.identity`),
`../cross-cutting/kyc-and-tiers.md` (capability tier gate), `../cross-cutting/feature-flags-and-audit.md`.

## 2. Services / endpoints in scope

Member group `/academy` (base `/api/finance`); admin group `/academy` (base `/api`).

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| Get my identity | `GET /academy/me` | member (token) | no |
| Grant academy role (self) | `POST /academy/roles` | member; owner=caller | no |
| Upsert profile | `PUT /academy/profile` | member; owner | no |
| Link guardian→minor | `POST /academy/guardians/link` | member; caller is guardian | no |
| Record consent | `POST /academy/guardians/:minorId/consent` | member; caller is guardian+actor | no |
| Admin lookup user | `GET /academy/admin/users/:id` | `academy.identity` | no |
| Admin revoke guardian | `POST /academy/admin/guardians/:id/revoke` | `academy.identity` | no |

Roles: learner/parent/tutor/staff. GuardianStatus: pending/active/revoke. Consent `Scope` is a
free-form object (e.g. `{"purchases":true,"community":true,"data_sharing":false}`), immutable.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage | Status |
|---|---|---|---|
| Minor consent+tier gate (`canUnlock`) | unit | `identity_test.go::TestCanUnlock_MinorConsentGate` | AUTOMATED |
| Open capability (tier 0) | unit | `identity_test.go::TestCanUnlock_OpenCapability` | AUTOMATED |
| Min tier per capability | unit | `identity_test.go::TestMinTierForCapability` | AUTOMATED |
| Role validity guard | unit | `identity_test.go::TestValidRole_GrantGuard` | AUTOMATED |
| Guardian FSM pending→active→revoked (service) | integration | — | TODO |
| Admin lookup/revoke authz | integration/authz | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `ACADEMYIDENTITY-INT-001` | Get my identity aggregates roles/profiles/links | P1 | user with role+profile+links | `GET /academy/me` | — | 200; `roles`, `profiles`, `guardian_links`, `guarded_by` populated |
| `ACADEMYIDENTITY-INT-002` | Grant valid role | P1 | authed learner | `POST /academy/roles {role:"parent"}` | valid | 200; role added (additive) |
| `ACADEMYIDENTITY-INT-003` | Upsert profile | P2 | authed | `PUT /academy/profile {role:"learner",...}` | valid | 200; profile row upserted |
| `ACADEMYIDENTITY-INT-004` | Link guardian creates pending link | P1 | guardian + minor users | `POST /academy/guardians/link {minor_user_id}` | — | 201; link `status=pending` |
| `ACADEMYIDENTITY-INT-005` | Record consent flips link to active | P0 | pending link exists | `POST /academy/guardians/:minorId/consent {scope}` | scope obj | 201; consent created; link `pending→active` atomically |
| `ACADEMYIDENTITY-VAL-001` | Invalid role rejected | P1 | authed | `POST /academy/roles {role:"admin"}` | invalid | 400 `invalid_role` |
| `ACADEMYIDENTITY-VAL-002` | Missing body rejected | P2 | authed | `POST /academy/roles {}` | — | 400 `invalid_body` |
| `ACADEMYIDENTITY-VAL-003` | Consent on non-pending link rejected | P1 | link already active | record consent again | — | 409 `illegal_transition` (no pending link) |
| `ACADEMYIDENTITY-AUTHZ-001` | Admin lookup denied without permission | P0 | caller lacks `academy.identity` | `GET /academy/admin/users/:id` | — | 403 `forbidden` (RBAC-AUTHZ-001) |
| `ACADEMYIDENTITY-AUTHZ-002` | Admin lookup allowed for holder | P1 | holder | same | — | 200 |
| `ACADEMYIDENTITY-AUTHZ-003` | Unauthenticated member route | P0 | no token | `GET /academy/me` | — | 401 `authentication_required` |
| `ACADEMYIDENTITY-SEC-001` | Minor purchase capability gated | P0 | minor, no consent / tier 0 | check `CanUnlockCapability("purchases")` | — | Denied — tier checked first, then consent (`canUnlock`) |
| `ACADEMYIDENTITY-SEC-002` | Consent is immutable | P1 | consent recorded | attempt to modify historical consent | — | No mutation path; revocation flips link, consent row intact |
| `ACADEMYIDENTITY-SEC-003` | Academy flag-off route inaccessible | P0 | `FEATURE_ACADEMY_ENABLED` off | Call any identity endpoint | — | Not mounted / 404 — never 500 (FLAG-SEC-001) |

## 5. State-machine transitions

**Guardian link** (`academy_guardian_links.status`):

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| pending | record consent | active | consent record created; audited | `ACADEMYIDENTITY-FSM-001` |
| active | admin revoke | revoked (terminal) | audit `academy.guardian.revoked`; consent history retained | `ACADEMYIDENTITY-FSM-002` |

Illegal transitions rejected `ErrIllegalTransition` (consent on non-pending link, revoke of a
non-active link) and audited.

## 6. Security & abuse cases

- **Capability gate** `canUnlock`: tier checked before consent; a minor without active consent OR
  below tier 1 is denied purchases/community/data_sharing (`ACADEMYIDENTITY-SEC-001`; see
  `kyc-and-tiers.md`).
- **Immutable consent:** consent rows never updated/deleted; revocation flips the link only.
- **IDOR/self-scope:** member routes act on the token identity (caller is guardian/actor); admin
  lookup/revoke require `academy.identity`.
- **Additive roles:** roles layered onto the single Paymax identity — never a parallel auth store.

## 7. Automated specs to add

- `identity/service_guardian_fsm_test.go` — pending→active on consent, active→revoked on admin
  revoke, illegal transitions rejected + audited. TODO.
- `identity/authz_test.go` — admin lookup/revoke denied without `academy.identity`. TODO.

## 8. Coverage target & exit criteria

Pure gate logic covered by `identity_test.go`. Exit: guardian FSM + audit proven; capability gate
denies minors correctly; admin authz green; flag-off inaccessible.
