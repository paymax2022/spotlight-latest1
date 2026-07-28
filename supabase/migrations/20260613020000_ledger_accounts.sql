-- Migration: ledger_accounts
-- Additive only — creates a new table, no changes to existing tables.
-- Each user gets one wallet account per currency (enforced by UNIQUE constraint).
-- All FKs reference auth.users(id), not platform_users.

CREATE TABLE IF NOT EXISTS public.ledger_accounts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        TEXT        NOT NULL DEFAULT 'wallet'
                          CHECK (type IN ('wallet')),
  currency    TEXT        NOT NULL DEFAULT 'NGN'
                          CHECK (char_length(currency) = 3),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, type, currency)
);

CREATE INDEX IF NOT EXISTS idx_ledger_accounts_user_id
  ON public.ledger_accounts (user_id);

-- RLS
ALTER TABLE public.ledger_accounts ENABLE ROW LEVEL SECURITY;

-- Users can read their own account
CREATE POLICY "ledger_accounts_select_own"
  ON public.ledger_accounts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Only service_role may insert (account creation is internal)
-- No INSERT/UPDATE/DELETE policy for authenticated → service_role bypasses RLS
