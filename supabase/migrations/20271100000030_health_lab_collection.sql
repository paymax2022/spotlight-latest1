-- Health Lab: home-collection persistence. Additive only.
--   * lab_orders now remembers WHERE and WHEN a home collection happens and WHO
--     is doing it (previously the address/time the patient picked was dropped).
--   * lab_collection_checklists — the phlebotomist's confirmed bedside checklist,
--     kept as collection evidence (HL-6).
--   * lab_phlebotomist_locations — last known position, shown to the patient only
--     while their collection is active.
-- No money column is touched.

ALTER TABLE public.lab_orders
  ADD COLUMN IF NOT EXISTS collection_address        text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS collection_lat            double precision,
  ADD COLUMN IF NOT EXISTS collection_lng            double precision,
  ADD COLUMN IF NOT EXISTS scheduled_for             timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_phlebotomist_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS collection_status         text
    CHECK (collection_status IS NULL OR collection_status IN ('EN_ROUTE','ARRIVED'));

CREATE INDEX IF NOT EXISTS idx_lab_orders_phleb
  ON public.lab_orders (assigned_phlebotomist_id, state) WHERE assigned_phlebotomist_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.lab_collection_checklists (
  order_id      uuid PRIMARY KEY REFERENCES public.lab_orders(id) ON DELETE CASCADE,
  completed_ids text[] NOT NULL DEFAULT '{}',
  completed_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lab_phlebotomist_locations (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  lat        double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng        double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A scanned tube barcode identifies one sample. Added only when no duplicates
-- already exist, so applying this can never fail on historical data.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.lab_samples GROUP BY barcode_ref HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_lab_samples_barcode ON public.lab_samples (barcode_ref);
  END IF;
END $$;

ALTER TABLE public.lab_collection_checklists   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_phlebotomist_locations  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lab_collection_checklists_own ON public.lab_collection_checklists;
CREATE POLICY lab_collection_checklists_own ON public.lab_collection_checklists
  FOR SELECT TO authenticated USING (completed_by = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS lab_collection_checklists_service ON public.lab_collection_checklists;
CREATE POLICY lab_collection_checklists_service ON public.lab_collection_checklists
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS lab_phleb_locations_own ON public.lab_phlebotomist_locations;
CREATE POLICY lab_phleb_locations_own ON public.lab_phlebotomist_locations
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS lab_phleb_locations_service ON public.lab_phlebotomist_locations;
CREATE POLICY lab_phleb_locations_service ON public.lab_phlebotomist_locations
  TO service_role USING (TRUE) WITH CHECK (TRUE);
