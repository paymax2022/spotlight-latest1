-- Pharmacy refill schedules — the patient's per-item refill preference for a
-- dispensed prescription item (GET /refills, POST /refills/:id/schedule).
-- ADDITIVE-ONLY: new table, nothing existing altered.
BEGIN;

CREATE TABLE IF NOT EXISTS public.pharmacy_refill_schedules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rx_item_id   uuid NOT NULL REFERENCES public.health_prescription_items(id) ON DELETE CASCADE,
  auto_refill  boolean NOT NULL DEFAULT false,
  due_at       timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (patient_id, rx_item_id)
);
CREATE INDEX IF NOT EXISTS idx_pharmacy_refill_schedules_patient
  ON public.pharmacy_refill_schedules (patient_id, due_at);

-- The Go service writes via service_role; a patient may read only their own rows.
ALTER TABLE public.pharmacy_refill_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pharmacy_refill_schedules_owner ON public.pharmacy_refill_schedules;
CREATE POLICY pharmacy_refill_schedules_owner ON public.pharmacy_refill_schedules
  FOR SELECT TO authenticated USING (patient_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS pharmacy_refill_schedules_service ON public.pharmacy_refill_schedules;
CREATE POLICY pharmacy_refill_schedules_service ON public.pharmacy_refill_schedules
  TO service_role USING (TRUE) WITH CHECK (TRUE);

COMMIT;
