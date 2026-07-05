/**
 * Vote bridge integration tests.
 *
 * Mocks all dependencies (feature flag, idempotency, kyc gate, outbox, vote services).
 * Tests the wiring: flag off → direct call; flag on → bridge with idempotency + kyc + outbox.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/src/server/voting/free-vote.service', () => ({
  castFreeVote: vi.fn(),
}));

vi.mock('@/src/server/voting/paid-vote.service', () => ({
  verifyAndCreditPaidVote: vi.fn(),
}));

vi.mock('@/src/server/voting-bridge/idempotency', () => {
  const checkAndClaimIdempotencyKey = vi.fn();
  return {
    checkAndClaimIdempotencyKey,
    storeIdempotencyResult: vi.fn(),
    // Mirrors the real anchor: the bridge now routes idempotency through the
    // shared core `resolveIdempotency(key, bridgeIdempotencyAnchor())`. The
    // real anchor's `claim` delegates to checkAndClaimIdempotencyKey (cached
    // value → 'cached', null → 'fresh'), so the mock does the same and the
    // per-test checkAndClaimIdempotencyKey stubs keep their semantics.
    bridgeIdempotencyAnchor: () => ({
      lookupCached: async () => null,
      claim: (key: string) => checkAndClaimIdempotencyKey(key),
    }),
  };
});

vi.mock('@/src/server/voting-bridge/kyc-gate', () => ({
  assertKycGate: vi.fn(),
}));

vi.mock('@/src/server/voting-bridge/outbox', () => ({
  enqueueOutboxEvent: vi.fn(),
}));

import { bridgedCastFreeVote, bridgedVerifyPaidVote } from '@/src/server/voting-bridge/bridge';
import { castFreeVote } from '@/src/server/voting/free-vote.service';
import { verifyAndCreditPaidVote } from '@/src/server/voting/paid-vote.service';
import { checkAndClaimIdempotencyKey, storeIdempotencyResult } from '@/src/server/voting-bridge/idempotency';
import { assertKycGate } from '@/src/server/voting-bridge/kyc-gate';
import { enqueueOutboxEvent } from '@/src/server/voting-bridge/outbox';

const FREE_VOTE_REQ = {
  contestId: 'contest-001',
  contestantId: 'contestant-001',
};

const FREE_VOTE_RESULT = {
  success: true,
  votesAdded: 1,
  totalFreeVotesUsed: 1,
  freeVotesRemaining: 4,
  newTotalVotes: 10,
  fraudStatus: 'clean' as const,
};

const VERIFY_REQ = {
  transactionId: 'tx-001',
  paymentReference: 'PAY_ref_001',
};

const VERIFY_RESULT = {
  success: true,
  alreadyProcessed: false,
  votesCredited: 10,
  newTotalVotes: 20,
  receiptNumber: 'RCP-001',
};

function enableBridge() { process.env.VOTES_BRIDGE_ENABLED = 'true'; }
function disableBridge() { delete process.env.VOTES_BRIDGE_ENABLED; }

describe('bridgedCastFreeVote — bridge off', () => {
  beforeEach(() => { vi.clearAllMocks(); disableBridge(); });

  it('calls castFreeVote directly without bridge logic', async () => {
    vi.mocked(castFreeVote).mockResolvedValue(FREE_VOTE_RESULT as any);

    const result = await bridgedCastFreeVote(FREE_VOTE_REQ, '1.2.3.4', '', '', 'user-001');

    expect(castFreeVote).toHaveBeenCalledOnce();
    expect(checkAndClaimIdempotencyKey).not.toHaveBeenCalled();
    expect(assertKycGate).not.toHaveBeenCalled();
    expect(result.votesAdded).toBe(1);
  });
});

describe('bridgedCastFreeVote — bridge on', () => {
  beforeEach(() => { vi.clearAllMocks(); enableBridge(); });
  afterEach(disableBridge);

  it('throws 400 when idempotency key is missing', async () => {
    const { ApiError } = await import('@/src/lib/api/responses');
    await expect(
      bridgedCastFreeVote(FREE_VOTE_REQ, '1.2.3.4', '', '', 'user-001', undefined),
    ).rejects.toThrow(ApiError);
    expect(castFreeVote).not.toHaveBeenCalled();
  });

  it('returns cached result when idempotency key already has a result', async () => {
    vi.mocked(checkAndClaimIdempotencyKey).mockResolvedValue(FREE_VOTE_RESULT);

    const result = await bridgedCastFreeVote(FREE_VOTE_REQ, '1.2.3.4', '', '', 'user-001', 'key-001');

    expect(castFreeVote).not.toHaveBeenCalled();
    expect(assertKycGate).not.toHaveBeenCalled();
    expect(result.votesAdded).toBe(1);
  });

  it('runs KYC gate, calls castFreeVote, stores result, enqueues outbox', async () => {
    vi.mocked(checkAndClaimIdempotencyKey).mockResolvedValue(null); // new key
    vi.mocked(assertKycGate).mockResolvedValue(undefined);
    vi.mocked(castFreeVote).mockResolvedValue(FREE_VOTE_RESULT as any);
    vi.mocked(storeIdempotencyResult).mockResolvedValue(undefined);
    vi.mocked(enqueueOutboxEvent).mockResolvedValue(undefined);

    const result = await bridgedCastFreeVote(FREE_VOTE_REQ, '1.2.3.4', '', '', 'user-001', 'key-002');

    expect(assertKycGate).toHaveBeenCalledWith('user-001');
    expect(castFreeVote).toHaveBeenCalledOnce();
    expect(storeIdempotencyResult).toHaveBeenCalledWith('key-002', FREE_VOTE_RESULT);
    expect(enqueueOutboxEvent).toHaveBeenCalledWith('votes.free.cast', expect.objectContaining({
      contestId: 'contest-001',
      votesAdded: 1,
    }));
    expect(result.success).toBe(true);
  });

  it('enqueues referral.triggered when shareCode is present', async () => {
    vi.mocked(checkAndClaimIdempotencyKey).mockResolvedValue(null);
    vi.mocked(assertKycGate).mockResolvedValue(undefined);
    vi.mocked(castFreeVote).mockResolvedValue(FREE_VOTE_RESULT as any);
    vi.mocked(storeIdempotencyResult).mockResolvedValue(undefined);
    vi.mocked(enqueueOutboxEvent).mockResolvedValue(undefined);

    await bridgedCastFreeVote(
      { ...FREE_VOTE_REQ, shareCode: 'SHARE123' },
      '1.2.3.4', '', '', 'user-001', 'key-003',
    );

    expect(enqueueOutboxEvent).toHaveBeenCalledWith('referral.triggered', expect.objectContaining({
      shareCode: 'SHARE123',
      voterId: 'user-001',
    }));
  });

  it('skips KYC gate when userId is undefined (anonymous voter)', async () => {
    vi.mocked(checkAndClaimIdempotencyKey).mockResolvedValue(null);
    vi.mocked(castFreeVote).mockResolvedValue(FREE_VOTE_RESULT as any);
    vi.mocked(storeIdempotencyResult).mockResolvedValue(undefined);
    vi.mocked(enqueueOutboxEvent).mockResolvedValue(undefined);

    await bridgedCastFreeVote(FREE_VOTE_REQ, '1.2.3.4', '', '', undefined, 'key-004');

    expect(assertKycGate).not.toHaveBeenCalled();
    expect(castFreeVote).toHaveBeenCalledOnce();
  });

  it('does NOT store result when castFreeVote throws (failed calls not cached)', async () => {
    vi.mocked(checkAndClaimIdempotencyKey).mockResolvedValue(null);
    vi.mocked(assertKycGate).mockResolvedValue(undefined);
    vi.mocked(castFreeVote).mockRejectedValue(new Error('DB down'));

    await expect(
      bridgedCastFreeVote(FREE_VOTE_REQ, '1.2.3.4', '', '', 'user-001', 'key-005'),
    ).rejects.toThrow('DB down');

    expect(storeIdempotencyResult).not.toHaveBeenCalled();
  });
});

describe('bridgedVerifyPaidVote — bridge on', () => {
  beforeEach(() => { vi.clearAllMocks(); enableBridge(); });
  afterEach(disableBridge);

  it('returns cached result when payment reference already verified', async () => {
    vi.mocked(checkAndClaimIdempotencyKey).mockResolvedValue(VERIFY_RESULT);

    const result = await bridgedVerifyPaidVote(VERIFY_REQ, 'actor', '1.2.3.4', 'agent');

    expect(verifyAndCreditPaidVote).not.toHaveBeenCalled();
    expect(result.votesCredited).toBe(10);
  });

  it('calls verifyAndCreditPaidVote and enqueues outbox on new verification', async () => {
    vi.mocked(checkAndClaimIdempotencyKey).mockResolvedValue(null);
    vi.mocked(verifyAndCreditPaidVote).mockResolvedValue(VERIFY_RESULT as any);
    vi.mocked(storeIdempotencyResult).mockResolvedValue(undefined);
    vi.mocked(enqueueOutboxEvent).mockResolvedValue(undefined);

    const result = await bridgedVerifyPaidVote(VERIFY_REQ, 'actor', '1.2.3.4', 'agent');

    expect(verifyAndCreditPaidVote).toHaveBeenCalledOnce();
    expect(storeIdempotencyResult).toHaveBeenCalledWith(
      `paid-vote-verify:${VERIFY_REQ.paymentReference}`,
      VERIFY_RESULT,
    );
    expect(enqueueOutboxEvent).toHaveBeenCalledWith('votes.paid.credited', expect.objectContaining({
      paymentReference: 'PAY_ref_001',
      votesCredited: 10,
    }));
    expect(result.success).toBe(true);
  });
});
