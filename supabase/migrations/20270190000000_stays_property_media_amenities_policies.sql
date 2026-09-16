-- Stays: property photos, amenities, house rules/cancellation policy, contact +
-- check-in/out — closes the gap where a self-listed (DIRECT-rail) property had
-- no way to carry any of this. Ref: docs/estate/PRD_Paymax_Hotel_Booking.md §8/§17.
--
-- ADDITIVE-ONLY: new columns with safe defaults, new table. No DROP, no rename,
-- no type narrowing.
BEGIN;

-- ── stays_property: amenities/policies/contact ──────────────────────────────
-- check_in_from/check_out_until are TEXT "HH:MM", not a native `time` column:
-- these are display-only (no in-SQL time arithmetic anywhere), and a plain
-- string sidesteps pgx's driver-version-dependent handling of scanning SQL
-- `time` into Go's time.Time.
ALTER TABLE public.stays_property
  ADD COLUMN IF NOT EXISTS amenities jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS house_rules text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cancellation_policy text NOT NULL DEFAULT 'FLEXIBLE',
  ADD COLUMN IF NOT EXISTS check_in_from text NOT NULL DEFAULT '14:00',
  ADD COLUMN IF NOT EXISTS check_out_until text NOT NULL DEFAULT '12:00',
  ADD COLUMN IF NOT EXISTS contact_phone text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_email text NOT NULL DEFAULT '';

DO $$ BEGIN
  ALTER TABLE public.stays_property
    ADD CONSTRAINT stays_property_cancellation_policy_check
    CHECK (cancellation_policy IN ('FLEXIBLE','MODERATE','STRICT','NON_REFUNDABLE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.stays_property
    ADD CONSTRAINT stays_property_check_in_from_format
    CHECK (check_in_from ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.stays_property
    ADD CONSTRAINT stays_property_check_out_until_format
    CHECK (check_out_until ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── PROPERTY PHOTOS — property-level or room-scoped (room_type_id nullable). One
-- object per row; the object itself lives in R2 (private bucket, presigned PUT to
-- write / presigned GET to read — see backend/internal/platform/r2). Only the
-- object key is stored here, never a public URL, matching the marketplace/estate/
-- association listing-media pattern.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stays_property_photo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   uuid NOT NULL REFERENCES public.stays_property(id) ON DELETE CASCADE,
  room_type_id  uuid REFERENCES public.stays_room_type(id) ON DELETE CASCADE,
  storage_key   text NOT NULL,
  caption       text NOT NULL DEFAULT '',
  is_cover      boolean NOT NULL DEFAULT false,
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stays_property_photo_property ON public.stays_property_photo (property_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_stays_property_photo_room ON public.stays_property_photo (room_type_id) WHERE room_type_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_stays_property_photo_updated ON public.stays_property_photo;
CREATE TRIGGER trg_stays_property_photo_updated BEFORE UPDATE ON public.stays_property_photo
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- RLS lockdown (same pattern as 20270170000000_restaurant_likes_rls_lockdown.sql
-- and the stays_staff_invite migration): this table is reached ONLY by the Go
-- backend (pgx service pool), which bypasses RLS. Enabling RLS with no policy
-- denies anon/authenticated via PostgREST outright.
DO $rls$ BEGIN IF to_regclass('public.stays_property_photo') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.stays_property_photo ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;

DO $$
BEGIN
  IF to_regclass('public.stays_property_photo') IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.stays_property_photo FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.stays_property_photo FROM authenticated';
  END IF;
END $$;

COMMIT;
