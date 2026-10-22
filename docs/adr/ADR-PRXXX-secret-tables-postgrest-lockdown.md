# ADR-PRXXX: Lock eight more secret-bearing or forgeable tables out of PostgREST

**Status:** Accepted · **Date:** 2026-10-22 · **Area:** platform security (food, health, academy, transport)

## Context
ADR-PR858 locked the PIN-bearing transport tables out of PostgREST. Its security review found eight more tables with the same root cause: Supabase's default grants give `anon` and `authenticated` every privilege on public tables, and RLS limits *rows*, not *columns*.

| table | exposure over `/rest/v1` with an ordinary JWT |
|---|---|
| `orders` (food) | `orders_select` admits the rider. The rider reads `delivery_code` and `pickup_code`, confirms their own delivery and releases escrow without the customer. `maskPODCodes` in `restaurant/service.go` exists precisely so riders never see these codes. |
| `pharmacy_orders` | `pharmacy_orders_party` admits the pharmacy owner, who is also the payee. The owner reads `pickup_code`. |
| `academy_access_cards` | `academy_access_cards_read` is `USING (true)` with no role, so anyone, **including anon**, reads `pin_hash`. That is a salted SHA-256 of a 6-digit PIN: brute-forceable offline in moments per card. |
| `bus_tickets`, `event_transport_bookings` | The owner-only INSERT policy lets a user forge a ticket with a QR code of their choosing. Status defaults to paid/booked/issued, and boarding looks a ticket up by QR alone. A forged row can also carry another user's `settlement_id` to draw a refund. |
| `mover_jobs`, `car_hire_bookings` | Same forge-INSERT shape (any status, any escrow state), no secret. |
| `mover_bids` | Same default grants; reachable once a job is visible. |

Nothing legitimate uses that access. No client in `frontend-web`, `frontend-admin`, `mobile-app` or `supabase/functions` calls `.from()`/`/rest/v1` on any of these tables. No view or SECURITY INVOKER RPC reads them (the one invoker function that mentions `orders`, `restaurant_dispute_refund_cap_check`, is a trigger on a backend-written table). None is in a realtime publication. The Go backend reads and writes them as the table owner or `service_role`.

## Decision
Migration `20271076000000_secret_tables_postgrest_lockdown.sql`, identical in shape to ADR-PR858:
- `REVOKE ALL ON` all eight tables `FROM PUBLIC, anon, authenticated`;
- clear any column-level grants to those roles (they survive a table-level REVOKE);
- `GRANT ALL ... TO service_role` explicitly.

We revoke the whole table rather than column-scoping SELECT, because no client needs a read and full revocation also closes INSERT/UPDATE/DELETE at the grant layer, independent of policy correctness.

## Consequences
- These tables return `42501 permission denied` to `anon`/`authenticated` over PostgREST. Backend flows are unchanged; the food, health, academy and transport suites pass before and after against a migrated clone.
- **Policies on other tables that subquery `orders` or `pharmacy_orders` now fail closed for PostgREST callers:** `order_items`, `order_restaurant_items`, `restaurant_ratings` (INSERT), `restaurant_rider_locations` (SELECT/INSERT), `restaurant_order_messages` (SELECT/INSERT), `pharmacy_order_lines`, `dispense_records`. No client uses those tables directly. The side effect also closes the client-INSERT paths on ratings, rider locations and order messages. Those tables still hold default grants; locking them explicitly is a follow-up.
- The `authenticated` policies stay in place, because migrations are additive-only, but they are unreachable. Re-granting table SELECT would re-expose the secrets. A future direct client read must be a **column-scoped GRANT that omits the secret columns** (`delivery_code`, `pickup_code`, `pin_hash`, `qr_code`).
- Pinned by `backend/tests/postgrestlockdown/secret_tables_lockdown_live_db_test.go`. It runs a catalog check that PUBLIC/anon/authenticated hold no table or column privilege. Then, per table: the counterparty and anon cannot read each secret, the row is unreadable, a client-shaped forged INSERT is denied, UPDATE and DELETE are denied, and `service_role` keeps full access.
