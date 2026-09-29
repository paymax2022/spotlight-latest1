-- Film Academy tuition Go migration (Phase 1): track when an installment plan
-- was fully paid off. Additive-only — no existing column touched.

ALTER TABLE public.academy_installment_plans
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.academy_installment_plans.completed_at IS
  'Set when every installment on the plan reaches paid/waived (HasCompletePayment).';
