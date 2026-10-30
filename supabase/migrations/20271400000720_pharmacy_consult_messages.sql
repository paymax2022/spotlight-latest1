-- Pharmacy consult thread — patient <-> pharmacist messages
-- (GET|POST /api/finance/health/pharmacy/consult/messages).
-- ADDITIVE-ONLY: new table, nothing existing altered.
BEGIN;

CREATE TABLE IF NOT EXISTS public.pharmacy_consult_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_pharmacist  boolean NOT NULL DEFAULT false,
  body             text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 8000),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pharmacy_consult_messages_patient
  ON public.pharmacy_consult_messages (patient_id, created_at DESC);

ALTER TABLE public.pharmacy_consult_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pharmacy_consult_messages_owner ON public.pharmacy_consult_messages;
CREATE POLICY pharmacy_consult_messages_owner ON public.pharmacy_consult_messages
  FOR SELECT TO authenticated USING (patient_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS pharmacy_consult_messages_service ON public.pharmacy_consult_messages;
CREATE POLICY pharmacy_consult_messages_service ON public.pharmacy_consult_messages
  TO service_role USING (TRUE) WITH CHECK (TRUE);

COMMIT;
