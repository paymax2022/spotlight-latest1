# RLS Coverage Remediation — Supabase `public` schema

**Date:** 2026-07-03
**Status:** Remediated (backend/server-only tables); 0 open exposures
**Related:** migration `20260703225152_rls_backend_only_lockdown.sql`, `make rls-check`

## Finding

Supabase exposes every `public` table through PostgREST to holders of the `anon` /
`authenticated` keys (the `anon` key ships inside the app). An audit of the local
database found **133 of 601 public tables had no row-level security**, and **all
133 held full `anon` + `authenticated` grants** (SELECT/INSERT/UPDATE/DELETE/
TRUNCATE). Affected tables included money/audit/session data — `audit_logs`,
`auth_sessions`, `assoc_payments`, `assoc_revenue_splits`, `arena_pot_disbursement`,
`bridge_idempotency_keys`, `bridge_outbox`, `invest_*`, `tier_limit_events`.

With no RLS and those grants, any client with the anon key could read, write, or
truncate those tables directly via `POST /rest/v1/…`, bypassing the Go backend's
own authorization entirely.

## Classification (how the 133 split)

The Go backend connects as the table owner (`postgres`) and **bypasses RLS**; the
Next.js server routes touch these tables only via the **service-role** client
(`createAdminClient` → `SUPABASE_SERVICE_ROLE_KEY`), which also bypasses RLS. Every
`.from('…')` call in `frontend-web`, `frontend-admin`, and `mobile-app` was checked
against the 133:

| Bucket | Count | How reached | Action |
|---|---|---|---|
| Backend-only | 127 | Go backend (owner) only | Enable RLS + revoke anon/authenticated |
| Server-only | 5 | Next.js server via service-role (`bridge_idempotency_keys`, `bridge_outbox`, `stem_contests`, `stem_schools`, `tier_limit_events`) | Enable RLS + revoke anon/authenticated |
| PostGIS system | 1 | `spatial_ref_sys` — world-readable reference data, extension-owned | Leave as-is (allowlisted) |

No table in the 133 is accessed with the browser/anon key, so enabling RLS with a
deny-all default breaks nothing.

## Remediation

`supabase/migrations/20260703225152_rls_backend_only_lockdown.sql` covers the 132
non-exception tables:

1. `ALTER TABLE … ENABLE ROW LEVEL SECURITY` — with no policy, this is deny-all for
   anon/authenticated. Owners (the Go backend) and service_role still bypass it, so
   the backend and server routes are unaffected. `FORCE` RLS is intentionally **not**
   used (it would also gate the owner).
2. `REVOKE ALL … FROM anon, authenticated` — defence-in-depth, guarded in a `DO`
   block on `pg_roles` existence so the migration also applies on a bare Postgres
   (CI without the Supabase role shim), where those roles are absent.

Additive, reversible, idempotent. Verified locally: RLS-less public tables dropped
**133 → 1** (`spatial_ref_sys`), migration re-applies cleanly, and the backend health
check stays green.

## Guardrail

`make rls-check` fails if any `public` table lacks RLS outside `RLS_ALLOWLIST`
(default: `spatial_ref_sys`). It is chained into `make migrate-reset`, so the
`make verify` go-live gate (and the `integration-verify` CI job) now block any future
table that ships without RLS.

## Residual / follow-ups

- **`spatial_ref_sys`** stays without RLS by design (PostGIS reference data). It is the
  sole allowlist entry.
- The 5 server-only tables are locked down, but `bridge_idempotency_keys` /
  `bridge_outbox` being reachable at all from the web tier is a smell — consider moving
  that logic behind the Go backend so infra tables have no frontend surface.
- This closed the *coverage* gap (deny-all). Tables that genuinely need **user-facing**
  PostgREST access later must get real, scoped policies (per the pharmacy pattern),
  not a blanket re-grant.
