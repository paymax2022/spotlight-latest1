-- Migration: stays_deals — curated merchandising deals for the Stays landing feed.
-- Additive only: a new table. Denormalised display fields (title/subtitle + a
-- property card snapshot) so the member GET /deals endpoint needs no join to the
-- PostGIS-backed supply tables. Money is integer kobo. The (rail, supplier, ref)
-- triplet lets a client address the underlying offer on tap.

CREATE TABLE IF NOT EXISTS public.stays_deals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               text NOT NULL DEFAULT 'loyalty'
                       CHECK (kind IN ('mobile_rate','last_minute','loyalty')),
  title              text NOT NULL,
  subtitle           text NOT NULL DEFAULT '',
  -- Property addressing (to build the card id / navigate on tap).
  property_rail      text NOT NULL DEFAULT 'DIRECT',
  property_supplier  text NOT NULL DEFAULT '',
  property_ref       text NOT NULL DEFAULT '',
  -- Denormalised property-card snapshot.
  property_name      text NOT NULL DEFAULT '',
  city               text NOT NULL DEFAULT '',
  area               text NOT NULL DEFAULT '',
  star               int  NOT NULL DEFAULT 0,
  property_type      text NOT NULL DEFAULT 'hotel',
  lead_price_kobo    bigint NOT NULL DEFAULT 0 CHECK (lead_price_kobo >= 0),
  was_price_kobo     bigint CHECK (was_price_kobo IS NULL OR was_price_kobo >= 0),
  currency           text NOT NULL DEFAULT 'NGN',
  cover_url          text NOT NULL DEFAULT '',
  review_score       numeric NOT NULL DEFAULT 0,
  review_count       int NOT NULL DEFAULT 0,
  free_cancellation  boolean NOT NULL DEFAULT false,
  active             boolean NOT NULL DEFAULT true,
  sort               int NOT NULL DEFAULT 0,
  starts_at          timestamptz,
  ends_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stays_deals_active
  ON public.stays_deals (active, sort DESC, created_at DESC);

ALTER TABLE public.stays_deals ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated may read active deals; only service_role writes (curation
-- happens via the ops admin surface / seeds).
DO $$ BEGIN
  CREATE POLICY "stays_deals_select_active" ON public.stays_deals
    FOR SELECT TO authenticated USING (active = true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
