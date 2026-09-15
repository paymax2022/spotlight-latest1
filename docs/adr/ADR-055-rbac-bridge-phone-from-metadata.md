# ADR-055 — `platform_users.phone` is copied from `auth.users` metadata, not the raw column

- **Status:** Accepted
- **Date:** 2026-09-15

## Context

ADR-053 (`20270203000000_rbac_bridge_phone_only_identities.sql`) added `phone`
to `rbac_bridge_on_auth_insert()`'s mirror insert, copying `NEW.phone` — GoTrue's
own top-level column on `auth.users`. It flagged, but did not fix, that this is
a structural no-op: `RegisterUser` (`backend/internal/services/auth_service.go`,
brownfield-protected, not touched here) never sets that column. It sends phone
inside the signup/admin-create request's `data`/`user_metadata` payload — which
GoTrue stores at `raw_user_meta_data->>'phone'` — and separately `PATCH`es it
onto `user_profiles.phone` once the account exists.

Confirmed on local Supabase before this fix: 0 of 57,703 `platform_users` rows
carried a phone. Of the 6 `user_profiles` rows with a phone, 5 had the identical
value sitting in `auth.users.raw_user_meta_data->>'phone'` the whole time;
`auth.users.phone` itself was blank on all 6 (the 6th was a fixture row written
directly, bypassing `RegisterUser` entirely — out of scope, see Consequences).

`handle_new_user()` (`20261224000000_user_profiles_phone_backfill.sql`) hit
this exact problem for `user_profiles.phone` and already fixed it there:
`COALESCE(raw_user_meta_data->>'phone', NEW.phone)` instead of the raw column
alone. `rbac_bridge_on_auth_insert()` never picked up that precedent when
ADR-053 added its own phone copy.

**Not urgent for the WhatsApp lookup.** `backend/internal/app/health_triage_routes.go`'s
`StartOrContinue` — the original motivating reader of `platform_users.phone`
(ADR-052) — was independently repointed at `user_profiles.phone` directly
(commit `50fd9c83`), after that session found the same gap this ADR fixes and
judged it faster to route around `platform_users` than to fix the bridge. That
change stands on its own and needs nothing from this ADR. This migration exists
because ADR-052 establishes `platform_users` as the pgx-pool identity mirror
every future money-path call site is expected to trust — leaving its `phone`
column structurally unfillable would just relocate the same bug to the next
reader instead of the current one.

## Decision

`20270204010000_rbac_bridge_phone_metadata_source.sql`:

1. `rbac_bridge_on_auth_insert()`'s phone source becomes
   `COALESCE(NULLIF(NEW.raw_user_meta_data->>'phone', ''), NULLIF(NEW.phone, ''))`
   — metadata first, raw column as fallback, matching `handle_new_user`'s order
   exactly so the two triggers cannot disagree about which real users have a
   phone on file.
2. A guarded backfill (`WHERE COALESCE(pu.phone,'') = ''`) applies the same
   COALESCE to every existing `platform_users` row from its `auth.users`
   counterpart. Blanks-only, so re-running it is a no-op and it can never
   clobber a value already present.

Verified locally:

- The premise (pre-fix): query above, 0/57,703.
- The trigger, end-to-end: a rolled-back `INSERT INTO auth.users (id, email,
  raw_user_meta_data)` with `raw_user_meta_data->>'phone'` set produced a
  `platform_users` row with that phone, no direct `auth.users.phone` write
  involved.
- The backfill: applied for real (not rolled back — additive and idempotent),
  `UPDATE 5`, matching the 5 real metadata-sourced rows found above.
- `scripts/ci/check-migration-versions.sh`: 529 migrations, all versions
  unique.

## Consequences

- **Positive:** `platform_users.phone` now actually reflects what a user
  registered with, for every future signup and (via the backfill) every
  existing one whose phone reached `auth.users` metadata. Any future call site
  that trusts `platform_users` as ADR-052 intends gets a real value instead of
  silently always-empty.
- **Negative / accepted gap:** the one `user_profiles.phone` row that predates
  `RegisterUser`'s metadata write (a fixture inserted directly into
  `user_profiles`, never through `auth.users`) has no `auth.users` counterpart
  to backfill from and stays unfilled in `platform_users`. Not a regression —
  ADR-053's own backfill couldn't have reached it either, for the same reason.
- **No change to `health_triage_routes.go`.** That file already reads
  `user_profiles.phone` (commit `50fd9c83`) and does not depend on this fix.
  Documented here only so a future reader does not assume this ADR is why the
  WhatsApp lookup works.
