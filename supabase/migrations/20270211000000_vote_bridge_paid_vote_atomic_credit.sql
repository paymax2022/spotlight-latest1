-- Vote-bridge: atomic paid-vote credit. Additive-only. No DROP TABLE/COLUMN/TYPE,
-- no RENAME, no type narrowing.
--
-- Fixes PV-005 (double-credit race) for the bridged /api/v2/votes/paid/verify path.
--
-- The previously "fixed" bridgedVerifyPaidVote() acquired a lock via a SEPARATE
-- `lock_vote_transaction` RPC call, then issued several MORE separate Supabase
-- client calls (a .select(), an .insert(), an .update()) to actually check the
-- credit status and write the vote. Each Supabase-js call is its own PostgREST
-- request, and PostgREST commits each request's implicit transaction before
-- returning — so the row lock from the first call was released the instant
-- that RPC returned, before any of the "protected" reads/writes ran. Two
-- concurrent callers (a webhook and a browser redirect, the exact scenario
-- PV-005 describes) could both pass the credit-status check and both insert a
-- vote + increment totals: the double-credit this was supposed to prevent was
-- never actually prevented. `lock_vote_transaction` itself was never even
-- defined as a migration, so calling it would have failed outright.
--
-- The correct fix, matching the pattern already proven for the free-vote path
-- (claim_free_vote, 20260730120000_vote_bridge_free_vote.sql): the ENTIRE
-- lock -> check -> write sequence must happen inside ONE PL/pgSQL function
-- invoked via a SINGLE Supabase RPC call, so the row lock is held for the
-- full duration of the check-and-write, not just for one call in a chain.
--
-- Everything that can safely run twice (Paystack verification, fraud-signal
-- scoring, audit logging, receipt generation) stays in the bridge's TypeScript
-- layer, called BEFORE this RPC. This function is only the unsafe-to-repeat
-- core: verify the reference matches, verify not already credited, insert the
-- vote, mark the transaction credited, and update vote_totals — atomically.

CREATE OR REPLACE FUNCTION public.credit_paid_vote_transaction(
  p_transaction_id     uuid,
  p_payment_reference  text,
  p_amount_paid        numeric,
  p_provider_reference text    DEFAULT NULL,
  p_paid_at            timestamptz DEFAULT NULL,
  p_ip                 inet    DEFAULT NULL,
  p_user_agent         text    DEFAULT NULL
)
RETURNS TABLE (
  already_credited      boolean,
  reference_mismatch    boolean,
  vote_id                uuid,
  contest_id             uuid,
  contestant_id          uuid,
  voter_user_id          uuid,
  votes_purchased        integer,
  bonus_votes            integer,
  total_votes_to_credit  integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tx      public.vote_transactions;
  v_vote_id uuid;
  v_now     timestamptz := now();
BEGIN
  -- Lock the transaction row so a concurrent caller (webhook + redirect
  -- racing on the same transaction) serializes here — fixes PV-005 TOCTOU.
  SELECT * INTO v_tx
  FROM public.vote_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF v_tx.id IS NULL THEN
    RAISE EXCEPTION 'vote transaction % not found', p_transaction_id USING ERRCODE = 'P0002';
  END IF;

  IF v_tx.payment_reference IS DISTINCT FROM p_payment_reference THEN
    RETURN QUERY SELECT false, true, NULL::uuid, v_tx.contest_id, v_tx.contestant_id,
      v_tx.voter_user_id, v_tx.votes_purchased, v_tx.bonus_votes, v_tx.total_votes_to_credit;
    RETURN;
  END IF;

  IF v_tx.vote_credit_status = 'credited' THEN
    -- Already credited (by a prior call, or by the concurrent call that won
    -- the race and committed first) — safe idempotent replay, no second vote.
    RETURN QUERY SELECT true, false, NULL::uuid, v_tx.contest_id, v_tx.contestant_id,
      v_tx.voter_user_id, v_tx.votes_purchased, v_tx.bonus_votes, v_tx.total_votes_to_credit;
    RETURN;
  END IF;

  -- Mark credited FIRST, still under the row lock taken above — this closes
  -- the window a concurrent caller could otherwise pass the check above.
  UPDATE public.vote_transactions
     SET payment_status      = 'successful',
         vote_credit_status  = 'credited',
         amount_paid         = p_amount_paid,
         provider_reference  = COALESCE(p_provider_reference, provider_reference),
         paid_at             = COALESCE(p_paid_at, v_now),
         verified_at         = v_now,
         credited_at         = v_now,
         updated_at          = v_now
   WHERE id = p_transaction_id;

  INSERT INTO public.votes (
    contest_id, contestant_id, voter_user_id, vote_type, vote_quantity,
    vote_status, transaction_id, payment_reference, ip_address, user_agent,
    fraud_score, fraud_status, confirmed_at
  )
  VALUES (
    v_tx.contest_id, v_tx.contestant_id, v_tx.voter_user_id, 'paid', v_tx.total_votes_to_credit,
    'confirmed', v_tx.id, v_tx.payment_reference, p_ip, p_user_agent,
    0, 'clean', v_now
  )
  RETURNING id INTO v_vote_id;

  -- Totals — same NULL-round-correct atomic upsert pattern as claim_free_vote,
  -- and the SAME advisory-lock namespace (salt 0): paid and free crediting for
  -- the same (contest,contestant) round-less totals row must serialize against
  -- EACH OTHER too, or both could race to INSERT the first row for that key.
  -- Paid votes are never round-scoped, so round_id is always NULL here.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_tx.contest_id::text || ':' || v_tx.contestant_id::text, 0)
  );

  -- NOTE: this function's RETURNS TABLE declares OUT parameters named
  -- contest_id/contestant_id/votes_purchased/bonus_votes/total_votes_to_credit
  -- — bare references to the SAME-NAMED table columns below are ambiguous
  -- without explicit qualification (Postgres can't tell "the OUT variable" from
  -- "the vote_totals column"), so every such reference is qualified via the
  -- "vt" alias.
  UPDATE public.vote_totals AS vt
     SET paid_votes             = vt.paid_votes + v_tx.votes_purchased,
         bonus_votes            = vt.bonus_votes + v_tx.bonus_votes,
         total_confirmed_votes  = vt.total_confirmed_votes + v_tx.total_votes_to_credit,
         last_vote_at           = v_now,
         updated_at             = v_now
   WHERE vt.contest_id = v_tx.contest_id
     AND vt.contestant_id = v_tx.contestant_id
     AND vt.round_id IS NULL;

  IF NOT FOUND THEN
    INSERT INTO public.vote_totals (
      contest_id, contestant_id, round_id,
      paid_votes, bonus_votes, total_confirmed_votes, last_vote_at
    )
    VALUES (
      v_tx.contest_id, v_tx.contestant_id, NULL,
      v_tx.votes_purchased, v_tx.bonus_votes, v_tx.total_votes_to_credit, v_now
    );
  END IF;

  RETURN QUERY SELECT false, false, v_vote_id, v_tx.contest_id, v_tx.contestant_id,
    v_tx.voter_user_id, v_tx.votes_purchased, v_tx.bonus_votes, v_tx.total_votes_to_credit;
END;
$$;

COMMENT ON FUNCTION public.credit_paid_vote_transaction IS
  'Atomic paid-vote credit used by the voting-bridge (/api/v2/votes/paid/verify). '
  'Row-locks the transaction for the full check-and-write to prevent the webhook+redirect '
  'double-credit race (PV-005). Paystack verification, fraud scoring, and audit logging '
  'stay in the caller (safe to repeat); only the unsafe-to-repeat credit step is atomic here.';
