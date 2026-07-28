-- Migration: wallet_topup_intents
-- Additive only — new table tracking Paystack payment lifecycle before webhook credit.
--
-- Flow: POST /api/v1/wallet/topup → insert 'pending' intent + Paystack initialize
--       Paystack webhook → find intent by payment_reference → credit ledger → set 'completed'
--
-- The intent's id drives the ledger entry idempotency_key ('topup:<intent_id>:CREDIT'),
-- ensuring webhook retries can never double-credit the wallet.

CREATE TABLE IF NOT EXISTS public.wallet_topup_intents (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_kobo        BIGINT      NOT NULL CHECK (amount_kobo > 0),
  payment_reference  TEXT        NOT NULL UNIQUE,
  idempotency_key    TEXT        NOT NULL UNIQUE,
  status             TEXT        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
  authorization_url  TEXT,
  paystack_response  JSONB,
  error_message      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_topup_intents_user_id
  ON public.wallet_topup_intents (user_id);

CREATE INDEX IF NOT EXISTS idx_topup_intents_payment_reference
  ON public.wallet_topup_intents (payment_reference);

CREATE INDEX IF NOT EXISTS idx_topup_intents_status
  ON public.wallet_topup_intents (status)
  WHERE status = 'pending';

-- RLS
ALTER TABLE public.wallet_topup_intents ENABLE ROW LEVEL SECURITY;

-- Users can read their own intents
CREATE POLICY "topup_intents_select_own"
  ON public.wallet_topup_intents
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- service_role writes (INSERT/UPDATE) — no authenticated write policy
