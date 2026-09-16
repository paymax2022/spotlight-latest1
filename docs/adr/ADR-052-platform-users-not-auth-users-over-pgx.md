# ADR-052 — Read `platform_users`, never `auth.users`, over the pgx pool

- **Status:** Accepted
- **Date:** 2026-09-15

## Context

`backend/internal/platform/db.New()` runs `SET ROLE service_role` on every
pooled pgx connection so money-path and RBAC code can bypass RLS. Supabase
never grants `service_role` access to the `auth` schema — that protection is
deliberate, not an oversight, and holds in every environment except wherever
someone has hand-patched the local grant (as this local Supabase instance
currently has: `\dp auth.users` shows `service_role=r/postgres`, granted by a
plain `GRANT`, not by any migration). Any SQL run through this pool against
`auth.users` — `SELECT`, `JOIN`, `EXISTS` — fails with
`permission denied for table users` (42501) everywhere that hand-patch is
absent: staging, production, and a freshly reset local database alike.

A full audit of every `pgx`-pool call site referencing `auth.users` found 20
places already hitting this wall (originally `services/email_verification.go`'s
`authUserByEmail`, shared with the OTP login MFA step-up in
`services/otp_login.go`), spanning restaurant staff management, association
admin queues, crowdfunding discovery/comments/contributors/admin, academy fee
invoices, connect voting, wallet/FX account routing (inside a money
transaction), gifting, and the admin console.

