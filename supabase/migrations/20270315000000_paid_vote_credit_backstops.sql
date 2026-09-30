-- AUD-DB-002: verifyAndCreditPaidVote fulfils non-atomically — it writes
-- vote_credit_status='credited' BEFORE the votes row, and its status guard is
-- a read with no claim predicate. The service file is brownfield-protected,
-- so these two DB-level backstops bound the damage for every caller
-- (webhook, legacy verify route, bridge fallback):
--
--   1. uq_votes_paid_transaction — at most ONE paid votes row per
--      vote_transactions row. Closes the webhook+redirect TOCTOU
--      double-credit (the second concurrent insert raises a unique
--      violation instead of posting a second vote) and the post-refund
--      replay re-credit. Reversal rows (refund_reversal / fraud_reversal /
--      admin_adjustment share the same transaction_id) are excluded by the
--      vote_type predicate — only 'paid' inserts are one-per-transaction.
--      NOTE: if production data already holds duplicate paid rows per
--      transaction this index fails to build — that failure is the bug's
--      own evidence; dedupe the rows, do not weaken the constraint.
--
--   2. vote_transactions terminal-state trigger — 'refunded' and
--      'chargeback' may not transition back to 'successful': Paystack still
--      answers success when re-verifying a refunded charge, so a replayed
--      callback would otherwise resurrect the tx and pass the guard.
CREATE UNIQUE INDEX IF NOT EXISTS uq_votes_paid_transaction
  ON public.votes (transaction_id)
  WHERE vote_type = 'paid' AND transaction_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_vote_transaction_terminal_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.payment_status IN ('refunded', 'chargeback')
     AND NEW.payment_status <> OLD.payment_status THEN
    RAISE EXCEPTION
      'vote_transactions: % is terminal (attempted transition to %)',
      OLD.payment_status, NEW.payment_status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vote_transactions_terminal_status
  ON public.vote_transactions;
CREATE TRIGGER trg_vote_transactions_terminal_status
  BEFORE UPDATE OF payment_status ON public.vote_transactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_vote_transaction_terminal_status();
