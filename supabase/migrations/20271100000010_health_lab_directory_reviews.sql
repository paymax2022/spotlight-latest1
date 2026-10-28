-- Health Lab: persist what the mobile app used to fake.
-- Additive only. Replaces the client-side MOCK_LABS / MOCK_TESTS / MOCK_REVIEWS.
--   * lab_tests gains the display fields the catalog screens render
--     (category, description, home_collection, fasting_required).
--   * lab_profiles   — public directory facts for an APPROVED lab provider.
--   * lab_reviews    — one verified review per released order.

ALTER TABLE public.lab_tests
  ADD COLUMN IF NOT EXISTS category         text    NOT NULL DEFAULT 'wellness',
  ADD COLUMN IF NOT EXISTS description      text    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS home_collection  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS fasting_required boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.lab_profiles (
  lab_provider_id          uuid PRIMARY KEY REFERENCES public.health_providers(id) ON DELETE CASCADE,
  headline                 text    NOT NULL DEFAULT '',
  address                  text    NOT NULL DEFAULT '',
  supports_home_collection boolean NOT NULL DEFAULT false,
  supports_walk_in         boolean NOT NULL DEFAULT true,
  home_collection_fee_kobo bigint  NOT NULL DEFAULT 0 CHECK (home_collection_fee_kobo >= 0), -- NL-8 minor units
  result_eta_label         text    NOT NULL DEFAULT '',
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lab_reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_provider_id uuid NOT NULL REFERENCES public.health_providers(id) ON DELETE CASCADE,
  order_id        uuid NOT NULL REFERENCES public.lab_orders(id) ON DELETE CASCADE,
  author_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating          smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body            text NOT NULL DEFAULT '' CHECK (char_length(body) <= 2000),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id) -- one review per order; the service only accepts RELEASED orders the author owns
);
CREATE INDEX IF NOT EXISTS idx_lab_reviews_lab ON public.lab_reviews (lab_provider_id, created_at DESC);

ALTER TABLE public.lab_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_reviews  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lab_profiles_read ON public.lab_profiles;
CREATE POLICY lab_profiles_read ON public.lab_profiles
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.health_providers p
      WHERE p.id = lab_profiles.lab_provider_id
        AND ((p.status = 'APPROVED' AND p.discoverable) OR p.owner_user_id = auth.uid())
    )
  );
DROP POLICY IF EXISTS lab_profiles_service ON public.lab_profiles;
CREATE POLICY lab_profiles_service ON public.lab_profiles
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS lab_reviews_read ON public.lab_reviews;
CREATE POLICY lab_reviews_read ON public.lab_reviews
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS lab_reviews_service ON public.lab_reviews;
CREATE POLICY lab_reviews_service ON public.lab_reviews
  TO service_role USING (TRUE) WITH CHECK (TRUE);
