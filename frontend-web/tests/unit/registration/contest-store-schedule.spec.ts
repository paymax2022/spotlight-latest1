// The contest store must put the schedule and the prize on the ROW, not only in
// contest_config.
//
// Why this matters more than it looks: the definition is snapshotted into
// contest_config wholesale, so a field can round-trip through the admin console
// while the column underneath it stays NULL forever. start_date/end_date are read
// by the bridge trigger (20261223000000) that mirrors into connect_contests, and
// prize_pool is read by /api/v1/contests/:id. Neither reads the JSON snapshot, so
// a definition-only write is a contest that LOOKS scheduled in the form and is
// still open-ended in every app. These tests assert the insert/update payload,
// which is the only place the columns can be set.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const writes: Array<{ op: string; payload: Record<string, unknown> }> = [];

function chainable(op: string) {
  // Typed as a payload holder rather than a loose Record so `record.payload`
  // stays `Record<string, unknown> | undefined` — through an index signature it
  // is `unknown`, and `unknown ?? {}` fails tsc's index-signature check.
  const record: { payload?: Record<string, unknown> } = {};
  const builder = {
    insert(payload: Record<string, unknown>) { record.payload = payload; return this; },
    update(payload: Record<string, unknown>) { record.payload = payload; return this; },
    select() { return this; },
    eq() { return this; },
    order() { return this; },
    limit() { return this; },
    async single() {
      writes.push({ op, payload: record.payload ?? {} });
      return { data: { id: 'contest-1' }, error: null };
    },
  };
  // update() resolves through the non-single path, so record on the promise too.
  const thenable = {
    ...builder,
    then<T1, T2>(onFulfilled: (v: unknown) => T1, onRejected?: (e: unknown) => T2) {
      writes.push({ op, payload: record.payload ?? {} });
      return Promise.resolve({ data: null, error: null, count: 1 }).then(onFulfilled, onRejected);
    },
  };
  return thenable;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => ({ table, ...chainable(table) } as never) }),
}));

// Managed-category lookup is a separate DB read; the label is not what is under
// test here, and its fallback would otherwise need a live Postgres.
vi.mock('@/src/server/contests/categories', () => ({
  resolveCategoryLabel: async () => null,
}));

const definition = {
  slug: 'rising-star-2026',
  title: 'Rising Star 2026',
  contestCategory: 'other' as const,
  contestType: 'online_contest' as const,
  seasonOrEdition: 'Season 1',
  regionScope: 'national' as const,
  isPaid: false,
  registrationFeeNgn: 0,
  requiresGuardianConsentForMinors: false,
  legalAdultAge: 18,
  requiresMedical: false,
  requiresBootcampReadiness: false,
  supportsVoting: true,
  supportsAuditionScheduling: false,
  supportsSchoolEntry: false,
  supportsGroupEntry: false,
  categoryQuestionSet: 'other' as const,
  startDate: '2026-12-01',
  endDate: '2026-12-24',
  prizePool: '₦500,000 + a management deal',
};

describe('contest store schedule columns', () => {
  beforeEach(() => { writes.length = 0; });

  it('writes start_date, end_date and prize_pool on create', async () => {
    const { persistContestDefinition } = await import('@/src/server/registration-v2/contest-store');
    await persistContestDefinition(definition as never);
    const insert = writes.find((w) => w.op === 'contests');
    expect(insert, 'the store should write to public.contests').toBeTruthy();
    expect(insert!.payload).toEqual(expect.objectContaining({
      start_date: '2026-12-01T00:00:00.000Z',
      end_date: '2026-12-24T23:59:59.999Z',
      prize_pool: '₦500,000 + a management deal',
    }));
  });

  it('writes the same columns on update, so an edit can change or clear them', async () => {
    const { updateContestDefinition } = await import('@/src/server/registration-v2/contest-store');
    await updateContestDefinition('rising-star-2026', definition as never);
    const update = writes.find((w) => w.op === 'contests');
    expect(update!.payload).toEqual(expect.objectContaining({
      start_date: '2026-12-01T00:00:00.000Z',
      end_date: '2026-12-24T23:59:59.999Z',
      prize_pool: '₦500,000 + a management deal',
    }));
  });

  it('leaves the columns untouched when a definition predates the fields', async () => {
    // A caller that knows nothing about the schedule must not close a contest's
    // deadline by writing null over it.
    const { updateContestDefinition } = await import('@/src/server/registration-v2/contest-store');
    const legacy = { ...definition } as Record<string, unknown>;
    delete legacy.startDate;
    delete legacy.endDate;
    delete legacy.prizePool;
    await updateContestDefinition('rising-star-2026', legacy as never);
    const update = writes.find((w) => w.op === 'contests');
    expect(update!.payload).not.toHaveProperty('start_date');
    expect(update!.payload).not.toHaveProperty('end_date');
    expect(update!.payload).not.toHaveProperty('prize_pool');
  });
});
