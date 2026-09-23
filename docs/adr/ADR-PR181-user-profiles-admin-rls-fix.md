# ADR-PR181 — Fix `user_profiles` admin RLS policies: `USING (true)` → `public.is_admin()`

**Date:** 2026-09-17
**Status:** Accepted
**Deciders:** Platform/Security
**Scope:** `supabase/migrations/20270205010000_fix_user_profiles_admin_policy_wide_open.sql` (new, additive). No application code change.

## Context

`20260401010000_admin_panel_policies.sql` added two RLS policies on `public.user_profiles`:

- `admin_read_all_user_profiles` (`FOR SELECT`)
- `admin_update_application_status` (`FOR UPDATE`)

Both used `USING (true)` (the UPDATE policy also `WITH CHECK (true)`). Despite the
policy names and the inline comments claiming an "admin panel" scope, neither
predicate actually checked for admin — `true` grants the row to every row for
every `authenticated` principal. Any logged-in user could `SELECT` (and mutate
`application_status` on) every other user's full `user_profiles` row —
including phone and email — directly via PostgREST/the Supabase JS client.
This is a platform-wide PII exposure, not scoped to any one module. It was
found incidentally during a Property Management UAT pass while wiring a
realtor listing's agent-phone display, not because of that feature itself.

The repo already has an established, repeatedly-used pattern for admin-gated
RLS: `public.is_admin()` (`SECURITY DEFINER`, checks
`user_profiles.role = 'admin'` for `auth.uid()`, added in
`20260405200000_admin_role_setup.sql` specifically to avoid RLS recursion on
this same table). Dozens of other admin-scoped policies across the schema
already use `USING (public.is_admin())` — the two `user_profiles` policies
were the outliers.

## Decision

1. Add an additive migration that re-declares both policies (via the repo's
   established `DROP POLICY IF EXISTS` + `CREATE POLICY` convention — RLS
   policies have no `CREATE OR REPLACE` form) with `USING (public.is_admin())`
   in place of `USING (true)`, and `WITH CHECK (public.is_admin())` on the
   UPDATE policy.
2. Add no narrower/alternate non-admin policy. A repo-wide search for any
   client-side (anon/authenticated-key) read of `user_profiles` outside
   admin/server code found none — every legitimate read, including the admin
   console (`createAdminClient` in `frontend-web/src/lib/supabase/server.ts`),
   goes through the service-role client, which bypasses RLS entirely and was
   never depending on `USING (true)`. In particular, no realtor
   agent-phone-reveal feature reads this table directly. If a future feature
   needs a narrow non-admin read (e.g. exposing one listing's agent phone to
   an interested buyer), it should get its own purpose-built, column-scoped
   policy rather than reopening this one.
3. The existing `users_manage_own_user_profiles` policy (`id = auth.uid()`,
   `FOR ALL`) is untouched and continues to give every user read/write access
   to their own row independent of admin status.

## Consequences

### Positive
- Closes a live, platform-wide PII read (and a write-tampering path on
  `application_status`) with a one-file additive migration.
- Uses the same admin-check the rest of the schema already relies on — no new
  pattern, no new function, nothing else to audit for consistency.
- Zero behavior change for the admin console (service-role bypasses RLS) or
  for ordinary users reading/editing their own profile.

### Negative / trade-offs
- None identified. The only behavior removed is the unintended broad read/
  write that had no legitimate consumer.

## Verification

Applied to local Supabase and confirmed live:
- Non-admin authenticated session: visible `user_profiles` row count dropped
  from 578 (all rows) to 1 (own row only).
- Admin authenticated session: still sees all 578 rows.
- `scripts/ci/check-migration-versions.sh`: 532 migrations, all unique — no
  version collision.
