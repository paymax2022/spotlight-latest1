-- Vet provider workspace: the few records a vet writes that the booking spine and
-- the owner-side tables (20271099000100) cannot hold.
--
--   * home-visit destination coordinates (reason/address live in vet_appointment_details)
--   * the vet-only extras of an e-prescription (notes + expiry; per-item form/frequency
--     live in vet_rx_item_details)
--   * a pet lab order by test NAME, and a specialist referral
--   * the owner rating of a vet (shared with the owner-side API)
--
-- Consult diagnosis/follow-up go to vet_consult_summary_extras, keyed by consult id.
--
-- Additive only: no DROP, no rename, no type change. Re-runnable.

BEGIN;

ALTER TABLE public.vet_appointment_payments
  ADD COLUMN IF NOT EXISTS dest_lat double precision,
  ADD COLUMN IF NOT EXISTS dest_lng double precision;

CREATE TABLE IF NOT EXISTS public.vet_prescription_meta (
  prescription_id uuid PRIMARY KEY REFERENCES public.health_prescriptions(id) ON DELETE CASCADE,
  appointment_id  uuid REFERENCES public.health_appointments(id) ON DELETE SET NULL,
  pet_id          uuid NOT NULL REFERENCES public.pets(id) ON DELETE CASCADE,
  provider_id     uuid NOT NULL REFERENCES public.health_providers(id) ON DELETE CASCADE,
  notes           text NOT NULL DEFAULT '',
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vet_rx_meta_pet ON public.vet_prescription_meta (pet_id);

CREATE TABLE IF NOT EXISTS public.vet_lab_orders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES public.health_appointments(id) ON DELETE CASCADE,
  pet_id         uuid NOT NULL REFERENCES public.pets(id) ON DELETE CASCADE,
  owner_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id    uuid NOT NULL REFERENCES public.health_providers(id) ON DELETE CASCADE,
  test_names     text[] NOT NULL CHECK (cardinality(test_names) > 0),
  note           text NOT NULL DEFAULT '',
  ordered_by     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vet_lab_orders_owner ON public.vet_lab_orders (owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.vet_referrals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id   uuid NOT NULL REFERENCES public.health_appointments(id) ON DELETE CASCADE,
  pet_id           uuid NOT NULL REFERENCES public.pets(id) ON DELETE CASCADE,
  owner_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_provider_id uuid NOT NULL REFERENCES public.health_providers(id) ON DELETE CASCADE,
  specialty        text NOT NULL,
  to_vet_name      text NOT NULL,
  reason           text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vet_referrals_owner ON public.vet_referrals (owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.vet_reviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL UNIQUE REFERENCES public.health_appointments(id) ON DELETE CASCADE,
  provider_id    uuid NOT NULL REFERENCES public.health_providers(id) ON DELETE CASCADE,
  owner_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating         smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body           text NOT NULL DEFAULT '',
  is_hidden      boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.vet_reviews ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_vet_reviews_provider ON public.vet_reviews (provider_id, created_at DESC);

-- RLS: writes go through the Go service (service role). Authenticated readers see
-- only rows they are a party to; ops (is_admin) see all.
ALTER TABLE public.vet_prescription_meta      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vet_lab_orders             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vet_referrals              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vet_reviews                ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='vet_prescription_meta' AND policyname='vet_rx_meta_party') THEN
    CREATE POLICY vet_rx_meta_party ON public.vet_prescription_meta FOR SELECT TO authenticated
      USING (public.is_admin()
             OR EXISTS (SELECT 1 FROM public.health_prescriptions rx WHERE rx.id = vet_prescription_meta.prescription_id AND rx.patient_id = auth.uid())
             OR EXISTS (SELECT 1 FROM public.health_providers p WHERE p.id = vet_prescription_meta.provider_id AND p.owner_user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='vet_prescription_meta' AND policyname='vet_rx_meta_service') THEN
    CREATE POLICY vet_rx_meta_service ON public.vet_prescription_meta FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='vet_lab_orders' AND policyname='vet_lab_orders_party') THEN
    CREATE POLICY vet_lab_orders_party ON public.vet_lab_orders FOR SELECT TO authenticated
      USING (public.is_admin() OR owner_id = auth.uid() OR ordered_by = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='vet_lab_orders' AND policyname='vet_lab_orders_service') THEN
    CREATE POLICY vet_lab_orders_service ON public.vet_lab_orders FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='vet_referrals' AND policyname='vet_referrals_party') THEN
    CREATE POLICY vet_referrals_party ON public.vet_referrals FOR SELECT TO authenticated
      USING (public.is_admin() OR owner_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.health_providers p WHERE p.id = vet_referrals.from_provider_id AND p.owner_user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='vet_referrals' AND policyname='vet_referrals_service') THEN
    CREATE POLICY vet_referrals_service ON public.vet_referrals FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='vet_reviews' AND policyname='vet_reviews_read') THEN
    CREATE POLICY vet_reviews_read ON public.vet_reviews FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='vet_reviews' AND policyname='vet_reviews_service') THEN
    CREATE POLICY vet_reviews_service ON public.vet_reviews FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMIT;
