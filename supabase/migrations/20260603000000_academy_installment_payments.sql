-- Academy training fee installment payment system
-- Applicants pay training fees in installments; each plan tracks due dates,
-- payment references, and reminder timestamps.

CREATE TABLE IF NOT EXISTS public.academy_installment_plans (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id        UUID NOT NULL REFERENCES public.academy_applications(id) ON DELETE CASCADE,
  batch_id              UUID REFERENCES public.academy_batches(id) ON DELETE SET NULL,
  total_amount_ngn      NUMERIC(12, 2) NOT NULL CHECK (total_amount_ngn > 0),
  installments_count    INTEGER NOT NULL DEFAULT 3 CHECK (installments_count BETWEEN 1 AND 12),
  frequency             VARCHAR(20) NOT NULL DEFAULT 'monthly'
                          CHECK (frequency IN ('weekly','biweekly','monthly')),
  status                VARCHAR(20) NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','completed','cancelled')),
  notes                 TEXT,
  created_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (application_id)  -- one plan per applicant
);

CREATE TABLE IF NOT EXISTS public.academy_installment_payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id               UUID NOT NULL REFERENCES public.academy_installment_plans(id) ON DELETE CASCADE,
  installment_number    INTEGER NOT NULL CHECK (installment_number >= 1),
  amount_ngn            NUMERIC(12, 2) NOT NULL CHECK (amount_ngn > 0),
  due_date              DATE NOT NULL,
  paid_at               TIMESTAMPTZ,
  payment_reference     VARCHAR(255),
  payment_provider      VARCHAR(50) DEFAULT 'paystack',
  status                VARCHAR(20) NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','paid','overdue','waived')),
  reminder_sent_at      TIMESTAMPTZ,
  reminder_count        INTEGER NOT NULL DEFAULT 0,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id, installment_number)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_installment_plans_application
  ON public.academy_installment_plans(application_id);

CREATE INDEX IF NOT EXISTS idx_installment_plans_batch
  ON public.academy_installment_plans(batch_id);

CREATE INDEX IF NOT EXISTS idx_installment_payments_plan
  ON public.academy_installment_payments(plan_id);

CREATE INDEX IF NOT EXISTS idx_installment_payments_due
  ON public.academy_installment_payments(due_date)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_installment_payments_overdue
  ON public.academy_installment_payments(due_date, status)
  WHERE status IN ('pending','overdue');

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_installment_plans_updated_at ON public.academy_installment_plans;
CREATE TRIGGER trg_installment_plans_updated_at
  BEFORE UPDATE ON public.academy_installment_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_installment_payments_updated_at ON public.academy_installment_payments;
CREATE TRIGGER trg_installment_payments_updated_at
  BEFORE UPDATE ON public.academy_installment_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Mark plan complete when all installments are paid
CREATE OR REPLACE FUNCTION public.check_installment_plan_completion()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  total_count  INTEGER;
  paid_count   INTEGER;
BEGIN
  SELECT installments_count INTO total_count
  FROM public.academy_installment_plans WHERE id = NEW.plan_id;

  SELECT COUNT(*) INTO paid_count
  FROM public.academy_installment_payments
  WHERE plan_id = NEW.plan_id AND status = 'paid';

  IF paid_count >= total_count THEN
    UPDATE public.academy_installment_plans
    SET status = 'completed', updated_at = NOW()
    WHERE id = NEW.plan_id AND status = 'active';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_plan_completion ON public.academy_installment_payments;
CREATE TRIGGER trg_check_plan_completion
  AFTER UPDATE ON public.academy_installment_payments
  FOR EACH ROW
  WHEN (NEW.status = 'paid' AND OLD.status <> 'paid')
  EXECUTE FUNCTION public.check_installment_plan_completion();

-- RLS
ALTER TABLE public.academy_installment_plans    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_installment_payments ENABLE ROW LEVEL SECURITY;

-- Admin can do everything (via service role key, bypasses RLS)
-- Applicants can read their own plan/payments
CREATE POLICY "Applicant reads own plan"
  ON public.academy_installment_plans FOR SELECT
  USING (
    application_id IN (
      SELECT id FROM public.academy_applications WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Applicant reads own payments"
  ON public.academy_installment_payments FOR SELECT
  USING (
    plan_id IN (
      SELECT p.id FROM public.academy_installment_plans p
      JOIN public.academy_applications a ON a.id = p.application_id
      WHERE a.user_id = auth.uid()
    )
  );
