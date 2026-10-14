# Admin User Profile — Phase 1b design

**Date:** 2026-10-14
**Status:** Design (pre-implementation)
**Branch:** `feat/admin-user-profile-phase1b` (stacked on `feat/admin-user-profile-page` / PR #746)

## Purpose

Admins need a single per-user page to **see and manage** a platform user: who they
are, the roles/RBAC they hold, their wallet, their KYC standing, and their recent
login/security activity. Today `/admin/users` lists users and (via #746) opens a
per-user page that covers only identity + account actions. This phase adds the four
remaining panels so an admin can resolve a support or compliance question about one
user without hopping between the roles screen, the finance console, the KYC queue,
and the audit log.

**Who it's for:** platform admins (console operators), gated by existing RBAC
permissions. **Success:** from `/admin/users/<id>` an admin can read roles, wallet,
KYC, and activity, assign/remove a role, and approve/reject an open KYC case, with
each panel honouring its own permission and failing independently.

## Scope

This is **Phase 1b** of a decomposed feature. Phasing agreed with the user:

- **Phase 1a — done, in review (#746):** page shell + identity/status/account panel
  (details, edit, Suspend/Unsuspend/Lock/Unlock). *Not modified here beyond adding
  panels below it.*
- **Phase 1b — THIS spec:** roles (view + manage), wallet (read-only), KYC (status +
  approve/reject), login & security activity.
- **Phase 2 — later:** referrals / tier summary.
- **Phase 3 — later:** cross-module activity (orders/rides/votes) — needs its own
  design; no aggregate endpoint exists today.

**Explicitly out of scope for 1b:** referrals, cross-module activity, any new tier
logic, any wallet mutation, any change to the identity/account panel from #746.

## Architecture & data flow

The page (`frontend-admin/app/admin/users/[id]/page.tsx`, already a client component
from #746) gains four panels **below** the existing account section. On mount it
fires the account read (#746) plus four independent reads in parallel through the
admin-proxy (`/api/admin-proxy/[...path]`, which attaches `x-admin-api-key` and
forwards to the Go backend).

Chosen approach: **frontend fan-out to existing/thin endpoints** (Approach A of the
brainstorm). Rejected: a single aggregate backend endpoint (Approach B) — it would
collapse four distinct permissions into one handler, let one slow/failing domain
stall every panel, and add materially more backend code for a read the client can
already compose. Fan-out matches the console's established pattern and #746's own
per-section loading/error handling.

Each panel owns its own loading / empty / error / permission-denied state. One
domain failing (e.g. wallet 500, or a 403 because the admin lacks that permission)
renders an inline message **in that panel only** — it never blanks the page or the
other panels.

## Endpoints

### New backend surface (two thin GETs)

1. **`GET /api/admin/users/:id/roles`** — permission `users.view`.
   Wraps the existing `rbacService.GetUserRoles(ctx, id)` (repository
   `RBACSupabaseRepository.GetUserRoles`), which returns active role **slugs**
   (`[]string`, from `user_roles` joined to `roles`, `is_active = true`).
   Response: `{ "roles": ["admin", "support", ...] }`.
   New handler mounted in the `rbacAdmin` group in
   `backend/internal/app/router.go` alongside the existing
   `POST /users/:id/roles` and `DELETE /users/:id/roles/:roleId`.

2. **`GET /api/finance/admin/kyc/users/:id`** — permission `finance.admin.kyc`.
   Returns the user's KYC standing plus the id of their current open case (so the
   decision buttons have a target):
   `{ "tier": <int>, "status": "<string>", "openCaseId": "<uuid|null>" }`.
   Reads `user_profiles.kyc_tier` / `kyc_status` (same source as
   `kyc.Handler.GetMe`) and looks up the user's latest unresolved `kycverify` case.
   New thin handler mounted in the `kvAdmin` group
   (`r.Group("/api/finance/admin/kyc")`) in
   `backend/internal/app/finance_routes.go`.

### Existing endpoints reused (no backend change)

| Use | Endpoint | Permission |
|---|---|---|
| Assign role | `POST /api/admin/users/:id/roles` (body `{role}`) | `users.roles.assign` |
| Remove role | `DELETE /api/admin/users/:id/roles/:roleId` | `users.roles.assign` |
| Role catalog (picker) | existing `rbacAdmin` roles list | `roles.view` (as today) |
| Wallet balance | `GET /api/finance/admin/wallets/:id/balance` | `finance.admin.transfers` |
| Wallet transactions | `GET /api/finance/admin/wallets/:id/transactions` | `finance.admin.transfers` |
| KYC approve | `POST /api/finance/admin/kyc/cases/:caseId/approve` | `finance.admin.kyc` |
| KYC reject | `POST /api/finance/admin/kyc/cases/:caseId/reject` | `finance.admin.kyc` |
| Login activity | `GET /api/admin/users/login-activity?actorUser=:id&limit=50` | `audit.logs.view` |
| Security events | `GET /api/admin/users/security-events?actorUser=:id&limit=50` | `audit.logs.view` |

The audit endpoints already map `?actorUser=` (and `?targetUser=`) via
`auditFilterFromQuery` in `backend/internal/handlers/admin_overview.go`, so no
backend change is needed for Panel 5. Login activity filters on `actorUser` (the
user is the one who logged in). For security events, confirm during planning whether
rows key on actor or target against the actual row semantics, and filter on
whichever identifies *this user as the subject* (defaulting to `actorUser`).

## Panels

**Panel 1 — Identity & account** *(from #746, unchanged here.)*

**Panel 2 — Roles (view + manage).** Chip list of the user's current role slugs,
each with a remove ✕ that is rendered only when the operator holds
`users.roles.assign`. An "Assign role" dropdown sourced from the console's roles
catalog; selecting assigns via `POST` then refetches the roles list. Remove calls
`DELETE .../roles/:roleId` then refetches. (Note: `GetUserRoles` returns slugs; the
picker maps slugs to display names via the catalog it already loads.)

**Panel 3 — Wallet (read-only).** Balance rendered kobo→₦, and a recent-transactions
table from `/transactions`. No mutation controls at all.

**Panel 4 — KYC (status + approve/reject).** Shows tier + status from the new
per-user read. Approve / Reject buttons render **only when `openCaseId` is non-null**
and target that case id via the existing case endpoints; on success the panel
refetches its status.

**Panel 5 — Login & security activity.** Two read-only lists (login activity;
security events), newest first, `limit=50`, filtered to this user via `actorUser`
(see the endpoints table note on the security-events param).

## Permissions & error handling

The four panels span four permissions (`users.view`, `finance.admin.transfers`,
`finance.admin.kyc`, `audit.logs.view`), so an operator may hold some and not others.
Behaviour is uniform and per-panel:

- **200** → render the panel.
- **403** → inline "You don't have permission to view this." placeholder; no retry.
- **other error** → inline error text + a Retry button that re-fires only that
  panel's read.
- The page itself remains usable regardless of any panel's outcome. A real **404**
  on the *account* read still shows "User not found" (that is #746's behaviour and is
  unchanged).

Write actions (assign/remove role, approve/reject KYC) surface their own success or
error inline next to the control and refetch the owning panel on success.

## Testing

**Frontend (vitest / RTL), extending `app/admin/users/[id]/profile.test.tsx`:**
- Each panel: loaded / empty / error / 403 states render correctly and in isolation
  (a failing wallet read does not blank roles).
- Roles: assign and remove fire the correct calls and refetch; remove ✕ hidden
  without `users.roles.assign`.
- KYC: approve/reject render only when `openCaseId` is present and POST to that case
  id; hidden when no open case.
- Wallet: renders read-only — assert there are no mutation controls.

**Backend (`go test`), table tests for the two new handlers:**
- `GET /users/:id/roles`: happy path (slugs), empty (no roles), permission-denied.
- `GET /finance/admin/kyc/users/:id`: tier/status + open case present; no open case
  (`openCaseId: null`); permission-denied.

No money-path mutation is introduced (wallet is read-only; KYC decisions reuse the
existing audited case endpoints), so no new ledger invariants and no `ledger-auditor`
gate. Both new reads touch authz/PII, so request **`security-reviewer`** on the PR.

## Delivery

- Stacked on `feat/admin-user-profile-page` (#746). If #746 merges first, rebase onto
  `main`; the only shared file is `page.tsx` (we append panels below #746's account
  section).
- Feature-flag: the page is already reachable via #746 behind the existing
  `/admin/users` route guard (`users.view`); the new panels are permission-gated, so
  no separate flag is required. (Confirm during planning whether the module's
  convention still wants a flag; CLAUDE.md says "no flag, no merge" for **new
  modules** — this is an extension of an existing admin surface, not a new module.)
- Conventional Commits; PR < 400 lines where practical (frontend panels + two Go
  handlers + tests).

## Open items for the implementation plan

- Exact `kycverify` case table/column names for "latest open case" (resolve against
  the schema when writing the plan).
- Whether the roles catalog endpoint returns display names or only slugs (affects the
  picker label mapping).
- Transaction row shape from `AdminListTransactions` (for the wallet table columns).
