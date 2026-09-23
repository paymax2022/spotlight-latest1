/**
 * Vote Bridge - Adapter layer connecting legacy voting functions to admin portal
 * Adds idempotency, KYC gating, and outbox pattern without modifying protected functions
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { checkAndClaimIdempotencyKey, storeIdempotencyResult, releaseIdempotencyKey } from './idempotency';
import { assertKycTier } from './kyc-gate';
import { enqueueOutboxEvent } from './outbox';
import { isBridgeEnabled } from './feature-flag';
import { castFreeVoteAtomic } from './free-vote-atomic';
// The legacy engine this bridge wraps. Imported, never edited — both live in
// protected files (see .claude/hooks/protect-legacy.sh); free-vote-atomic.ts
// already takes the same approach with their helpers.
import { castFreeVote } from '@/src/server/voting/free-vote.service';
import { verifyAndCreditPaidVote } from '@/src/server/voting/paid-vote.service';
import type { FraudStatus } from '@/src/features/voting/types';
// Shared cross-engine helpers (NOT protected — voting/core/* is Paymax-era
// shared infrastructure, distinct from the top-level *.service.ts files).
// Safe to import and call directly; only the *.service.ts files themselves
// (and the legacy SQL/routes) may never be edited.
import { verifyVotePayment, recordVoteFraudSignals, recordVoteAudit } from '@/src/server/voting/core';

export interface CastFreeVoteRequest {
  contestantId: string;
  contestId: string;
  shareCode?: string;
  /** Defaults to 1. Forwarded to the atomic claim, which caps it against the day's allowance. */
  voteQuantity?: number;
  /** Email or phone, for contests whose freeVoteLimitScope is not 'user'. */
  voterIdentifier?: string;
}

export interface VerifyPaidVoteRequest {
  transactionId: string;
  paymentReference: string;
}

export interface VoteResponse {
  success: boolean;
  voteId?: string;
  totalVotes?: number;
  error?: string;
  /**
   * Free-vote allowance, from the atomic claim. `freeVotesRemaining` is what the
   * vote modal renders after a successful vote — it read the field all along,
   * while the direct-insert path never produced it, so every voter was told they
   * had "undefined free votes remaining today".
   */
  votesAdded?: number;
  totalFreeVotesUsed?: number;
  freeVotesRemaining?: number;
  fraudStatus?: FraudStatus;
  /** ISO timestamp when this contestant's free votes reset. */
  resetAt?: string;
  /**
   * HTTP status the caller should surface. The bridge's failure path used to
   * flatten every throw into a bare message, so the route mapped all of them to
   * 400 — a KYC rejection (403) and a rate/cap refusal (429) arrived
   * indistinguishable from a malformed body. Carrying the code keeps the
   * thrower's intent intact. Absent means "no opinion"; the route decides.
   */
  statusCode?: number;
  /** Paid-vote verify only: true when this call observed a credit that had
   *  already happened (won by a concurrent caller, or a genuine client
   *  retry) rather than performing one itself. */
  alreadyProcessed?: boolean;
  /** Paid-vote verify only: votes_purchased + bonus_votes for this transaction. */
  votesCredited?: number;
}

/**
 * The two error types thrown under the bridge disagree on the property name:
 * ApiError (src/lib/api/responses) uses `status`, KycGateError
 * (voting-bridge/kyc-gate) uses `statusCode`. Read both rather than picking one
 * and silently dropping the other's intent.
 */
function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const e = error as { status?: unknown; statusCode?: unknown };
  if (typeof e.statusCode === 'number') return e.statusCode;
  if (typeof e.status === 'number') return e.status;
  return undefined;
}

/**
 * Bridged free vote casting with idempotency
 * Fixes TOCTOU race in castFreeVote() by using idempotency keys
 */
