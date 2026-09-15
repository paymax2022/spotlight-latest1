# ADR-054 — `user_profiles.email` becomes nullable; phone-only `auth.users` inserts stop hard-failing

- **Status:** Accepted (DB-layer scope only — see Consequences)
- **Date:** 2026-09-15

## Context

ADR-053 made the `platform_users` identity mirror unconditional, but noted a
sharper, unrelated blocker: `handle_new_user()`
(`20260401004207_create_user_profiles.sql`, amended by
`20260405200000_admin_role_setup.sql` and
`20261224000000_user_profiles_phone_backfill.sql`) unconditionally inserts
`NEW.email` into `public.user_profiles.email`, which is `TEXT NOT NULL`. That
trigger has no exception handler, so ANY phone-only `auth.users` insert
(`email` NULL) aborts the whole transaction — verified empirically against
local Supabase before this ADR: `null value in column "email" of relation
"user_profiles" violates not-null constraint`. This is a harder failure than
ADR-053's gap: not a silent mis-route, a hard abort, in every environment.

`user_profiles` (unlike `platform_users`) is **not** on the brownfield-protected
path list (`docs/audit/02-routes.md` § Legacy Module File Map, enforced by
`.claude/hooks/protect-legacy.sh`) — confirmed by reading both directly, not
assumed from CLAUDE.md's looser "legacy auth" prose. So widening this
constraint via a new, additive migration is in-bounds. `handle_new_user()`'s
own `INSERT` needs no logic change: it already passes `NEW.email` through
with no NOT-NULL-enforcing expression around it, so the constraint was the
only blocker.

Before touching the constraint, every consumer of `user_profiles.email` was
audited (Go backend, frontend-web, mobile-app) for NULL-unsafe reads. Two real
risks, both now fixed in this same change:

- `backend/internal/finance/va/service.go` (`ProvisionVirtualAccount`'s user-info
  fetch) scanned `email` into a plain `string`, which errors the whole `Scan`
  call on NULL — would have broken virtual-account provisioning outright for
  a phone-only user. Fixed with `COALESCE(email,'')`, matching the sibling
  `phone` column in the same query.
- `backend/internal/transport/insurance.go`'s `loadParcelSenderProfile` scanned
  `email` into `p.Email string` directly while every other field in the same
  row used a `*string` intermediate — a NULL email failed the whole `Scan`
  and silently discarded `first_name`/`last_name`/`phone` too, not just
  email (caught downstream by `senderMissingProfileFields`, so no crash
  reached a caller, but for the wrong reason). Fixed to use the same
  `*string` pattern as its neighbors.

Every other call site already read `email` through `COALESCE(...)` in SQL, a
Go `*string`, or a PostgREST JSON decode into a plain Go/TS string (which
`null` → zero-value, not a panic) — confirmed by an explore pass across
`backend/`, `frontend-web/`, and `mobile-app/`, including
`frontend-web/src/lib/auth/server.ts` (brownfield-protected, but its
`user_profiles` reads never touch `email` — nothing there needed a workaround).

## Decision

`20270204000000_user_profiles_email_nullable.sql`:
`ALTER TABLE public.user_profiles ALTER COLUMN email DROP NOT NULL`. Additive
(widens, doesn't narrow); `user_profiles_email_key` (UNIQUE) is untouched —
Postgres allows unlimited NULLs under UNIQUE.

Verified end-to-end against local Supabase, inside a rolled-back transaction:
a synthetic phone-only `INSERT INTO auth.users (phone, ...)` (no email) now
cascades through both `on_auth_user_created` (`handle_new_user`) and
`on_auth_user_rbac_bridge` (ADR-053's `rbac_bridge_on_auth_insert`)
successfully — producing a `user_profiles` row, a `platform_users` row, a
`registered-user` role grant, and a positive `mainWalletAccountID`
(ADR-052) probe. Before both ADR-053 and this migration, the same insert
aborted outright.

## Consequences

- **Positive:** the identity-mirror pipeline (`auth.users` →
  `user_profiles` + `platform_users`) is now fully additive-safe for a
  phone-only row. If some future path creates one, it no longer hard-fails,
  and the downstream ADR-052/ADR-053 invariants hold for it.
- **Scope, deliberately limited to the DB layer — not "phone-only signup
  ships":**
  - **No registration path creates a phone-only `auth.users` row.**
    `RegisterUser` (`backend/internal/services/auth_service.go`) always
    requires email, and that file is brownfield-protected — changing its
    contract needs a wrapping adapter (vote-bridge pattern), not a direct
    edit, and is a separate decision.
  - **No login path resolves a phone-only account either.**
    `auth_service.go`'s `phoneToEmail`/`resolveLoginEmail` require a
    non-empty `user_profiles.email` to find an account by phone-first login;
    a phone-only row (email NULL) would not resolve. Same file, same
    protected-path constraint.
  - **No SMS/OTP provider is configured.** The existing OTP system (Brevo) is
    email-only; a real phone-only signup/login product feature needs its own
    SMS vendor integration, cost, and UX — a product decision, not made here.
  - Together these mean: this migration makes a phone-only identity
    *survivable* at the database layer, not *reachable* by any real user
    today. Treat "is phone-only signup live" as still NO until a follow-up
    explicitly closes the auth_service.go adapter + SMS provider gaps.
- **Going forward:** any new code reading `user_profiles.email` must not
  assume it is non-null — scan into `*string` or wrap in `COALESCE`, per the
  two fixes in this change.
