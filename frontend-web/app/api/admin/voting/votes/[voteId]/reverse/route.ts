import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { incrementVoteTotals } from '@/src/server/voting/totals.service';
import { appendAuditLog } from '@/src/server/voting/audit.service';
import { reverseWalletDebit } from '@/src/server/wallet/service';

export async function POST(
  request: Request,
  context: { params: Promise<{ voteId: string }> },
) {
  try {
    const identity = await assertAdminPermission(request, 'votes:manage');
    const { voteId } = await context.params;
    const body = (await request.json()) as { reason: string };

    if (!body.reason || body.reason.trim().length < 5) {
      return errorResponse('A reason of at least 5 characters is required', 400);
    }

    const supabase = createAdminClient();

    // Fetch the vote
    const { data: vote, error: voteErr } = await supabase
      .from('votes')
      .select('*')
      .eq('id', voteId)
      .maybeSingle();

    if (voteErr || !vote) return errorResponse('Vote not found', 404);
    if ((vote as any).vote_status === 'reversed') {
      return errorResponse('Vote is already reversed', 400);
    }

    const v = vote as any;

    // ---------------------------------------------------------------------
    // Wallet refund (P0): if the original vote was funded from the in-app
    // wallet, post a REVERSING ledger entry crediting the user the original
    // amount. The payment_provider lives on vote_transactions (not on votes),
    // so resolve the linked transaction via votes.transaction_id.
    //
    // Idempotency is guaranteed at the ledger level: reverseWalletDebit keys
    // off a deterministic idempotency_key derived from the transaction id, and
    // the ledger_entries.idempotency_key UNIQUE constraint makes a re-run a
    // no-op (returns alreadyProcessed). Combined with the vote_status guard
    // above (a 'reversed' vote returns 400 before reaching here), the refund
    // can never be posted twice.
    // ---------------------------------------------------------------------
    let walletRefund: { refunded: boolean; amountKobo: number; alreadyRefunded: boolean } = {
      refunded: false,
      amountKobo: 0,
      alreadyRefunded: false,
    };

    if (v.transaction_id) {
      const { data: tx } = await supabase
        .from('vote_transactions')
        .select('id, payment_provider, payment_reference, amount_paid, voter_user_id')
        .eq('id', v.transaction_id)
        .maybeSingle();

      const t = tx as any;
      // Only refund wallet-funded purchases. Paystack-funded purchases are
      // refunded out-of-band via Paystack (not this ledger), and bridge/Go
      // wallet votes (payment_provider !== 'wallet') hold their balance in the
      // Go ledger and must be reversed there — never fabricate a credit here.
      if (
        t &&
        t.payment_provider === 'wallet' &&
        t.voter_user_id &&
        t.amount_paid != null &&
        Number(t.amount_paid) > 0
      ) {
        const amountKobo = Math.round(Number(t.amount_paid) * 100);
        const refundRef = String(t.payment_reference ?? t.id);
        const refundResult = await reverseWalletDebit(t.voter_user_id as string, {
          amountKobo,
          reference: refundRef,
          // Deterministic, transaction-scoped key — re-running the reversal
          // hits the UNIQUE constraint and is treated as alreadyProcessed.
          idempotencyKey: `vote-reversal-refund:${t.id}`,
          description: `Refund: reversed vote ${voteId}`,
          metadata: {
            type: 'vote_reversal_refund',
            voteId,
            transactionId: t.id,
            contestId: v.contest_id,
            contestantId: v.contestant_id,
          },
        });
        walletRefund = {
          refunded: !refundResult.alreadyProcessed,
          amountKobo,
          alreadyRefunded: refundResult.alreadyProcessed,
        };
      }
    }

    // Mark vote reversed
    await supabase
      .from('votes')
      .update({
        vote_status: 'reversed',
        reversal_reason: body.reason,
        reversed_at: new Date().toISOString(),
      })
      .eq('id', voteId);

    // Mark the linked transaction refunded (idempotent — already-refunded
    // transactions just re-set the same status).
    //
    // This used to be gated on walletRefund.amountKobo > 0, which is only ever
    // true for payment_provider='wallet'. A card-funded reversal therefore left
    // vote_credit_status = 'credited', with two consequences: the connect tally
    // trigger never removed the mirrored votes, so a refunded purchase kept its
    // votes on the mobile roster permanently; and repair-connect-tally.sh, which
    // selects on 'credited', would re-create a mirror row an operator had
    // removed by hand. The status describes the vote, not the funding rail.
    if (v.transaction_id) {
      await supabase
        .from('vote_transactions')
        .update({ payment_status: 'refunded', vote_credit_status: 'reversed', updated_at: new Date().toISOString() })
        .eq('id', v.transaction_id);
    }

    // Update totals
    const quantity = Math.abs(Number(v.vote_quantity));
    await incrementVoteTotals(v.contest_id, v.contestant_id, {
      reversedVotes: quantity,
    });

    await appendAuditLog({
      actorId: identity.actorId,
      actorRole: identity.role,
      action: 'vote_reversed',
      entityType: 'vote',
      entityId: voteId,
      contestId: v.contest_id,
      contestantId: v.contestant_id,
      oldValue: { vote_status: v.vote_status, vote_quantity: v.vote_quantity },
      newValue: {
        vote_status: 'reversed',
        reversal_reason: body.reason,
        walletRefundKobo: walletRefund.amountKobo,
        walletRefunded: walletRefund.refunded,
        walletAlreadyRefunded: walletRefund.alreadyRefunded,
      },
      reason: body.reason,
    });

    return successResponse({
      success: true,
      voteId,
      reversedQuantity: quantity,
      walletRefund,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to reverse vote');
  }
}