export async function bridgedCastFreeVote(
  req: CastFreeVoteRequest,
  userId: string | undefined,
  idempotencyKey: string,
  context: {
    ipAddress: string;
    userAgent: string;
    deviceFingerprint?: string;
  }
): Promise<VoteResponse> {
  // Gradual rollout: with the flag off the request is served by the legacy
  // engine this bridge wraps.
  //
  // It previously returned "Bridge not enabled" and served nothing, despite the
  // comment here promising a fallthrough — castFreeVote was not even imported.
  // The flag DEFAULTS TO DISABLED (feature-flag.ts) and /api/v2/votes/free is
  // what the vote modal calls, so any deployment without VOTES_BRIDGE_ENABLED
  // set had free voting dead rather than merely un-bridged. A rollout flag that
  // breaks the feature when off is not a rollout flag.
  //
  // The legacy path is the PRE-atomic one, so it carries the D-001/D-002/D-003
  // races claim_free_vote fixes. That is the accepted meaning of "flag off",
  // not a regression introduced here — turn the bridge on to get the atomic
  // claim.
  if (!isBridgeEnabled()) {
    try {
      const legacy = await castFreeVote(
        req,
        context.ipAddress,
        context.deviceFingerprint ?? '',
        context.userAgent,
        userId,
      );
      return {
        success: true,
        votesAdded: legacy.votesAdded,
        totalFreeVotesUsed: legacy.totalFreeVotesUsed,
        freeVotesRemaining: legacy.freeVotesRemaining,
        fraudStatus: legacy.fraudStatus,
        resetAt: legacy.resetAt,
      };
    } catch (error) {
      // The legacy service THROWS ApiError; the bridge's contract is to return.
      console.error('[VoteBridge] legacy castFreeVote error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        statusCode: statusOf(error),
      };
    }
  }

  if (!idempotencyKey) {
    return {
      success: false,
      error: 'X-Idempotency-Key header is required'
    };
  }

  // Whether THIS call owns the idempotency claim. Only the owner may release it:
  // a 409 from checkAndClaimIdempotencyKey means someone else holds the claim,
  // and releasing theirs would hand this duplicate a second vote.
  let ownsClaim = false;

  try {
    // Step 1: Idempotency check — return cached result if exists
    const cached = await checkAndClaimIdempotencyKey(idempotencyKey);
    if (cached) {
      return cached as VoteResponse;
    }
    ownsClaim = true;

    // Step 2: KYC tier gate (does not touch protected files)
    if (userId) {
      await assertKycTier(userId, req.contestantId);
    }

    // Step 3: Atomic claim.
    //
    // This used to be a bare INSERT into `votes`, which enforced nothing: no
    // daily cap, no timezone-correct day bucket, no totals upsert. The claim
    // that does all three (claim_free_vote, row-locked; D-001/D-002/D-003) had
    // been written, migrated and unit-tested, but nothing ever called it —
    // castFreeVoteAtomic's only occurrence in the tree was its own definition.
    // This is that missing call site.
    //
    // deviceFingerprint is passed through rather than defaulted to a placeholder:
    // a contest whose freeVoteLimitScope is 'device' must refuse a vote it cannot
    // attribute (the claim answers 400), because bucketing every fingerprint-less
    // voter under one shared identifier would pool them into a single daily cap.
    const claim = await castFreeVoteAtomic(
      req,
      context.ipAddress,
      context.deviceFingerprint ?? '',
      context.userAgent,
      userId,
    );

    // newTotalVotes is deliberately not forwarded: the claim hardcodes it to 0
    // ("caller can fetch from totals"), and echoing a known-zero running total is
    // worse than omitting the field.
    const result: VoteResponse = {
      success: true,
      votesAdded: claim.votesAdded,
      totalFreeVotesUsed: claim.totalFreeVotesUsed,
      freeVotesRemaining: claim.freeVotesRemaining,
      fraudStatus: claim.fraudStatus,
      resetAt: claim.resetAt,
    };

    // Step 4: Store result against idempotency key
    await storeIdempotencyResult(idempotencyKey, result);

    // Step 5: Enqueue async side effects (non-blocking)
    if (req.shareCode && userId) {
      await enqueueOutboxEvent('referral.triggered', {
        shareCode: req.shareCode,
        voterId: userId,
        contestantId: req.contestantId,
        contestId: req.contestId,
      });
    }

    // Enqueue vote analytics event
    await enqueueOutboxEvent('votes.free.cast', {
      contestantId: req.contestantId,
      contestId: req.contestId,
      voterId: userId,
      timestamp: new Date().toISOString(),
    });

    return result;
  } catch (error) {
    // Free the claim so a retry with the same key re-attempts rather than being
    // refused forever by the 409 guard. The claim row is written before the vote
    // and filled in after, so a failure leaves it holding the empty placeholder.
    if (ownsClaim) {
      await releaseIdempotencyKey(idempotencyKey);
    }
    console.error('[VoteBridge] castFreeVote error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      statusCode: statusOf(error),
    };
  }
}

