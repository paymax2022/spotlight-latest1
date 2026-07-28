ALTER TABLE public.utility_transactions
  DROP CONSTRAINT IF EXISTS utility_transactions_payment_source_check,
  ADD CONSTRAINT utility_transactions_payment_source_check
    CHECK (payment_source IN ('wallet','paystack'));

CREATE TABLE IF NOT EXISTS public.utility_paystack_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL
    CHECK (category IN ('airtime','data','electricity','cable_tv','internet','education')),
  biller_id UUID NOT NULL REFERENCES public.utility_billers(id),
  product_id UUID NOT NULL REFERENCES public.utility_products(id),
  customer_reference TEXT NOT NULL,
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo > 0),
  retail_amount_kobo BIGINT NOT NULL CHECK (retail_amount_kobo > 0),
  payment_reference TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','completed','failed')),
  authorization_url TEXT,
  transaction_id UUID REFERENCES public.utility_transactions(id),
  failure_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_utility_paystack_intents_user_created
  ON public.utility_paystack_intents(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_utility_paystack_intents_reference
  ON public.utility_paystack_intents(payment_reference);

ALTER TABLE public.utility_paystack_intents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "utility_paystack_intents_read_own"
  ON public.utility_paystack_intents
  FOR SELECT
  USING (auth.uid() = user_id);
