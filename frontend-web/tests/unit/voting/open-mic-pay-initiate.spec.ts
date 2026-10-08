/**
 * Open-mic paid-vote initiate — input boundary.
 *
 * Endpoint under test: POST /api/open-mic/votes/pay/initiate
 *
 * Prod findings that motivated the shape gates:
 *   - contestId:"bogus" (non-uuid) → getContestById → PostgREST 22P02 →
 *     rethrown → 500 "Failed to initiate payment" (sweep-3 BUG-4).
 *   - submissionId / fractional votes fed the uuid entry column and the
 *     integer votes column downstream — same 500 class once a real contest
 *     was passed.
 *
 * Hermetic: auth + persistence are mocked. No DB, no network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest } from '../golden-path/_fixtures';

vi.mock('@/src/lib/auth/request', () => ({
  requireRequestUser: vi.fn(),
}));

vi.mock('@/src/server/openmic/persistence', () => ({
  getContestById: vi.fn(),
}));

vi.mock('@/src/server/payments/openmic-vote-intents', () => ({
  createOpenMicVoteIntent: vi.fn(async () => undefined),
}));

import { POST as postInitiate } from '../../../app/api/open-mic/votes/pay/initiate/route';
import { requireRequestUser } from '@/src/lib/auth/request';
import { getContestById } from '@/src/server/openmic/persistence';
import { createOpenMicVoteIntent } from '@/src/server/payments/openmic-vote-intents';

const VALID_BODY = {
  contestId: '11111111-1111-1111-1111-111111111111',
  submissionId: '22222222-2222-2222-2222-222222222222',
  votes: 10,
};

describe('POST /api/open-mic/votes/pay/initiate (route)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'user-1', email: 'v@example.com' } as any);
    vi.mocked(getContestById).mockResolvedValue({
      votingConfig: { votePrice: 50 },
    } as any);
  });

  it('returns 400 when contestId is missing', async () => {
    const res = await postInitiate(
      makeRequest('/api/open-mic/votes/pay/initiate', {
        body: { ...VALID_BODY, contestId: undefined },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 on a non-uuid contestId without touching the store', async () => {
    const res = await postInitiate(
      makeRequest('/api/open-mic/votes/pay/initiate', {
        body: { ...VALID_BODY, contestId: 'bogus' },
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/uuid/i);
    expect(vi.mocked(getContestById)).not.toHaveBeenCalled();
    expect(vi.mocked(createOpenMicVoteIntent)).not.toHaveBeenCalled();
  });

  it('returns 400 on a non-uuid submissionId without touching the store', async () => {
    const res = await postInitiate(
      makeRequest('/api/open-mic/votes/pay/initiate', {
        body: { ...VALID_BODY, submissionId: 'bogus' },
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/uuid/i);
    expect(vi.mocked(getContestById)).not.toHaveBeenCalled();
    expect(vi.mocked(createOpenMicVoteIntent)).not.toHaveBeenCalled();
  });

  it('returns 400 on fractional votes', async () => {
    const res = await postInitiate(
      makeRequest('/api/open-mic/votes/pay/initiate', {
        body: { ...VALID_BODY, votes: 1.5 },
      }),
    );
    expect(res.status).toBe(400);
    expect(vi.mocked(createOpenMicVoteIntent)).not.toHaveBeenCalled();
  });

  it('returns 400 on an unsafe-integer votes count', async () => {
    const res = await postInitiate(
      makeRequest('/api/open-mic/votes/pay/initiate', {
        body: { ...VALID_BODY, votes: Number.MAX_SAFE_INTEGER + 1 },
      }),
    );
    expect(res.status).toBe(400);
    expect(vi.mocked(createOpenMicVoteIntent)).not.toHaveBeenCalled();
  });

  it('mints an intent with the server-quoted amount on a valid request', async () => {
    const res = await postInitiate(
      makeRequest('/api/open-mic/votes/pay/initiate', { body: VALID_BODY }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.amountKobo).toBe(10 * 50 * 100); // votes × server-side votePrice
    expect(vi.mocked(createOpenMicVoteIntent)).toHaveBeenCalledWith(
      expect.objectContaining({
        contestId: VALID_BODY.contestId,
        submissionId: VALID_BODY.submissionId,
        votes: 10,
        amountKobo: 50_000,
      }),
    );
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(requireRequestUser).mockRejectedValue(new Error('UNAUTHORIZED'));
    const res = await postInitiate(
      makeRequest('/api/open-mic/votes/pay/initiate', { body: VALID_BODY }),
    );
    expect(res.status).toBe(401);
  });
});