/**
 * Bridged paid vote verification with row-level locking
 * Fixes TOCTOU in verifyAndCreditPaidVote() by acquiring SELECT FOR UPDATE
 */
export async function bridgedVerifyPaidVote(
  req: VerifyPaidVoteRequest,
  userId: string,
  context: {
    ipAddress: string;
    userAgent: string;
  }
): Promise<VoteResponse> {
  // Same rollout contract as the free path: flag off means legacy, not broken.
  if (!isBridgeEnabled()) {
    try {
      const legacy = await verifyAndCreditPaidVote(
        req,
        userId,
        context.ipAddress,
        context.userAgent,
      );
      return {
        success: true,
        totalVotes: legacy.newTotalVotes,
        alreadyProcessed: legacy.alreadyProcessed,
        votesCredited: legacy.votesCredited,
      };
    } catch (error) {
      console.error('[VoteBridge] legacy verifyAndCreditPaidVote error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        statusCode: statusOf(error),
      };
    }
  }

  const supabase = createAdminClient();

  try {
    // Step 1: Fetch the transaction. Read-only — safe to repeat, and needed
    // before we can call Paystack (we need the reference + expected amount).
    const { data: tx, error: fetchErr } = await supabase
      .from('vote_transactions')
      .select('*')
      .eq('id', req.transactionId)
      .maybeSingle();

    if (fetchErr || !tx) {
      return { success: false, error: 'Transaction not found', statusCode: 404 };
    }

    // Fast idempotent path: already credited, no need to touch Paystack again.
    if (tx.vote_credit_status === 'credited') {
      return {
        // vote_transactions carries no vote_id column — the associated votes
        // row (if the caller needs it) is looked up via votes.transaction_id.
        success: true,
        alreadyProcessed: true,
        votesCredited: tx.total_votes_to_credit ?? undefined,
      };
    }

    if (tx.payment_reference !== req.paymentReference) {
      return { success: false, error: 'Payment reference mismatch', statusCode: 400 };
    }

    if (tx.payment_status === 'failed' || tx.payment_status === 'abandoned') {
      return { success: false, error: 'This payment was not successful. No votes were added.', statusCode: 400 };
    }

    // Step 2: Verify with the gateway. A read-only round-trip to Paystack — safe
    // to repeat if a concurrent caller races us here; only the DB write below
    // (Step 4) is the part that must not run twice.
    const verification = await verifyVotePayment(tx.payment_reference);

    if (!verification.success) {
      await supabase
        .from('vote_transactions')
        .update({ payment_status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', tx.id);
      return { success: false, error: 'Payment verification failed. No votes were added.', statusCode: 400 };
    }

    const amountPaidKobo = verification.amountKobo;
    const amountPaidNgn = amountPaidKobo / 100;
    const amountExpectedKobo = Math.round(Number(tx.amount_expected) * 100);

    if (Math.abs(amountPaidNgn - Number(tx.amount_expected)) > 1) {
      await supabase
        .from('vote_transactions')
        .update({ payment_status: 'failed', amount_paid: amountPaidNgn })
        .eq('id', tx.id);
      await recordVoteFraudSignals({
        domain: 'general',
        contestId: tx.contest_id,
        contestantId: tx.contestant_id,
        votes: tx.total_votes_to_credit,
        paymentReference: tx.payment_reference,
        ipAddress: context.ipAddress,
        userId: tx.voter_user_id ?? null,
        amountExpectedKobo,
        amountPaidKobo,
      });
      return { success: false, error: 'Payment amount mismatch. Please contact support.', statusCode: 400 };
    }

    // Step 3: Atomic credit. This is the ONE call in the whole flow that must
    // not run twice concurrently — see the migration comment on
    // credit_paid_vote_transaction for why the naive "lock RPC then several
    // more separate calls" approach this replaced never actually serialized
    // anything (each Supabase-js call is its own PostgREST transaction).
    const { data: creditRows, error: creditErr } = await supabase.rpc('credit_paid_vote_transaction', {
      p_transaction_id: req.transactionId,
      p_payment_reference: req.paymentReference,
      p_amount_paid: amountPaidNgn,
      p_provider_reference: verification.providerReference ?? null,
      p_paid_at: verification.paidAt ?? null,
      p_ip: context.ipAddress ?? null,
      p_user_agent: context.userAgent ?? null,
    });

    if (creditErr) {
      throw creditErr;
    }

    const credit = Array.isArray(creditRows) ? creditRows[0] : creditRows;
    if (!credit) {
      throw new Error('credit_paid_vote_transaction returned no row');
    }

    if (credit.reference_mismatch) {
      return { success: false, error: 'Payment reference mismatch', statusCode: 400 };
    }

    if (credit.already_credited) {
      // Lost the race to a concurrent caller (or this is a genuine retry) —
      // the OTHER caller already recorded fraud signals/audit/outbox for the
      // real credit event. Returning success here (not a second credit) is
      // exactly what closes PV-005.
      return {
        success: true,
        alreadyProcessed: true,
        votesCredited: credit.total_votes_to_credit ?? undefined,
      };
    }

    // Step 4: Side effects for the caller that WON the race — safe to do only
    // once, which `already_credited` above guarantees.
    await recordVoteFraudSignals({
      domain: 'general',
      contestId: credit.contest_id,
      contestantId: credit.contestant_id,
      votes: credit.total_votes_to_credit,
      paymentReference: req.paymentReference,
      ipAddress: context.ipAddress,
      userId: credit.voter_user_id ?? null,
      amountExpectedKobo,
      amountPaidKobo,
    });
    await recordVoteAudit({
      domain: 'general',
      action: 'vote_credited',
      actorId: userId,
      entityId: req.transactionId,
      contestId: credit.contest_id,
      contestantId: credit.contestant_id,
      paymentReference: req.paymentReference,
      votes: credit.total_votes_to_credit,
      amountPaidKobo,
      amountExpectedKobo,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    const result: VoteResponse = {
      success: true,
      voteId: credit.vote_id ?? undefined,
      alreadyProcessed: false,
      votesCredited: credit.total_votes_to_credit ?? undefined,
    };

    await enqueueOutboxEvent('votes.paid.credited', {
      transactionId: req.transactionId,
      contestantId: credit.contestant_id,
      voterId: credit.voter_user_id,
      timestamp: new Date().toISOString(),
    });

    return result;
  } catch (error) {
    console.error('[VoteBridge] verifyPaidVote error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      statusCode: statusOf(error),
    };
  }
}

/**
 * Get contestant voting data synchronized from admin portal
 */
export async function getContestantVotingData(contestantId: string) {
  const supabase = createAdminClient();

  try {
    const { data, error } = await supabase
      .from('contestant_vote_stats')
      .select('*')
      .eq('contestant_id', contestantId)
      .single();

    if (error) {
      console.error('[VoteBridge] getContestantVotingData error:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('[VoteBridge] getContestantVotingData error:', error);
    return null;
  }
}

/**
 * Get leaderboard synced from admin voting data
 */
export async function getContestLeaderboard(competitionId: string, limit = 20) {
  const supabase = createAdminClient();

  try {
    const { data, error } = await supabase
      .from('contestant_vote_stats')
      .select('*')
      .eq('competition_id', competitionId)
      .order('total_votes', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[VoteBridge] getContestLeaderboard error:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('[VoteBridge] getContestLeaderboard error:', error);
    return [];
  }
}
