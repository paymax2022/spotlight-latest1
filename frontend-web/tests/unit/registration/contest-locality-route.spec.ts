// The admin contest routes are the write boundary for contest locality, and the
// migration says so out loud: 20272000000000 deliberately added NO CHECK on
// public.contests.location_scope — a constraint would make that file refuse to
// replay on any environment holding an older value — so the vocabulary and the
// "a local contest names a locality" rule live HERE instead.
//
// What is pinned below, and why:
//
//   * scope 'lga' / 'village' is refused without the state + LGA that name it. An
//     admin who picks "Local – village" and saves nothing would otherwise publish
//     a contest whose locality is empty, and every locality filter would show it
//     under a blank row;
//   * a value the curated data does not contain is still ACCEPTED. The village
//     list is curated (only some LGAs have rows) and locality is display + filter,
//     so the console is not the place to arbitrate how a quarter is spelled;
//   * lowering the scope clears the triple. Turning a village contest back into a
//     national one must not leave "Anambra / Onitsha North / Ogbendida" behind on
//     a contest that no longer claims it;
//   * the same three keys reach persistContestDefinition, because that mapping is
//     the only route from the console to a column — contest_config alone is
//     invisible to Go and to the phone.
//
// Store mocks follow ./contest-admin-schedule-route.spec.ts.
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

const persisted: Array<Record<string, unknown>> = [];
const updated: Array<Record<string, unknown>> = [];

vi.mock('@/src/server/registration/store', () => ({
  createRegistrationContest: (input: Record<string, unknown>) => {
    created.push(input);
    return input;
  },
  updateRegistrationContest: vi.fn(() => null),
  deleteRegistrationContest: vi.fn(),
  listRegistrationContests: () => [],
  getRegistrationContestBySlug: () => null,
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
  getPersistedContestBySlug: vi.fn(async () => persistedContest),
  listPersistedContests: async () => [],
}));

const created: Array<Record<string, unknown>> = [];
let persistedContest: Record<string, unknown> | null = null;

import { POST } from '@/app/api/admin/contests/route';
import { PATCH } from '@/app/api/admin/contests/[slug]/route';

const base = {
  title: 'Onitsha North Open Mic',
  slug: 'onitsha-north-open-mic',
  contestCategory: 'other',
  contestType: 'online_contest',
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
  return PATCH(new Request('https://x.test/api/admin/contests/onitsha-north-open-mic', {
    method: 'PATCH',
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ slug: 'onitsha-north-open-mic' }) });
}

beforeEach(() => {
  persisted.length = 0;
  updated.length = 0;
  created.length = 0;
  persistedContest = null;
});

describe('POST /api/admin/contests locality', () => {
  it('stores the locality triple a village-scoped contest names', async () => {
    const res = await POST(post({
      ...base,
      regionScope: 'village',
      localityState: ' Anambra ',
      localityLga: 'Onitsha North\n',
      localityVillage: 'Ogbendida',
    }));

    expect(res.status).toBe(201);
    expect(persisted[0]).toMatchObject({
      regionScope: 'village',
      localityState: 'Anambra',
      localityLga: 'Onitsha North',
      localityVillage: 'Ogbendida',
    });
  });

  it('accepts a village the curated list does not contain', async () => {
    const res = await POST(post({
      ...base,
      regionScope: 'village',
      localityState: 'Anambra',
      localityLga: 'Onitsha North',
      localityVillage: 'Ogbenda',
    }));

    expect(res.status).toBe(201);
  });

  it('refuses a local contest that names no locality, and says which level is missing', async () => {
    const lgaOnly = await POST(post({ ...base, regionScope: 'lga' }));
    expect(lgaOnly.status).toBe(400);
    expect((await lgaOnly.json()).error).toMatch(/state|local government/);

    const noVillage = await POST(post({
      ...base,
      regionScope: 'village',
      localityState: 'Anambra',
      localityLga: 'Onitsha North',
    }));
    expect(noVillage.status).toBe(400);
    expect((await noVillage.json()).error).toMatch(/village/i);

    expect(persisted).toHaveLength(0);
    expect(created).toHaveLength(0);
  });

  it('keeps an LGA-scoped contest village-free', async () => {
    const res = await POST(post({
      ...base,
      regionScope: 'lga',
      localityState: 'Anambra',
      localityLga: 'Onitsha North',
      localityVillage: 'Ogbendida',
    }));

    expect(res.status).toBe(201);
    // The scope says the contest covers the whole LGA; a stray village would make
    // it match a quarter-only filter.
    expect(persisted[0]?.localityVillage).toBe('');
  });

  it('clears the triple when the scope stops being local', async () => {
    const res = await POST(post({
      ...base,
      regionScope: 'national',
      localityState: 'Anambra',
      localityLga: 'Onitsha North',
      localityVillage: 'Ogbendida',
    }));

    expect(res.status).toBe(201);
    expect(persisted[0]).toMatchObject({
      localityState: '',
      localityLga: '',
      localityVillage: '',
    });
  });

  it('refuses an absurdly long locality value instead of trusting the column', async () => {
    const res = await POST(post({
      ...base,
      regionScope: 'lga',
      localityState: 'A'.repeat(300),
      localityLga: 'Onitsha North',
    }));

    expect(res.status).toBe(400);
    expect(persisted).toHaveLength(0);
  });
});

describe('PATCH /api/admin/contests/[slug] locality', () => {
  const editable = {
    ...base,
    startDate: '',
    endDate: '',
    prizePool: '',
  };

  beforeEach(() => {
    persistedContest = { ...editable, regionScope: 'lga', localityState: 'Anambra', localityLga: 'Onitsha North' };
  });

  it('writes the locality the edit chose', async () => {
    const res = await patch({
      ...editable,
      regionScope: 'village',
      localityState: 'Anambra',
      localityLga: 'Onitsha North',
      localityVillage: 'Isiokwe',
    });

    expect(res.status).toBe(200);
    expect(updated[0]).toMatchObject({
      localityState: 'Anambra',
      localityLga: 'Onitsha North',
      localityVillage: 'Isiokwe',
    });
  });

  it('refuses to widen a contest to village scope without a village', async () => {
    const res = await patch({ ...editable, regionScope: 'village', localityState: 'Anambra', localityLga: 'Onitsha North' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/village/i);
    expect(updated).toHaveLength(0);
  });

  it('clears the locality when the contest goes back to national', async () => {
    const res = await patch({ ...editable, regionScope: 'national' });
    expect(res.status).toBe(200);
    expect(updated[0]).toMatchObject({ localityState: '', localityLga: '', localityVillage: '' });
  });
});
