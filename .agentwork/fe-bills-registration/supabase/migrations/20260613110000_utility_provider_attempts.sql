-- Migration: utility_provider_attempts
-- Durable attempt trail for provider failover and reconciliation.

CREATE TABLE IF NOT EXISTS public.utility_provider_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES public.utility_transactions(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES public.utility_providers(id),
  provider_mapping_id UUID REFERENCES public.utility_provider_product_mappings(id),
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  status TEXT NOT NULL DEFAULT 'started'
    CHECK (status IN ('started','successful','pending','failed','timeout','error')),
  request_idempotency_key TEXT NOT NULL,
  provider_reference TEXT,
  message TEXT,
  raw_response JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (transaction_id, provider_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_utility_attempts_transaction
  ON public.utility_provider_attempts(transaction_id, attempt_number);

CREATE INDEX IF NOT EXISTS idx_utility_attempts_provider
  ON public.utility_provider_attempts(provider_id, started_at DESC);

ALTER TABLE public.utility_provider_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "utility_attempts_read_own" ON public.utility_provider_attempts
  FOR SELECT TO authenticated USING (
    transaction_id IN (SELECT id FROM public.utility_transactions WHERE user_id = auth.uid())
  );
