/**
 * AD-011/VI-010 — POST .../rounds/[roundId]/publish-results.
 *
 * bridgedRecomputeRanksForResults and appendAuditLog are mocked at their
 * module boundary (both are separately unit-tested: leaderboard-ranks-bridge.spec.ts
 * for the tie-break bridge, existing suites for audit.service) — this file
 * asserts the route's own contract: already-published guard (no recompute
 * attempted), prize mapping by rank, and audit logging on success.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/server/admin/auth', () => ({ assertAdminPermission: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/src/server/voting-bridge/leaderboard-ranks', () => ({ bridgedRecomputeRanksForResults: vi.fn() }));
vi.mock('@/src/server/voting/audit.service', () => ({ appendAuditLog: vi.fn() }));

import { POST as publishPOST } from '@/app/api/admin/voting/rounds/[roundId]/publish-results/route';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { bridgedRecomputeRanksForResults } from '@/src/server/voting-bridge/leaderboard-ranks';
import { appendAuditLog } from '@/src/server/voting/audit.service';
import { ApiError } from '@/src/lib/api/responses';

function ctx(roundId = 'round-1') {
  return { params: Promise.resolve({ roundId }) };
}

function req(method = 'POST') {
  return new Request('https://x.test/api/admin/voting/rounds/round-1/publish-results', { method });
}

function makeSupabase(opts: {
  round?: any;
  prizeRows?: any[];
  insertedRows?: any[];
  rpcError?: any;
  contestantRows?: any[];
}) {
  const calls: any = {};

  function roundsChain() {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve({ data: opts.round ?? null, error: null }),
    };
    return chain;
  }

  function prizesChain() {
    const chain: any = {
      select: () => chain,
      eq: () => Promise.resolve({ data: opts.prizeRows ?? [], error: null }),
    };
    return chain;
  }

  function contestantsChain() {
    const chain: any = {
      select: () => chain,
      in: () => Promise.resolve({ data: opts.contestantRows ?? [], error: null }),
    };
    return chain;
  }

  const rpc = vi.fn().mockImplementation((name: string, args: any) => {
    calls.rpcName = name;
    calls.rpcArgs = args;
    if (opts.rpcError) return Promise.resolve({ data: null, error: opts.rpcError });
    return Promise.resolve({ data: opts.insertedRows ?? [], error: null });
  });

  const client: any = {
    from: (table: string) => {
      if (table === 'voting_rounds') return roundsChain();
      if (table === 'voting_contest_prizes') return prizesChain();
      if (table === 'contestants') return contestantsChain();
      throw new Error(`Unexpected table: ${table}`);
    },
    rpc,
  };

  return { client, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertAdminPermission).mockResolvedValue({ actorId: 'admin-1', role: 'super_admin' } as any);
});

describe('AD-011/VI-010: publish-results', () => {
  it('rejects when the caller lacks votes:manage, before touching anything', async () => {
    vi.mocked(assertAdminPermission).mockRejectedValueOnce(new ApiError('Forbidden', 403));
    const res = await publishPOST(req(), ctx());
    expect(res.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(bridgedRecomputeRanksForResults).not.toHaveBeenCalled();
  });

  it('404s when the round does not exist', async () => {
    const { client } = makeSupabase({ round: null });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await publishPOST(req(), ctx());
    expect(res.status).toBe(404);
  });

  it('409s on an already-published round and never attempts recompute', async () => {
    const { client } = makeSupabase({ round: { id: 'round-1', contest_id: 'contest-1', status: 'results_published' } });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await publishPOST(req(), ctx());
    expect(res.status).toBe(409);
    expect(bridgedRecomputeRanksForResults).not.toHaveBeenCalled();
  });

  it('400s when there is no leaderboard data to publish', async () => {
    const { client } = makeSupabase({ round: { id: 'round-1', contest_id: 'contest-1', status: 'active' } });
    vi.mocked(createAdminClient).mockReturnValue(client);
    vi.mocked(bridgedRecomputeRanksForResults).mockResolvedValue([]);

    const res = await publishPOST(req(), ctx());
    expect(res.status).toBe(400);
  });

  it('happy path: inserts results, maps prizes by rank, logs audit, returns tieBreakRule', async () => {
    const round = { id: 'round-1', contest_id: 'contest-1', status: 'active', name: 'Finale' };
    const prizeRows = [
      { id: 'prize-1', position: 1 },
      { id: 'prize-2', position: 2 },
    ];
    const ranks = [
      { contestantId: 'enr-A', rank: 1, totalConfirmedVotes: 100, paidVotes: 60 },
      { contestantId: 'enr-B', rank: 2, totalConfirmedVotes: 80, paidVotes: 20 },
      { contestantId: 'enr-C', rank: 3, totalConfirmedVotes: 10, paidVotes: 0 },
    ];
    const insertedRows = [
      { contestant_id: 'enr-A', rank: 1, total_confirmed_votes: 100, paid_votes: 60, prize_id: 'prize-1' },
      { contestant_id: 'enr-B', rank: 2, total_confirmed_votes: 80, paid_votes: 20, prize_id: 'prize-2' },
      { contestant_id: 'enr-C', rank: 3, total_confirmed_votes: 10, paid_votes: 0, prize_id: null },
    ];

    const contestantRows = [
      { id: 'enr-A', name: 'Contestant A' },
      { id: 'enr-B', name: 'Contestant B' },
      { id: 'enr-C', name: 'Contestant C' },
    ];
    const { client, calls } = makeSupabase({ round, prizeRows, insertedRows, contestantRows });
    vi.mocked(createAdminClient).mockReturnValue(client);
    vi.mocked(bridgedRecomputeRanksForResults).mockResolvedValue(ranks);

    const res = await publishPOST(req(), ctx());
    expect(res.status).toBe(200);

    // rank-3 contestant has no configured prize position -> prizeId null, no error.
    expect(calls.rpcName).toBe('publish_voting_round_results');
    expect(calls.rpcArgs.p_results).toEqual([
      { contestant_id: 'enr-A', rank: 1, total_confirmed_votes: 100, paid_votes: 60, prize_id: 'prize-1' },
      { contestant_id: 'enr-B', rank: 2, total_confirmed_votes: 80, paid_votes: 20, prize_id: 'prize-2' },
      { contestant_id: 'enr-C', rank: 3, total_confirmed_votes: 10, paid_votes: 0, prize_id: null },
    ]);

    const body = await res.json();
    expect(body.tieBreakRule).toBe('total_confirmed_votes DESC, paid_votes DESC, last_vote_at ASC');
    expect(body.results).toHaveLength(3);
    expect(body.results[2].prizeId).toBeNull();
    expect(body.results[0].contestantName).toBe('Contestant A');

    expect(appendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'voting_round_results_locked',
        entityType: 'voting_round',
        entityId: 'round-1',
        contestId: 'contest-1',
        newValue: expect.objectContaining({ contestantCount: 3, topContestantId: 'enr-A' }),
      }),
    );
  });

  it('maps a race-condition already-published RPC error to 409', async () => {
    const round = { id: 'round-1', contest_id: 'contest-1', status: 'active' };
    const { client } = makeSupabase({
      round,
      prizeRows: [],
      rpcError: { message: 'voting_round_already_published' },
    });
    vi.mocked(createAdminClient).mockReturnValue(client);
    vi.mocked(bridgedRecomputeRanksForResults).mockResolvedValue([
      { contestantId: 'enr-A', rank: 1, totalConfirmedVotes: 5, paidVotes: 0 },
    ]);

    const res = await publishPOST(req(), ctx());
    expect(res.status).toBe(409);
  });
});
