# Cross-cutting: RBAC & Permissions

**Risk tier: 0.** Applies to every permission-gated action across all modules and both admin
consoles. Source of truth: `backend/internal/middleware/authorization.go`
(`RequirePermission`, `RequireScopedPermission`), `backend/internal/services/rbac_service.go`
(business-rule guards), `backend/internal/repositories/rbac_repository.go` +
`rbac_supabase_repository.go`, `backend/internal/handlers/rbac_handler.go` +
`admin_users_handler.go`. Personas integration test:
`backend/internal/middleware/authorization_personas_test.go`.

## 1. How authorization works here (test-relevant facts)

- `RequirePermission(rbac, "slug")` — global-scope check. Denies with **403 `forbidden`** when
  `CheckPermission` returns `false` **or an error** (deny-by-default / fail-closed). Denies
  **401 `unauthenticated`** if no `authUser` on context (auth middleware must run first).
- `RequireScopedPermission(rbac, "slug", scopeType, scopeIDParam)` — same, but pulls the scope
  id from a path param (e.g. per-school, per-property, per-association) and checks the grant
  **within that scope**. A grant in scope A must not authorize an action in scope B.
- Service-layer business-rule guards in `rbac_service.go` (these are invariants, not just
  middleware):
  - **System roles** cannot be updated or deleted (`existing.IsSystem` → error).
  - **System permissions** cannot be updated or deleted.
  - **Critical permissions** — `votes.override`, `payments.refund`, `permissions.assign`,
    `roles.delete`, `users.roles.assign`, `permissions.delete` — can **only be assigned by a
    `super-admin`**; anyone else → `critical permissions can only be assigned by super admin`.
  - **Last-super-admin invariant:** removing the `super-admin` role from the final holder →
    `cannot remove last super admin`.
- User lifecycle (`SuspendUser`/`LockUser`/…) feeds the auth status gate in
  `authentication.md` (suspended/locked/deleted → 403 at the auth layer).

## 2. Test matrix by layer

| Behavior | Layer | Existing coverage |
|---|---|---|
| Deny-by-default + scope isolation (personas) | integration | `authorization_personas_test.go` |
| Service guards (system role/perm, critical-perm, last-super-admin) | unit | `rbac_service_test.go` (per TEST_STRATEGY) |
| Allowed vs denied per protected endpoint | integration | **partial** — per-module cases below |
| Admin RBAC journey (grant→use→revoke→deny) | e2e | **gap G4** |

