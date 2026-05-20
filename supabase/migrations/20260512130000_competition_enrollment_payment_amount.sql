-- Track confirmed registration payment amount for competition enrollments
ALTER TABLE public.competition_enrollments
  ADD COLUMN IF NOT EXISTS payment_amount_ngn INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_competition_enrollments_payment_status
  ON public.competition_enrollments(payment_status);

CREATE INDEX IF NOT EXISTS idx_competition_enrollments_payment_reference
  ON public.competition_enrollments(payment_reference)
  WHERE payment_reference IS NOT NULL AND payment_reference <> '';
