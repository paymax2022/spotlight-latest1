-- Patient-uploaded prescription images/documents awaiting pharmacist review
-- (POST /api/finance/health/pharmacy/prescriptions/upload[/presign]).
-- The object lives in R2 under pharmacy-rx/<patient_id>/; this row is metadata.
-- ADDITIVE-ONLY: new table, nothing existing altered.
BEGIN;

CREATE TABLE IF NOT EXISTS public.pharmacy_rx_uploads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_key   text NOT NULL UNIQUE,
  content_type  text NOT NULL,
  patient_name  text NOT NULL CHECK (length(btrim(patient_name)) BETWEEN 1 AND 480),
  note          text NOT NULL DEFAULT '',
  state         text NOT NULL DEFAULT 'VERIFYING'
                  CHECK (state IN ('VERIFYING', 'VERIFIED', 'REJECTED')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pharmacy_rx_uploads_patient
  ON public.pharmacy_rx_uploads (patient_id, created_at DESC);

ALTER TABLE public.pharmacy_rx_uploads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pharmacy_rx_uploads_owner ON public.pharmacy_rx_uploads;
CREATE POLICY pharmacy_rx_uploads_owner ON public.pharmacy_rx_uploads
  FOR SELECT TO authenticated USING (patient_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS pharmacy_rx_uploads_service ON public.pharmacy_rx_uploads;
CREATE POLICY pharmacy_rx_uploads_service ON public.pharmacy_rx_uploads
  TO service_role USING (TRUE) WITH CHECK (TRUE);

COMMIT;
