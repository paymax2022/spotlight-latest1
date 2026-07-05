import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';
import { RECEIPT_PREFIX } from '@/src/features/voting/constants';
import type {
  InitiatePaidVoteRequest,
  InitiatePaidVoteResponse,
  VerifyPaidVoteRequest,
  VerifyPaidVoteResponse,
  VotePackage,
} from '@/src/features/voting/types';
import { getVotingSettings, assertVotingOpen } from './free-vote.service';
import { initializePaystackPayment } from './payment/paystack';
import { incrementVoteTotals } from './totals.service';
import { appendAuditLog } from './audit.service';
import {
  resolveIdempotency,
  verifyVotePayment,
  recordVoteFraudSignals,
  recordVoteAudit,
} from './core';
import { randomUUID } from 'node:crypto';
import { sendVoteReceiptEmail } from './email.service';

export async function getActiveVotePackages(contestId: string): Promise<VotePackage[]> {
  const supabase = createAdminClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('vote_packages')
    .select('*')
    .eq('contest_id', contestId)
    .eq('is_active', true)
    .or(`starts_at.is.null,starts_at.lte.${now}`)
    .or(`ends_at.is.null,ends_at.gte.${now}`)
    .order('display_order', { ascending: true });

  if (error) throw new ApiError('Failed to load vote packages', 500);
  return (data ?? []).map(mapPackageRow);
}

