-- Pharmacovigilance recall records for the pharmacy admin console
-- (GET|POST /api/health/pharmacy/admin/recalls). A recall tied to a catalog
-- product also deactivates it (never deletes — history retained).
-- ADDITIVE-ONLY: new table, nothing existing altered.
BEGIN;

CREATE TABLE IF NOT EXISTS public.pharmacy_recalls (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id         uuid REFERENCES public.pharmacy_products(id) ON DELETE SET NULL,
  product_name       text NOT NULL,
  nafdac_reg_no      text,
  batch_no           text NOT NULL,
  severity           text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status             text NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'investigating', 'resolved', 'closed')),
  reason             text NOT NULL,
  units_affected     int NOT NULL DEFAULT 0 CHECK (units_affected >= 0),
  patients_notified  int NOT NULL DEFAULT 0 CHECK (patients_notified >= 0),
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pharmacy_recalls_created ON public.pharmacy_recalls (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pharmacy_recalls_product ON public.pharmacy_recalls (product_id);

ALTER TABLE public.pharmacy_recalls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pharmacy_recalls_admin ON public.pharmacy_recalls;
CREATE POLICY pharmacy_recalls_admin ON public.pharmacy_recalls
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS pharmacy_recalls_service ON public.pharmacy_recalls;
CREATE POLICY pharmacy_recalls_service ON public.pharmacy_recalls
  TO service_role USING (TRUE) WITH CHECK (TRUE);

COMMIT;
