-- Applicants choose one-off (with discount) or installment when applying.
-- Admin sets the discount percentage on the batch.

ALTER TABLE public.academy_batches
  ADD COLUMN IF NOT EXISTS one_off_discount_pct NUMERIC(5,2) DEFAULT 0
    CHECK (one_off_discount_pct >= 0 AND one_off_discount_pct <= 100);

COMMENT ON COLUMN public.academy_batches.one_off_discount_pct IS
  'Discount % applied when applicant pays the full tuition in one payment.';

ALTER TABLE public.academy_applications
  ADD COLUMN IF NOT EXISTS payment_preference VARCHAR(20) DEFAULT 'installment'
    CHECK (payment_preference IN ('one_off','installment'));

COMMENT ON COLUMN public.academy_applications.payment_preference IS
  'Payment choice made by the applicant at registration time.';

ALTER TABLE public.academy_installment_plans
  ADD COLUMN IF NOT EXISTS plan_type VARCHAR(20) DEFAULT 'installment'
    CHECK (plan_type IN ('one_off','installment')),
  ADD COLUMN IF NOT EXISTS discount_applied_pct NUMERIC(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discounted_amount_ngn NUMERIC(12,2);

COMMENT ON COLUMN public.academy_installment_plans.plan_type IS
  'Whether this is a one-off payment (with possible discount) or installments.';
COMMENT ON COLUMN public.academy_installment_plans.discounted_amount_ngn IS
  'Actual amount charged after discount (for one_off plans).';
