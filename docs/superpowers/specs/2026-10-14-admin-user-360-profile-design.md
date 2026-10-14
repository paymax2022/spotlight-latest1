# Admin User Profile — 360° view (Phase 3) design

**Date:** 2026-10-14
**Status:** Design (pre-implementation) — awaiting review
**Builds on:** `2026-10-14-admin-user-profile-phase1b-design.md` (#746, #750), open PRs #752 (authz/KYC guard) and #753 (Phase 2 tier/referral panel)

## Purpose

An admin opening `/admin/users/<id>` should be able to answer "who is this person and
what do they do on the platform?" without visiting another console page: their photo
and verification state, **every module they have onboarded into** (e.g. restaurant
owner, marketplace seller, driver, doctor), their **full transaction history**, their
**referral code and referral activity**, what **other admins have done to them**, and
their **active sessions**. Phases 1a–2 already cover account, roles, wallet balance,
KYC, login/security events and tier/referral standing; this phase adds what is still
missing.

**Who it's for:** platform admins, gated by existing RBAC permissions.
**Success:** from one page an admin can see the user's photo and verification state,
list every module the user belongs to with a link into that module's admin page, page
through the user's ledger, read the user's referral code and referral ledger, and read
the admin-action history and sessions — each panel failing independently and honouring
its own permission.

### Stated by the user
- Transaction details for the user; the user's photo.
- Which modules the user has access to / has onboarded into (example: restaurant owner
  or merchant).
- Referral code and referral transactions.
- "Everything pertaining to each user should be available on the user profile."
- Build approach B (per-panel pattern), built by this session.

### Assumptions (correct me)
- "Modules the user has access to" means **modules the user has a role/record in**
  (ownership/membership rows), not RBAC permissions. Explicit module-access grants
  (`/api/v1/admin/modules/users/:userId/grants`) are shown as one more row.
- Read-only: no new mutation controls beyond what #746/#750 already ship.
- Rows for modules the user is not in are collapsed, not hidden, so an admin can see
  coverage.

## Scope

Three small PRs, each additive, stacked on `main`, none editing `ReferralTierPanel`
or the Roles/Wallet/KYC/Activity panels:

- **PR A — identity & activity:** header photo + verification + last login (backend
  user GET extended); Transactions panel; Admin-actions panel; Sessions panel.
- **PR B — modules:** new membership endpoint + Modules panel.
- **PR C — referral activity:** referral-code read endpoint + Referral activity panel;
  fix the console's wrong referral-360 path.

**Out of scope:** any wallet/ledger mutation; force-logout / password-reset controls;
per-module deep detail (we link into the module's own admin page); effective-permission
and role-scope display (no route today); BVN/NIN status outside Connect; savings,
crypto, utility, insurance, event-ticket, stays-booking *activity* (only membership
is shown); editing a user's photo.

## Architecture

Frontend fan-out per panel, as in Phase 1b: each panel calls its own endpoint through
the existing admin-proxy and owns its loading / empty / error+Retry / 403 state. The
one exception is **module membership**, where no per-module "by user id" endpoint
exists for ~15 modules; a single backend registry endpoint is the smaller and safer
option there (rejecting 15 new endpoints or 15 frontend fetches to 15 different
permission models). It follows the existing aggregate pattern in
`backend/internal/handlers/admin_overview.go` (spec registry, per-query timeout,
bounded concurrency, soft-fail per row) and uses the shared pgx pool.

## Backend

All new routes are contract-first in `contracts/openapi.yaml`, additive, and ship
with one ADR (`ADR-PR<n>-admin-user-360.md`, number assigned on merge per repo rule).

### B1. Extend `GET /api/admin/users/:id` (PR A)
`rbac_supabase_repository.go GetAdminUser` / `domain.AdminUser` gain **optional**
fields: `avatarUrl`, `lastLoginAt`, `emailVerifiedAt`, `phoneVerifiedAt`,
`referralCode`, `referredBy`.
- `platform_users` already holds `last_login_at`, `email_verified_at`,
  `phone_verified_at`, `referral_code`, `referred_by`: add to the existing select.
- `avatarUrl`: one extra Supabase REST read of `user_profiles` by id, taking
  `profile_photo_url`, else `avatar_url`, else `metadata.profilePhotoUrl` (the same
  precedence as `frontend-web/src/server/user/profile.ts`). A missing profile row or
  failed read yields no avatar, never an error.
- Scope check (`canAccessUser`) and permission (`users.view`) unchanged. Old clients
  ignore the new keys.

### B2. `GET /api/admin/users/:id/modules` (PR B)
On the `rbacAdmin` group: `RequireAuthContext` + `RequirePermission("users.view")` +
the same `canAccessUser` scope check as B1. Registered only when the shared pgx pool
is non-nil and `FEATURE_ADMIN_USER_MODULES_ENABLED` is on (404 otherwise).

A registry of membership specs (`{Key, Label, Group, Href, SQL}`), each a single
parameterised query `SELECT count(*), min(created_at) FROM <table> WHERE <col> = $1`.
Run concurrently, capped at 8 in flight, 4 s per query, on the shared pool. Response:

```json
{ "success": true,
  "modules": [ { "key": "restaurant", "label": "Restaurant owner", "group": "Commerce",
                 "href": "/admin/restaurant/...", "status": "member|none|error",
                 "count": 2, "since": "2026-03-02T10:00:00Z" } ] }
```
A query that errors or times out yields `status:"error"` for that row only; the
request still returns 200. Initial registry (table.owner column, to be verified
against migrations by the registry test): restaurant (`restaurants.owner_id`),
marketplace seller (`mkt_listings.seller_id`), doctor (`doctor_profiles.user_id`,
`doctors.user_id`), driver (`drivers.user_id`), estate resident
(`estate_residents.user_id`), association member (`assoc_memberships.user_id`), stays
host (`stays_hotelier_profile.user_id`), events organiser (`events.organizer_id`),
ticket holder (`event_tickets.owner_id`), crowdfunding creator
(`campaigns.creator_id`), insurance policyholder
(`insurance_policy.policyholder_user_id`), savings vault owner
(`savings_vaults.owner_user_id`), ajo member (`ajo_members.user_id`), crypto account
(`crypto_accounts.user_id`), academy profile (`academy_profiles.user_id`), Connect
profile (`connect_profiles.user_id`), merchant onboarding profile
(`onb_merchant_profile.user_id`), explicit module grants (`user_module_grants.user_id`, counting only rows not revoked or expired).
A row whose table or column does not exist in a given environment is `error`, not a
crash; the registry test (below) keeps this from shipping silently.

### B3. `GET /api/finance/admin/referrals/:user_id/code` (PR C)
Thin handler in `finance/referrals` reusing the existing code-resolution order
(`referral_links.referrer_id`, then `finance_referral_codes.user_id`, then
`platform_users.referral_code`). Returns `{code, source}` or 404. Permission
`referral.admin.case`; wired through the same finance-admin proxy as the #753 aliases.

## Frontend (all under `frontend-admin/app/admin/users/[id]/`)

Each panel is a self-contained component modelled on `WalletPanel.tsx`
(`useCallback` load, `AdminUsersRequestError` 403 → "You don't have permission",
other errors → message + Retry, no mutation controls). Services extend
`usersService` / `userFinanceService` using `readOrThrow`.

- **Header (PR A):** avatar (initials fallback when absent or the image fails to
  load), Email/Phone verified badges, "Last login" line. Edits only the header block
  of `page.tsx`.
- **TransactionsPanel (PR A):** `listAdminTransactions({user_id})` (permission
  `finance.admin.transactions.view`), 25 per page with prev/next, optional type
  filter; columns type / amount (₦ from integer kobo) / description / account type /
  date; each row links to `/admin/finance/transactions/[id]`. Complements, does not
  replace, `WalletPanel`.
- **AdminActionsPanel (PR A):** `/api/admin/audit-logs?targetUser=<id>&limit=50`
  (permission `audit.logs.view`): action, module, actor, severity, date.
- **SessionsPanel (PR A):** `/api/admin/users/:id/sessions`; the backend's
  503 `feature_disabled` renders "Session hardening is not enabled in this
  environment." Read-only.
- **ModulesPanel (PR B):** grouped by `group`; `member` rows show count + "since" +
  an "Open" link to `href`; `none` rows collapsed under "Not onboarded (n)"; `error`
  rows show "unavailable".
- **ReferralActivityPanel (PR C):** code + source (copyable), the referral-360
  summary, and the referral ledger by beneficiary
  (`/api/referral/admin/ledger?beneficiary=<id>`, max 200, labelled as such). Fixes
  `getReferralUser360` in `referralAdminOpsService.ts` to call
  `/users/:id/referral-360`.

## Security & privacy

- Every new route requires auth context, an RBAC permission, and the existing
  per-user scope check; none is reachable with only the shared admin key.
- The photo URL is an admin-only read behind `users.view`; no new storage access.
- Phone/email are already shown to `users.view` holders; no new PII fields beyond
  `referralCode`/`referredBy`.
- Reading sessions already writes an `info` audit entry server-side; the new reads
  add no write paths.

## Error handling

Panel-local, never page-blocking. Backend `modules` degrades per row. Missing
optional data (photo, last login, referral code) renders as absent, not as an error.

## Testing

- **Go:** handler tests per endpoint (permission, out-of-scope user → 403, unknown id);
  `modules`: nil pool → route skipped, flag off → 404, one failing query yields an
  `error` row with HTTP 200, concurrency cap respected; a registry test, in the style
  of `admin_overview_test.go`, asserting every spec's `Href` resolves to a real
  `frontend-admin` page and every table/column exists in the migration chain.
- **Frontend (vitest):** per panel — loaded, empty, 403, error+Retry; header avatar
  fallback; service tests for new calls and the corrected referral-360 path;
  `profile.test.tsx` extended. `npm run type-check` clean.
- **Live:** each PR's panel verified against staging after deploy; enabling
  `FEATURE_ADMIN_USER_MODULES_ENABLED` on staging is a Railway variable change and
  will be confirmed with the user first.

## Coordination

Another session owns #752/#753 and the Phase 1b–2 panels. PR A–C touch `page.tsx`
only in the header block and by appending panel elements; each PR re-fetches
`origin/main` before committing and rebases if #752/#753 have landed.
