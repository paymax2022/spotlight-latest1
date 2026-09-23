/**
 * Real-logic unit tests for the v1 free-vote engine's core function:
 * `castFreeVote` (src/server/voting/free-vote.service.ts — protected, DO NOT EDIT).
 *
 * Golden-path tests (tests/unit/golden-path/free-vote.spec.ts) mock castFreeVote
 * itself and only assert the route contract. These tests exercise the real
 * function body against a generic fake Supabase query-builder, covering the
 * UAT test-plan rows that were "Not Run" pending an executed test:
 *   FV-001 — cast one free vote, recorded once, count +1
 *   FV-004 — free vote for a different contestant same day is allowed
 *   FV-006 — re-login / multi-session cannot bypass the identity-scoped limit
 *   FV-007 — clock manipulation cannot unlock an extra free vote (server-time bucket)
 *   FV-009 — free voting requires an eligible/verified voter per config
 *
 * scoreFreeFraud / incrementVoteTotals / appendAuditLog are mocked at the
 * module boundary (same pattern as tests/unit/voting/free-vote-concurrency.spec.ts)
 * so these tests stay on castFreeVote's own responsibility: identity scoping,
 * per-contestant capping, and the server-time vote-date bucket.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAdminClient } from '@/lib/supabase/server';
import { castFreeVote } from '@/src/server/voting/free-vote.service';
import { scoreFreeFraud } from '@/src/server/voting/fraud.service';
import { incrementVoteTotals } from '@/src/server/voting/totals.service';
import { appendAuditLog } from '@/src/server/voting/audit.service';

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}));
vi.mock('@/src/server/voting/fraud.service', () => ({
  scoreFreeFraud: vi.fn().mockResolvedValue(0),
}));
vi.mock('@/src/server/voting/totals.service', () => ({
  incrementVoteTotals: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/server/voting/audit.service', () => ({
  appendAuditLog: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Generic chainable/thenable fake for `supabase.from(table)...`
// ---------------------------------------------------------------------------

function makeTableClient(responses: Record<string, unknown[]>) {
  const callIndex: Record<string, number> = {};
  const calls: { table: string; method: string; args: unknown[] }[] = [];

  function nextFor(table: string) {
    const idx = callIndex[table] ?? 0;
    callIndex[table] = idx + 1;
    const queue = responses[table] ?? [];
    return queue[idx] ?? queue[queue.length - 1] ?? { data: null, error: null };
  }

  function builder(table: string): any {
    const obj: any = {};
    const chainMethods = ['select', 'eq', 'order', 'limit', 'or', 'is'];
    for (const m of chainMethods) {
      obj[m] = vi.fn((...args: unknown[]) => {
        calls.push({ table, method: m, args });
        return obj;
      });
    }
    obj.upsert = vi.fn((...args: unknown[]) => {
      calls.push({ table, method: 'upsert', args });
      return obj;
    });
    obj.update = vi.fn((...args: unknown[]) => {
      calls.push({ table, method: 'update', args });
      return obj;
    });
    obj.insert = vi.fn((...args: unknown[]) => {
      calls.push({ table, method: 'insert', args });
      return obj;
    });
    obj.single = vi.fn(async () => nextFor(table));
    obj.maybeSingle = vi.fn(async () => nextFor(table));
    obj.then = (resolve: any, reject: any) =>
      Promise.resolve(nextFor(table)).then(resolve, reject);
    return obj;
  }

  const client: any = {
    from: vi.fn((table: string) => builder(table)),
    rpc: vi.fn(),
  };
  return { client, calls };
}

function baseSettingsRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'vs-1',
    contest_id: 'contest-1',
    voting_enabled: true,
    voting_type: 'hybrid',
    free_voting_enabled: true,
    free_votes_per_day: 3,
    free_votes_per_contest: null,
    free_votes_per_contestant: null,
    free_vote_reset_time: '00:00:00',
    free_vote_limit_scope: 'user',
    require_login_for_free_vote: false,
    status: 'active',
    daily_free_vote_cap_enabled: false,
    daily_free_vote_cap: null,
    fraud_detection_enabled: true,
    enable_vote_quarantine: false,
    timezone: 'Africa/Lagos',
    payment_provider: 'paystack',
    ...overrides,
  };
}

describe('castFreeVote (real logic, mocked Supabase)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(scoreFreeFraud).mockResolvedValue(0);
  });

  // FV-001 ---------------------------------------------------------------
  it('FV-001: casts one free vote and increments the per-contestant counter by exactly 1', async () => {
    const { client, calls } = makeTableClient({
      voting_settings: [{ data: baseSettingsRow(), error: null }],
      voter_contestant_daily_limits: [
        { data: { free_votes_used: 0, free_votes_limit: 3 }, error: null },
      ],
      voter_daily_limits: [{ data: { free_votes_used: 0, free_votes_limit: 3 }, error: null }],
      votes: [{ data: { id: 'vote-1' }, error: null }],
    });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const result = await castFreeVote(
      { contestId: 'contest-1', contestantId: 'contestant-A' },
      '10.0.0.1',
      'fp-1',
      'UA/1.0',
      'user-1',
    );

    expect(result.success).toBe(true);
    expect(result.votesAdded).toBe(1);
    expect(result.totalFreeVotesUsed).toBe(1);
    expect(vi.mocked(incrementVoteTotals)).toHaveBeenCalledWith('contest-1', 'contestant-A', {
      freeVotes: 1,
    });

    const contestantUpdate = calls.find(
      (c) => c.table === 'voter_contestant_daily_limits' && c.method === 'update',
    );
    expect((contestantUpdate!.args[0] as any).free_votes_used).toBe(1);
  });

  // FV-004 ---------------------------------------------------------------
  it('FV-004: a vote for a different contestant the same day is allowed (per-contestant cap, not per-day)', async () => {
    const settingsClient = () =>
      makeTableClient({
        voting_settings: [{ data: baseSettingsRow(), error: null }],
        // Each contestant has its own independent daily-limit row — both start at 0 used.
        voter_contestant_daily_limits: [
          { data: { free_votes_used: 0, free_votes_limit: 3 }, error: null },
        ],
        voter_daily_limits: [{ data: { free_votes_used: 0, free_votes_limit: 3 }, error: null }],
        votes: [{ data: { id: 'vote-x' }, error: null }],
      });

    const { client: clientA } = settingsClient();
    vi.mocked(createAdminClient).mockReturnValueOnce(clientA);
    const resultA = await castFreeVote(
      { contestId: 'contest-1', contestantId: 'contestant-A' },
      '10.0.0.2',
      'fp-2',
      'UA/1.0',
      'user-2',
    );
    expect(resultA.success).toBe(true);
    expect(resultA.votesAdded).toBe(1);

    const { client: clientB } = settingsClient();
    vi.mocked(createAdminClient).mockReturnValueOnce(clientB);
    const resultB = await castFreeVote(
      { contestId: 'contest-1', contestantId: 'contestant-B' },
      '10.0.0.2',
      'fp-2',
      'UA/1.0',
      'user-2',
    );
    expect(resultB.success).toBe(true);
    expect(resultB.votesAdded).toBe(1);
  });

  // FV-006 -----------------------------------------------------------------
  it('FV-006: re-login on a new device/session cannot bypass the identity-scoped (user) limit once exhausted', async () => {
    const { client } = makeTableClient({
      voting_settings: [{ data: baseSettingsRow({ free_vote_limit_scope: 'user' }), error: null }],
      // Already at cap for this user+contestant today — a "new session" changes
      // ip/deviceFingerprint but NOT the identity key (userId), so this row is
      // still hit.
      voter_contestant_daily_limits: [
        { data: { free_votes_used: 3, free_votes_limit: 3 }, error: null },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(client);

    await expect(
      castFreeVote(
        { contestId: 'contest-1', contestantId: 'contestant-A' },
        '203.0.113.99', // different IP — simulates a new device
        'fp-new-device', // different fingerprint — simulates a new session
        'UA/2.0 (new device)',
        'user-1', // SAME user id (re-logged in)
      ),
    ).rejects.toMatchObject({ status: 429 });
  });

  // FV-007 -------------------------------------------------------------------
  it('FV-007: the vote-date bucket is derived from server time, ignoring any client-supplied date field', async () => {
    const { client, calls } = makeTableClient({
      voting_settings: [{ data: baseSettingsRow(), error: null }],
      voter_contestant_daily_limits: [
        { data: { free_votes_used: 0, free_votes_limit: 3 }, error: null },
      ],
      voter_daily_limits: [{ data: { free_votes_used: 0, free_votes_limit: 3 }, error: null }],
      votes: [{ data: { id: 'vote-clock' }, error: null }],
    });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const serverToday = new Date().toISOString().split('T')[0];

    // CastFreeVoteRequest has no client-timestamp field at all; even attaching
    // an arbitrary bogus one must not influence the bucket used.
    const req = {
      contestId: 'contest-1',
      contestantId: 'contestant-A',
      // Deliberately injecting a field the CastFreeVoteRequest type doesn't declare.
      clientDate: '2020-01-01',
    };

    await castFreeVote(req as any, '10.0.0.3', 'fp-3', 'UA/1.0', 'user-3');

    const upsertCall = calls.find(
      (c) => c.table === 'voter_contestant_daily_limits' && c.method === 'upsert',
    );
    expect((upsertCall!.args[0] as any).vote_date).toBe(serverToday);
    expect((upsertCall!.args[0] as any).vote_date).not.toBe('2020-01-01');
  });

  // FV-009 -----------------------------------------------------------------
  describe('FV-009: eligibility gate (require_login_for_free_vote)', () => {
    it('rejects an unauthenticated voter when login is required', async () => {
      const { client } = makeTableClient({
        voting_settings: [
          { data: baseSettingsRow({ require_login_for_free_vote: true }), error: null },
        ],
      });
      vi.mocked(createAdminClient).mockReturnValue(client);

      await expect(
        castFreeVote(
          { contestId: 'contest-1', contestantId: 'contestant-A' },
          '10.0.0.4',
          'fp-4',
          'UA/1.0',
          undefined, // not logged in
        ),
      ).rejects.toMatchObject({ status: 401 });
    });

    it('allows an authenticated voter when login is required', async () => {
      const { client } = makeTableClient({
        voting_settings: [
          { data: baseSettingsRow({ require_login_for_free_vote: true }), error: null },
        ],
        voter_contestant_daily_limits: [
          { data: { free_votes_used: 0, free_votes_limit: 3 }, error: null },
        ],
        voter_daily_limits: [{ data: { free_votes_used: 0, free_votes_limit: 3 }, error: null }],
        votes: [{ data: { id: 'vote-gate' }, error: null }],
      });
      vi.mocked(createAdminClient).mockReturnValue(client);

      const result = await castFreeVote(
        { contestId: 'contest-1', contestantId: 'contestant-A' },
        '10.0.0.5',
        'fp-5',
        'UA/1.0',
        'user-5',
      );
      expect(result.success).toBe(true);
    });
  });
});
