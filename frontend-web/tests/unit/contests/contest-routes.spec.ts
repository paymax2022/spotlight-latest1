import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression for two prod sweep findings on /api/v1/contests:
 *
 * 1. GET /categories filtered contests on status IN ('active','open','published').
 *    contests.status is the contest_status enum ('draft'|'active'|'upcoming'|'ended'
 *    — supabase/migrations/20260404210000_create_contests.sql), so PostgREST
 *    coerced the literals and Postgres rejected the query with
 *    `invalid input value for enum contest_status` → a consistent 500.
 *    The list route's ('active','upcoming') pair is the correct roster filter.
 *
 * 2. contestantCount counted `vote_totals` rows — a contestant with zero votes
 *    has no vote_totals row, so contests with full rosters reported 0. The
 *    roster lives in `contestants` (contest_id FK to contests); the count must
 *    come from there with the same 'approved'|'active' filter the
 *    /contests/[id]/contestants route serves, so the number matches the list.
 */

type QueryResult = {
  data?: unknown[] | null;
  error?: unknown;
  count?: number | null;
  single?: unknown;
};

type RecordedQuery = {
  calls: { select: unknown[][]; in: [string, unknown][]; eq: [string, unknown][] };
};

function makeQuery(result: QueryResult): RecordedQuery & Record<string, unknown> {
  const calls: RecordedQuery['calls'] = { select: [], in: [], eq: [] };
  const q: Record<string, unknown> & { calls: RecordedQuery['calls'] } = {
    calls,
    select: (...args: unknown[]) => {
      calls.select.push(args);
      return q;
    },
    in: (col: string, vals: unknown) => {
      calls.in.push([col, vals]);
      return q;
    },
    eq: (col: string, val: unknown) => {
      calls.eq.push([col, val]);
      return q;
    },
    not: () => q,
    ilike: () => q,
    or: () => q,
    order: () => q,
    maybeSingle: async () => ({ data: result.single ?? null, error: result.error ?? null }),
    // supabase-js query builders are thenable — mirror that so `await` resolves.
    then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
      return Promise.resolve({
        data: result.data ?? null,
        error: result.error ?? null,
        count: result.count ?? null,
      }).then(onFulfilled, onRejected);
    },
  };
  return q;
}

// Per-table queue of canned results; each from() shifts one.
let tableResults: Record<string, QueryResult[]>;
let recorded: Record<string, RecordedQuery[]>;

const supabase = {
  from(table: string) {
    const queue = tableResults[table] ?? [];
    const result = queue.length > 1 ? queue.shift()! : queue[0] ?? {};
    const q = makeQuery(result);
    (recorded[table] ??= []).push(q);
    return q;
  },
};

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => supabase,
  createClient: async () => supabase,
}));

vi.mock('@/src/server/voting/free-vote.service', () => ({
  getRemainingFreeVotes: vi.fn(async () => ({ freeVotesRemaining: 0 })),
}));

vi.mock('@/src/server/voting/visibility.service', () => ({
  getEffectiveVisibility: vi.fn(async () => ({
    showVoteCount: true,
    showLeaderboard: true,
    showRank: true,
    activePhaseKey: null,
    activePhaseLabel: null,
  })),
}));

import { GET as getCategories } from '../../../app/api/v1/contests/categories/route';
import { GET as listContests } from '../../../app/api/v1/contests/route';
import { GET as getContest } from '../../../app/api/v1/contests/[id]/route';

const CONTEST_A = '11111111-1111-4111-8111-111111111111';
const CONTEST_B = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  tableResults = {};
  recorded = {};
});

describe('GET /api/v1/contests/categories', () => {
  it('filters on the real contest_status enum values, not connect_contests literals', async () => {
    tableResults.contests = [{ data: [{ category: 'Music' }, { category: 'Music' }, { category: 'Film' }] }];

    const res = await getCategories();
    const body = await res.json();

    expect(res.status).toBe(200);
    const inCalls = recorded.contests[0].calls.in;
    const statusFilter = inCalls.find(([col]) => col === 'status');
    expect(statusFilter?.[1]).toEqual(['active', 'upcoming']);
    expect(body.find((c: { id: string }) => c.id === 'music').activeContestCount).toBe(2);
  });
});

