# ADR-053 — The `platform_users` identity bridge mirrors every `auth.users` row, not only email ones

- **Status:** Accepted
- **Date:** 2026-09-15

## Context

ADR-052 moved ~20 pgx-pool call sites — `orchestration.mainWalletAccountID`
among them — from querying `auth.users` (which `service_role` cannot read) to
`public.platform_users`, on the strength of `platform_users.id` mirroring
`auth.users.id` 1:1 via the trigger in
`20260904000000_rbac_identity_bridge.sql`.

That mirror is not actually unconditional: `rbac_bridge_on_auth_insert()` only
inserts `IF NEW.email IS NOT NULL`. Supabase Auth can create a user with a
phone and no email; such a row is silently never mirrored. Every ADR-052 call
site that treats "no `platform_users` row" as "not a real customer" then
mistreats a real phone-only identity the same way. The money-path instance is
`mainWalletAccountID`: a missing row makes it return `ok=false`, and its one
caller (`OpenWallet`) swallows that as plain success — the ledger account is
never provisioned and NGN for that customer would fall back to the legacy
`orch_balances` pot, the exact "two pots for one currency" defect class
ADR-051 already fixed once, for FX's own private pot.

Two things bound how urgent this actually is, both confirmed against this
codebase rather than assumed:

- **No registration path here creates a phone-only `auth.users` row today.**
  `RegisterUser` (`services/auth_service.go`) always sends `email` to GoTrue;
  `phone` is only patched onto `user_profiles` afterward. The email-only OTP
  surfaces (Brevo) verify/reset an existing email account, they do not create
  one. So this is a latent gap, not a live incident.
- **A phone-only `auth.users` insert cannot succeed at all today, in any
  environment**, for a reason entirely outside this bridge: `handle_new_user()`
  (`20260401004207_create_user_profiles.sql`, the pre-existing/legacy
  user_profiles trigger) unconditionally inserts `NEW.email` into
  `user_profiles.email`, which is `NOT NULL`. That trigger has no exception
  handler, so the whole `auth.users` insert transaction aborts. This is a
  brownfield/legacy-auth trigger per CLAUDE.md's protected-paths rule and is
  **not touched by this ADR** — fixing it (or routing a future phone-signup
  path around it) is a separate decision.

Given that, this ADR closes the bridge's half of the gap so the invariant
ADR-052 already assumes ("every auth identity has a `platform_users` mirror")
is actually true, without waiting on — or touching — the legacy blocker above.
It is defense-in-depth for whenever that blocker is lifted (or bypassed by a
native Supabase phone-OTP flow, or an admin-created account), not a fix that
makes phone-only signup work end-to-end today.

## Decision

`20270203000000_rbac_bridge_phone_only_identities.sql`:

1. `ALTER TABLE platform_users ALTER COLUMN email DROP NOT NULL` — additive
   (widens a constraint, does not narrow one). The `UNIQUE` index is
   untouched; Postgres allows unlimited `NULL`s under `UNIQUE`, so this cannot
   collide two phone-only users on email.
2. `rbac_bridge_on_auth_insert()` drops the `IF NEW.email IS NOT NULL` gate —
   every `auth.users` insert gets a `platform_users` mirror, whatever identity
   it carries.
3. The insert (trigger and backfill) now also copies `phone`. `platform_users.
   phone` was never populated by the original bridge for *any* user — a
   pre-existing, separate gap now visible because `app/health_triage_routes.go`
   (ADR-052) resolves its WhatsApp lookup against exactly that column. This
   migration does not claim to fix that lookup: `auth.users.phone` (the GoTrue
   native column) is itself never set by `RegisterUser` either — the phone
   number only ever reaches `user_profiles.phone` via a separate `PATCH`. That
   is flagged as a follow-up, not resolved here.
4. The `email`-gated backfill in the original migration is re-run without the
   gate, for any `auth.users` row that still has no mirror.

Verified locally: the trigger body was exercised directly against
`public.platform_users` (not through a real `auth.users` insert, which the
legacy `handle_new_user()` blocker above prevents for a phone-only row) —
insert with `email=NULL, phone=<E.164>` mirrors correctly, grants
`registered-user`, and satisfies `mainWalletAccountID`'s
`EXISTS(SELECT 1 FROM platform_users WHERE id=$1)` probe. A live-DB Go test,
`TestLiveDB_OrchNGN_MainWalletResolvesForIdentityWithoutEmail`
(`backend/tests/fx/orch_ngn_main_wallet_live_db_test.go`), pins that
`OpenWallet`/`mainWalletAccountID` correctly provisions a `ledger_accounts`
row for a `platform_users` row with a `NULL` email — the shape this migration
newly makes possible — rather than silently no-opping.

## Consequences

- **Positive:** the `platform_users` mirror is now unconditional, matching
  what ADR-052's ~20 call sites already assume. If a phone-only identity is
  ever created (native Supabase phone/SMS auth, an admin-created account, a
  future product path), it gets a wallet like any other customer instead of
  being silently split into the legacy `orch_balances` pot.
- **Negative / accepted gap, not fixed here:** `handle_new_user()` still hard-
  blocks any phone-only `auth.users` insert everywhere (local, staging, prod)
  — this migration cannot be exercised end-to-end until that legacy trigger is
  addressed, which is a brownfield change requiring its own review, not a
  drive-by edit here.
- **Negative / accepted gap, not fixed here:** `platform_users.phone` mirrors
  `auth.users.phone`, which the app's own registration flow never sets (it
  only ever writes `user_profiles.phone`). `app/health_triage_routes.go`'s
  WhatsApp-by-phone lookup (ADR-052) therefore still cannot resolve any of
  today's real users by phone, independent of the phone-only-signup question
  this ADR addresses. Filed as a separate follow-up: either sync
  `user_profiles.phone` → `platform_users.phone`, or point that lookup at
  `user_profiles` instead.
- **Going forward:** any future auth-insert trigger or backfill must keep
  mirroring unconditionally — no reintroducing an `email IS NOT NULL`-shaped
  gate — or this ADR's invariant regresses silently again.
