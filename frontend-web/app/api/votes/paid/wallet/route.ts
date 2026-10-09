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
import { checkIdempotencyKey } from '@/src/server/wallet/idempotency';
import { boundClaimKey } from '@/src/server/voting-bridge/idempotency';
import { enqueueOutboxEvent } from '@/src/server/voting-bridge/outbox';
import { checkRateLimit } from '@/src/lib/voting/rate-limit';
import { getRequestIp } from '@/src/lib/rate-limit/client-ip';
import { getVotingSettings, assertVotingOpen } from '@/src/server/voting/free-vote.service';
import { incrementVoteTotals } from '@/src/server/voting/totals.service';
import { appendAuditLog } from '@/src/server/voting/audit.service';
import { createAdminClient } from '@/lib/supabase/server';
import { randomUUID } from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  try {
    const user = await requireRequestUser(request);

    const idempotencyKey = request.headers.get('Idempotency-Key');
    if (!idempotencyKey) {
      return errorResponse('Idempotency-Key header is required for wallet mutations.', 400);
    }

    // Wallet-debit money path — per-user throttle (AUD-SEC-001). Shares the
    // bucket key with the v2 wallet route so both draw one allowance.
    const rl = checkRateLimit(`vote:paid:wallet:${user.id}`, 10, 60_000);
    if (!rl.allowed) {
      return errorResponse('Too many requests. Please slow down.', 429);
    }

    const ip = getRequestIp(request);
    const ua = request.headers.get('user-agent') ?? 'unknown';

    const body = (await request.json().catch(() => null)) as WalletVoteBody;
    if (!body) return errorResponse('Invalid JSON body', 400);

    if (!body.contestId) return errorResponse('contestId is required', 400);
    if (!body.contestantId) return errorResponse('contestantId is required', 400);
    if (!body.packageId) return errorResponse('packageId is required', 400);
    if (!body.voterEmail) return errorResponse('voterEmail is required', 400);
    if (!body.voterName) return errorResponse('voterName is required', 400);
    // Non-UUID ids can never satisfy the uuid columns the queries below hit
    // (voting_settings.contest_id / vote_packages.id) — reject so they surface
    // as 400, not a Postgres 22P02 → 500.
    if (!UUID_RE.test(body.contestId)) return errorResponse('contestId must be a valid UUID', 400);
    if (!UUID_RE.test(body.contestantId)) return errorResponse('contestantId must be a valid UUID', 400);
    if (!UUID_RE.test(body.packageId)) return errorResponse('packageId must be a valid UUID', 400);

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
    // The raw Idempotency-Key is unscoped — a key reused by another user, or by
    // this user for a different package/contestant, must never collide with the
    // original ledger entry or transaction row. The bound key scopes the
    // ledger idempotency key AND vote_transactions.idempotency_key to
    // user + purchase shape, so a replay dedupes only the exact purchase it
    // describes and everything else executes as the distinct operation it is.
    const walletLedgerKey = boundClaimKey('wallet-vote', user.id, idempotencyKey, {
      contestId: body.contestId,
      contestantId: body.contestantId,
      packageId: body.packageId,
      votes: totalVotesToCredit,
      amountKobo,
    });

    // Atomic wallet debit — enforces available balance + tier daily cap via RPC.
    // Throws 402 on INSUFFICIENT_BALANCE, 403 on TIER_LIMIT_EXCEEDED.
    const debit = await debitWallet(user.id, {
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

    if (debit.alreadyProcessed) {
      // A prior attempt consumed this ledger key. If its compensation already
      // posted, the money is NOT held — proceeding would record a transaction
      // and deliver votes against a refunded debit. The reversal's derived key
      // is the durable spent-marker, so it answers even when the prior attempt
      // failed before its vote_transactions row could commit.
      const refunded = await checkIdempotencyKey(`rev:${walletLedgerKey}`);
      if (refunded.alreadyProcessed) {
        return errorResponse('This purchase was refunded — submit again with a new Idempotency-Key.', 409);
      }
    }

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
        idempotency_key: walletLedgerKey,
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
      const { data: prior, error: priorErr } = await supabase
        .from('vote_transactions')
        .select('id, payment_reference, total_votes_to_credit, amount_expected, vote_credit_status, contest_id, contestant_id, voter_user_id, votes_purchased, bonus_votes')
        .eq('idempotency_key', walletLedgerKey)
        .maybeSingle();

      // If the READ failed we cannot tell a replay from a genuine failure, and
      // falling through would reverse a debit whose purchase may well have been
      // recorded — reinstating the very hole this branch closes. Fail loudly and
      // leave the money where it is; the caller can retry the same key safely.
      if (priorErr) {
        console.error('[votes/paid/wallet] idempotent replay detected but the prior transaction could not be read',
          { idempotencyKey, error: priorErr.message });
        return errorResponse('Could not confirm the existing transaction. Retry with the same Idempotency-Key.', 503);
      }

      if (prior) {
        const p = prior as {
          id: string; payment_reference: string;
          total_votes_to_credit: number; amount_expected: number;
          vote_credit_status: string;
          contest_id: string; contestant_id: string; voter_user_id: string;
          votes_purchased: number; bonus_votes: number | null;
        };

        // A refunded purchase is terminal — the key is spent and a new purchase
        // needs a new one. Never re-fulfil against money that already went back.
        if (p.vote_credit_status === 'reversed') {
          return errorResponse('This purchase was refunded — submit again with a new Idempotency-Key.', 409);
        }

        // 'credited' — but a prior crash (or a pre-fix request that swallowed
        // the votes insert error) may have committed the transaction without
        // ever delivering the votes row. Money is held, so the correct replay
        // result is to complete the fulfilment, not to report phantom success.
        const { data: priorVote, error: voteReadErr } = await supabase
          .from('votes')
          .select('id')
          .eq('transaction_id', p.id)
          .maybeSingle();
        if (voteReadErr) {
          return errorResponse('Could not confirm the existing fulfilment. Retry with the same Idempotency-Key.', 503);
        }
        if (!priorVote) {
          const { error: healErr } = await supabase.from('votes').insert({
            contest_id: p.contest_id,
            contestant_id: p.contestant_id,
            voter_user_id: p.voter_user_id,
            vote_type: 'paid',
            vote_quantity: Number(p.total_votes_to_credit ?? 0),
            vote_status: 'confirmed',
            transaction_id: p.id,
            payment_reference: p.payment_reference,
            fraud_score: 0,
            fraud_status: 'clean',
            confirmed_at: new Date().toISOString(),
          });
          if (healErr) {
            // A concurrent replay of this same bound key can win the insert —
            // uq_votes_paid_transaction makes the loser 23505, which is
            // fulfilment-by-the-other-caller, not a failure.
            if (healErr.code !== '23505') {
              console.error('[votes/paid/wallet] replay found credited transaction without votes; fulfilment retry failed',
                { transactionId: p.id, error: healErr.message });
              return errorResponse('Vote fulfilment is still pending. Retry with the same Idempotency-Key.', 503);
            }
          } else {
            // Preserve the recorded paid/bonus split — totals consumers
            // report them separately, and folding bonus into paid skews it.
            await incrementVoteTotals(p.contest_id, p.contestant_id, {
              paidVotes: Number(p.votes_purchased ?? p.total_votes_to_credit ?? 0),
              bonusVotes: Number(p.bonus_votes ?? 0),
            });
          }
        }

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
      // A genuine failure: the debit posted and nothing recorded it. Reverse —
      // and if THAT fails, the money is still held with no transaction row, so
      // flag it for reconciliation rather than swallowing it silently.
      const reversed = await reverseWalletDebit(user.id, {
        amountKobo,
        reference: paymentReference,
        idempotencyKey: `rev:${walletLedgerKey}`,
        description: 'Reversal: vote transaction record failed after wallet debit',
      }).then(() => true).catch(() => false);
      if (!reversed) {
        await enqueueOutboxEvent('votes.wallet.reversal_failed', {
          idempotencyKey: walletLedgerKey,
          clientIdempotencyKey: idempotencyKey,
          contestId: body.contestId,
          contestantId: body.contestantId,
          voterId: user.id,
          costKobo: amountKobo,
          cause: 'vote_transactions insert failed',
        }).catch(() => {});
      }

      return errorResponse('Failed to record vote transaction', 500);
    }

    // Insert the confirmed vote record. This error MUST be observed: the
    // transaction row is already committed 'credited' and the debit already
    // posted, so a swallowed failure strands the money and every later replay
    // reports alreadyProcessed over an unfulfilled purchase.
    const { error: voteErr } = await supabase.from('votes').insert({
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

    if (voteErr) {
      // Compensate the committed debit, then mark the transaction 'reversed'
      // so the connect-tally trigger removes the credited mirror and replays
      // get the spent-key 409 rather than free votes. The reversal posts by
      // the debit's recorded amount under `rev:<bound key>` — never the raw
      // client key.
      const reversed = await reverseWalletDebit(user.id, {
        amountKobo,
        reference: paymentReference,
        idempotencyKey: `rev:${walletLedgerKey}`,
        description: 'Reversal: vote fulfilment failed after wallet debit',
      }).then(() => true).catch(() => false);

      if (reversed) {
        await supabase
          .from('vote_transactions')
          .update({ vote_credit_status: 'reversed' })
          .eq('id', txRow.id);
      } else {
        // Money is still held but nothing was delivered — flag for manual
        // reconciliation instead of masking it behind a 500.
        await enqueueOutboxEvent('votes.wallet.reversal_failed', {
          idempotencyKey: walletLedgerKey,
          clientIdempotencyKey: idempotencyKey,
          transactionId: txRow.id,
          contestId: body.contestId,
          contestantId: body.contestantId,
          voterId: user.id,
          costKobo: amountKobo,
        }).catch(() => {});
      }

      console.error('[votes/paid/wallet] votes insert failed after committed debit',
        { transactionId: txRow.id, reversed, error: voteErr.message });
      return errorResponse('Vote fulfilment failed; the wallet charge was reversed.', 500);
    }

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
