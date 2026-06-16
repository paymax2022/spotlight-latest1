-- Add training-fee configuration directly on academy_batches.
-- Applicants inherit this structure on approval — no per-applicant setup needed.

ALTER TABLE public.academy_batches
  ADD COLUMN IF NOT EXISTS training_fee_ngn       NUMERIC(12,2) DEFAULT 0
    CHECK (training_fee_ngn >= 0),
  ADD COLUMN IF NOT EXISTS installments_count     INTEGER       DEFAULT 1
    CHECK (installments_count BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS fee_frequency          VARCHAR(20)   DEFAULT 'monthly'
    CHECK (fee_frequency IN ('upfront','weekly','biweekly','monthly')),
  -- Days after approval before the first installment is due
  ADD COLUMN IF NOT EXISTS fee_start_offset_days  INTEGER       DEFAULT 0;

COMMENT ON COLUMN public.academy_batches.training_fee_ngn IS
  'Total training fee in Naira for this batch (0 = free).';
COMMENT ON COLUMN public.academy_batches.installments_count IS
  'Number of equal installments applicants pay (1 = full payment upfront).';
COMMENT ON COLUMN public.academy_batches.fee_frequency IS
  'Interval between installments: upfront, weekly, biweekly, or monthly.';
COMMENT ON COLUMN public.academy_batches.fee_start_offset_days IS
  'Days after approval date before the first installment falls due.';
