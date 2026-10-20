-- RLS deny-all gate on backend-only tables flagged by `make rls-check`.
--
-- Context: `make rls-check` fails any public table without RLS enabled.
-- Service-role (Go backend) bypasses RLS, so ENABLE-without-policy is the
-- correct deny-all for tables that have no member-facing read/write path.
-- Per the `rls-force-vs-enable-vote-projection-trap` memory, we deliberately
-- ENABLE (not FORCE) — forcing without a write policy would deny the backend
-- itself, which is already protected by RLS bypass at the connection layer.
--
-- 16 bus_* tables shipped in `20271050000000_bus_transport_v2.sql` (PR #846,
-- feat(bus): v2 schema) without RLS; this migration retrofits RLS so the
-- rls-check gate passes. 2 Phase-5 Food tables likewise added by the
-- restaurant-delivery-zones and food-order-chargebacks migrations here are
-- backend-only idempotency/config tables with no member read path.
--
-- All ALTERs are idempotent (ENABLE on an already-enabled table is a no-op).

-- Phase-5 Food backend-only tables
ALTER TABLE IF EXISTS public.restaurant_delivery_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.restaurant_order_chargebacks ENABLE ROW LEVEL SECURITY;

-- Bus transport v2 — backend-only queue/catalog tables (PR #846).
ALTER TABLE IF EXISTS public.bus_booking ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bus_booking_leg ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bus_booking_passenger ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bus_departure ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bus_geo_city ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bus_geo_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bus_route_fare ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bus_route_stop ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bus_route_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bus_seat_hold ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bus_seat_layout ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bus_seat_layout_seat ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bus_seat_occupancy ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bus_terminal ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bus_ticket_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bus_vehicle ENABLE ROW LEVEL SECURITY;
