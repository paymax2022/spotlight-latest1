-- Task 5.2: recurring settlement templates (additive-only).
-- Feature flag: FEATURE_RECURRING_SETTLEMENT_ENABLED (default off).
CREATE TABLE IF NOT EXISTS public.recurring_settlement_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text        NOT NULL,
  source_account_id uuid        NOT NULL REFERENCES public.ledger_accounts(id),
  amount_kobo       bigint      NOT NULL CHECK (amount_kobo > 0),
  schedule          text        NOT NULL CHECK (schedule IN ('daily','weekly','monthly')),
  anchor_day        smallint    CHECK (anchor_day BETWEEN 1 AND 31),
  splits            jsonb       NOT NULL,  -- [{"account_id": "...", "bps": 7000}, ...] sums to 10000
  next_run_at       timestamptz NOT NULL,
  last_run_at       timestamptz,
  active            boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (schedule <> 'monthly' OR anchor_day IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS recurring_settlement_templates_due_idx
  ON public.recurring_settlement_templates (next_run_at) WHERE active;
ALTER TABLE public.recurring_settlement_templates ENABLE ROW LEVEL SECURITY;
-- No policies: service role / backend pool only.
