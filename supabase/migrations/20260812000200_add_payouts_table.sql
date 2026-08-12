-- Creator payout requests (Tier 2+ gated). Additive-only.

CREATE TABLE IF NOT EXISTS payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  reference TEXT NOT NULL UNIQUE,
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo > 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  bank_name TEXT,
  account_number TEXT,
  account_name TEXT,
  idempotency_key TEXT NOT NULL,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT payouts_idempotency_key_unique UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS payouts_user_id_created_at_idx
  ON payouts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payouts_status_idx ON payouts (status);

ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payouts_select_own ON payouts;
CREATE POLICY payouts_select_own ON payouts
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS payouts_insert_own ON payouts;
CREATE POLICY payouts_insert_own ON payouts
  FOR INSERT WITH CHECK (auth.uid() = user_id);
