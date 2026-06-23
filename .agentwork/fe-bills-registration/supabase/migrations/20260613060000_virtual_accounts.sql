-- Migration: virtual_accounts
-- Additive only — new table storing Paystack Dedicated Virtual Account details.
--
-- Provisioning is idempotent: UNIQUE (user_id, provider, currency) ensures one DVA
-- per user per provider per currency. Second provision call returns the existing row.
--
-- Inbound transfers are credited to the wallet via the ledger (charge.success webhook,
-- channel=dedicated_nuban). account_number is the lookup key in the webhook handler.

CREATE TABLE IF NOT EXISTS public.virtual_accounts (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider         TEXT        NOT NULL DEFAULT 'paystack'
                               CHECK (provider IN ('paystack')),
  customer_code    TEXT,
  account_number   TEXT        NOT NULL,
  account_name     TEXT        NOT NULL,
  bank_name        TEXT        NOT NULL,
  bank_code        TEXT        NOT NULL,
  currency         TEXT        NOT NULL DEFAULT 'NGN'
                               CHECK (char_length(currency) = 3),
  provisioned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, provider, currency),
  UNIQUE (account_number, provider)
);

CREATE INDEX IF NOT EXISTS idx_virtual_accounts_user_id
  ON public.virtual_accounts (user_id);

-- Lookup by account_number for DVA inbound transfer webhook
CREATE INDEX IF NOT EXISTS idx_virtual_accounts_account_number
  ON public.virtual_accounts (account_number);

-- RLS
ALTER TABLE public.virtual_accounts ENABLE ROW LEVEL SECURITY;

-- Users can read their own virtual account
CREATE POLICY "virtual_accounts_select_own"
  ON public.virtual_accounts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- service_role only for INSERT/UPDATE
