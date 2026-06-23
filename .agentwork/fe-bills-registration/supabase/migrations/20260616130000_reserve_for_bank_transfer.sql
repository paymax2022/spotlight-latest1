-- Block 11: Atomic fund reservation for bank transfer
--
-- Performs in one transaction:
--   1. Acquires advisory lock on sender account (prevents concurrent double-spend)
--   2. Checks sender balance ≥ amount + fee
--   3. Enforces daily KYC tier limit (when p_daily_limit_kobo > 0)
--   4. Inserts DEBIT ledger entry (funds now reserved / unavailable)
--   5. Inserts bank_transfers record with status='funds_reserved'
--
-- Returns: (entry_id, transfer_id)
-- Raises:  INSUFFICIENT_BALANCE | TIER_LIMIT_EXCEEDED

CREATE OR REPLACE FUNCTION reserve_for_bank_transfer(
  p_account_id              UUID,
  p_user_id                 UUID,
  p_recipient_id            UUID,
  p_bank_code               TEXT,
  p_bank_name               TEXT,
  p_account_number_last4    TEXT,
  p_account_name            TEXT,
  p_paystack_recipient_code TEXT,
  p_amount_kobo             BIGINT,
  p_fee_kobo                BIGINT,
  p_reference               TEXT,
  p_idempotency_key         TEXT,
  p_daily_limit_kobo        BIGINT  DEFAULT 0,
  p_narration               TEXT    DEFAULT NULL,
  p_metadata                JSONB   DEFAULT NULL
)
RETURNS TABLE(entry_id UUID, transfer_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_balance       BIGINT;
  v_daily_spent   BIGINT;
  v_total_debit   BIGINT := p_amount_kobo + p_fee_kobo;
  v_entry_id      UUID   := gen_random_uuid();
  v_transfer_id   UUID   := gen_random_uuid();
BEGIN
  -- Advisory lock prevents concurrent debits on the same account
  PERFORM pg_advisory_xact_lock(hashtext(p_account_id::TEXT));

  -- Compute current available balance
  SELECT COALESCE(
    SUM(CASE
      WHEN type IN ('CREDIT', 'REVERSAL_DEBIT')  THEN  amount_kobo
      WHEN type IN ('DEBIT',  'REVERSAL_CREDIT') THEN -amount_kobo
      ELSE 0
    END), 0
  )
  INTO v_balance
  FROM ledger_entries
  WHERE account_id = p_account_id;

  IF v_balance < v_total_debit THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE: available=% required=%',
      v_balance, v_total_debit;
  END IF;

  -- Daily limit enforcement
  IF p_daily_limit_kobo > 0 THEN
    SELECT COALESCE(SUM(amount_kobo), 0)
    INTO v_daily_spent
    FROM ledger_entries
    WHERE account_id = p_account_id
      AND type = 'DEBIT'
      AND created_at >= CURRENT_DATE::TIMESTAMPTZ;

    IF v_daily_spent + v_total_debit > p_daily_limit_kobo THEN
      RAISE EXCEPTION 'TIER_LIMIT_EXCEEDED: daily_limit=% spent=% requested=%',
        p_daily_limit_kobo, v_daily_spent, v_total_debit;
    END IF;
  END IF;

  -- Reserve funds: DEBIT reduces available balance immediately
  INSERT INTO ledger_entries (
    id, account_id, type, amount_kobo, reference,
    idempotency_key, description, metadata
  ) VALUES (
    v_entry_id,
    p_account_id,
    'DEBIT',
    v_total_debit,
    p_reference,
    p_idempotency_key || ':bank-reserve',
    COALESCE(p_narration, 'Bank transfer to ' || p_account_name),
    p_metadata
  );

  -- Create the bank transfer record at funds_reserved status
  INSERT INTO bank_transfers (
    id, reference, idempotency_key,
    user_id, recipient_id,
    bank_code, bank_name, account_number_last4, account_name, paystack_recipient_code,
    amount_kobo, fee_kobo, narration, status, sender_entry_id
  ) VALUES (
    v_transfer_id, p_reference, p_idempotency_key,
    p_user_id, p_recipient_id,
    p_bank_code, p_bank_name, p_account_number_last4, p_account_name, p_paystack_recipient_code,
    p_amount_kobo, p_fee_kobo, p_narration, 'funds_reserved', v_entry_id
  );

  RETURN QUERY SELECT v_entry_id, v_transfer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION reserve_for_bank_transfer TO service_role;

COMMENT ON FUNCTION reserve_for_bank_transfer IS
  'Block 11 — atomic fund reservation for outbound bank transfer. '
  'Debits the sender wallet and creates a bank_transfers record atomically. '
  'Paystack transfer is initiated by the caller AFTER this returns successfully.';
