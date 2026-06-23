-- Migration: debit_wallet_atomic RPC
-- Fixes Block 4's non-atomic TOCTOU: balance check and ledger INSERT are now
-- inside a single PL/pgSQL function that holds a row-level lock for the duration.
-- Additive-only — no existing functions are modified.

CREATE OR REPLACE FUNCTION public.debit_wallet_atomic(
  p_account_id       uuid,
  p_amount_kobo      bigint,
  p_reference        text,
  p_idempotency_key  text,
  p_daily_limit_kobo bigint  DEFAULT NULL,  -- NULL = unlimited (Tier 3)
  p_description      text    DEFAULT NULL,
  p_metadata         jsonb   DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_available     bigint;
  v_daily_total   bigint;
BEGIN
  -- 1. Acquire an exclusive row-level lock on the ledger_accounts row.
  --    Any concurrent debit for the same account blocks here until we COMMIT.
  PERFORM 1
    FROM public.ledger_accounts
   WHERE id = p_account_id
     FOR UPDATE;

  -- 2. Read the current balance from the view (computed under the lock).
  SELECT COALESCE(wb.available_kobo, 0)
    INTO v_available
    FROM public.wallet_balance wb
   WHERE wb.account_id = p_account_id;

  v_available := COALESCE(v_available, 0);

  IF v_available < p_amount_kobo THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE: available=% required=%',
      v_available, p_amount_kobo;
  END IF;

  -- 3. Enforce daily tier limit if one is supplied.
  IF p_daily_limit_kobo IS NOT NULL THEN
    SELECT COALESCE(SUM(le.amount_kobo), 0)
      INTO v_daily_total
      FROM public.ledger_entries le
     WHERE le.account_id = p_account_id
       AND le.type = 'DEBIT'
       AND le.created_at >= date_trunc('day', NOW() AT TIME ZONE 'Africa/Lagos');

    v_daily_total := COALESCE(v_daily_total, 0);

    IF v_daily_total + p_amount_kobo > p_daily_limit_kobo THEN
      RAISE EXCEPTION 'TIER_LIMIT_EXCEEDED: daily_total=% amount=% limit=%',
        v_daily_total, p_amount_kobo, p_daily_limit_kobo;
    END IF;
  END IF;

  -- 4. Insert the DEBIT entry atomically (still under the account lock).
  INSERT INTO public.ledger_entries
    (account_id, type, amount_kobo, reference, idempotency_key, description, metadata)
  VALUES
    (p_account_id, 'DEBIT', p_amount_kobo, p_reference, p_idempotency_key,
     p_description, p_metadata);
END;
$$;

COMMENT ON FUNCTION public.debit_wallet_atomic IS
  'Atomically checks available balance and optional daily tier limit, then inserts a DEBIT '
  'ledger entry — all under a row-level lock on ledger_accounts. '
  'Raises INSUFFICIENT_BALANCE or TIER_LIMIT_EXCEEDED on failure; '
  'caller must catch SQLSTATE P0001 and map to HTTP 402/403 respectively.';

-- Revoke public execution; only service_role (used by the Next.js backend) may call this.
REVOKE EXECUTE ON FUNCTION public.debit_wallet_atomic FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.debit_wallet_atomic TO service_role;
