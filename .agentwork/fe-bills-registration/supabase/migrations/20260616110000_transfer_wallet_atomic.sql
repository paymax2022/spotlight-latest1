-- Block 10: Atomic wallet-to-wallet transfer RPC
--
-- Performs a complete wallet-to-wallet transfer in a single transaction:
--   1. Acquires a row-level lock on sender's ledger entries (prevents TOCTOU).
--   2. Checks sender has sufficient balance (amount + fee).
--   3. Optionally enforces sender's daily KYC tier limit.
--   4. Inserts a DEBIT ledger entry for the sender (amount + fee).
--   5. Inserts a CREDIT ledger entry for the receiver (amount only).
--   6. Inserts a record in wallet_transfers.
--
-- Returns: (sender_entry_id, receiver_entry_id, transfer_id)
-- Raises:  INSUFFICIENT_BALANCE | TIER_LIMIT_EXCEEDED

CREATE OR REPLACE FUNCTION transfer_wallet_atomic(
  p_sender_account_id    UUID,
  p_receiver_account_id  UUID,
  p_sender_id            UUID,
  p_receiver_id          UUID,
  p_amount_kobo          BIGINT,
  p_fee_kobo             BIGINT,
  p_reference            TEXT,
  p_idempotency_key      TEXT,
  p_daily_limit_kobo     BIGINT  DEFAULT 0,   -- 0 = no limit enforcement
  p_narration            TEXT    DEFAULT NULL,
  p_metadata             JSONB   DEFAULT NULL
)
RETURNS TABLE(sender_entry_id UUID, receiver_entry_id UUID, transfer_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_balance             BIGINT;
  v_daily_spent         BIGINT;
  v_total_debit         BIGINT := p_amount_kobo + p_fee_kobo;
  v_sender_entry_id     UUID   := gen_random_uuid();
  v_receiver_entry_id   UUID   := gen_random_uuid();
  v_transfer_id         UUID   := gen_random_uuid();
BEGIN
  -- Prevent self-transfer at DB level
  IF p_sender_id = p_receiver_id THEN
    RAISE EXCEPTION 'SELF_TRANSFER: sender and receiver must be different users';
  END IF;

  -- Lock sender's ledger entries to prevent concurrent double-spend
  -- (SHARE ROW EXCLUSIVE on the account row via ledger_entries aggregate)
  PERFORM pg_advisory_xact_lock(hashtext(p_sender_account_id::TEXT));

  -- Compute current available balance from ledger
  SELECT COALESCE(
    SUM(CASE
      WHEN type IN ('CREDIT', 'REVERSAL_DEBIT') THEN  amount_kobo
      WHEN type IN ('DEBIT',  'REVERSAL_CREDIT') THEN -amount_kobo
      ELSE 0
    END), 0
  )
  INTO v_balance
  FROM ledger_entries
  WHERE account_id = p_sender_account_id;

  IF v_balance < v_total_debit THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE: available=% required=%',
      v_balance, v_total_debit;
  END IF;

  -- Enforce daily KYC tier limit when p_daily_limit_kobo > 0
  IF p_daily_limit_kobo > 0 THEN
    SELECT COALESCE(SUM(amount_kobo), 0)
    INTO v_daily_spent
    FROM ledger_entries
    WHERE account_id = p_sender_account_id
      AND type = 'DEBIT'
      AND created_at >= CURRENT_DATE::TIMESTAMPTZ;

    IF v_daily_spent + v_total_debit > p_daily_limit_kobo THEN
      RAISE EXCEPTION 'TIER_LIMIT_EXCEEDED: daily_limit=% spent=% requested=%',
        p_daily_limit_kobo, v_daily_spent, v_total_debit;
    END IF;
  END IF;

  -- DEBIT sender (amount + fee so fee stays inside Paymax)
  INSERT INTO ledger_entries (
    id, account_id, type, amount_kobo, reference,
    idempotency_key, description, metadata
  ) VALUES (
    v_sender_entry_id,
    p_sender_account_id,
    'DEBIT',
    v_total_debit,
    p_reference,
    p_idempotency_key || ':sender',
    COALESCE(p_narration, 'Wallet transfer to Paymax user'),
    p_metadata
  );

  -- CREDIT receiver (amount only — fee stays with Paymax)
  INSERT INTO ledger_entries (
    id, account_id, type, amount_kobo, reference,
    idempotency_key, description, metadata
  ) VALUES (
    v_receiver_entry_id,
    p_receiver_account_id,
    'CREDIT',
    p_amount_kobo,
    p_reference,
    p_idempotency_key || ':receiver',
    COALESCE(p_narration, 'Wallet transfer received from Paymax user'),
    p_metadata
  );

  -- Record the transfer
  INSERT INTO wallet_transfers (
    id, reference, idempotency_key,
    sender_id, receiver_id,
    amount_kobo, fee_kobo, narration, status,
    sender_entry_id, receiver_entry_id
  ) VALUES (
    v_transfer_id, p_reference, p_idempotency_key,
    p_sender_id, p_receiver_id,
    p_amount_kobo, p_fee_kobo, p_narration, 'successful',
    v_sender_entry_id, v_receiver_entry_id
  );

  RETURN QUERY SELECT v_sender_entry_id, v_receiver_entry_id, v_transfer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION transfer_wallet_atomic TO service_role;

COMMENT ON FUNCTION transfer_wallet_atomic IS
  'Block 10 — atomic Paymax wallet-to-wallet transfer. '
  'Locks sender account, checks balance + daily limit, then debits sender '
  'and credits receiver in a single transaction. '
  'Raises INSUFFICIENT_BALANCE or TIER_LIMIT_EXCEEDED on failure.';
