-- The connect tally follows the credit, on every rail.
--
-- WHY THIS EXISTS, AND WHY IT IS A TRIGGER
-- A credited paid vote must appear in `connect_votes`, the plane Go's ListRoster
-- sums for the mobile roster. The first attempt at this called a TypeScript
-- bridge from two routes. A money-path audit found that covered ONE of the
-- entry points: `voting/payment/webhook.ts` calls verifyAndCreditPaidVote()
-- directly, and `app/vote-callback/page.tsx` still posts to the v1 verify route.
-- Neither can be patched — webhook.ts, its route, and the v1 verify route are all
-- brownfield-protected. A web card buyer therefore still paid and saw nothing.
--
-- Every rail, protected or not, ends at the same place: vote_transactions with
-- vote_credit_status = 'credited'. Projecting from there covers all of them at
-- once and cannot be bypassed by a new caller. It also fixes the reverse
-- direction the audit flagged: an admin reversal refunded the money while the
-- mobile roster kept the votes forever, because nothing removed the mirror.
--
-- ⚠️ AN AFTER TRIGGER THAT RAISES ABORTS THE PAYMENT. Every branch here either
-- writes or records why it did not; none raises. A contest that cannot be
-- mirrored must never take down the credit that pays for it.
--
-- ⚠️ UNITS: vote_transactions.amount_expected is NAIRA; connect_votes.amount_kobo
-- is minor units. Hence *100. Getting this wrong prices a vote at 1/100th.

CREATE OR REPLACE FUNCTION public.tg_connect_tally_follows_credit()
RETURNS TRIGGER
LANGUAGE plpgsql
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

  -- Reversal: the money went back, so the votes must stop counting. connect_votes
  -- has no reversed state and quantity > 0 is CHECKed, so there is no negative
  -- row to post — the projection row is removed. The durable record of what
  -- happened stays in vote_transactions, the ledger and the audit log; this table
  -- is a tally, not the books.
  IF NEW.vote_credit_status = 'reversed' THEN
    DELETE FROM public.connect_votes WHERE idempotency_key = v_key;
    RETURN NULL;
  END IF;

  IF NEW.vote_credit_status IS DISTINCT FROM 'credited' THEN
    RETURN NULL;
  END IF;

  v_qty  := COALESCE(NEW.total_votes_to_credit, 0);
  v_kobo := ROUND(COALESCE(NEW.amount_expected, 0) * 100)::BIGINT;

  -- Guards. Each records WHY rather than failing quietly: a buyer who paid and
  -- cannot be shown their votes is exactly the defect this whole change exists
  -- to remove, so it must never be invisible.
  v_reason := CASE
    WHEN NEW.voter_user_id IS NULL THEN 'missing_voter'
    WHEN v_qty  <= 0               THEN 'invalid_quantity'
    WHEN v_kobo <= 0               THEN 'invalid_amount'
    WHEN NOT EXISTS (SELECT 1 FROM public.connect_contests c WHERE c.id = NEW.contest_id)
                                   THEN 'contest_not_in_connect_plane'
    -- ListRoster filters on connect_contest_id ALONE. Accepting a match on the
    -- legacy contest_id would report success for a vote the roster can never
    -- display — a false green.
    WHEN NOT EXISTS (SELECT 1 FROM public.contestants ct
                      WHERE ct.id = NEW.contestant_id
                        AND ct.connect_contest_id = NEW.contest_id)
                                   THEN 'contestant_not_in_contest'
    ELSE NULL
  END;

  IF v_reason IS NOT NULL THEN
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
        'amountKobo',       v_kobo
      ),
      'failed',
      v_reason
    );
    RETURN NULL;
  END IF;

  INSERT INTO public.connect_votes
    (contest_id, voter_id, option_ref, paid, quantity, amount_kobo, idempotency_key, ledger_ref)
  VALUES (
    NEW.contest_id,
    NEW.voter_user_id,
    NEW.contestant_id::TEXT,
    TRUE,
    v_qty,
    v_kobo,
    v_key,
    NEW.payment_reference
  )
  -- uq_connect_votes_idem is PARTIAL, so the predicate must be repeated for the
  -- inference to match it. A webhook and a browser redirect crediting the same
  -- transaction collapse here instead of doubling somebody's votes.
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.tg_connect_tally_follows_credit() IS
  'Projects a credited paid vote into connect_votes (the plane ListRoster sums) '
  'and removes it on reversal. Covers every rail, including the brownfield-'
  'protected webhook. Never raises: a mirror problem must not abort a payment.';

DROP TRIGGER IF EXISTS trg_connect_tally_follows_credit ON public.vote_transactions;
CREATE TRIGGER trg_connect_tally_follows_credit
  AFTER INSERT OR UPDATE OF vote_credit_status ON public.vote_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_connect_tally_follows_credit();