describe('GET /api/v1/contests', () => {
  it('counts contestants rows for contestantCount, not vote_totals rows', async () => {
    tableResults.contests = [
      {
        data: [
          { id: CONTEST_A, name: 'A', category: 'Music', status: 'active', start_date: null, end_date: null },
          { id: CONTEST_B, name: 'B', category: 'Film', status: 'active', start_date: null, end_date: null },
        ],
      },
    ];
    tableResults.voting_settings = [{ data: [] }];
    // No votes cast yet — the bug returned contestantCount 0 for both contests.
    tableResults.vote_totals = [{ data: [] }];
    tableResults.contestants = [
      {
        data: [
          { contest_id: CONTEST_A },
          { contest_id: CONTEST_A },
          { contest_id: CONTEST_A },
          { contest_id: CONTEST_B },
        ],
      },
    ];

    const res = await listContests(new Request('http://localhost/api/v1/contests'));
    const body = await res.json();

    expect(res.status).toBe(200);
    const contestQuery = recorded.contests[0];
    expect(contestQuery.calls.in.find(([col]) => col === 'status')?.[1]).toEqual(['active', 'upcoming']);

    // Roster count uses contestants.contest_id with the roster status filter.
    const rosterQuery = recorded.contestants[0];
    expect(rosterQuery.calls.in.find(([col]) => col === 'contest_id')?.[1]).toEqual([CONTEST_A, CONTEST_B]);
    expect(rosterQuery.calls.in.find(([col]) => col === 'status')?.[1]).toEqual(['approved', 'active']);

    const byId = new Map(body.map((c: { id: string }) => [c.id, c]));
    expect((byId.get(CONTEST_A) as { contestantCount: number }).contestantCount).toBe(3);
    expect((byId.get(CONTEST_B) as { contestantCount: number }).contestantCount).toBe(1);
  });

  it('serves the prize and closes voting on the stored end date', async () => {
    // The admin console can now write contests.prize_pool and end_date, and this
    // is the surface the web voting page reads. Two behaviours matter here:
    //  - the prize must reach the client, or the field is set-and-never-seen;
    //  - endsAt prefers voting_ends_at but falls back to end_date, so a contest
    //    whose deadline has passed must report isLive:false instead of the
    //    rolling "ends tomorrow" the null case fabricates.
    tableResults.contests = [
      {
        data: [
          {
            id: CONTEST_A, name: 'A', category: 'Music', status: 'active',
            start_date: '2026-12-01T00:00:00.000Z', end_date: '2026-12-24T23:59:59.999Z',
            prize_pool: '₦500,000 + a management deal',
          },
          {
            id: CONTEST_B, name: 'B', category: 'Film', status: 'active',
            start_date: null, end_date: '2020-01-01T00:00:00.000Z', prize_pool: '',
          },
        ],
      },
    ];
    tableResults.voting_settings = [{
      data: [
        { contest_id: CONTEST_A, voting_enabled: true, voting_ends_at: null },
        // B is enabled too, so the only thing that can make it not-live is the
        // stored deadline — the flag is not doing the work.
        { contest_id: CONTEST_B, voting_enabled: true, voting_ends_at: null },
      ],
    }];
    tableResults.vote_totals = [{ data: [] }];
    tableResults.contestants = [{ data: [{ contest_id: CONTEST_A }] }];

    const res = await listContests(new Request('http://localhost/api/v1/contests'));
    const body = (await res.json()) as Array<Record<string, unknown>>;
    const byId = new Map(body.map((c) => [c.id as string, c]));

    // The fake builder hands back the canned rows whatever the projection says, so
    // without this assert a column missing from .select() would pass every check
    // below — and in production PostgREST returns only projected columns, so
    // prize_pool absent means the prize is '' forever with no error anywhere.
    const projection = String(recorded.contests[0].calls.select[0][0]);
    expect(projection).toContain('prize_pool');
    expect(projection).toContain('end_date');

    expect(byId.get(CONTEST_A)?.prize).toBe('₦500,000 + a management deal');
    expect(byId.get(CONTEST_A)?.endsAt).toBe('2026-12-24T23:59:59.999Z');
    expect(byId.get(CONTEST_A)?.isLive).toBe(true);
    // Past deadline, voting enabled: closed, and not the fabricated fallback.
    expect(byId.get(CONTEST_B)?.isLive).toBe(false);
    expect(byId.get(CONTEST_B)?.endsAt).toBe('2020-01-01T00:00:00.000Z');
    expect(byId.get(CONTEST_B)?.prize).toBe('');
  });
});

describe('GET /api/v1/contests/[id]', () => {
  it('returns the contestants roster count even when no votes exist', async () => {
    tableResults.contests = [
      {
        single: {
          id: CONTEST_A,
          name: 'A',
          description: '',
          rules: '',
          prize_pool: '',
          category: 'Music',
          status: 'active',
          start_date: null,
          end_date: null,
          max_contestants: 0,
        },
      },
    ];
    tableResults.voting_settings = [{ single: null }];
    tableResults.vote_totals = [{ data: [] }];
    tableResults.contestants = [{ count: 7, data: null }];

    const res = await getContest(new Request('http://localhost/api/v1/contests/' + CONTEST_A), {
      params: Promise.resolve({ id: CONTEST_A }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    const rosterQuery = recorded.contestants[0];
    expect(rosterQuery.calls.eq.find(([col]) => col === 'contest_id')?.[1]).toBe(CONTEST_A);
    expect(rosterQuery.calls.in.find(([col]) => col === 'status')?.[1]).toEqual(['approved', 'active']);
    expect(body.data?.contestantCount ?? body.contestantCount).toBe(7);
  });
});
