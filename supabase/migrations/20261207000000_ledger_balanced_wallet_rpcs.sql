-- Migration: make the Next.js wallet-plane RPCs post BALANCED double-entry.
-- ADR-PR98 (docs/adr/ADR-PR98-wallet-plane-double-entry.md).
--
-- WHY
-- ---
-- public.ledger_entries is SHARED between two writers:
--   • the Go finance module (backend/internal/finance/ledger) — always posts a
--     balanced DR/CR pair for every event;
--   • the Next.js wallet plane — historically posted ONE leg per event.
-- Because the table is shared, the single-sided writers made global conservation
-- (SUM(signed amount) = 0 over the whole table) permanently unassertable, and
-- they violate the CLAUDE.md iron rule that every money mutation posts balanced
-- double-entry. ADR-PR98 chose option (a): give the wallet plane counter-legs on
-- the SAME chart of accounts the Go ledger uses, so the table balances globally.
--
-- This migration fixes the three SQL writers that could not conserve value:
--   1. debit_wallet_atomic       — DEBIT wallet, no counter-leg
--   2. reserve_for_bank_transfer — DEBIT wallet, no counter-leg
--   3. transfer_wallet_atomic    — DR sender (amount+fee) / CR receiver (amount);
--                                  the fee had NO leg, so every fee-bearing
--                                  transfer leaked exactly fee_kobo.
-- The app-level single-leg writers (creditWallet / reverseWalletDebit / the
-- legacy-balance migration / the bank-transfer refund) are fixed in the same PR
-- via frontend-web/src/server/wallet/journal.ts.
--
-- SAFETY / ADDITIVITY
-- -------------------
--  • No table, column or row is dropped, renamed or narrowed.
--  • Function BODIES are replaced in place (CREATE OR REPLACE) with the argument
--    lists byte-for-byte UNCHANGED — no caller edit, and no overload ambiguity
--    for PostgREST's named-argument calls. The counter-account is resolved
--    INSIDE the function, so omitting it is impossible by construction.
--  • Every pre-existing check, lock, day-boundary and RAISE message is preserved
--    verbatim; the only behavioural delta is the added balancing leg.
--  • The wallet leg keeps its existing idempotency_key EXACTLY; only the
--    counter-leg is suffixed. Entries written before ADR-PR98 carry the
--    un-suffixed key and the app's dedup check looks up that exact string, so a
--    replayed webhook for a pre-ADR event still de-duplicates. Changing the
--    wallet leg's key would double-spend on replay. Do not.
--  • User balances are untouched: counter-legs land on STANDING accounts
--    (user_id IS NULL), which no user's balance projection reads.
--
-- ⚠ MONEY-PATH: requires ledger-auditor review before merge.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Standing-account resolver
-- ---------------------------------------------------------------------------
-- Mirrors Go's ledger.Repository.GetOrCreateAccount(nil, type): standing
-- accounts are singletons keyed by type with user_id IS NULL AND group_id IS
-- NULL, enforced by ledger_accounts_standing_type_key (20260912000001). Both
-- planes therefore converge on ONE row per type.
CREATE OR REPLACE FUNCTION public.ledger_standing_account(p_type TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id
    FROM public.ledger_accounts
   WHERE type = p_type AND user_id IS NULL AND group_id IS NULL;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.ledger_accounts (type, currency)
  VALUES (p_type, 'NGN')
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    -- Lost the race against a concurrent creator (or the Go plane) — re-read.
    SELECT id INTO v_id
      FROM public.ledger_accounts
     WHERE type = p_type AND user_id IS NULL AND group_id IS NULL;
  END IF;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'LEDGER_STANDING_ACCOUNT_UNRESOLVED: type=%', p_type;
  END IF;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.ledger_standing_account IS
  'Resolves (creating on first use) the singleton standing ledger account for a type '
  '(user_id IS NULL AND group_id IS NULL). Counter-leg destination for the wallet-plane '
  'RPCs — see ADR-PR98.';

REVOKE EXECUTE ON FUNCTION public.ledger_standing_account FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.ledger_standing_account TO service_role;

-- ---------------------------------------------------------------------------
-- 2) debit_wallet_atomic — now DR wallet / CR settlement
-- ---------------------------------------------------------------------------
-- 'settlement' is the generic platform clearing pot — the same counterparty the
-- Go internal-ledger funding path uses for wallet funding/draining that is not
-- attributable to a provider or to revenue. Callers wanting finer attribution
-- should post through the app-level journal helper instead.
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
  v_counter_id    uuid;
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

  -- 4. Post the BALANCED pair atomically (still under the account lock).
  --    ADR-PR98: the wallet leg keeps p_idempotency_key verbatim; the counter-leg
  --    is suffixed ':counter'. The daily-total query above deliberately filters
  --    on the wallet account only, so the new CREDIT leg cannot inflate it.
  v_counter_id := public.ledger_standing_account('settlement');

  INSERT INTO public.ledger_entries
    (account_id, type, amount_kobo, reference, idempotency_key, description, metadata)
  VALUES
    (p_account_id, 'DEBIT',  p_amount_kobo, p_reference, p_idempotency_key,
     p_description, p_metadata),
    (v_counter_id, 'CREDIT', p_amount_kobo, p_reference, p_idempotency_key || ':counter',
     p_description, p_metadata);