Two tables already mirror what these call sites needed, and one call site
(`stays/extranet/staff_invite.go`'s `FindPlatformUserByEmail`) had already
independently arrived at the fix:

- **`public.platform_users`** (`20260527100000_enterprise_auth_rbac.sql`,
  bridged 1:1 to `auth.users.id` by `20260904000000_rbac_identity_bridge.sql`)
  has `id`, `email`, `first_name`, `last_name`, `phone`, `status`,
  `created_at`, `last_login_at`, `deleted_at` — a superset of what every
  affected query actually read.
- **`public.user_profiles`** (`id` FK to `auth.users(id)`, so also 1:1) has
  `full_name`/`phone` for call sites that already joined it alongside
  `auth.users` for other columns.

## Decision

Every pgx-pool call site that needs an `auth.users` column reads
`public.platform_users` instead (or `user_profiles` where a sibling join
already existed for `full_name`/`phone`). Concretely:

- `email`, `phone`, `status`, `created_at`, `deleted_at` → `platform_users`
  column of the same name.
- `last_sign_in_at` → `platform_users.last_login_at` (nearest available
  equivalent; not byte-identical to GoTrue's own tracking, but this pool was
  never going to be able to read GoTrue's copy anyway).
- `raw_user_meta_data->>'full_name'` → `COALESCE(NULLIF(btrim(first_name || '
  ' || last_name), ''), email)` on `platform_users`.
- `raw_user_meta_data->>'avatar_url'` → no equivalent column exists on
  `platform_users`; call sites that read it (`crowdfunding/engage/comments.go`)
  now return `NULL` for that field rather than fabricate a join. Filed as a
  known gap, not fixed here.
- `handlers/gifting_store.go` had drifted further: it joined a table literally
  named `profiles`, which has never had a `name` or `nickname` column (only
  `profile_type`, `avatar_url`, `bio`, …). That call would have failed on
  "column does not exist" independent of the `auth.users` grant issue. Fixed
  in the same pass to join `user_profiles` (`full_name`) instead; `nickname`
  has no source anywhere in the schema and is now always `""`.

Fixed call sites (file → function):

| File | Function(s) |
|---|---|
| `services/email_verification.go` | `authUserByEmail` |
| `restaurant/staff_invite.go` | `ListStaff`, `LookupUser` |
| `restaurant/legacy_linking.go` | `LinkLegacyOwners` |
| `estate/service.go` | `GetResidentCard` |
| `association/service.go` | `GetApprovalQueue`, `GetApplication` |
| `association/service_content.go` | `GetPendingMeetings` |
| `association/service_ext.go` | bulk-import duplicate check, email resolve |
| `association/service_actions.go` | bulk-import email resolve |
| `finance/referrals/rewards_service.go` | `ListReferrals` |
| `orchestration/customer_wallet.go` | `mainWalletAccountID` |
| `crowdfunding/creator/service.go` | `creatorDisplayName`, `GetContributors`, `GetCreatorContributions` |
| `crowdfunding/service_discovery.go` | `creatorMeta`, `creatorEmail` |
| `crowdfunding/engage/comments.go` | `ListComments`, `authorIdentity` |
| `crowdfunding/adminext/service.go` | KYC identity batch, `DecideKyc`, `userBaseCTE`, moderation name lookup |
| `academy/fees/adminapi/repository.go` | `ListInvoices` |
| `connect/voting/repo.go` | vote list |
| `handlers/admin_store.go` | `GetDashboardStats`, `ListUsers`, `GetKYCQueue`, `ListOrders`, `ListWithdrawals` |
| `handlers/gifting_store.go` | `GetRecipients`, `enrichGiftTransaction` |
| `app/health_triage_routes.go` | WhatsApp phone-to-user lookup |

Verified by executing the rewritten SQL shapes directly against the local
Supabase instance under `SET ROLE service_role` (real data returned, no
42501), then running every touched package's test suite against
`TEST_DATABASE_URL` (`go test ./... -count=1`, all green except one
pre-existing, unrelated failure in `internal/integrations/rtc`).

## Consequences

- **Positive:** these 20 call sites now work in every environment, including
  ones where nobody has manually granted `service_role` extra access — which
  should be all of them; the local grant found on this instance is itself a
  latent trap (it makes `auth.users` reads look fine locally while staying
  broken everywhere else) and is worth a separate follow-up to either remove
  it or formalize why it exists.
- **Negative / accepted gap:** avatar URLs sourced from GoTrue metadata are no
  longer available through this path (`crowdfunding/engage/comments.go`).
  Nothing currently reads a real value there either way (no `avatar_url`
  column has ever existed on `platform_users` or `profiles`), so this is a
  no-op in practice, not a regression — but a real avatar feature will need
  its own storage, not `auth.users`.
- **Going forward:** any new pgx-pool code that needs identity data (email,
  name, phone, status, timestamps) must read `platform_users` /
  `user_profiles`, never `auth.users` directly. `auth.users` is reachable only
  from Supabase's own GoTrue-fronted paths (PostgREST with `authenticated`/
  `anon`, or the Admin API), never from this pool.

## Addendum (2026-09-15) — a service_role grant on auth.users now coexists with this ADR, kept deliberately

A separate, concurrent fix (`supabase/migrations/20270202000000_service_role_auth_users_select.sql`,
AUTH-008 then AUTH-011) independently repaired the same underlying defect for
the same function — `authUserByEmail()` in `services/email_verification.go` —
by granting `service_role` a column-narrowed `SELECT (id, email,
email_confirmed_at, deleted_at) ON auth.users`, rather than migrating the
call site to `platform_users`. That grant landed on `develop` chronologically
around this ADR's own commit (90e8c5b1); whichever version of
`email_verification.go` is newest wins the file, and today that's this ADR's
`platform_users` rewrite — so the grant is currently unused by any
production code path (checked: no non-test pgx-pool Go code queries
`auth.users` directly on the current `develop` tip).

Decision: **the grant is being left in place, not revoked.** Revoking it
would break `TestLiveDB_ServiceRoleCanSelectAuthUsers`
(`backend/tests/otp/service_role_auth_users_grant_live_db_test.go`), a
regression test written specifically to catch a real production incident
(OTP email verification and password-reset completion 500ing under
`service_role`). The grant itself is narrow, read-only, and exposes no
password hash, token, or MFA-secret columns — the residual risk of keeping
it is low, and it was already responsibly least-privilege-narrowed by its
own author (AUTH-011) before this ADR's fix even landed. Undoing another
session's tested, incident-justified migration to resolve what is now a
purely cosmetic redundancy is not worth the disruption.

This does not change the rule above: new code still must not query
`auth.users` directly. The grant existing is not permission to use it — it's
a narrow, dormant safety net kept for the one call site it was built for,
which no longer needs it.
