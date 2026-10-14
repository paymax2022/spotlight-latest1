# ADR-PR754: User 360 profile, PR A - photo, verification, ledger, admin actions, sessions

Status: accepted · Follows ADR-PR750 and ADR-PR752. Spec and plan: `docs/superpowers/` (branch `docs/admin-user-360-spec`).

## Context
The profile page lacked who the user is (photo, verification, last login), their full ledger, what
other admins did to them, and their sessions. All of this already exists in the database or on
endpoints keyed by user id; none of it reached the profile.

## Decisions
1. **Enrich the existing single-user GET, do not add an endpoint.** Six optional `omitempty` fields
   (`avatarUrl`, `lastLoginAt`, `emailVerifiedAt`, `phoneVerifiedAt`, `referralCode`, `referredBy`).
   They are filled only by `Get`, after `canAccessUser` passes, so the list and `/users/export`
   responses do not gain new personal data.
2. **Optional interfaces, not new methods.** `services.AdminUserEnricher` / `repositories.AdminUserEnricher`
   are discovered by type assertion. `RBACService` and `RBACRepository` have many test fakes; adding
   methods would force every fake to change for a read-only nicety.
3. **Enrichment is best-effort.** A failed REST read leaves the field empty and never fails the
   request. The cost is that a misconfigured grant makes avatars vanish silently (no log; follow-up).
4. **Avatar URLs are untrusted.** The URL is user-controlled and fetched by the admin's browser, so
   only parseable `https:` URLs load, with `referrerPolicy="no-referrer"`; anything else shows initials.
5. **Panels fan out, one per concern**, each with its own loading/empty/403/error state, and each
   ignores superseded responses (the page stays mounted when the route param changes, so a slow
   response for the previous user must never overwrite the current one).
6. **No feature flag on this PR.** It extends an existing `users.view` endpoint with optional fields
   and adds read-only panels over endpoints that already exist (ledger list, audit logs, sessions).
   The flag `FEATURE_ADMIN_USER_MODULES_ENABLED` is reserved for PR B, which adds a new endpoint.

## Consequences
- Anyone holding `users.view` and passing the scope check now also reads the photo URL, last login,
  verification times and referral code of that user.
- The Transactions and Admin-actions panels use global permissions (`finance.admin.transactions.view`,
  `audit.logs.view`). The page mounts them only after the scoped user read succeeds, so a scoped admin
  gains nothing they could not already fetch directly.
- Each Sessions read writes a `user.sessions.view` audit row (existing endpoint behaviour), which
  can crowd real actions out of the Admin-actions panel's 50-row window.

## Not covered
Module memberships (PR B), referral code and activity (PR C), the same stale-response guard on the
page and the older panels, and a status-bearing error from `listAdminTransactions` so 403 detection
stops matching message text.