END;
$$;

COMMENT ON FUNCTION public.debit_wallet_atomic IS
  'Atomically checks available balance and optional daily tier limit, then posts a BALANCED '
  'DR wallet / CR settlement pair — all under a row-level lock on ledger_accounts (ADR-PR98). '
  'Raises INSUFFICIENT_BALANCE or TIER_LIMIT_EXCEEDED on failure; '
  'caller must catch SQLSTATE P0001 and map to HTTP 402/403 respectively.';

REVOKE EXECUTE ON FUNCTION public.debit_wallet_atomic FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.debit_wallet_atomic TO service_role;

-- ---------------------------------------------------------------------------
-- 3) reserve_for_bank_transfer — now DR wallet / CR provider_clearing
-- ---------------------------------------------------------------------------
-- 'provider_clearing' is the in-flight-to-PSP pot: at reserve time the funds have
-- left the user's spendable balance and are on their way to Paystack. Chosen over
-- the Go plane's 'failed_transfer_suspense' deliberately — suspense requires a
-- second posting to drain it on SUCCESS, and this plane has no such step, so a
-- suspense pot here would only ever grow. Clearing needs no settle step: on
-- success the money genuinely did leave, and on failure the refund's
-- REVERSAL_CREDIT drains the same clearing account (see bank-webhook.ts).
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
  v_counter_id    UUID;
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

  -- Reserve funds as a BALANCED pair (ADR-PR98): DEBIT reduces the sender's
  -- available balance immediately; the CREDIT records the funds as in flight to
  -- the payment provider. The sender leg keeps its existing ':bank-reserve' key —
  -- bank_transfers.sender_entry_id points at it, so that must not change.
  v_counter_id := public.ledger_standing_account('provider_clearing');

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
  'Posts a BALANCED reserve (DR sender wallet amount+fee / CR provider_clearing, '
  'ADR-PR98) and creates a bank_transfers record atomically. '
  'Paystack transfer is initiated by the caller AFTER this returns successfully.';

-- ---------------------------------------------------------------------------
-- 4) transfer_wallet_atomic — the fee now has a leg
-- ---------------------------------------------------------------------------
-- Before: DR sender (amount+fee), CR receiver (amount) → every fee-bearing
-- transfer leaked exactly fee_kobo. The fee is now recognised as platform income
-- (CR paymax_revenue), so the journal sums to zero for any fee. A zero-fee
-- transfer still posts exactly the original two entries.
CREATE OR REPLACE FUNCTION transfer_wallet_atomic(
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

  -- ADR-PR98: recognise the fee that "stays with Paymax" as an actual leg,
  -- otherwise the journal is short by exactly fee_kobo.
  IF p_fee_kobo IS NOT NULL AND p_fee_kobo > 0 THEN
    v_fee_account_id := public.ledger_standing_account('paymax_revenue');

    INSERT INTO ledger_entries (
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
  'Locks sender account, checks balance + daily limit, then posts a BALANCED journal '
  '(DR sender amount+fee / CR receiver amount / CR paymax_revenue fee, ADR-PR98) '
  'in a single transaction. Raises INSUFFICIENT_BALANCE or TIER_LIMIT_EXCEEDED on failure.';

COMMIT;