export async function initiatePaidVote(
  req: InitiatePaidVoteRequest,
  ipAddress: string,
  userAgent: string,
  userId?: string,
): Promise<InitiatePaidVoteResponse> {
  const supabase = createAdminClient();
  const settings = await getVotingSettings(req.contestId);

  assertVotingOpen(settings);
  if (!settings.paidVotingEnabled) throw new ApiError('Paid voting is not enabled', 400);

  // --- Resolve package & vote quantity ---
  let votesPurchased: number;
  let bonusVotes: number;
  let amountExpected: number;
  let packageId: string | null = null;

  if (req.packageId) {
    const pkg = await getPackageById(req.packageId, req.contestId);
    votesPurchased = pkg.votes;
    bonusVotes = pkg.bonusVotes;
    amountExpected = pkg.amount;
    packageId = pkg.id;
  } else if (req.customVoteQuantity && settings.allowCustomVoteQuantity) {
    if (req.customVoteQuantity < settings.minPaidVotes) {
      throw new ApiError(`Minimum purchase is ${settings.minPaidVotes} votes`, 400);
    }
    if (req.customVoteQuantity > settings.maxPaidVotesPerTxn) {
      throw new ApiError(`Maximum purchase per transaction is ${settings.maxPaidVotesPerTxn} votes`, 400);
    }
    // 1 vote = base unit; admin sets price per vote via packages; custom needs a base rate
    const baseRate = await getBaseVoteRate(req.contestId);
    votesPurchased = req.customVoteQuantity;
    bonusVotes = 0;
    amountExpected = votesPurchased * baseRate;
  } else {
    throw new ApiError('Either packageId or customVoteQuantity is required', 400);
  }

  const totalVotesToCredit = votesPurchased + bonusVotes;
  const paymentReference = `${settings.paymentRefPrefix}-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;

  // --- Create pending transaction ---
  const { data: txRow, error: txErr } = await supabase
    .from('vote_transactions')
    .insert({
      contest_id: req.contestId,
      contestant_id: req.contestantId,
      voter_user_id: userId ?? null,
      vote_package_id: packageId,
      payment_provider: settings.paymentProvider,
      payment_reference: paymentReference,
      amount_expected: amountExpected,
      currency: settings.currency,
      votes_purchased: votesPurchased,
      bonus_votes: bonusVotes,
      total_votes_to_credit: totalVotesToCredit,
      payment_status: 'pending',
      vote_credit_status: 'pending',
      voter_email: req.voterEmail,
      voter_name: req.voterName,
      idempotency_key: `${req.contestId}:${req.contestantId}:${req.voterEmail}:${paymentReference}`,
      metadata: { ipAddress, userAgent, shareCode: req.shareCode ?? null },
    })
    .select('id')
    .single();

  if (txErr || !txRow) throw new ApiError('Failed to create payment transaction', 500);

  // --- Initialize payment with provider ---
  const authorizationUrl = await initializePaystackPayment({
    reference: paymentReference,
    email: req.voterEmail,
    amount: Math.round(amountExpected * 100), // Paystack uses kobo
    currency: settings.currency,
    callbackUrl: req.callbackUrl,
    metadata: {
      transactionId: txRow.id,
      contestId: req.contestId,
      contestantId: req.contestantId,
      votesPurchased,
      bonusVotes,
      custom_fields: [
        { display_name: 'Contest', variable_name: 'contest_id', value: req.contestId },
        { display_name: 'Contestant', variable_name: 'contestant_id', value: req.contestantId },
        { display_name: 'Votes', variable_name: 'votes', value: String(votesPurchased) },
      ],
    },
  });

  await appendAuditLog({
    actorId: userId ?? req.voterEmail,
    actorRole: 'voter',
    action: 'paid_vote_initiated',
    entityType: 'vote_transaction',
    entityId: txRow.id,
    contestId: req.contestId,
    contestantId: req.contestantId,
    newValue: { paymentReference, amountExpected, votesPurchased },
    ipAddress,
    userAgent,
  });

  return {
    transactionId: txRow.id,
    paymentReference,
    authorizationUrl,
    amountExpected,
    currency: settings.currency,
    votesToCredit: votesPurchased,
    bonusVotes,
  };
}

// Called after a payment success page redirect OR webhook — whichever arrives first.
// Idempotent: calling twice for the same reference is safe.
export async function verifyAndCreditPaidVote(
  req: VerifyPaidVoteRequest,
  actorId: string,
  ipAddress: string,
  userAgent: string,
): Promise<VerifyPaidVoteResponse> {
  const supabase = createAdminClient();

  // --- Fetch transaction ---
  const { data: tx, error: txErr } = await supabase
    .from('vote_transactions')
    .select('*')
    .eq('id', req.transactionId)
    .eq('payment_reference', req.paymentReference)
    .maybeSingle();

  if (txErr || !tx) throw new ApiError('Transaction not found', 404);

  // --- Idempotency (shared core): durable anchor is vote_credit_status on the
  //     transaction row. A duplicate verify returns the cached success and
  //     never re-verifies/re-credits. ---
  const idempotency = await resolveIdempotency<VerifyPaidVoteResponse>(
    tx.payment_reference,
    {
      lookupCached: async () => {
        if (tx.vote_credit_status === 'credited') {
          return {
            success: true,
            alreadyProcessed: true,
            votesCredited: tx.total_votes_to_credit,
            newTotalVotes: 0,
            receiptNumber: await getReceiptNumber(tx.id),
          };
        }
        return null;
      },
    },
  );
  if (idempotency.status === 'cached') return idempotency.value;

  // --- Already failed ---
  if (tx.payment_status === 'failed' || tx.payment_status === 'abandoned') {
    throw new ApiError('This payment was not successful. No votes were added.', 400);
  }

  // --- Verify payment server-side (shared core Paystack wrapper) ---
  const verification = await verifyVotePayment(tx.payment_reference);

  if (!verification.success) {
    await supabase
      .from('vote_transactions')
      .update({ payment_status: 'failed', updated_at: new Date().toISOString() })
      .eq('id', tx.id);
    throw new ApiError('Payment verification failed. No votes were added.', 400);
  }

  // --- Guard: amount must match ---
  const amountPaidKobo = verification.amountKobo;
  const amountPaidNgn = amountPaidKobo / 100;
  const amountExpectedKobo = Math.round(Number(tx.amount_expected) * 100);
  if (Math.abs(amountPaidNgn - Number(tx.amount_expected)) > 1) {
    await supabase
      .from('vote_transactions')
      .update({ payment_status: 'failed', amount_paid: amountPaidNgn })
      .eq('id', tx.id);

    // Shared fraud signal: mismatched amount on a paid vote.
    await recordVoteFraudSignals({
      domain: 'general',
      contestId: tx.contest_id,
      contestantId: tx.contestant_id,
      votes: tx.total_votes_to_credit,
      paymentReference: tx.payment_reference,
      ipAddress,
      userId: tx.voter_user_id ?? null,
      amountExpectedKobo,
      amountPaidKobo,
    });
    // Unified audit + legacy audit entry (kept for back-compat).
    await recordVoteAudit({
      domain: 'general',
      action: 'vote_amount_mismatch',
      actorId,
      entityId: tx.id,
      contestId: tx.contest_id,
      contestantId: tx.contestant_id,
      paymentReference: tx.payment_reference,
      amountPaidKobo,
      amountExpectedKobo,
      ipAddress,
      userAgent,
    });
    await appendAuditLog({
      actorId,
      actorRole: 'system',
      action: 'paid_vote_amount_mismatch',
      entityType: 'vote_transaction',
      entityId: tx.id,
      contestId: tx.contest_id,
      contestantId: tx.contestant_id,
      oldValue: { amountExpected: tx.amount_expected },
      newValue: { amountPaid: amountPaidNgn },
      ipAddress,
      userAgent,
    });
    throw new ApiError('Payment amount mismatch. Please contact support.', 400);
  }

  // --- Mark transaction successful ---
  const now = new Date().toISOString();
  await supabase
    .from('vote_transactions')
    .update({
      payment_status: 'successful',
      vote_credit_status: 'credited',
      amount_paid: amountPaidNgn,
      provider_reference: verification.providerReference,
      paid_at: verification.paidAt ?? now,
      verified_at: now,
      credited_at: now,
    })
    .eq('id', tx.id);

  // --- Insert confirmed vote record ---
  const { data: voteRow } = await supabase
    .from('votes')
    .insert({
      contest_id: tx.contest_id,
      contestant_id: tx.contestant_id,
      voter_user_id: tx.voter_user_id,
      vote_type: 'paid',
      vote_quantity: tx.total_votes_to_credit,
      vote_status: 'confirmed',
      transaction_id: tx.id,
      payment_reference: tx.payment_reference,
      fraud_score: 0,
      fraud_status: 'clean',
      confirmed_at: now,
    })
    .select('id')
    .single();

  // --- Credit vote totals ---
  await incrementVoteTotals(tx.contest_id, tx.contestant_id, {
    paidVotes: tx.votes_purchased,
    bonusVotes: tx.bonus_votes,
  });

  // --- Generate receipt ---
  const receiptNumber = await issueReceipt(tx, amountPaidNgn, now);

  // --- Shared core: high-volume fraud signal + unified credit audit ---
  const fraud = await recordVoteFraudSignals({
    domain: 'general',
    contestId: tx.contest_id,
    contestantId: tx.contestant_id,
    votes: tx.total_votes_to_credit,
    paymentReference: tx.payment_reference,
    ipAddress,
    userId: tx.voter_user_id ?? null,
    amountExpectedKobo,
    amountPaidKobo,
  });
  await recordVoteAudit({
    domain: 'general',
    action: 'vote_credited',
    actorId,
    entityId: tx.id,
    contestId: tx.contest_id,
    contestantId: tx.contestant_id,
    paymentReference: tx.payment_reference,
    votes: tx.total_votes_to_credit,
    amountPaidKobo,
    amountExpectedKobo,
    fraudScore: fraud.score,
    ipAddress,
    userAgent,
  });

  await appendAuditLog({
    actorId,
    actorRole: 'system',
    action: 'paid_vote_credited',
    entityType: 'vote_transaction',
    entityId: tx.id,
    contestId: tx.contest_id,
    contestantId: tx.contestant_id,
    newValue: {
      votesCredit: tx.total_votes_to_credit,
      amountPaid: amountPaidNgn,
      receiptNumber,
      voteId: voteRow?.id,
    },
    ipAddress,
    userAgent,
  });

  return {
    success: true,
    alreadyProcessed: false,
    votesCredited: tx.total_votes_to_credit,
    newTotalVotes: 0,
    receiptNumber,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getPackageById(packageId: string, contestId: string): Promise<VotePackage> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('vote_packages')
    .select('*')
    .eq('id', packageId)
    .eq('contest_id', contestId)
    .eq('is_active', true)
    .maybeSingle();
  if (error || !data) throw new ApiError('Vote package not found or inactive', 404);
  return mapPackageRow(data);
}

async function getBaseVoteRate(contestId: string): Promise<number> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('vote_packages')
    .select('amount, votes')
    .eq('contest_id', contestId)
    .eq('is_active', true)
    .order('display_order', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) throw new ApiError('No vote packages configured for this contest', 400);
  return data.amount / data.votes;
}

async function issueReceipt(
  tx: Record<string, unknown>,
  amountPaid: number,
  issuedAt: string,
): Promise<string> {
  const supabase = createAdminClient();
  const receiptNumber = `${RECEIPT_PREFIX}-${Date.now()}-${randomUUID().slice(0, 6).toUpperCase()}`;
  await supabase.from('vote_receipts').insert({
    transaction_id: tx.id,
    contest_id: tx.contest_id,
    contestant_id: tx.contestant_id,
    voter_email: tx.voter_email,
    voter_name: tx.voter_name,
    receipt_number: receiptNumber,
    votes_purchased: tx.votes_purchased,
    bonus_votes: tx.bonus_votes,
    amount_paid: amountPaid,
    currency: tx.currency ?? 'NGN',
    payment_ref: tx.payment_reference,
    issued_at: issuedAt,
  });

  // Send receipt email asynchronously — don't block the response
  if (tx.voter_email) {
    void (async () => {
      try {
        const adminSupa = createAdminClient();
        const { data } = await adminSupa
          .from('competition_enrollments')
          .select('stage_name, user_profiles(full_name), competitions:contests(name)')
          .eq('id', tx.contestant_id as string)
          .maybeSingle();
        const contestantName = (data as any)?.stage_name || (data as any)?.user_profiles?.full_name || 'Contestant';
        const contestName = (data as any)?.competitions?.name || 'Spotlight Contest';
        await sendVoteReceiptEmail({
          to: tx.voter_email as string,
          voterName: (tx.voter_name as string) || (tx.voter_email as string),
          contestantName,
          contestName,
          votesPurchased: Number(tx.votes_purchased),
          bonusVotes: Number(tx.bonus_votes ?? 0),
          amountPaid,
          currency: (tx.currency as string) ?? 'NGN',
          receiptNumber,
          paymentRef: tx.payment_reference as string,
          issuedAt,
        });
      } catch { /* fire-and-forget */ }
    })();
  }

  return receiptNumber;
}

async function getReceiptNumber(transactionId: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('vote_receipts')
    .select('receipt_number')
    .eq('transaction_id', transactionId)
    .maybeSingle();
  return (data as { receipt_number?: string } | null)?.receipt_number ?? null;
}

function mapPackageRow(row: Record<string, unknown>): VotePackage {
  return {
    id: row.id as string,
    contestId: row.contest_id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    votes: Number(row.votes),
    bonusVotes: Number(row.bonus_votes ?? 0),
    totalVotes: Number(row.votes) + Number(row.bonus_votes ?? 0),
    amount: Number(row.amount),
    currency: (row.currency as string) ?? 'NGN',
    isActive: Boolean(row.is_active),
    isRecommended: Boolean(row.is_recommended),
    promoLabel: (row.promo_label as string | null) ?? null,
    displayOrder: Number(row.display_order ?? 0),
    startsAt: (row.starts_at as string | null) ?? null,
    endsAt: (row.ends_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
