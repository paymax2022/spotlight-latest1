/**
 * Vote bridge — wraps the legacy vote service with:
 *   1. Feature-flag bypass (VOTES_BRIDGE_ENABLED=false → direct call)
 *   2. Idempotency (X-Idempotency-Key dedup via bridge_idempotency_keys)
 *   3. KYC gate (suspended users denied; per-tier limits in Block 7)
 *   4. Outbox enqueue (referral.triggered, votes.free.cast, votes.paid.credited)
 *
 * IMPORTANT: This file IMPORTS from the protected vote service — it never edits it.
 * The brownfield hook will block any edit attempt to protected files.
 */
import type { CastFreeVoteRequest, CastFreeVoteResponse, VerifyPaidVoteRequest, VerifyPaidVoteResponse } from '@/src/features/voting/types';
import { castFreeVote } from '@/src/server/voting/free-vote.service';
import { verifyAndCreditPaidVote } from '@/src/server/voting/paid-vote.service';
import { ApiError } from '@/src/lib/api/responses';
import { isBridgeEnabled } from './feature-flag';
import { checkAndClaimIdempotencyKey, storeIdempotencyResult } from './idempotency';
import { assertKycGate } from './kyc-gate';
import { enqueueOutboxEvent } from './outbox';

// ---------------------------------------------------------------------------
// bridgedCastFreeVote
// ---------------------------------------------------------------------------

export async function bridgedCastFreeVote(
  req: CastFreeVoteRequest,
  ipAddress: string,
  deviceFingerprint: string,
  userAgent: string,
  userId?: string,
  idempotencyKey?: string,
): Promise<CastFreeVoteResponse> {
  if (!isBridgeEnabled()) {
    // Bridge off — fall through directly to the original function
    return castFreeVote(req, ipAddress, deviceFingerprint, userAgent, userId);
  }

  if (!idempotencyKey) {
    throw new ApiError('X-Idempotency-Key header is required for bridged votes.', 400);
  }

  // Step 1: Idempotency check
  const cached = await checkAndClaimIdempotencyKey(idempotencyKey);
  if (cached) return cached as CastFreeVoteResponse;

  // Step 2: KYC gate (only for authenticated users)
  if (userId) await assertKycGate(userId);

  // Step 3: Call the protected function
  const result = await castFreeVote(req, ipAddress, deviceFingerprint, userAgent, userId);

  // Step 4: Store result (only on success — failed calls must not be cached)
  await storeIdempotencyResult(idempotencyKey, result);

  // Step 5: Enqueue outbox events (non-blocking)
  await enqueueOutboxEvent('votes.free.cast', {
    contestId: req.contestId,
    contestantId: req.contestantId,
    voterId: userId ?? null,
    votesAdded: result.votesAdded,
  });

  if (req.shareCode && userId) {
    await enqueueOutboxEvent('referral.triggered', {
      shareCode: req.shareCode,
      voterId: userId,
      contestantId: req.contestantId,
      contestId: req.contestId,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// bridgedVerifyPaidVote
// ---------------------------------------------------------------------------

export async function bridgedVerifyPaidVote(
  req: VerifyPaidVoteRequest,
  actorId: string,
  ipAddress: string,
  userAgent: string,
): Promise<VerifyPaidVoteResponse> {
  if (!isBridgeEnabled()) {
    return verifyAndCreditPaidVote(req, actorId, ipAddress, userAgent);
  }

  // Use paymentReference as the idempotency key
  const idempotencyKey = `paid-vote-verify:${req.paymentReference}`;

  const cached = await checkAndClaimIdempotencyKey(idempotencyKey);
  if (cached) return cached as VerifyPaidVoteResponse;

  const result = await verifyAndCreditPaidVote(req, actorId, ipAddress, userAgent);

  await storeIdempotencyResult(idempotencyKey, result);

  if (!result.alreadyProcessed) {
    await enqueueOutboxEvent('votes.paid.credited', {
      transactionId: req.transactionId,
      paymentReference: req.paymentReference,
      votesCredited: result.votesCredited,
    });
  }

  return result;
}
