/**
 * Vote Bridge - Adapter layer connecting legacy voting functions to admin portal
 * Adds idempotency, KYC gating, and outbox pattern without modifying protected functions
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { checkAndClaimIdempotencyKey, storeIdempotencyResult } from './idempotency';
import { assertKycTier } from './kyc-gate';
import { enqueueOutboxEvent } from './outbox';
import { isBridgeEnabled } from './feature-flag';

export interface CastFreeVoteRequest {
  contestantId: string;
  contestId: string;
  shareCode?: string;
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
   * HTTP status the caller should surface. The bridge's failure path used to
   * flatten every throw into a bare message, so the route mapped all of them to
   * 400 — a KYC rejection (403) and a rate/cap refusal (429) arrived
   * indistinguishable from a malformed body. Carrying the code keeps the
   * thrower's intent intact. Absent means "no opinion"; the route decides.
   */
  statusCode?: number;
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
  // Check if bridge is enabled (gradual rollout support)
  if (!isBridgeEnabled()) {
    // Fall through to original legacy function
    // (imported from protected file — never edit directly)
    return {
      success: false,
      error: 'Bridge not enabled'
    };
  }

  if (!idempotencyKey) {
    return {
      success: false,
      error: 'X-Idempotency-Key header is required'
    };
  }

  try {
    // Step 1: Idempotency check — return cached result if exists
    const cached = await checkAndClaimIdempotencyKey(idempotencyKey);
    if (cached) {
      return cached as VoteResponse;
    }

    // Step 2: KYC tier gate (does not touch protected files)
    if (userId) {
      await assertKycTier(userId, req.contestantId);
    }

    // Step 3: Create admin client and insert vote
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('votes')
      .insert({
        contestant_id: req.contestantId,
        competition_id: req.contestId,
        voter_id: userId,
        vote_type: 'free',
        ip_address: context.ipAddress,
        user_agent: context.userAgent,
        device_fingerprint: context.deviceFingerprint,
      })
      .select('id, total_votes')
      .single();

    if (error) {
      throw error;
    }

    const result: VoteResponse = {
      success: true,
      voteId: data.id,
      totalVotes: data.total_votes,
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
  if (!isBridgeEnabled()) {
    return {
      success: false,
      error: 'Bridge not enabled'
    };
  }

  const supabase = createAdminClient();

  try {
    // Step 1: Acquire SELECT FOR UPDATE lock on transaction
    // This prevents webhook + redirect double-credit race
    const { error: lockErr } = await supabase.rpc('lock_vote_transaction', {
      tx_id: req.transactionId,
    });

    if (lockErr) {
      console.error('[VoteBridge] Lock error:', lockErr);
      return {
        success: false,
        error: 'Could not acquire transaction lock',
      };
    }

    // Step 2: Fetch the transaction and verify it hasn't been credited
    const { data: tx, error: fetchErr } = await supabase
      .from('vote_transactions')
      .select('*')
      .eq('id', req.transactionId)
      .single();

    if (fetchErr || !tx) {
      return {
        success: false,
        error: 'Transaction not found',
      };
    }

    if (tx.vote_credit_status === 'credited') {
      return {
        success: false,
        error: 'Vote already credited for this transaction',
      };
    }

    if (tx.payment_reference !== req.paymentReference) {
      return {
        success: false,
        error: 'Payment reference mismatch',
      };
    }

    // Step 3: Insert the vote
    const { data: vote, error: voteErr } = await supabase
      .from('votes')
      .insert({
        contestant_id: tx.contestant_id,
        competition_id: tx.competition_id,
        voter_id: tx.voter_id,
        vote_type: 'paid',
        ip_address: context.ipAddress,
        user_agent: context.userAgent,
        transaction_id: req.transactionId,
      })
      .select('id, total_votes')
      .single();

    if (voteErr) {
      throw voteErr;
    }

    // Step 4: Mark transaction as credited
    const { error: updateErr } = await supabase
      .from('vote_transactions')
      .update({ vote_credit_status: 'credited', vote_id: vote.id })
      .eq('id', req.transactionId);

    if (updateErr) {
      throw updateErr;
    }

    const result: VoteResponse = {
      success: true,
      voteId: vote.id,
      totalVotes: vote.total_votes,
    };

    // Step 5: Enqueue analytics event
    await enqueueOutboxEvent('votes.paid.credited', {
      transactionId: req.transactionId,
      contestantId: tx.contestant_id,
      voterId: tx.voter_id,
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
