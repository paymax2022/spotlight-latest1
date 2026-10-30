-- Driver onboarding: NIN + driver's licence verified by provider (Dojah), and
-- the guarantor captured during onboarding.
--
-- Two additive changes to driver_documents, both widenings:
--   1. `nin` joins the doc_type allow-list. NIN and the licence are now
--      data-matched against the provider instead of uploaded as files, and the
--      verified result is stored as a driver_documents row so admin review sees
--      one place.
--   2. file_url becomes nullable, because a provider-verified row has no stored
--      object. Existing upload rows keep their value; nothing is rewritten.
--
-- driver_guarantors is new: the driver supplies the guarantor's details during
-- onboarding, and the document the guarantor signs is issued AFTER onboarding
-- completes (document_status starts at pending_issue), so it never gates
-- submission.

DO $$
BEGIN
  IF to_regclass('public.driver_documents') IS NOT NULL THEN
    ALTER TABLE public.driver_documents ALTER COLUMN file_url DROP NOT NULL;

    ALTER TABLE public.driver_documents
      DROP CONSTRAINT IF EXISTS driver_documents_doc_type_check;
    ALTER TABLE public.driver_documents
      ADD CONSTRAINT driver_documents_doc_type_check
      CHECK (doc_type IN (
        'government_id','drivers_licence','proof_of_address','vehicle_licence',
        'roadworthiness','insurance','driver_photo',
        'vehicle_insurance','license','vehicle_reg','road_worthiness','lasrra',
        'psv','profile_photo',
        -- provider-verified identity (no uploaded object)
        'nin'
      ));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.driver_guarantors (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id           uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  full_name           text NOT NULL,
  phone               text NOT NULL,
  email               text,
  relationship        text NOT NULL,
  document_status     text NOT NULL DEFAULT 'pending_issue',
  signed_document_url text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_guarantors_document_status_check
    CHECK (document_status IN ('pending_issue','issued','signed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS driver_guarantors_driver_id_key
  ON public.driver_guarantors (driver_id);

ALTER TABLE public.driver_guarantors ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'driver_guarantors'
      AND policyname = 'driver_guarantors_own'
  ) THEN
    CREATE POLICY driver_guarantors_own ON public.driver_guarantors
      FOR ALL TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.drivers d
        WHERE d.id = driver_guarantors.driver_id AND d.user_id = auth.uid()
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM public.drivers d
        WHERE d.id = driver_guarantors.driver_id AND d.user_id = auth.uid()
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'driver_guarantors'
      AND policyname = 'driver_guarantors_service'
  ) THEN
    CREATE POLICY driver_guarantors_service ON public.driver_guarantors
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
