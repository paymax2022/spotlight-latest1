# Estate module — static RLS & index audit (Block 47c)

Scope: the estate super-app tables (Blocks 29–46) and the `/api/v1/estate/*`
handlers that read/write them. This is the **static** portion of Block 47
hardening — a live-DB penetration test against a deployed Supabase project
remains environment-blocked (Block 47d).

Date: 2026-06-22. Migrations reviewed:
`20260616250000_estate.sql`, `20260618000000_estate_onboarding.sql`,
`20260622010000_estate_modules.sql`, `20260622020000_estate_modules_38_46.sql`,
`20260622030000_estate_indexes.sql`.

## RLS posture

The money-path and Spotlight modules are read through the **service-role**
client (`createAdminClient`), which bypasses RLS by design; the handlers enforce
scope in code via `getResidentContext` (estate membership) plus an explicit
`role === 'estate_admin'` check on admin-only routes. RLS is the defence-in-depth
layer for any direct (anon/authenticated) access.

| Table group | RLS enabled | SELECT policy | service_role bypass |
|---|---|---|---|
| Blocks 29–37 (16 tables) | ✓ (DO-loop `ENABLE ROW LEVEL SECURITY`) | estate-scoped (`EXISTS estate_residents`) | ✓ `*_service` policy |
| Block 39 `estate_ai_notes` | ✓ | estate-scoped | ✓ |
| Block 43 `estate_notifications` | ✓ | owner-scoped (`user_id = auth.uid()`) | ✓ |
| Block 45 `estate_member_settings` | ✓ | owner-scoped | ✓ |
| Pre-existing (`estate_properties`, `estate_residents`, …) | ✓ | estate-/owner-scoped | ✓ |

Findings:
- **No table is missing RLS.** Every estate table enables RLS and has both a
  scoped SELECT policy and a `service_role` bypass.
- **Owner-scoped tables are correctly owner-scoped.** `estate_notifications` and
  `estate_member_settings` restrict SELECT to `user_id = auth.uid()`, so one
  resident cannot read another's notifications or settings even with a raw token.
- **Admin-only writes are gated in code**, not by RLS (service-role bypasses
  RLS): announcements POST, documents POST, ai-notes generate, finance, reports,
  and admin/summary all check `ctx.role === 'estate_admin'` and return 403
  otherwise. Verified by reading each handler.
- **Cross-estate isolation** on every detail/mutation route is enforced by
  comparing the loaded row's `estate_id` (or `resident_id`/`user_id`) to the
  caller's context before acting (404/403 otherwise).

## Index coverage

Estate-scoped LIST paths were already indexed in `20260622010000`
(`idx_*_estate` on `estate_id [+ status/created_at]`). The audit found five
remaining hot query paths without a supporting index; all are added additively
in `20260622030000_estate_indexes.sql`:

| Query path (handler) | Filter | Index added |
|---|---|---|
| `getMeetingMinutes`, ai-notes generate | `meeting_minutes.meeting_id` | `idx_meeting_minutes_meeting` |
| `getRepair`, `addRepairUpdate` | `repair_updates.request_id` | `idx_repair_updates_request` |
| `listMyBookings` | `facility_bookings (estate_id, resident_id)` | `idx_bookings_resident` |
| `listFacilities` | `estate_facilities.estate_id` | `idx_facilities_estate` |
| `listVendors` | `estate_vendors.estate_id` | `idx_vendors_estate` |

Already-adequate (no change needed):
- `meeting_rsvps` and `announcement_reads` are covered by their
  `UNIQUE(meeting_id,user_id)` / `UNIQUE(announcement_id,user_id)` indexes.
- `estate_payments` finance aggregation filters on `estate_id` (+ `status` in
  code), served by `idx_payments_estate`; idempotency by `uidx_payments_reference`.
- `estate_notifications` feed + unread badge: `idx_notifications_user`
  `(user_id, created_at)` + partial `WHERE read_at IS NULL`.

## Residual / env-blocked (Block 47d)

- Live `EXPLAIN ANALYZE` of the above paths against production-scale data.
- Penetration test of RLS with a real authenticated (non-service) token to
  confirm policies behave as written under PostgREST.
- Confirm the service-role key is never shipped to clients (deploy-time check).
