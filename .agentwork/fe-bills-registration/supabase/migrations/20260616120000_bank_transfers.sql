-- Block 11: Wallet-to-Bank Transfer tables
-- Additive-only. No DROP, no RENAME, no type narrowing.

-- ── bank_transfer_recipients ──────────────────────────────────────────────────
-- Stores Paystack transfer recipient codes so we don't recreate them on repeat transfers.

CREATE TABLE IF NOT EXISTS bank_transfer_recipients (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID        NOT NULL REFERENCES auth.users(id),
  bank_code               TEXT        NOT NULL,
  bank_name               TEXT        NOT NULL,
  account_number          TEXT        NOT NULL,  -- full number (encrypted at app layer ideally, stored plain for now)
  account_number_last4    TEXT        NOT NULL GENERATED ALWAYS AS (RIGHT(account_number, 4)) STORED,
  account_name            TEXT        NOT NULL,
  paystack_recipient_code TEXT        NOT NULL UNIQUE,
  nickname                TEXT,
  is_favorite             BOOLEAN     NOT NULL DEFAULT false,
  last_used_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bank_transfer_recipients_user_idx
  ON bank_transfer_recipients(user_id);

-- Prevent duplicate recipients for the same user+bank+account
CREATE UNIQUE INDEX IF NOT EXISTS bank_transfer_recipients_uniq
  ON bank_transfer_recipients(user_id, bank_code, account_number);

ALTER TABLE bank_transfer_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bank_recipients_owner_select"
  ON bank_transfer_recipients FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "bank_recipients_service_role"
  ON bank_transfer_recipients FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ── bank_transfers ────────────────────────────────────────────────────────────
-- One row per outbound bank transfer initiated by a user.

CREATE TABLE IF NOT EXISTS bank_transfers (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  reference                 TEXT        NOT NULL UNIQUE,        -- Paymax-generated (BTF_...)
  idempotency_key           TEXT        NOT NULL UNIQUE,
  user_id                   UUID        NOT NULL REFERENCES auth.users(id),
  recipient_id              UUID        REFERENCES bank_transfer_recipients(id),
  bank_code                 TEXT        NOT NULL,
  bank_name                 TEXT        NOT NULL,
  account_number_last4      TEXT        NOT NULL,
  account_name              TEXT        NOT NULL,
  paystack_recipient_code   TEXT        NOT NULL,
  paystack_transfer_code    TEXT,                                -- returned by Paystack on initiate
  paystack_transfer_id      BIGINT,                             -- Paystack internal numeric ID
  amount_kobo               BIGINT      NOT NULL CHECK (amount_kobo > 0),
  fee_kobo                  BIGINT      NOT NULL DEFAULT 0 CHECK (fee_kobo >= 0),
  narration                 TEXT,
  status                    TEXT        NOT NULL DEFAULT 'funds_reserved'
                                        CHECK (status IN (
                                          'funds_reserved',     -- funds debited, awaiting Paystack
                                          'provider_initiated', -- Paystack accepted the transfer
                                          'successful',         -- transfer.success webhook received
                                          'failed',             -- transfer.failed; funds reversed
                                          'reversed'            -- manual reversal
                                        )),
  failure_reason            TEXT,
  sender_entry_id           UUID,                               -- ledger DEBIT entry
  reversal_entry_id         UUID,                               -- ledger REVERSAL_DEBIT entry (on failure)
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bank_transfers_user_idx
  ON bank_transfers(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS bank_transfers_reference_idx
  ON bank_transfers(reference);

CREATE INDEX IF NOT EXISTS bank_transfers_paystack_code_idx
  ON bank_transfers(paystack_transfer_code)
  WHERE paystack_transfer_code IS NOT NULL;

ALTER TABLE bank_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bank_transfers_owner_select"
  ON bank_transfers FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "bank_transfers_service_role"
  ON bank_transfers FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
