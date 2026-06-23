# Spotlight Realtor — Go-Live Runbook

Everything ships **mock-by-default**, so the app and admin run with no backend.
This runbook flips the module to live. All steps are additive and reversible.

## 0. Pre-flight

- Module is GREEN (scoped `tsc` rc=0, esbuild bundles clean). Run the full gate
  on a CI runner: `cd mobile-app/reactnative && npm run typecheck && npx expo export`,
  and `cd frontend-web && npx tsc --noEmit && npm run lint`, and
  `cd frontend-admin && npx tsc --noEmit`. CI workflow: `.github/workflows/realtor-ci.yml`.

## 1. Database — apply migrations (additive, ordered)

```
supabase db push
```

> **Validated:** all 5 migrations have been applied clean-room against a real
> PostgreSQL 14 instance (20 tables, 5 RPCs, the no-double-booking EXCLUDE
> constraint, RLS on all 20 tables). The committed RPC invariant tests
> (`supabase/tests/realtor_rpcs.test.sql`, run after `_supabase_shim.sql`) pass
> 4/4: idempotent `pay_invoice`, shortlet no-double-booking, hotel sold-out
> guard, and `owner_dashboard`. CI runs this automatically against a `postgres:14`
> service (job `migration-apply-and-rpc-tests` in `.github/workflows/realtor-ci.yml`).
> On a real Supabase project, `auth.users` / `auth.uid()` / `auth.role()` already
> exist, so the shim is CI/local-only.

Applies, in order:

| Migration | Adds |
|---|---|
| `20260620000000_realtor_property_graph.sql` | portfolios, properties, units, rooms, offering_modes, listings, inspection_bookings, rental_applications + RLS |
| `20260620010000_realtor_lease_payments.sql` | leases, invoices, payments, escrow_deposits, move_ins + RLS |
| `20260620020000_realtor_backend_rpcs.sql` | shortlet_bookings (EXCLUDE no-overlap) + RPCs: sign_lease, pay_invoice, create_shortlet_booking, owner_dashboard |
| `20260620030000_realtor_maintenance.sql` | maintenance_requests + RLS (tenant/vendor/owner) |
| `20260620040000_realtor_hotel.sql` | hotels, room_types, hotel_reservations, hotel_rooms, channel_connections + RPC book_hotel_room |

All migrations are additive-only (no DROP / no ALTER COLUMN / no DROP NOT NULL),
enforced by the `migration-guard` job in CI.

## 2. Seed inventory

Insert at least a few `realtor_hotels` + `realtor_room_types`, or onboard owners
via the mobile **owner → create property → add unit → offering modes** flow
(which writes the graph tables directly). Published `realtor_listings` are
world-readable and appear in the marketplace immediately.

## 3. Environment

**frontend-web** (`.env`):
```
FEATURE_REALTOR_ENABLED=true
ANTHROPIC_API_KEY=sk-ant-...           # for the AI assistant + assist routes
ANTHROPIC_REALTOR_MODEL=claude-haiku-4-5-20251001   # optional override
```

**frontend-admin** (`.env`):
```
NEXT_PUBLIC_REALTOR_ADMIN_USE_MOCK=false
```

**mobile-app/reactnative** (`.env`):
```
EXPO_PUBLIC_REALTOR_USE_MOCK=false
```

## 4. Endpoints / RPCs the live mode calls

Mobile (direct Supabase + RPC):
- reads: `realtor_listings`, `realtor_units`, `realtor_properties`, `realtor_leases`,
  `realtor_invoices`, `realtor_escrow_deposits`, `realtor_move_ins`,
  `realtor_maintenance_requests`, `realtor_hotels`, `realtor_room_types`,
  `realtor_hotel_reservations`, `realtor_hotel_rooms`, `realtor_channel_connections`.
- writes/RPCs: `realtor_sign_lease`, `realtor_pay_invoice` (idempotent),
  `realtor_create_shortlet_booking` (EXCLUDE-guarded), `realtor_book_hotel_room`
  (availability-guarded), `realtor_owner_dashboard`; plus inserts for inspections,
  applications and maintenance.

Mobile → frontend-web (secure, server-side key):
- `POST /api/v1/realtor/ai/listing-copy`
- `POST /api/v1/realtor/ai/assist`  (tasks: maintenance_triage, shortlet_pricing, arrears_risk)

Admin → live control plane (when `…ADMIN_USE_MOCK=false`), base `/api/realtor/admin`:
- `GET /overview`, `GET /listings/pending`, `POST /listings/{id}/decision`
- `GET /verifications`, `POST /verifications/{id}/decision`
- `GET /payments`, `GET /escrow`

The admin control-plane endpoints are the remaining server work — the admin
client already calls them behind the mock flag (same pattern as fx/crowdfunding
admin services).

## 5. Smoke test (live)

1. Marketplace home lists published listings.
2. Book inspection → appears under My Inspections.
3. Approved application → lease → e-sign → pay (escrow row created) → move-in.
4. Shortlet booking blocks overlapping dates (EXCLUDE constraint → "dates unavailable").
5. Hotel booking decrements availability; sold-out raises a clean error.
6. Maintenance report → AI triage → vendor quote → approve → complete → confirm → rate.
7. Admin: moderation approve publishes a listing; verification decisions clear the queue.

## 6. Rollback

Set the three `…USE_MOCK` flags back to mock (or unset) and
`FEATURE_REALTOR_ENABLED=false`. Tables remain (additive); no data loss.