## 3. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| RBAC-AUTHZ-001 | Deny-by-default | P0 | `qa-user-a` with no relevant permission | Call a `RequirePermission`-gated admin endpoint | — | 403 `forbidden` |
| RBAC-AUTHZ-002 | Allowed caller succeeds | P0 | `qa-admin` holds the permission | Same endpoint | — | 200 |
| RBAC-AUTHZ-003 | Unauthenticated on gated route | P0 | no token | Call gated endpoint | — | 401 `unauthenticated` (auth layer) |
| RBAC-AUTHZ-004 | CheckPermission error → fail-closed | P0 | force `CheckPermission` to error (DB down) | Call gated endpoint | — | 403 `forbidden` (never allow-on-error) |
| RBAC-AUTHZ-005 | Scoped grant authorizes only its scope | P0 | `qa-school-admin` granted `academy.school.manage` in school S1 | Act on S1 (allow), then S2 (deny) | scopeId S1, S2 | S1 → 200; S2 → 403 |
| RBAC-AUTHZ-006 | Scope-id from path, not body | P0 | scoped grant in S1 | Call `.../S2/...` but put `scopeId=S1` in body | — | 403 (scope comes from path param only) |
| RBAC-AUTHZ-007 | Object-level / IDOR baseline | P0 | `qa-user-a` owns record R | `qa-user-b` calls action on R | R id | 403/404; B cannot act on A's record |
| RBAC-UNIT-001 | System role cannot be updated | P0 | a system role exists | Attempt update via `rbac_service.UpdateRole` | — | error `system roles cannot be updated` |
| RBAC-UNIT-002 | System role cannot be deleted | P0 | — | Attempt delete | — | error `system roles cannot be deleted` |
| RBAC-UNIT-003 | System permission immutable | P0 | a system permission | Attempt update/delete | — | error `system permissions cannot be updated/deleted` |
| RBAC-SEC-001 | Critical permission — non-super-admin blocked | P0 | `qa-admin` (not super) | Assign `payments.refund` to a role | slug `payments.refund` | error `critical permissions can only be assigned by super admin` |
| RBAC-SEC-002 | Critical permission — super-admin allowed | P0 | `qa-super-admin` | Assign `payments.refund` | — | success |
| RBAC-SEC-003 | Each critical slug enforced | P0 | `qa-admin` | Attempt to assign each of `votes.override`, `permissions.assign`, `roles.delete`, `users.roles.assign`, `permissions.delete` | all 6 slugs | each rejected for non-super-admin |
| RBAC-INV-001 | Cannot remove last super admin | P0 | exactly one `super-admin` holder | Remove `super-admin` from that user | — | error `cannot remove last super admin`; role retained |
| RBAC-INV-002 | Can remove a super admin when others remain | P1 | two super-admins | Remove role from one | — | success; one super-admin remains |
| RBAC-AUTHZ-008 | Permission matrix read | P2 | `qa-admin` with `permissions.read` | `GET` permission matrix | — | 200; matrix reflects seeded grants |
| RBAC-AUTHZ-009 | Bulk assign respects per-item guards | P1 | `qa-admin` | Bulk-assign a set incl. a critical perm | mixed slugs | Non-critical succeed; critical item rejected per-item |
| RBAC-E2E-001 | Grant → use → revoke → deny | P0 | staging, `qa-super-admin` | Grant `finance.disputes.manage` to `qa-admin`; qa-admin resolves a dispute (allow); revoke; qa-admin retries (deny) | — | Allowed while granted, 403 after revoke; audit entries written |

## 4. Domain-specific authorization variants (test each where it applies)

- **STEM authz** (`middleware/stem_authz.go`): `RequireStemRoles(...)` via `x-stem-role` header.
  Case: missing/incorrect `x-stem-role` → denied; correct role → allowed. (STEM module file.)
- **Guard/GuardFunc closure** pattern (`creators`, `spray`, `loyalty`, `p2pmarket`,
  `insurance`, referral sub-modules): each module file carries its allowed-vs-denied cases for
  the specific guard it installs.
- **Admin-key & service-token** gates: see `session-and-tokens.md`.

## 5. Security & abuse cases

- **Privilege escalation via self-grant:** a non-super-admin must not grant themselves a
  critical permission or the `super-admin` role (RBAC-SEC-001/003).
- **Scope leakage:** re-run RBAC-AUTHZ-005/006 for every scoped module (academy schools,
  estate, association, stays extranet) — a scoped grant must be strictly confined.
- **Deny-on-error everywhere:** RBAC-AUTHZ-004 must hold on every gate (fail-closed is the
  contract; an errored permission check is a denial, not an allow).

## 6. Automated specs to add

- Extend `rbac_service_test.go` to cover all 6 critical slugs (RBAC-SEC-003) and the
  two-super-admin case (RBAC-INV-002) if not present. (verify/extend)
- `authorization_scope_test.go` — table-driven scope isolation for `RequireScopedPermission`
  (grant in S1, assert allow S1 / deny S2). (gap)
- Playwright `admin-rbac-journey.spec.ts` for RBAC-E2E-001. (gap G4)

## 7. Coverage target & exit criteria

RBAC middleware + service ≥ 85% on pure-logic funcs. Exit: deny-by-default, fail-closed,
scope isolation, all critical-permission guards, and last-super-admin invariant proven; the
grant→revoke e2e green on staging.
