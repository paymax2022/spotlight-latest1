-- Paymax Stays / Hotel Booking — Availability integrity (SB1 direct-adapter wiring)
-- Ref: docs/estate/PRD_Paymax_Hotel_Booking.md §9 (ARI / oversell-impossible),
--      docs/estate/STAYS-BUILD-PLAN.md §2 (invariants).
--
-- ADDITIVE-ONLY: CREATE TABLE/INDEX/POLICY IF NOT EXISTS, idempotent.
--   NO DROP TABLE/COLUMN/TYPE, NO RENAME, NO type narrowing.
--   DROP POLICY/TRIGGER IF EXISTS is used only to re-create them idempotently.
--
-- Purpose:
--   The per-date allotment calendar (public.stays_availability_day) is already
--   created by 20260715000000_stays_ari.sql, keyed by (room_type_id, date) with
--   allotment / sold / stop_sell and the CHECK (sold <= allotment) oversell guard.
--   This migration is a no-op safety re-assert of that table (IF NOT EXISTS) PLUS
--   the genuinely new, additive piece that the Direct adapter needs to wire its
--   Book/Cancel legs to that calendar SAFELY:
--
--     public.stays_availability_decrement — a supplier_ref → (room_type_id, nights,
--     rooms) LINK/LEDGER row written when the direct adapter commits an allotment
--     decrement at Book time. It makes the adapter's decrement + release IDEMPOTENT:
--       * Book replay: a row already exists for supplier_ref → skip re-decrement.
--       * Cancel replay: the row's released flag flips once → skip re-release.
--     This prevents double-decrement (phantom oversell headroom loss) on a retried
--     Book and double-release (phantom inventory) on a retried Cancel.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- AVAILABILITY DAY — re-assert (no-op if already present from stays_ari).
-- Per room-type, per-date allotment + sold + stop_sell. The row-locked decrement
-- target: SELECT ... FOR UPDATE on (room_type_id, date) for each stay night; reject
-- when (allotment - sold) < rooms or stop_sell (OVERSELL_BLOCKED). The CHECK
-- (sold <= allotment) is the last-line DB guard against oversell.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stays_availability_day (
  room_type_id uuid NOT NULL REFERENCES public.stays_room_type(id) ON DELETE CASCADE,
  date         date NOT NULL,
  allotment    int  NOT NULL DEFAULT 0 CHECK (allotment >= 0),
  sold         int  NOT NULL DEFAULT 0 CHECK (sold >= 0),
  stop_sell    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_type_id, date),
  CONSTRAINT stays_availability_no_oversell CHECK (sold <= allotment)
);
CREATE INDEX IF NOT EXISTS idx_stays_availability_date ON public.stays_availability_day (date);

-- ════════════════════════════════════════════════════════════════════════════
-- AVAILABILITY DECREMENT — idempotency ledger for the direct adapter's Book/Cancel
-- allotment legs. One row per supplier reservation ref; records exactly which
-- (room_type_id, nights, rooms) were decremented so a replayed Book is a no-op and
-- a replayed Cancel releases exactly once.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stays_availability_decrement (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_ref  text NOT NULL,                      -- the direct DIR-* reservation ref
  room_type_id  uuid NOT NULL REFERENCES public.stays_room_type(id) ON DELETE CASCADE,
  check_in      date NOT NULL,
  check_out     date NOT NULL,
  rooms         int  NOT NULL DEFAULT 1 CHECK (rooms >= 1),
  released      boolean NOT NULL DEFAULT false,     -- flipped true when Cancel releases
  created_at    timestamptz NOT NULL DEFAULT now(),
  released_at   timestamptz,
  CHECK (check_out > check_in),
  UNIQUE (supplier_ref)                             -- idempotent decrement per booking
);
CREATE INDEX IF NOT EXISTS idx_stays_avail_decrement_room
  ON public.stays_availability_decrement (room_type_id, check_in);

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security — deny-by-default; service_role full (the adapter writes via
-- the financial pgx pool as service; no end-user reads this ledger).
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.stays_availability_day        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stays_availability_decrement  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stays_avail_decrement_admin ON public.stays_availability_decrement;
CREATE POLICY stays_avail_decrement_admin ON public.stays_availability_decrement
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS stays_avail_decrement_service ON public.stays_availability_decrement;
CREATE POLICY stays_avail_decrement_service ON public.stays_availability_decrement
  TO service_role USING (TRUE) WITH CHECK (TRUE);

COMMIT;
