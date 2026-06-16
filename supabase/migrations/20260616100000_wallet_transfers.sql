-- Block 10: Wallet-to-Wallet Transfer
-- Additive-only. No DROP, no RENAME, no type narrowing.
-- Tracks every internal Paymax-to-Paymax money movement.

CREATE TABLE IF NOT EXISTS wallet_transfers (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  reference         TEXT          NOT NULL UNIQUE,
  idempotency_key   TEXT          NOT NULL UNIQUE,
  sender_id         UUID          NOT NULL REFERENCES auth.users(id),
  receiver_id       UUID          NOT NULL REFERENCES auth.users(id),
  amount_kobo       BIGINT        NOT NULL CHECK (amount_kobo > 0),
  fee_kobo          BIGINT        NOT NULL DEFAULT 0 CHECK (fee_kobo >= 0),
  narration         TEXT,
  status            TEXT          NOT NULL DEFAULT 'successful'
                                  CHECK (status IN ('successful', 'failed', 'reversed')),
  -- Ledger entry IDs for audit trail
  sender_entry_id   UUID,
  receiver_entry_id UUID,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Efficient lookup by participant (for transaction history)
CREATE INDEX IF NOT EXISTS wallet_transfers_sender_idx
  ON wallet_transfers(sender_id, created_at DESC);

CREATE INDEX IF NOT EXISTS wallet_transfers_receiver_idx
  ON wallet_transfers(receiver_id, created_at DESC);

-- RLS: users can only see transfers they are part of.
-- Service-role bypasses RLS so the backend can insert freely.
ALTER TABLE wallet_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wallet_transfers_participant_select"
  ON wallet_transfers FOR SELECT
  USING (auth.uid() IN (sender_id, receiver_id));

-- Service role can do everything (INSERT from RPC, UPDATE for reversals)
CREATE POLICY "wallet_transfers_service_role_all"
  ON wallet_transfers FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
