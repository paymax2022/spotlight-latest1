/**
 * Wallet-paid vote credit for the v2 bridge (AUD-BILL-003 follow-through).
 *
 * /api/v2/votes/wallet previously credited via castFreeVote() — the wrong
 * domain for a paid purchase: that service clamps the quantity to the FREE
 * daily allowance, marks rows vote_type='free', and can 429 on cap exhaustion
 * AFTER the Go wallet debit has committed. This mirrors the v1
 * /api/votes/paid/wallet credit path instead: a vote_transactions row
 * (payment_provider 'wallet', idempotency_key UNIQUE → safe replay), a
 * confirmed 'paid' votes row, totals, and an audit entry.
 *
 * The caller owns compensation: on a thrown error after the Go debit has
 * posted, the route must call the vote-bridge reverse endpoint and then
 * markVotePurchaseReversed() to keep the transaction record honest.
 */
import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';
import { incrementVoteTotals } from '@/src/server/voting/totals.service';
import { appendAuditLog } from '@/src/server/voting/audit.service';
import { randomUUID } from 'node:crypto';

export interface WalletCreditResult {
  alreadyProcessed: boolean;
  transactionId: string;
  paymentReference: string;
  votesCredited: number;
}

export interface WalletCreditParams {
  contestId: string;
  contestantId: string;
  userId: string;
  voterEmail?: string;
  voteCount: number;
  costKobo: number;
  idempotencyKey: string;
  ip: string;
  userAgent: string;
}

type TxRow = {
  id: string;
  payment_reference: string;
  total_votes_to_credit: number;
  vote_credit_status: string;
};

/** Insert the paid votes row + totals for an existing transaction record. */
async function fulfillVotes(
  supabase: ReturnType<typeof createAdminClient>,
  p: WalletCreditParams,
  txId: string,
  paymentReference: string,
  votes: number,
  now: string,
) {
  // transaction_id is the dedupe seam — a resume after a mid-credit crash must
  // not insert a second votes row for the same purchase.
  const { data: existing } = await supabase
    .from('votes')
    .select('id')
    .eq('transaction_id', txId)
    .maybeSingle();

  if (!existing) {
    const { error: voteErr } = await supabase.from('votes').insert({
      contest_id: p.contestId,
      contestant_id: p.contestantId,
      voter_user_id: p.userId,
      vote_type: 'paid',
      vote_quantity: votes,
      vote_status: 'confirmed',
      transaction_id: txId,
      payment_reference: paymentReference,
      fraud_score: 0,
      fraud_status: 'clean',
      confirmed_at: now,
    });
    if (voteErr) {
      // A concurrent same-key caller can pass the claim gate when the claim
      // insert fails open on a transient error. The loser's heal insert then
      // hits uq_votes_paid_transaction — that is "the other caller fulfilled
      // it", NOT a credit failure. Throwing here would send the route down the
      // reversal path and refund a purchase that was just delivered.
      if (voteErr.code === '23505') {
        const { data: won } = await supabase
          .from('votes')
          .select('id')
          .eq('transaction_id', txId)
          .maybeSingle();
        if (won) return;
      }
      throw new ApiError('Failed to credit votes', 500);
    }
    await incrementVoteTotals(p.contestId, p.contestantId, { paidVotes: votes });
  }
}

export async function creditWalletVotes(p: WalletCreditParams): Promise<WalletCreditResult> {
  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const paymentReference = `WVOTE-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;
  // vote_transactions.amount_* is numeric naira (matches the v1 route).
  const amountNaira = p.costKobo / 100;

  const { data: txRow, error: txErr } = await supabase
    .from('vote_transactions')
    .insert({
      contest_id: p.contestId,
      contestant_id: p.contestantId,
      voter_user_id: p.userId,
      vote_package_id: null,
      payment_provider: 'wallet',
      payment_reference: paymentReference,
      amount_expected: amountNaira,
      amount_paid: amountNaira,
      currency: 'NGN',
      votes_purchased: p.voteCount,
      bonus_votes: 0,
      total_votes_to_credit: p.voteCount,
      payment_status: 'successful',
      vote_credit_status: 'credited',
      voter_email: p.voterEmail ?? null,
      idempotency_key: p.idempotencyKey,
      paid_at: now,
      verified_at: now,
      credited_at: now,
      metadata: { source: 'wallet', api: 'v2', ipAddress: p.ip, userAgent: p.userAgent },
    })
    .select('id')
    .single();

  if (txErr?.code === '23505') {
    // Replay under the same key. If the purchase was refunded ('reversed') the
    // key is spent — a new purchase needs a new key.
    const { data: prior, error: priorErr } = await supabase
      .from('vote_transactions')
      .select('id, payment_reference, total_votes_to_credit, vote_credit_status')
      .eq('idempotency_key', p.idempotencyKey)
      .maybeSingle();
    if (priorErr) {
      throw new ApiError('Could not confirm the existing transaction. Retry with the same idempotency key.', 503);
    }
    if (!prior) {
      throw new ApiError('Vote transaction conflict', 409);
    }
    const tx = prior as TxRow;
    if (tx.vote_credit_status === 'reversed') {
      throw new ApiError('This purchase was refunded — submit again with a new idempotency key.', 409);
    }
    // 'credited': fulfill any votes/totals step a prior crash may have missed —
    // the money is held, so completing the credit is the correct replay result.
    await fulfillVotes(supabase, p, tx.id, tx.payment_reference, Number(tx.total_votes_to_credit ?? 0), now);
    return {
      alreadyProcessed: true,
      transactionId: tx.id,
      paymentReference: tx.payment_reference,
      votesCredited: Number(tx.total_votes_to_credit ?? 0),
    };
  }

  if (txErr || !txRow) {
    throw new ApiError('Failed to record vote transaction', 500);
  }

  await fulfillVotes(supabase, p, txRow.id, paymentReference, p.voteCount, now);

  await appendAuditLog({
    actorId: p.userId,
    actorRole: 'voter',
    action: 'wallet_vote_credited',
    entityType: 'vote_transaction',
    entityId: txRow.id,
    contestId: p.contestId,
    contestantId: p.contestantId,
    newValue: { votesCredited: p.voteCount, amountKobo: p.costKobo, paymentReference },
    ipAddress: p.ip,
    userAgent: p.userAgent,
  }).catch(() => { /* audit is best-effort — never fail a posted credit */ });

  return {
    alreadyProcessed: false,
    transactionId: txRow.id,
    paymentReference,
    votesCredited: p.voteCount,
  };
}

/**
 * Mark a purchase refunded after the wallet reversal posted: the transaction
 * flips to 'reversed' and any votes rows for it are removed so the tally
 * cannot count a refunded purchase.
 */
export async function markVotePurchaseReversed(idempotencyKey: string) {
  const supabase = createAdminClient();
  const { data: tx } = await supabase
    .from('vote_transactions')
    .select('id')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (!tx) return;
  await supabase.from('votes').delete().eq('transaction_id', tx.id);
  await supabase
    .from('vote_transactions')
    .update({ vote_credit_status: 'reversed' })
    .eq('id', tx.id);
}
