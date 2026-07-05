-- Paymax Health — Pharmacy vertical: multi-pharmacy discovery + ratings.
-- Ref: docs/adr/ADR-017-pharmacy-discovery-ratings.md; builds on
-- 20260815000100_health_platform.sql (health_providers.geo, PostGIS) and
-- 20260815000200_health_pharmacy.sql (pharmacy_products/orders). Mirrors the
-- vet vertical's existing PostGIS discovery pattern (backend/internal/health/vet)
-- so a customer can browse ALL approved pharmacies and pick one by proximity,
-- location, or rating — not just transact against a single pharmacy_provider_id.
--
-- ADDITIVE-ONLY. No DROP TABLE / DROP COLUMN / DROP TYPE / RENAME / type
-- narrowing (DROP POLICY IF EXISTS only — the documented re-runnable pattern).
-- Money is BIGINT kobo (NL-8). RLS: public discovery of APPROVED+discoverable
-- pharmacies only; profile owner scoped; reviews scoped to the reviewing
-- patient/pharmacy owner; service_role full.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- PROFILE — pharmacy-specific discovery/storefront attributes, kept separate
-- from the shared health_providers row (which also carries VET/LAB). A row is
-- only required once the owner sets storefront details or the first review
-- lands (upserted then); discovery/detail reads tolerate a missing row via
-- LEFT JOIN + COALESCE defaults, so nothing here blocks HL-2 approval.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.pharmacy_provider_profiles (
  pharmacy_provider_id uuid PRIMARY KEY REFERENCES public.health_providers(id) ON DELETE CASCADE,
  address              text NOT NULL DEFAULT '',
  supports_pickup      boolean NOT NULL DEFAULT true,
  supports_delivery    boolean NOT NULL DEFAULT true,
  delivery_fee_kobo    bigint NOT NULL DEFAULT 0 CHECK (delivery_fee_kobo >= 0), -- NL-8 minor units
  avg_rating           numeric(3,2) NOT NULL DEFAULT 0 CHECK (avg_rating BETWEEN 0 AND 5),
  rating_count         integer NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- REVIEWS — one review per completed order (patient-authored, HL-2 discovery
-- input). Gated in the Go service to orders in DELIVERED/COLLECTED/CLOSED; the
-- UNIQUE(order_id) is the DB-level backstop against a double submit/replay.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.pharmacy_reviews (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             uuid NOT NULL REFERENCES public.pharmacy_orders(id) ON DELETE CASCADE,
  pharmacy_provider_id uuid NOT NULL REFERENCES public.health_providers(id) ON DELETE CASCADE,
  patient_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating               smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body                 text NOT NULL DEFAULT '',
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id)
);
CREATE INDEX IF NOT EXISTS idx_pharmacy_reviews_provider ON public.pharmacy_reviews (pharmacy_provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pharmacy_reviews_patient  ON public.pharmacy_reviews (patient_id);

-- Keep pharmacy_provider_profiles.avg_rating/rating_count in sync on every new
-- review. Reviews are immutable (no UPDATE/DELETE path in the Go service), so an
-- AFTER INSERT trigger recomputing the aggregate is sufficient and atomic with
-- the review write.
CREATE OR REPLACE FUNCTION public.pharmacy_reviews_apply_rating() RETURNS trigger AS $$
BEGIN
  INSERT INTO public.pharmacy_provider_profiles (pharmacy_provider_id, avg_rating, rating_count)
  SELECT NEW.pharmacy_provider_id, COALESCE(AVG(rating), 0), COUNT(*)
  FROM public.pharmacy_reviews WHERE pharmacy_provider_id = NEW.pharmacy_provider_id
  ON CONFLICT (pharmacy_provider_id) DO UPDATE
    SET avg_rating = EXCLUDED.avg_rating, rating_count = EXCLUDED.rating_count, updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_pharmacy_reviews_apply_rating ON public.pharmacy_reviews;
CREATE TRIGGER trg_pharmacy_reviews_apply_rating
  AFTER INSERT ON public.pharmacy_reviews
  FOR EACH ROW EXECUTE FUNCTION public.pharmacy_reviews_apply_rating();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE public.pharmacy_provider_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_reviews            ENABLE ROW LEVEL SECURITY;

-- Profiles: readable by anyone once the underlying pharmacy is APPROVED +
-- discoverable (HL-2 — same gate as pharmacy_products); the owning pharmacy
-- always sees its own (including while pending); admin sees all.
DROP POLICY IF EXISTS pharmacy_provider_profiles_read ON public.pharmacy_provider_profiles;
CREATE POLICY pharmacy_provider_profiles_read ON public.pharmacy_provider_profiles
  FOR SELECT TO authenticated USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.health_providers p
      WHERE p.id = pharmacy_provider_profiles.pharmacy_provider_id
        AND (
          (p.domain = 'PHARMACY' AND p.status = 'APPROVED' AND p.discoverable = true)
          OR p.owner_user_id = auth.uid()
        )
    )
  );
DROP POLICY IF EXISTS pharmacy_provider_profiles_service ON public.pharmacy_provider_profiles;
CREATE POLICY pharmacy_provider_profiles_service ON public.pharmacy_provider_profiles
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Reviews: only the authoring patient or an admin may read a review row via RLS.
-- The pharmacy owner is deliberately EXCLUDED here to preserve reviewer anonymity
-- (HL-8): owners see their storefront's reviews through the Go service
-- (pgxpool/service_role), which strips patient_id, and must never be able to
-- de-anonymize a reviewer by querying pharmacy_reviews directly via PostgREST.
-- Writes go through the Go service (service_role) only — the state/eligibility
-- gate (order must be DELIVERED/COLLECTED/CLOSED) is enforced there, not by RLS,
-- matching the dispense_records precedent in this vertical.
DROP POLICY IF EXISTS pharmacy_reviews_party ON public.pharmacy_reviews;
CREATE POLICY pharmacy_reviews_party ON public.pharmacy_reviews
  FOR SELECT TO authenticated USING (
    public.is_admin() OR patient_id = auth.uid()
  );
DROP POLICY IF EXISTS pharmacy_reviews_service ON public.pharmacy_reviews;
CREATE POLICY pharmacy_reviews_service ON public.pharmacy_reviews
  TO service_role USING (TRUE) WITH CHECK (TRUE);

COMMIT;
