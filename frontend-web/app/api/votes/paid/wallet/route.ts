/**
 * POST /api/votes/paid/wallet
 *
 * Debit the authenticated user's in-app wallet and immediately credit votes.
 * All monetary amounts are in kobo (integers). No Paystack redirect.
 *
 * Iron rules enforced:
 *  - Idempotency-Key header required
 *  - debitWallet uses debit_wallet_atomic RPC (balance check + tier daily cap)
 *  - Double-entry ledger entry written before vote_transaction is inserted
 *  - Audit log appended on success
 *  - On transaction-record failure: best-effort reversal before returning 500
 */
import { NextResponse } from 'next/server';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';
import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { debitWallet, reverseWalletDebit } from '@/src/server/wallet/service';
import { getVotingSettings, assertVotingOpen } from '@/src/server/voting/free-vote.service';
import { incrementVoteTotals } from '@/src/server/voting/totals.service';
import { appendAuditLog } from '@/src/server/voting/audit.service';
import { createAdminClient } from '@/lib/supabase/server';
import { randomUUID } from 'node:crypto';

interface WalletVoteBody {
  contestantId?: string;
  contestId?: string;
  packageId?: string;
  voterEmail?: string;
  voterName?: string;
}

export async function POST(request: Request) {
  if (!featureFlags.wallet()) {
    return errorResponse('Wallet feature is not available.', 503);
  }

  const idempotencyKey = request.headers.get('Idempotency-Key');
  if (!idempotencyKey) {
    return errorResponse('Idempotency-Key header is required for wallet mutations.', 400);
  }

  try {
    const user = await requireRequestUser(request);
    const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
    const ua = request.headers.get('user-agent') ?? 'unknown';

    const body = (await request.json()) as WalletVoteBody;

    if (!body.contestId) return errorResponse('contestId is required', 400);
    if (!body.contestantId) return errorResponse('contestantId is required', 400);
    if (!body.packageId) return errorResponse('packageId is required', 400);
    if (!body.voterEmail) return errorResponse('voterEmail is required', 400);
    if (!body.voterName) return errorResponse('voterName is required', 400);

    // Confirm voting is open for this contest
    const settings = await getVotingSettings(body.contestId);
    assertVotingOpen(settings);
    if (!settings.paidVotingEnabled) {
      return errorResponse('Paid voting is not enabled for this contest', 400);
    }

    // Fetch package server-side — never trust client-supplied price
    const supabase = createAdminClient();
    const { data: pkg, error: pkgErr } = await supabase
      .from('vote_packages')
      .select('id, votes, bonus_votes, amount, currency')
      .eq('id', body.packageId)
      .eq('contest_id', body.contestId)
      .eq('is_active', true)
      .maybeSingle();

    if (pkgErr || !pkg) {
      return errorResponse('Vote package not found or inactive', 404);
    }

    const votesPurchased = Number(pkg.votes);
    const bonusVotes = Number(pkg.bonus_votes ?? 0);
    const totalVotesToCredit = votesPurchased + bonusVotes;
    // vote_packages.amount is stored in naira; convert to kobo for the ledger
    const amountKobo = Math.round(Number(pkg.amount) * 100);
    const paymentReference = `WVOTE-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const walletLedgerKey = `wallet-vote:${idempotencyKey}`;

    // Atomic wallet debit — enforces available balance + tier daily cap via RPC.
    // Throws 402 on INSUFFICIENT_BALANCE, 403 on TIER_LIMIT_EXCEEDED.
    await debitWallet(user.id, {
      amountKobo,
      reference: paymentReference,
      idempotencyKey: walletLedgerKey,
      description: `Vote purchase: ${totalVotesToCredit} votes`,
      metadata: {
        type: 'vote_purchase',
        contestId: body.contestId,
        contestantId: body.contestantId,
        packageId: body.packageId,
      },
    });

    const now = new Date().toISOString();

    // Record the transaction as immediately completed
    const { data: txRow, error: txErr } = await supabase
      .from('vote_transactions')
      .insert({
        contest_id: body.contestId,
        contestant_id: body.contestantId,
        voter_user_id: user.id,
        vote_package_id: body.packageId,
        payment_provider: 'wallet',
        payment_reference: paymentReference,
        amount_expected: Number(pkg.amount),
        amount_paid: Number(pkg.amount),
        currency: (pkg.currency as string) ?? 'NGN',
        votes_purchased: votesPurchased,
        bonus_votes: bonusVotes,
        total_votes_to_credit: totalVotesToCredit,
        payment_status: 'successful',
        vote_credit_status: 'credited',
        voter_email: body.voterEmail,
        voter_name: body.voterName,
        idempotency_key: idempotencyKey,
        paid_at: now,
        verified_at: now,
        credited_at: now,
        metadata: { source: 'wallet', ipAddress: ip, userAgent: ua },
      })
      .select('id')
      .single();

    // A replay of the SAME Idempotency-Key is not a failure — it is the caller
    // doing exactly what the header is for.
    //
    // vote_transactions.idempotency_key is UNIQUE, so the second attempt raises
    // 23505 here. This block used to treat every error as "the record failed"
    // and reverse the debit. The debit itself is idempotent (debitWallet returns
    // alreadyProcessed and posts nothing), so the reversal had no debit to undo:
    // it posted a REVERSAL_DEBIT that wallet_balance counts as +amount. Net
    // effect of one replayed request: the money came back and the votes — rows,
    // totals and the connect mirror from the first request — all stood. Free
    // votes for anyone who could resend one HTTP request, or double-tap with a
    // stable key.
    if (txErr?.code === '23505') {
      const { data: prior } = await supabase
        .from('vote_transactions')
        .select('id, payment_reference, total_votes_to_credit, amount_expected')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();

      if (prior) {
        const p = prior as {
          id: string; payment_reference: string;
          total_votes_to_credit: number; amount_expected: number;
        };
        return NextResponse.json(
          {
            success: true,
            alreadyProcessed: true,
            transactionId: p.id,
            paymentReference: p.payment_reference,
            votesCredited: Number(p.total_votes_to_credit ?? 0),
            amountKobo: Math.round(Number(p.amount_expected ?? 0) * 100),
          },
          { status: 200 },
        );
      }
    }

    if (txErr || !txRow) {
      // A genuine failure: the debit posted and nothing recorded it. Reverse.
      await reverseWalletDebit(user.id, {
        amountKobo,
        reference: paymentReference,
        idempotencyKey: `rev:${walletLedgerKey}`,
        description: 'Reversal: vote transaction record failed after wallet debit',
      }).catch(() => { /* best-effort — logged at Supabase level */ });

      return errorResponse('Failed to record vote transaction', 500);
    }

    // Insert the confirmed vote record
    await supabase.from('votes').insert({
      contest_id: body.contestId,
      contestant_id: body.contestantId,
      voter_user_id: user.id,
      vote_type: 'paid',
      vote_quantity: totalVotesToCredit,
      vote_status: 'confirmed',
      transaction_id: txRow.id,
      payment_reference: paymentReference,
      fraud_score: 0,
      fraud_status: 'clean',
      confirmed_at: now,
    });

    // Increment running vote totals (updates contestant ranking)
    await incrementVoteTotals(body.contestId, body.contestantId, {
      paidVotes: votesPurchased,
      bonusVotes,
    });

    await appendAuditLog({
      actorId: user.id,
      actorRole: 'voter',
      action: 'wallet_vote_credited',
      entityType: 'vote_transaction',
      entityId: txRow.id,
      contestId: body.contestId,
      contestantId: body.contestantId,
      newValue: { votesCredited: totalVotesToCredit, amountKobo, paymentReference },
      ipAddress: ip,
      userAgent: ua,
    });

    return NextResponse.json(
      {
        success: true,
        transactionId: txRow.id,
        paymentReference,
        votesCredited: totalVotesToCredit,
        amountKobo,
      },
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
