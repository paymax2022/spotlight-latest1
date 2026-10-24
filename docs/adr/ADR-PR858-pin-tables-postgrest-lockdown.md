# ADR-PR858: Lock the PIN-bearing transport tables out of PostgREST

**Status:** Accepted · **Date:** 2026-10-22 · **Area:** transport security

## Context
Four tables hold a hand-off secret that the counterparty must *verify* but never *read*:

| table | secret column(s) | counterparty with a SELECT policy |
|---|---|---|
| `parcels` | `pickup_pin`, `dropoff_pin` | courier (`parcels_own`) |
| `towing_jobs` | `pin` | operator (`towing_own`) |
| `trips` | `trip_pin` | driver (`trips_select`) |
| `business_deliveries` | `dropoff_pin` | courier (`business_deliveries_own`) |

Supabase's default grants gave `anon` and `authenticated` every privilege on these tables. RLS limited *rows*, not *columns*. So any user with an ordinary JWT could call `/rest/v1` directly:

- **Read the secret.** `GET /rest/v1/parcels?id=eq.<id>&select=dropoff_pin`, sent with the courier's JWT, returns the drop-off PIN. The courier can then complete delivery and release escrow without the receiver. This bypasses both the "courier verifies, never reads" rule in ParcelDetail and the attempt limit `checkPin` (ADR-PR843) puts on guessing. The same works for ride, towing and business-delivery PINs.
- **Forge rows.** `parcels_insert`, `towing_insert` and `trips_insert` only check that the owner column equals `auth.uid()`. A user can insert a row with any `status` (for example `pickup_pin_verified`), with their own courier, and with no payment behind it.

Nothing legitimate uses that access:
- no client in `frontend-web`, `frontend-admin` or `mobile-app/reactnative` calls `.from()` on these tables;
- no RPC or view reads them as the caller;
- none of them is in a realtime publication.

Every read and write goes through the Go backend, which connects as the table owner or `service_role`.

## Decision
Migration `20271073000000_pin_tables_postgrest_lockdown.sql`:
- runs `REVOKE ALL ON` all four tables `FROM anon, authenticated`;
- clears any column-level grants to those roles, because a column-level grant survives a table-level REVOKE;
- states `GRANT ALL ... TO service_role` explicitly.

We revoke the whole table, not just the PIN columns. Column-scoped SELECT would still leave the row readable, and nothing needs it. Revoking everything also closes the forged-INSERT and UPDATE/DELETE paths at the grant layer, so they no longer depend on policies being correct.

## Consequences
- Over PostgREST, these tables now return `42501 permission denied` for `anon` and `authenticated`. The backend flows (book, accept, pickup, drop-off) are unchanged; the live-DB test suite runs them.
- The `authenticated` policies stay in place, because migrations here are additive-only. They are now unreachable. If anyone re-grants table SELECT, the PIN columns are exposed again. A future direct client read must use a **column-scoped GRANT that omits the secret columns**.
- **This is a prerequisite for turning on `FEATURE_PARCEL_RECEIVER_PIN_SMS` in production** (PR #857). Texting the receiver a PIN means nothing while the courier can read that PIN from the table.
- `mover_jobs`, `mover_bids` and `car_hire_bookings` have the same forge-INSERT shape, but they hold no secret. They are left for a follow-up.
- Pinned by `backend/internal/transport/pin_tables_postgrest_lockdown_live_db_test.go`. For each table, it checks that the courier/driver and the owner cannot read the secret, that the owner cannot forge a row, that the counterparty cannot UPDATE or DELETE, that `anon` gets nothing, and that `service_role` keeps full access.
