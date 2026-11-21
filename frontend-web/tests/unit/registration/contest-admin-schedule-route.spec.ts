// The admin contest routes must accept, validate and persist a contest's
// schedule and prize — "start and end and price to be won" in the operator's
// words.
//
// Before this, the two write routes only ever handled the fields the old form
// had. The dates and the prize existed as columns on public.contests (the web
// detail API reads prize_pool, and 20261223000000 mirrors start_date/end_date
// into connect_contests.opens_at/closes_at, which is the window mobile's
// getVotingWindow enforces) but nothing in the admin surface could put a value
// in them. A contest was therefore permanently open-ended, and the prize shown
// on its page was always empty.
//
// These tests exercise the route handlers themselves with the store boundary
// mocked — the payload handed to persistContestDefinition/updateContestDefinition
// is the only thing that can reach a column, and the 400s are what the console
// surfaces instead of silently saving a nonsense window. Pattern follows
// tests/unit/registration/vote-packages-crud.spec.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/src/server/admin/auth', () => ({ assertAdminPermission: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/src/server/registration-v2/publish-to-voting', () => ({
  publishContestToVotingPlane: vi.fn(async () => ({ published: true })),
}));
vi.mock('@/src/server/contests/categories', () => ({
  allowedCategorySlugs: async () => ['music', 'other', 'rising_star'],
  resolveCategoryLabel: async () => null,
}));
vi.mock('@/src/server/registration/store', () => ({
  createRegistrationContest: (input: Record<string, unknown>) => input,
  updateRegistrationContest: vi.fn(() => null),
  deleteRegistrationContest: vi.fn(),
  listRegistrationContests: () => [],
}));
vi.mock('@/src/server/registration-v2/contest-store', () => ({
  persistContestDefinition: vi.fn(async (def: Record<string, unknown>) => {
    persisted.push(def);
    return { id: 'contest-1' };
  }),
  updateContestDefinition: vi.fn(async (_slug: string, def: Record<string, unknown>) => {
    updated.push(def);
  }),
  deleteContestDefinition: vi.fn(),
  contestSlugExists: async () => false,
  getPersistedContestBySlug: vi.fn(async () => null),
  listPersistedContests: async () => [],
}));

const persisted: Array<Record<string, unknown>> = [];
const updated: Array<Record<string, unknown>> = [];

import { POST } from '@/app/api/admin/contests/route';
import { PATCH } from '@/app/api/admin/contests/[slug]/route';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { getPersistedContestBySlug } from '@/src/server/registration-v2/contest-store';

const base = {
  title: 'Rising Star 2026',
  slug: 'rising-star-2026',
  contestCategory: 'rising_star',
  contestType: 'public_voting_contest',
  seasonOrEdition: 'Season 1',
  regionScope: 'national',
  supportsVoting: true,
};

function post(body: Record<string, unknown>) {
  return new Request('https://x.test/api/admin/contests', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function patch(body: Record<string, unknown>) {
  return new Request('https://x.test/api/admin/contests/rising-star-2026', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

// Next 15 hands route handlers a params promise; the slug is fixed here because
// every PATCH case edits the same contest.
// PATCH's contract is a full definition (title, category, type and season are all
// required), so the schedule cases send the same complete body the console sends
// and vary only the schedule keys.
function patchReq(body: Record<string, unknown>) {
  return PATCH(patch({ ...base, ...body }), { params: Promise.resolve({ slug: 'rising-star-2026' }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  persisted.length = 0;
  updated.length = 0;
  vi.mocked(assertAdminPermission).mockResolvedValue({ actorId: 'admin-1' } as never);
  vi.mocked(getPersistedContestBySlug).mockResolvedValue(null as never);
});

describe('POST /api/admin/contests schedule', () => {
  it('stores the schedule as instants on the definition it persists', async () => {
    const res = await POST(
      post({
        ...base,
        startDate: '2026-12-01',
        endDate: '2026-12-24',
        prizePool: '₦500,000 + a management deal',
      }),
    );
    expect(res.status).toBe(201);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      startDate: '2026-12-01T00:00:00.000Z',
      endDate: '2026-12-24T23:59:59.999Z',
      prizePool: '₦500,000 + a management deal',
    });
  });

  it('rejects an end date before the start date with the reason, not a 500', async () => {
    const res = await POST(post({ ...base, startDate: '2026-12-24', endDate: '2026-12-01' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('The contest end date must be on or after the start date.');
    expect(persisted).toHaveLength(0);
  });

  it('rejects an unparseable date', async () => {
    const res = await POST(post({ ...base, startDate: 'next tuesday' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Contest start date is not a valid date.');
    expect(persisted).toHaveLength(0);
  });

  it('leaves an omitted schedule unbounded rather than inventing one', async () => {
    const res = await POST(post({ ...base }));
    expect(res.status).toBe(201);
    expect(persisted[0]?.startDate ?? '').toBe('');
    expect(persisted[0]?.endDate ?? '').toBe('');
  });
});

describe('PATCH /api/admin/contests/[slug] schedule', () => {
  it('writes the schedule through to Postgres', async () => {
    const res = await patchReq({ startDate: '2026-12-01', endDate: '2026-12-24', prizePool: 'A record deal' });
    // updateRegistrationContest is mocked to miss, so the route falls back to the
    // Postgres row — which must exist for an edit to mean anything.
    expect(res.status).toBe(404);

    vi.mocked(getPersistedContestBySlug).mockResolvedValue({
      ...base,
      startDate: '',
      endDate: '',
      prizePool: '',
    } as never);
    const again = await patchReq({ startDate: '2026-12-01', endDate: '2026-12-24', prizePool: 'A record deal' });
    expect(again.status).toBe(200);
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({
      startDate: '2026-12-01T00:00:00.000Z',
      endDate: '2026-12-24T23:59:59.999Z',
      prizePool: 'A record deal',
    });
  });

  it('keeps an untouched deadline when the edit omits the schedule', async () => {
    vi.mocked(getPersistedContestBySlug).mockResolvedValue({
      ...base,
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-06-30T23:59:59.999Z',
      prizePool: '₦100,000',
    } as never);
    const res = await patchReq({ title: 'Rising Star 2026' });
    expect(res.status).toBe(200);
    expect(updated[0]).toMatchObject({
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-06-30T23:59:59.999Z',
      prizePool: '₦100,000',
    });
  });

  it('treats an empty submission as a real clear', async () => {
    vi.mocked(getPersistedContestBySlug).mockResolvedValue({
      ...base,
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-06-30T23:59:59.999Z',
      prizePool: '₦100,000',
    } as never);
    const res = await patchReq({ startDate: '', endDate: '', prizePool: '' });
    expect(res.status).toBe(200);
    expect(updated[0]).toMatchObject({ startDate: '', endDate: '', prizePool: '' });
  });

  it('rejects a nonsense window with 400, not a raw Postgres error', async () => {
    const res = await patchReq({ endDate: '2026-02-30' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Contest end date is not a valid date.');
    expect(updated).toHaveLength(0);
  });
});
