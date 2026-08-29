/**
 * bridgedCastFreeVote wiring: what the bridge calls, in what order, and what it
 * refuses to do.
 *
 * Rewritten against the bridge that exists. The previous version described a
 * different one: it called bridgedCastFreeVote(req, ip, fingerprint, ua, userId,
 * key) — a six-positional signature the function has never had — mocked
 * assertKycGate and bridgeIdempotencyAnchor (neither exists on develop OR main),
 * and expected throws where the bridge returns. Its header blamed a pending
 * main→develop sync, but main carries the same bridge this does, so the sync it
 * waited for was never coming.
 *
 * The paid-vote cases are NOT carried over. They asserted idempotency-keyed
 * caching around verifyAndCreditPaidVote, while bridgedVerifyPaidVote actually
 * serialises on a lock_vote_transaction RPC and calls neither. That path is
 * covered by tests/unit/voting/paid-vote-concurrency.spec.ts, which tests the
 * lock it really takes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/src/server/voting-bridge/free-vote-atomic', () => ({
  castFreeVoteAtomic: vi.fn(),
}));

vi.mock('@/src/server/voting-bridge/idempotency', () => ({
  checkAndClaimIdempotencyKey: vi.fn(),
  storeIdempotencyResult: vi.fn(),
  releaseIdempotencyKey: vi.fn(),
}));

vi.mock('@/src/server/voting-bridge/kyc-gate', () => ({
  assertKycTier: vi.fn(),
  KycGateError: class KycGateError extends Error {},
}));

vi.mock('@/src/server/voting-bridge/outbox', () => ({
  enqueueOutboxEvent: vi.fn(),
}));

import { bridgedCastFreeVote } from '@/src/server/voting-bridge/bridge';
import { castFreeVoteAtomic } from '@/src/server/voting-bridge/free-vote-atomic';
import {
  checkAndClaimIdempotencyKey,
  storeIdempotencyResult,
  releaseIdempotencyKey,
} from '@/src/server/voting-bridge/idempotency';
import { assertKycTier } from '@/src/server/voting-bridge/kyc-gate';
import { enqueueOutboxEvent } from '@/src/server/voting-bridge/outbox';

const REQ = { contestId: 'contest-001', contestantId: 'contestant-001' };
const CTX = { ipAddress: '1.2.3.4', userAgent: 'agent', deviceFingerprint: 'fp-1' };

/** What castFreeVoteAtomic resolves — CastFreeVoteResponse. */
const CLAIM = {
  success: true,
  votesAdded: 1,
  totalFreeVotesUsed: 1,
  freeVotesRemaining: 4,
  newTotalVotes: 0,
  fraudStatus: 'clean' as const,
  resetAt: '2026-01-02T00:00:00.000Z',
  contestantId: 'contestant-001',
};

const enableBridge = () => { process.env.VOTES_BRIDGE_ENABLED = 'true'; };
const disableBridge = () => { delete process.env.VOTES_BRIDGE_ENABLED; };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertKycTier).mockResolvedValue(true as never);
  vi.mocked(castFreeVoteAtomic).mockResolvedValue(CLAIM as never);
  vi.mocked(checkAndClaimIdempotencyKey).mockResolvedValue(null);
});
afterEach(disableBridge);

describe('bridgedCastFreeVote — bridge off', () => {
  beforeEach(disableBridge);

  // NOTE: the bridge's own comment here says "fall through to original legacy
  // function", but no fallthrough was ever implemented — it returns an error and
  // never imports castFreeVote. Asserting what the code does, not what the
  // comment claims; the mismatch is worth resolving separately, because the flag
  // defaults to disabled and /api/v2/votes/free is what the vote modal calls.
  it('refuses rather than falling through to the legacy service', async () => {
    const result = await bridgedCastFreeVote(REQ, 'user-001', 'key-000', CTX);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Bridge not enabled');
    expect(checkAndClaimIdempotencyKey).not.toHaveBeenCalled();
    expect(castFreeVoteAtomic).not.toHaveBeenCalled();
  });
});

describe('bridgedCastFreeVote — bridge on', () => {
  beforeEach(enableBridge);

  it('refuses without an idempotency key, before claiming or voting', async () => {
    const result = await bridgedCastFreeVote(REQ, 'user-001', '', CTX);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Idempotency-Key');
    expect(checkAndClaimIdempotencyKey).not.toHaveBeenCalled();
    expect(castFreeVoteAtomic).not.toHaveBeenCalled();
  });

  it('returns the cached result without voting again', async () => {
    const cached = { success: true, votesAdded: 1, freeVotesRemaining: 4 };
    vi.mocked(checkAndClaimIdempotencyKey).mockResolvedValue(cached);

    const result = await bridgedCastFreeVote(REQ, 'user-001', 'key-001', CTX);

    expect(result).toEqual(cached);
    expect(assertKycTier).not.toHaveBeenCalled();
    expect(castFreeVoteAtomic).not.toHaveBeenCalled();
  });

  it('gates on KYC, claims once, stores the result and enqueues the vote event', async () => {
    const result = await bridgedCastFreeVote(REQ, 'user-001', 'key-002', CTX);

    expect(assertKycTier).toHaveBeenCalledWith('user-001', 'contestant-001');
    expect(castFreeVoteAtomic).toHaveBeenCalledOnce();
    expect(storeIdempotencyResult).toHaveBeenCalledWith('key-002', expect.objectContaining({
      success: true,
      votesAdded: 1,
      freeVotesRemaining: 4,
    }));
    expect(enqueueOutboxEvent).toHaveBeenCalledWith('votes.free.cast', expect.objectContaining({
      contestId: 'contest-001',
    }));
    expect(result.success).toBe(true);
  });

  it('enqueues referral.triggered when a shareCode is present', async () => {
    await bridgedCastFreeVote({ ...REQ, shareCode: 'SHARE123' }, 'user-001', 'key-003', CTX);

    expect(enqueueOutboxEvent).toHaveBeenCalledWith('referral.triggered', expect.objectContaining({
      shareCode: 'SHARE123',
      voterId: 'user-001',
    }));
  });

  it('skips the KYC gate for an anonymous voter but still claims the vote', async () => {
    await bridgedCastFreeVote(REQ, undefined, 'key-004', CTX);

    expect(assertKycTier).not.toHaveBeenCalled();
    expect(castFreeVoteAtomic).toHaveBeenCalledOnce();
  });

  it('does not cache a failed claim, and frees the key so a retry can re-attempt', async () => {
    vi.mocked(castFreeVoteAtomic).mockRejectedValueOnce(new Error('DB down'));

    const result = await bridgedCastFreeVote(REQ, 'user-001', 'key-005', CTX);

    // The bridge RETURNS failures rather than throwing at its caller.
    expect(result.success).toBe(false);
    expect(result.error).toBe('DB down');
    expect(storeIdempotencyResult).not.toHaveBeenCalled();
    // Without this release the claim row would strand and every retry of this
    // key would be refused 409 forever.
    expect(releaseIdempotencyKey).toHaveBeenCalledWith('key-005');
  });
});
