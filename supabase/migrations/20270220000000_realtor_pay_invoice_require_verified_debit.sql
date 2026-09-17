-- Realtor module — close the fabricated-payment exploit in realtor_pay_invoice.
-- ADDITIVE ONLY (no DROP).
--
-- ⚠️ Verified locally (per the task brief's instruction not to trust this
-- blind) via `\df realtor_pay_invoice` and `pg_proc.proacl` after applying
-- the naive "CREATE OR REPLACE with one new trailing DEFAULT arg" version of
-- this migration, and TWO separate bugs turned up:
--
--   (1) Postgres overloads functions by (name, arg COUNT), so adding a 4th
--       parameter does NOT replace the original 3-arg function — it creates
--       a SECOND, separate function. The original 3-arg
--       `realtor_pay_invoice(UUID, TEXT, TEXT)` — with its original
--       vulnerable body and its original `GRANT ... TO authenticated` — was
--       still present and still directly callable by any authenticated
--       client, leaving the exploit fully open despite this migration's
--       intent. Fixed by explicitly re-defining BOTH overloads: the 3-arg
--       form becomes a thin delegating shim (no vulnerable logic of its own
--       — CREATE OR REPLACE on its own unchanged signature, so still
--       additive/non-breaking) and BOTH overloads have EXECUTE revoked from
--       PUBLIC/authenticated and granted only to service_role.
--
--   (2) DEVIATION FROM THE BRIEF: giving `p_user_id` a `DEFAULT NULL` (as the
--       brief's illustrative snippet suggested) made the two overloads
--       genuinely AMBIGUOUS at call time: `SELECT realtor_pay_invoice(id,
--       'WALLET', 'key')` — the exact 3-arg call shape the ORIGINAL exploit
--       used — fails with `function realtor_pay_invoice(...) is not unique`
--       rather than resolving to either overload, because Postgres cannot
--       decide between "exact match, 3-arg function" and "4-arg function
--       with the last param defaulted". This is a general Postgres
--       limitation, not specific to this function — reproduced and confirmed
--       via `psql` before deciding on a fix. Left as-is, this would have
--       also broken the deliberate delegating shim's own dispatch behavior
--       for any other 3-arg-shaped caller. Fix: `p_user_id` has NO default
--       (required 4th parameter) below. This keeps both overloads additive
--       (no DROP; the new function simply has 4 required params instead of
--       3+1-default) while making the two call shapes unambiguous: a 3-arg
--       call resolves only to the shim, a 4-arg call resolves only to this
--       function. Every real caller (frontend-web's
--       src/server/realtor/invoices.ts, and the shim itself) already passes
--       all 4 args explicitly, so this costs nothing.
--
-- Bug fixed: realtor_pay_invoice was SECURITY DEFINER, GRANTed to
-- `authenticated`, and called DIRECTLY by the mobile client
-- (realtorLease.api.ts -> supabase.rpc('realtor_pay_invoice', ...)). It
-- unconditionally marked the invoice paid, activated the lease and created a
-- refundable escrow deposit with ZERO verification that any real payment
-- happened — no wallet debit, no ledger entry, no Paystack call. Any tenant
-- could tap "Pay" and get a free lease + fabricated escrow deposit.
--
-- Fix, two parts:
--   1. Require proof of a real debit before finalizing: for channel WALLET,
--      the function now requires a matching ledger_entries DEBIT row for the
--      given idempotency key (the same "check the ledger as proof of payment"
--      pattern already used elsewhere in this codebase, e.g. the Food module's
--      payout crash-recovery and the FOOD-009 double-payment fix). That DEBIT
--      row can only exist if frontend-web's debitWallet()/debit_wallet_atomic
--      already posted a balanced, tier-checked wallet debit under this key.
--      PAYSTACK is not yet integrated for realtor invoices and is refused.
--   2. Lock the RPC down to service_role only. It is no longer safe to expose
--      to `authenticated` even with the check above, because a client could
--      still race/replay an idempotency key it does not own or attempt to
--      probe the ledger indirectly. After this migration the ONLY supported
--      caller is frontend-web's src/server/realtor/invoices.ts#payInvoice,
--      which performs the debit first (via the admin/service-role client)
--      and then calls this RPC to finalize. The mobile client no longer calls
--      this RPC directly (mobile-app/reactnative/src/features/realtor/api/
--      realtorLease.api.ts now posts to /api/v1/realtor/invoices/[id]/pay).
--
-- auth.uid() is NULL for a service-role call (no user JWT), so the ownership
-- check is generalized to v_effective_uid := COALESCE(auth.uid(), p_user_id).
-- The new caller passes p_user_id explicitly (already verified against
-- lease.tenant_id in the TypeScript layer); a lingering direct call from an
-- `authenticated` session (if the grant were ever restored) still gets
-- auth.uid() and cannot forge p_user_id to any effect once EXECUTE is
-- revoked from `authenticated` below.

CREATE OR REPLACE FUNCTION realtor_pay_invoice(
    p_invoice_id UUID, p_channel TEXT, p_idempotency_key TEXT, p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_invoice  realtor_invoices%ROWTYPE;
    v_lease    realtor_leases%ROWTYPE;
    v_payment  realtor_payments%ROWTYPE;
    v_deposit  BIGINT;
    v_ref      TEXT;
    v_effective_uid UUID;
BEGIN
    v_effective_uid := COALESCE(auth.uid(), p_user_id);
    IF v_effective_uid IS NULL THEN
        RAISE EXCEPTION 'unauthenticated';
    END IF;

    -- Idempotency: return the prior receipt if this key was already used.
    SELECT * INTO v_payment FROM realtor_payments WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
        RETURN jsonb_build_object('id', v_payment.id, 'invoice_id', v_payment.invoice_id,
            'status', v_payment.status, 'amount', v_payment.amount_kobo, 'channel', v_payment.channel,
            'reference', v_payment.reference, 'escrow_held', v_payment.escrow_held_kobo,
            'paid_at', v_payment.paid_at);
    END IF;

    SELECT * INTO v_invoice FROM realtor_invoices WHERE id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'invoice_not_found'; END IF;
    SELECT * INTO v_lease FROM realtor_leases WHERE id = v_invoice.lease_id;
    IF v_lease.tenant_id <> v_effective_uid THEN RAISE EXCEPTION 'forbidden'; END IF;

    -- Require proof of a real debit before finalizing. debit_wallet_atomic
    -- posts the wallet leg with type='DEBIT' and idempotency_key kept VERBATIM
    -- (its counter leg is suffixed ':counter'), so this exact match can only
    -- exist if frontend-web's debitWallet() already posted a balanced,
    -- tier-checked wallet debit under this key.
    IF p_channel = 'WALLET' THEN
        IF NOT EXISTS (
            SELECT 1 FROM ledger_entries
             WHERE idempotency_key = p_idempotency_key AND type = 'DEBIT'
        ) THEN
            RAISE EXCEPTION 'payment_not_verified: no matching wallet debit found for idempotency key %', p_idempotency_key;
        END IF;
    ELSE
        RAISE EXCEPTION 'unsupported_payment_channel: % is not yet integrated for realtor invoices', p_channel;
    END IF;

    v_deposit := COALESCE((
        SELECT SUM((l->>'amount_kobo')::BIGINT)
        FROM jsonb_array_elements(v_invoice.lines) l
        WHERE (l->>'refundable')::BOOLEAN IS TRUE), 0);
    v_ref := upper(replace(gen_random_uuid()::text, '-', ''));

    INSERT INTO realtor_payments (invoice_id, user_id, channel, amount_kobo, escrow_held_kobo,
                                  status, reference, idempotency_key, paid_at)
    VALUES (p_invoice_id, v_effective_uid, p_channel, v_invoice.total_kobo, v_deposit,
            'paid', v_ref, p_idempotency_key, NOW())
    RETURNING * INTO v_payment;

    UPDATE realtor_invoices SET status = 'paid', paid_at = NOW() WHERE id = p_invoice_id;
    UPDATE realtor_leases SET status = 'active', updated_at = NOW() WHERE id = v_lease.id;

    INSERT INTO realtor_escrow_deposits (lease_id, amount_kobo, status, release_condition)
    VALUES (v_lease.id, v_deposit, 'held', 'Released within 14 days of a clean move-out inspection.')
    ON CONFLICT DO NOTHING;

    INSERT INTO realtor_move_ins (lease_id, checklist)
    VALUES (v_lease.id, jsonb_build_array(
        jsonb_build_object('id','mi_meter','label','Record prepaid meter reading','done',false),
        jsonb_build_object('id','mi_water','label','Confirm water & plumbing working','done',false),
        jsonb_build_object('id','mi_keys','label','Collect keys & access cards','done',false),
        jsonb_build_object('id','mi_photos','label','Take move-in condition photos','done',false)))
    ON CONFLICT (lease_id) DO NOTHING;

    RETURN jsonb_build_object('id', v_payment.id, 'invoice_id', p_invoice_id, 'status', 'paid',
        'amount', v_invoice.total_kobo, 'channel', p_channel, 'reference', v_ref,
        'escrow_held', v_deposit, 'paid_at', v_payment.paid_at);
END $$;

-- ── Neutralize the pre-existing 3-arg overload ───────────────────────────────
-- Postgres overloads by (name, arg COUNT): the 4-arg function above is a
-- SEPARATE function from the original `realtor_pay_invoice(UUID, TEXT, TEXT)`,
-- which still exists with its original vulnerable body and its original
-- `GRANT ... TO authenticated` until this section runs. Re-define it as a
-- thin delegating shim — same signature (additive, non-breaking), no
-- money-mutating logic of its own — so there is exactly ONE place
-- (the 4-arg function) that ever finalizes a payment. p_user_id is passed as
-- NULL; the 4-arg function then requires auth.uid() to be set (a NULL
-- v_effective_uid raises 'unauthenticated'), which is what a caller reaching
-- this 3-arg form through a user JWT would have anyway.
CREATE OR REPLACE FUNCTION realtor_pay_invoice(
    p_invoice_id UUID, p_channel TEXT, p_idempotency_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    RETURN realtor_pay_invoice(p_invoice_id, p_channel, p_idempotency_key, NULL);
END $$;

-- Close the direct-client-exploit path entirely on BOTH overloads: only
-- server-side code using the service-role key (frontend-web's admin Supabase
-- client, which always passes p_user_id and uses the 4-arg form) can call
-- this from now on. Grants are function-signature-specific in Postgres, so
-- each overload needs its own REVOKE/GRANT — confirmed via `proacl` that
-- omitting either one leaves that overload's original `authenticated` grant
-- in place.
REVOKE EXECUTE ON FUNCTION realtor_pay_invoice(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION realtor_pay_invoice(UUID, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION realtor_pay_invoice(UUID, TEXT, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION realtor_pay_invoice(UUID, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION realtor_pay_invoice(UUID, TEXT, TEXT, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION realtor_pay_invoice(UUID, TEXT, TEXT, UUID) TO service_role;

COMMENT ON FUNCTION realtor_pay_invoice(UUID, TEXT, TEXT) IS
  'Legacy 3-arg shim, service_role ONLY. Delegates to realtor_pay_invoice('
  'UUID, TEXT, TEXT, UUID) with p_user_id = NULL (requires auth.uid() to be '
  'set). Kept only because Postgres cannot replace an existing overload by '
  'adding a parameter; carries no logic of its own so there is exactly one '
  'enforcement path. No current caller in this codebase uses this shape — '
  'src/server/realtor/invoices.ts#payInvoice always calls the 4-arg form.';

COMMENT ON FUNCTION realtor_pay_invoice(UUID, TEXT, TEXT, UUID) IS
  'Finalizes a realtor lease invoice payment (payment record, invoice->paid, '
  'lease->active, escrow deposit, move-in checklist). service_role ONLY — '
  'callable only from frontend-web src/server/realtor/invoices.ts#payInvoice, '
  'which must debit the wallet via debitWallet()/debit_wallet_atomic FIRST. '
  'For p_channel=''WALLET'' this function refuses to finalize (RAISE '
  'payment_not_verified) unless a matching ledger_entries row with '
  'type=''DEBIT'' and idempotency_key = p_idempotency_key already exists — '
  'that row is proof a real, tier-checked, balanced wallet debit was posted. '
  'p_channel=''PAYSTACK'' is not yet integrated and is refused '
  '(unsupported_payment_channel). p_user_id is required when called with no '
  'auth.uid() session (i.e. via service_role); ownership is checked against '
  'realtor_leases.tenant_id either way.';
