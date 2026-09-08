-- A refunded purchase must never get its votes back.
--
-- THE DEFECT (re-audit of 20270140000000)
-- The trigger had no memory that a purchase was reversed: 'reversed' deleted the
-- mirror and a later 'credited' re-created it. That is reachable, not theoretical:
--
--   * paid-vote.service.ts:183 short-circuits only when vote_credit_status is
--     already 'credited'. After a reversal it is 'reversed', so the guard misses.
--   * paid-vote.service.ts:199 bails only on payment_status 'failed'/'abandoned'.
--     The admin reverse route sets 'refunded', which is not caught.
--   * A refunded Paystack charge keeps transaction status 'success' — a refund is
--     a separate object — so re-verification passes and the amount still matches.
--   * /api/votes/paid/verify is unauthenticated, and /vote-callback sits in the
--     buyer's browser history with the reference in the URL.
--
-- So: buyer pays NGN 10,000 for 120 votes, admin reverses for fraud, money is
-- refunded and the mirror deleted. The buyer re-opens the callback URL. The votes
-- come back on the roster, a second `votes` row is written, and vote_totals ends
-- at paid=240 / reversed=120. Once per reversal, which is enough.
--
-- The re-credit itself lives in brownfield-protected code. This trigger is the
-- only unprotected point on that path, so terminality is enforced here.
--
-- ALSO IN THIS MIGRATION, both from the same re-audit:
--
-- 1. Skip records were written with status 'failed'. Nothing reads those:
--    processPendingOutboxEvents() selects status='pending', so a 'failed' row is
--    invisible to the drainer that exists to retry it. They are now 'pending',
--    with 'votes.paid.tally_skipped' added to OutboxEventType and given a handler
--    that re-attempts the mirror.
--
-- 2. The header used to claim no branch raises. That was true only because
--    bridge_outbox and connect_votes both have relforcerowsecurity = FALSE and the
--    function owner is the table owner. A future `ALTER TABLE ... FORCE ROW LEVEL
--    SECURITY` — plausible on tables that have RLS on and no policies — would make
--    every skip raise 42501 inside an AFTER trigger, so the branch whose whole job
--    is to record "we could not show your votes" would start aborting payments.
--    The claim is now structural: each write is wrapped so it cannot propagate.

CREATE OR REPLACE FUNCTION public.tg_connect_tally_follows_credit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key    TEXT;
  v_qty    INTEGER;
  v_kobo   BIGINT;
  v_reason TEXT;
BEGIN
  IF NEW.payment_reference IS NULL THEN
    RETURN NULL;
  END IF;

  v_key := 'connect-tally:' || NEW.payment_reference;

  IF NEW.vote_credit_status = 'reversed' THEN
    BEGIN
      DELETE FROM public.connect_votes WHERE idempotency_key = v_key;
    EXCEPTION WHEN OTHERS THEN
      NULL;  -- never abort the reversal over its own projection
    END;
    RETURN NULL;
  END IF;

  IF NEW.vote_credit_status IS DISTINCT FROM 'credited' THEN
    RETURN NULL;
  END IF;

  v_qty  := COALESCE(NEW.total_votes_to_credit, 0);
  v_kobo := ROUND(COALESCE(NEW.amount_expected, 0) * 100)::BIGINT;

  v_reason := CASE
    -- Money already went back. A re-credit after a refund is either a replayed
    -- callback or an attack; either way the votes do not return.
    WHEN NEW.payment_status IN ('refunded', 'chargeback') THEN 'recredit_after_refund'
    WHEN NEW.voter_user_id IS NULL THEN 'missing_voter'
    WHEN v_qty  <= 0               THEN 'invalid_quantity'
    WHEN v_kobo <= 0               THEN 'invalid_amount'
    WHEN NOT EXISTS (SELECT 1 FROM public.connect_contests c WHERE c.id = NEW.contest_id)
                                   THEN 'contest_not_in_connect_plane'
    -- ListRoster filters on connect_contest_id ALONE; matching the legacy
    -- contest_id would report success for a vote the roster can never display.
    WHEN NOT EXISTS (SELECT 1 FROM public.contestants ct
                      WHERE ct.id = NEW.contestant_id
                        AND ct.connect_contest_id = NEW.contest_id)
                                   THEN 'contestant_not_in_contest'
    ELSE NULL
  END;

  IF v_reason IS NOT NULL THEN
    BEGIN
      INSERT INTO public.bridge_outbox (event_type, payload, status, last_error)
      VALUES (
        'votes.paid.tally_skipped',
        jsonb_build_object(
          'transactionId',    NEW.id,
          'paymentReference', NEW.payment_reference,
          'contestId',        NEW.contest_id,
          'contestantId',     NEW.contestant_id,
          'voterUserId',      NEW.voter_user_id,
          'votes',            v_qty,
          'amountKobo',       v_kobo,
          -- Also in last_error, but the outbox handler only receives payload, and
          -- it needs the reason to tell a permanent skip (a refunded purchase, a
          -- contestant on no roster) from a transient one worth retrying.
          'reason',           v_reason
        ),
        -- 'pending', not 'failed': the drainer only ever selects 'pending'.
        'pending',
        v_reason
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RETURN NULL;
  END IF;

  BEGIN
    INSERT INTO public.connect_votes
      (contest_id, voter_id, option_ref, paid, quantity, amount_kobo, idempotency_key, ledger_ref)
    VALUES (
      NEW.contest_id, NEW.voter_user_id, NEW.contestant_id::TEXT, TRUE,
      v_qty, v_kobo, v_key, NEW.payment_reference
    )
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.tg_connect_tally_follows_credit() IS
  'Projects a credited paid vote into connect_votes and removes it on reversal. '
  'A refunded or charged-back purchase is terminal and is never re-credited. '
  'No branch can raise: a projection problem must not abort a payment.';
