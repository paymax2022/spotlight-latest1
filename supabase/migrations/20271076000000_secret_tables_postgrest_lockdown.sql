-- ADR-PR875: second PostgREST lockdown wave (first wave: ADR-PR858).
--
-- Supabase's default grants gave anon and authenticated every table privilege
-- on these tables, and RLS limits rows, not columns. Over /rest/v1 with an
-- ordinary JWT:
--   * orders: orders_select admits the rider (rider_id = auth.uid()), who read
--     delivery_code and pickup_code and could confirm their own delivery,
--     releasing escrow without the customer (restaurant/service.go
--     maskPODCodes says riders must never see them);
--   * pharmacy_orders: pharmacy_orders_party admits the pharmacy owner — also
--     the payee — who read pickup_code;
--   * academy_access_cards: academy_access_cards_read is USING (true) with no
--     role restriction, so anyone, anon included, read pin_hash (salted
--     SHA-256 of a 6-digit PIN) and could crack every card offline;
--   * bus_tickets, event_transport_bookings: the owner-only INSERT policy let a
--     user forge a paid/booked ticket with a QR code of their choosing
--     (boarding looks up by QR alone) and point it at another user's
--     settlement_id to draw a refund;
--   * mover_jobs, car_hire_bookings: the same forge-INSERT shape; mover_bids
--     carried the same default grants.
-- Every legitimate read and write goes through the Go backend as the table
-- owner / service_role (no client calls .from() or /rest/v1 on them, no view
-- or SECURITY INVOKER RPC reads them, none is in a realtime publication), so
-- anon and authenticated get nothing at all.
--
-- Side effect, intended: authenticated policies on other tables that subquery
-- orders / pharmacy_orders (order_items, order_restaurant_items,
-- restaurant_ratings, restaurant_rider_locations, restaurant_order_messages,
-- pharmacy_order_lines, dispense_records) now fail closed with 42501 for
-- PostgREST callers. No client reads or writes those tables either; the
-- backend is unaffected.
--
-- Additive-only: grants are revoked, no table, column or policy is dropped. The
-- now-unreachable policies stay in place; re-granting SELECT would re-expose the
-- secret columns, so any future direct client read must be a column-scoped
-- GRANT that omits them.

REVOKE ALL ON TABLE public.orders                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.pharmacy_orders          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.academy_access_cards     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.bus_tickets              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.event_transport_bookings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.mover_jobs               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.mover_bids               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.car_hire_bookings        FROM PUBLIC, anon, authenticated;

-- Column-level grants survive a table-level REVOKE; clear any that exist so a
-- secret column cannot stay readable through one.
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT DISTINCT table_name, column_name, grantee, privilege_type
        FROM information_schema.column_privileges
        WHERE table_schema = 'public'
          AND table_name IN ('orders','pharmacy_orders','academy_access_cards','bus_tickets',
                             'event_transport_bookings','mover_jobs','mover_bids','car_hire_bookings')
          AND grantee IN ('PUBLIC','anon','authenticated')
    LOOP
        EXECUTE format('REVOKE %s (%I) ON TABLE public.%I FROM %s',
                       r.privilege_type, r.column_name, r.table_name,
                       CASE r.grantee WHEN 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(r.grantee) END);
    END LOOP;
END $$;

-- service_role keeps full access explicitly (it is what the backend and admin
-- tooling use when they do not connect as the owner).
GRANT ALL ON TABLE public.orders                   TO service_role;
GRANT ALL ON TABLE public.pharmacy_orders          TO service_role;
GRANT ALL ON TABLE public.academy_access_cards     TO service_role;
GRANT ALL ON TABLE public.bus_tickets              TO service_role;
GRANT ALL ON TABLE public.event_transport_bookings TO service_role;
GRANT ALL ON TABLE public.mover_jobs               TO service_role;
GRANT ALL ON TABLE public.mover_bids               TO service_role;
GRANT ALL ON TABLE public.car_hire_bookings        TO service_role;
