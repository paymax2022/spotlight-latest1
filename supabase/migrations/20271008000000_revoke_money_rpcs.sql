-- Migration: close the Supabase REST bypass on the money RPCs and stop the
-- wallet_balance view leaking every account's balance.
-- Security fix for the w7-m01 money-rail audit (issue #500).
-- Additive-only: REVOKE / CREATE OR REPLACE / GRANT — nothing is dropped.
--
-- EXPOSURE (verified via pg_proc.proacl / pg_class.relacl on a live DB)
-- ----------------------------------------------------------------------
-- transfer_wallet_atomic (20260616110000, redefined ADR-040 in 20261207000000)
-- and reserve_for_bank_transfer (20260616130000, redefined in 20261207000000)
-- carried the Postgres default EXECUTE grant to PUBLIC; the migrations only
-- added `GRANT EXECUTE ... TO service_role` and never revoked the default or
-- the Supabase default-privilege grants to anon/authenticated. PostgREST
-- exposes every public-schema function at /rest/v1/rpc/<name>, so an anon or
-- authenticated caller could invoke
--   transfer_wallet_atomic(p_sender_account_id := <victim account uuid>, ...)
-- and debit ANY ledger account. p_sender_id was never validated against the
-- account owner — it only fed the self-transfer check and audit columns.
-- debit_wallet_atomic and ledger_standing_account were revoked in
-- 20260614210000 / 20261207000000; these two were missed.
--
-- public.wallet_balance (20260613040000) was a definer-rights view (no
-- security_invoker) with ALL privileges granted to anon/authenticated — it
-- bypassed the select-own RLS on ledger_accounts/ledger_entries and leaked
-- every account UUID + balance, including the standing accounts
-- (provider_clearing, paymax_revenue, settlement, failed_transfer_suspense).
--
-- FIX
-- ---
--   1. CREATE OR REPLACE both function bodies — identical to the ADR-040
--      (20261207000000) balanced-journal versions, with two additions:
--        a) an ownership guard: the declared sender/user must own the debited
--           ledger account;
--        b) SET search_path = public, pg_temp on the SECURITY DEFINER
--           functions so a caller-controlled search_path cannot shadow the
--           referenced tables.
--      The only application callers are the Next.js wallet plane
--      (src/server/transfers/wallet-to-wallet.ts, bank.ts) which resolve the
--      sender account via getOrCreateAccount(userId) — user_id always matches.
--      The Go backend posts equivalent journals in its own pgx transactions
--      (backend/internal/finance/transfers/service.go) and never calls these.
--   2. REVOKE EXECUTE on both FROM PUBLIC, anon, authenticated; re-GRANT to
--      service_role (the Next.js plane calls via the service-role client).
--      Guarded by to_regprocedure so the migration is drift-safe.
--   3. Recreate wallet_balance WITH (security_invoker = true) — pattern per
--      20261207000200 — so the invoker's RLS applies; revoke anon/PUBLIC
--      privileges; keep SELECT for authenticated (sees only own rows now) and
--      service_role.
--
-- ⚠ MONEY-PATH: requires ledger-auditor + security-reviewer before merge.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) transfer_wallet_atomic — ADR-040 body + ownership guard + pinned path
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_wallet_atomic(
  p_sender_account_id    UUID,
  p_receiver_account_id  UUID,
  p_sender_id            UUID,
  p_receiver_id          UUID,
  p_amount_kobo          BIGINT,
  p_fee_kobo             BIGINT,
  p_reference            TEXT,
  p_idempotency_key      TEXT,
  p_daily_limit_kobo     BIGINT  DEFAULT 0,
  p_narration            TEXT    DEFAULT NULL,
  p_metadata             JSONB   DEFAULT NULL
)
RETURNS TABLE(sender_entry_id UUID, receiver_entry_id UUID, transfer_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_balance             BIGINT;
  v_daily_spent         BIGINT;
  v_total_debit         BIGINT := p_amount_kobo + p_fee_kobo;
  v_sender_entry_id     UUID   := gen_random_uuid();
  v_receiver_entry_id   UUID   := gen_random_uuid();
  v_transfer_id         UUID   := gen_random_uuid();
  v_fee_account_id      UUID;
BEGIN
  -- Ownership guard (w7-m01 fix): the declared sender must own the debited
  -- account. Previously p_sender_id fed only the self-transfer check and the
  -- wallet_transfers audit columns, so anyone holding EXECUTE could debit an
  -- arbitrary account UUID. Rejects standing/group accounts (user_id IS NULL)
  -- as senders — they are never a wallet-transfer sender by design.
  IF NOT EXISTS (
    SELECT 1 FROM public.ledger_accounts
     WHERE id = p_sender_account_id AND user_id = p_sender_id
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_OWNERSHIP_MISMATCH: p_sender_id does not own p_sender_account_id';
  END IF;

  -- Prevent self-transfer at DB level
  IF p_sender_id = p_receiver_id THEN
    RAISE EXCEPTION 'SELF_TRANSFER: sender and receiver must be different users';
  END IF;

  -- Lock sender's ledger entries to prevent concurrent double-spend
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
  FROM public.ledger_entries
  WHERE account_id = p_sender_account_id;

  IF v_balance < v_total_debit THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE: available=% required=%',
      v_balance, v_total_debit;
  END IF;

  -- Enforce daily KYC tier limit when p_daily_limit_kobo > 0
  IF p_daily_limit_kobo > 0 THEN
    SELECT COALESCE(SUM(amount_kobo), 0)
    INTO v_daily_spent
    FROM public.ledger_entries
    WHERE account_id = p_sender_account_id
      AND type = 'DEBIT'
      AND created_at >= CURRENT_DATE::TIMESTAMPTZ;

    IF v_daily_spent + v_total_debit > p_daily_limit_kobo THEN
      RAISE EXCEPTION 'TIER_LIMIT_EXCEEDED: daily_limit=% spent=% requested=%',
        p_daily_limit_kobo, v_daily_spent, v_total_debit;
    END IF;
  END IF;

  -- DEBIT sender (amount + fee so fee stays inside Paymax)
  INSERT INTO public.ledger_entries (
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
  INSERT INTO public.ledger_entries (
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

  -- ADR-040: recognise the fee that "stays with Paymax" as an actual leg,
  -- otherwise the journal is short by exactly fee_kobo.
  IF p_fee_kobo IS NOT NULL AND p_fee_kobo > 0 THEN
    v_fee_account_id := public.ledger_standing_account('paymax_revenue');

    INSERT INTO public.ledger_entries (
      id, account_id, type, amount_kobo, reference,
      idempotency_key, description, metadata
    ) VALUES (
      gen_random_uuid(),
      v_fee_account_id,
      'CREDIT',
      p_fee_kobo,
      p_reference,
      p_idempotency_key || ':fee',
      'Wallet transfer fee',
      p_metadata
    );
  END IF;

  -- Record the transfer
  INSERT INTO public.wallet_transfers (
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

COMMENT ON FUNCTION public.transfer_wallet_atomic IS
  'Block 10 — atomic Paymax wallet-to-wallet transfer. '
  'Locks sender account, checks balance + daily limit, then posts a BALANCED journal '
  '(DR sender amount+fee / CR receiver amount / CR paymax_revenue fee, ADR-040) '
  'in a single transaction. Raises INSUFFICIENT_BALANCE or TIER_LIMIT_EXCEEDED on failure. '
  'Ownership guard added 20271008000000: p_sender_id must own p_sender_account_id.';

-- ---------------------------------------------------------------------------
-- 2) reserve_for_bank_transfer — ADR-040 body + ownership guard + pinned path
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_for_bank_transfer(
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
SET search_path = public, pg_temp
AS $$
DECLARE
  v_balance       BIGINT;
  v_daily_spent   BIGINT;
  v_total_debit   BIGINT := p_amount_kobo + p_fee_kobo;
  v_entry_id      UUID   := gen_random_uuid();
  v_transfer_id   UUID   := gen_random_uuid();
  v_counter_id    UUID;
BEGIN
  -- Ownership guard (w7-m01 fix): the declared user must own the debited
  -- account — same bypass class as transfer_wallet_atomic.
  IF NOT EXISTS (
    SELECT 1 FROM public.ledger_accounts
     WHERE id = p_account_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_OWNERSHIP_MISMATCH: p_user_id does not own p_account_id';
  END IF;

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
  FROM public.ledger_entries
  WHERE account_id = p_account_id;

  IF v_balance < v_total_debit THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE: available=% required=%',
      v_balance, v_total_debit;
  END IF;

  -- Daily limit enforcement
  IF p_daily_limit_kobo > 0 THEN
    SELECT COALESCE(SUM(amount_kobo), 0)
    INTO v_daily_spent
    FROM public.ledger_entries
    WHERE account_id = p_account_id
      AND type = 'DEBIT'
      AND created_at >= CURRENT_DATE::TIMESTAMPTZ;

    IF v_daily_spent + v_total_debit > p_daily_limit_kobo THEN
      RAISE EXCEPTION 'TIER_LIMIT_EXCEEDED: daily_limit=% spent=% requested=%',
        p_daily_limit_kobo, v_daily_spent, v_total_debit;
    END IF;
  END IF;

  -- Reserve funds as a BALANCED pair (ADR-040): DEBIT reduces the sender's
  -- available balance immediately; the CREDIT records the funds as in flight to
  -- the payment provider. The sender leg keeps its existing ':bank-reserve' key —
  -- bank_transfers.sender_entry_id points at it, so that must not change.
  v_counter_id := public.ledger_standing_account('provider_clearing');

  INSERT INTO public.ledger_entries (
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
  ), (
    gen_random_uuid(),
    v_counter_id,
    'CREDIT',
    v_total_debit,
    p_reference,
    p_idempotency_key || ':bank-reserve:counter',
    COALESCE(p_narration, 'Bank transfer to ' || p_account_name),
    p_metadata
  );

  -- Create the bank transfer record at funds_reserved status
  INSERT INTO public.bank_transfers (
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

COMMENT ON FUNCTION public.reserve_for_bank_transfer IS
  'Block 11 — atomic fund reservation for outbound bank transfer. '
  'Posts a BALANCED reserve (DR sender wallet amount+fee / CR provider_clearing, '
  'ADR-040) and creates a bank_transfers record atomically. '
  'Paystack transfer is initiated by the caller AFTER this returns successfully. '
  'Ownership guard added 20271008000000: p_user_id must own p_account_id.';

-- ---------------------------------------------------------------------------
-- 3) Revoke default EXECUTE; re-grant to service_role only (drift-safe)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure(
    'public.transfer_wallet_atomic(uuid,uuid,uuid,uuid,bigint,bigint,text,text,bigint,text,jsonb)'
  ) IS NULL THEN
    RAISE NOTICE 'transfer_wallet_atomic(uuid,...) not found — skipping privilege fix';
  ELSE
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.transfer_wallet_atomic(uuid,uuid,uuid,uuid,bigint,bigint,text,text,bigint,text,jsonb) FROM PUBLIC';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE EXECUTE ON FUNCTION public.transfer_wallet_atomic(uuid,uuid,uuid,uuid,bigint,bigint,text,text,bigint,text,jsonb) FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'REVOKE EXECUTE ON FUNCTION public.transfer_wallet_atomic(uuid,uuid,uuid,uuid,bigint,bigint,text,text,bigint,text,jsonb) FROM authenticated';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION public.transfer_wallet_atomic(uuid,uuid,uuid,uuid,bigint,bigint,text,text,bigint,text,jsonb) TO service_role';
    END IF;
  END IF;

  IF to_regprocedure(
    'public.reserve_for_bank_transfer(uuid,uuid,uuid,text,text,text,text,text,bigint,bigint,text,text,bigint,text,jsonb)'
  ) IS NULL THEN
    RAISE NOTICE 'reserve_for_bank_transfer(uuid,...) not found — skipping privilege fix';
  ELSE
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.reserve_for_bank_transfer(uuid,uuid,uuid,text,text,text,text,text,bigint,bigint,text,text,bigint,text,jsonb) FROM PUBLIC';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE EXECUTE ON FUNCTION public.reserve_for_bank_transfer(uuid,uuid,uuid,text,text,text,text,text,bigint,bigint,text,text,bigint,text,jsonb) FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'REVOKE EXECUTE ON FUNCTION public.reserve_for_bank_transfer(uuid,uuid,uuid,text,text,text,text,text,bigint,bigint,text,text,bigint,text,jsonb) FROM authenticated';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION public.reserve_for_bank_transfer(uuid,uuid,uuid,text,text,text,text,text,bigint,bigint,text,text,bigint,text,jsonb) TO service_role';
    END IF;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) wallet_balance — security_invoker + tightened grants
-- ---------------------------------------------------------------------------
-- Same projection as 20260613040000; security_invoker makes the invoker's RLS
-- apply (select-own policies on ledger_accounts/ledger_entries) instead of the
-- view owner's — the pattern used for ledger_conservation_check in
-- 20261207000200.
CREATE OR REPLACE VIEW public.wallet_balance
WITH (security_invoker = true) AS
SELECT
  la.id          AS account_id,
  la.user_id,
  la.type        AS account_type,
  la.currency,
  COALESCE(
    SUM(
      CASE
        WHEN le.type IN ('CREDIT', 'REVERSAL_DEBIT') THEN  le.amount_kobo
        WHEN le.type IN ('DEBIT', 'REVERSAL_CREDIT') THEN -le.amount_kobo
        ELSE 0
      END
    ),
    0
  ) AS available_kobo,
  MAX(le.created_at) AS last_transaction_at
FROM public.ledger_accounts la
LEFT JOIN public.ledger_entries le ON le.account_id = la.id
GROUP BY la.id, la.user_id, la.type, la.currency;

-- Belt: CREATE OR REPLACE normally rewrites reloptions, but set it explicitly
-- so the option is guaranteed regardless of how the view was (re)created.
ALTER VIEW public.wallet_balance SET (security_invoker = true);

COMMENT ON VIEW public.wallet_balance IS
  'Ledger-projection of per-account available balance (kobo). '
  'security_invoker = true since 20271008000000 — callers see only rows their '
  'RLS on ledger_accounts/ledger_entries admits. Never a stored balance column.';

REVOKE ALL ON public.wallet_balance FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.wallet_balance FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.wallet_balance FROM authenticated';
    -- Read-only SELECT restored: with security_invoker, authenticated callers
    -- are filtered to their own ledger_accounts rows by base-table RLS.
    EXECUTE 'GRANT SELECT ON public.wallet_balance TO authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT ON public.wallet_balance TO service_role';
  END IF;
END;
$$;

COMMIT;
