/**
 * AD-011/VI-010 — POST .../rounds/[roundId]/publish-results.
 *
 * UAT Batch 8 (SEC-005/G-MC): this route no longer computes/publishes
 * directly — it only PROPOSES a contest_admin_approvals row (dual control).
 * The already-published guard (409) still runs HERE, before proposing (per
 * the scope decision: no point proposing to publish an already-locked
 * round). The compute/publish/prize-mapping/audit-logging behavior that used
 * to be asserted here now lives in executeResultsPublish and is covered by
 * sensitive-actions-service.test.ts, since that's where it actually runs
 * (at approve time).
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
import { ApiError } from '@/src/lib/api/responses';
import { chainableInsert } from '../golden-path/_fixtures';

function ctx(roundId = 'round-1') {
  return { params: Promise.resolve({ roundId }) };
}

function req(method = 'POST') {
  return new Request('https://x.test/api/admin/voting/rounds/round-1/publish-results', { method });
}

function makeSupabase(opts: { round?: any; insertedApproval?: any; insertError?: any }) {
  const insertCalls: any[] = [];

  function roundsChain() {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve({ data: opts.round ?? null, error: null }),
    };
    return chain;
  }

  function approvalsChain() {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve({ data: null, error: null }), // no idempotency key in these tests
      insert: (row: any) => {
        insertCalls.push(row);
        return chainableInsert(opts.insertedApproval ?? { id: 'approval-1', status: 'pending_approval' }, opts.insertError ?? null);
      },
    };
    return chain;
  }

  const client: any = {
    from: (table: string) => {
      if (table === 'voting_rounds') return roundsChain();
      if (table === 'contest_admin_approvals') return approvalsChain();
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return { client, insertCalls };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertAdminPermission).mockResolvedValue({ actorId: 'admin-1', role: 'super_admin' } as any);
});

describe('AD-011/VI-010: publish-results (propose-only)', () => {
  it('rejects when the caller lacks votes:sensitive:initiate, before touching anything', async () => {
    vi.mocked(assertAdminPermission).mockRejectedValueOnce(new ApiError('Forbidden', 403));
    const res = await publishPOST(req(), ctx());
    expect(res.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('404s when the round does not exist', async () => {
    const { client } = makeSupabase({ round: null });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await publishPOST(req(), ctx());
    expect(res.status).toBe(404);
  });

  it('409s on an already-published round, before proposing anything', async () => {
    const { client, insertCalls } = makeSupabase({
      round: { id: 'round-1', contest_id: 'contest-1', status: 'results_published' },
    });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await publishPOST(req(), ctx());
    expect(res.status).toBe(409);
    expect(insertCalls).toHaveLength(0);
    expect(bridgedRecomputeRanksForResults).not.toHaveBeenCalled();
  });

  it('happy path: proposes (202) a results_publish approval carrying the roundId, without computing/publishing anything yet', async () => {
    const round = { id: 'round-1', contest_id: 'contest-1', status: 'active', name: 'Finale' };
    const { client, insertCalls } = makeSupabase({
      round,
      insertedApproval: { id: 'approval-9', status: 'pending_approval' },
    });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await publishPOST(req(), ctx());
    expect(res.status).toBe(202);

    // Nothing computed or published at propose time.
    expect(bridgedRecomputeRanksForResults).not.toHaveBeenCalled();

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toMatchObject({
      action_type: 'results_publish',
      contest_id: 'contest-1',
      payload: { roundId: 'round-1' },
      initiator_id: 'admin-1',
      initiator_role: 'super_admin',
    });

    const body = await res.json();
    expect(body.approvalId).toBe('approval-9');
    expect(body.status).toBe('pending_approval');
  });
});
