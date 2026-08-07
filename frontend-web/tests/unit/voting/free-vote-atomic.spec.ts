/**
 * D-001/D-002/D-003 orchestration test for the voting-bridge atomic free-vote.
 *
 * The atomic claim (cap arithmetic, no double-count under concurrency, NULL-round
 * totals dedup) is proven directly against Postgres via the claim_free_vote
 * migration. THIS suite pins the TypeScript wiring around it:
 *   - the timezone-correct vote_date (D-001) is what gets passed to the RPC,
 *   - cap-exhausted (granted=0) surfaces as a 429, not a silent success,
 *   - a granted claim maps to the stable CastFreeVoteResponse shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/server/voting/free-vote.service', () => ({
  getVotingSettings: vi.fn(),
  assertVotingOpen: vi.fn(),
}));
vi.mock('@/src/server/voting/fraud.service', () => ({ scoreFreeFraud: vi.fn() }));
vi.mock('@/src/server/voting/audit.service', () => ({ appendAuditLog: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { castFreeVoteAtomic } from '@/src/server/voting-bridge/free-vote-atomic';
import { getVotingSettings, assertVotingOpen } from '@/src/server/voting/free-vote.service';
import { scoreFreeFraud } from '@/src/server/voting/fraud.service';
import { createAdminClient } from '@/lib/supabase/server';

function settings(overrides: Record<string, unknown> = {}) {
  return {
    contestId: 'contest-1',
    votingEnabled: true,
    freeVotingEnabled: true,
    requireLoginForFreeVote: false,
    freeVoteLimitScope: 'ip',
    freeVotesPerDay: 3,
    freeVotesPerContestant: null,
    freeVoteResetTime: '00:00',
    timezone: 'Africa/Lagos',
    enableVoteQuarantine: false,
    ...overrides,
  };
}

/** rpc mock returns the [{granted,total_used,cap,vote_id,vote_status}] row shape. */
function primeRpc(row: Record<string, unknown>) {
  const rpc = vi.fn().mockResolvedValue({ data: [row], error: null });
  vi.mocked(createAdminClient).mockReturnValue({ rpc } as any);
  return rpc;
}

const req = { contestId: 'contest-1', contestantId: 'enr-1', voteQuantity: 1 };

describe('castFreeVoteAtomic — bridge orchestration (D-001/D-002/D-003)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getVotingSettings).mockResolvedValue(settings() as any);
    vi.mocked(assertVotingOpen).mockReturnValue(undefined as any);
    vi.mocked(scoreFreeFraud).mockResolvedValue(0 as any);
  });

  it('passes the CONTEST-TIMEZONE day bucket to claim_free_vote (D-001)', async () => {
    const rpc = primeRpc({ granted: 1, total_used: 1, cap: 3, vote_id: 'v-1', vote_status: 'confirmed' });

    // 23:30 UTC on Jul 30 → 00:30 Jul 31 in Africa/Lagos → bucket must be 2026-07-31.
    const fixedNow = new Date('2026-07-30T23:30:00Z');
    await castFreeVoteAtomic(req as any, '1.2.3.4', 'dev', 'ua', undefined, fixedNow);

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fnName, args] = rpc.mock.calls[0];
    expect(fnName).toBe('claim_free_vote');
    expect(args.p_vote_date).toBe('2026-07-31'); // NOT the UTC 2026-07-30
    expect(args.p_cap).toBe(3);
    expect(args.p_qty).toBe(1);
  });

  it('maps a granted claim to the CastFreeVoteResponse shape', async () => {
    primeRpc({ granted: 1, total_used: 1, cap: 3, vote_id: 'v-1', vote_status: 'confirmed' });

    const res = await castFreeVoteAtomic(req as any, '1.2.3.4', 'dev', 'ua', undefined, new Date('2026-07-30T23:30:00Z'));

    expect(res.success).toBe(true);
    expect(res.votesAdded).toBe(1);
    expect(res.totalFreeVotesUsed).toBe(1);
    expect(res.freeVotesRemaining).toBe(2);
    expect(res.fraudStatus).toBe('clean');
    expect(res.contestantId).toBe('enr-1');
    expect(res.resetAt).toBe('2026-07-31T23:00:00.000Z'); // next local midnight (Lagos)
  });

  it('surfaces cap-exhausted (granted=0) as a 429, not a silent success', async () => {
    primeRpc({ granted: 0, total_used: 3, cap: 3, vote_id: null, vote_status: null });

    const { ApiError } = await import('@/src/lib/api/responses');
    await expect(
      castFreeVoteAtomic(req as any, '1.2.3.4', 'dev', 'ua', undefined, new Date('2026-07-30T23:30:00Z')),
    ).rejects.toMatchObject({ status: 429 });
    void ApiError;
  });

  it('requires login when the contest configures it', async () => {
    vi.mocked(getVotingSettings).mockResolvedValue(settings({ requireLoginForFreeVote: true }) as any);
    primeRpc({ granted: 1, total_used: 1, cap: 3, vote_id: 'v-1', vote_status: 'confirmed' });

    await expect(
      castFreeVoteAtomic(req as any, '1.2.3.4', 'dev', 'ua', undefined, new Date('2026-07-30T23:30:00Z')),
    ).rejects.toMatchObject({ status: 401 });
  });
});
