-- Health Lab results vault: durable record that a patient acknowledged the
-- consent gate before opening a result (HL-8). Additive only.
CREATE TABLE IF NOT EXISTS public.lab_result_acknowledgements (
  order_id        uuid NOT NULL REFERENCES public.lab_orders(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, user_id)
);

ALTER TABLE public.lab_result_acknowledgements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lab_result_ack_own ON public.lab_result_acknowledgements;
CREATE POLICY lab_result_ack_own ON public.lab_result_acknowledgements
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS lab_result_ack_service ON public.lab_result_acknowledgements;
CREATE POLICY lab_result_ack_service ON public.lab_result_acknowledgements
  TO service_role USING (TRUE) WITH CHECK (TRUE);
