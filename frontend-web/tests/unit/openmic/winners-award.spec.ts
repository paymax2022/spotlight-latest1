// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Winners tab's Prize column.
 *
 * The console renders `w.awardTitle || contest?.prizes?.[0]?.title || 'Winner Perks'`,
 * and until this change the first term could never be set: `announceWinner` writes a
 * real `winner_records` row (`award_title: 'Monthly Winner'`), but nothing read it
 * back, so a contest with no `prize_structure` — which is what the dev Open Mic
 * edition has — displayed the invented string "Winner Perks" as if the database said
 * that. The award a winner actually got IS stored; this reads it.
 *
 * The read is deliberately narrow: `winner_records` is only consulted once the page
 * has a winner row, because `listSubmissions` also answers the artist's own dashboard
 * and the review queue, and an unconditional second query would tax every one of
 * those reads for a column only one tab shows.
 */

const harness = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  queries: [] as Array<{ table: string; method: string; args: unknown[] }>,
}));

function builder(table: string): any {
  const chain: any = {
    select: (...args: unknown[]) => (harness.queries.push({ table, method: 'select', args }), chain),
    eq: (...args: unknown[]) => (harness.queries.push({ table, method: 'eq', args }), chain),
    in: (...args: unknown[]) => (harness.queries.push({ table, method: 'in', args }), chain),
    order: (...args: unknown[]) => (harness.queries.push({ table, method: 'order', args }), chain),
    limit: (...args: unknown[]) => (harness.queries.push({ table, method: 'limit', args }), chain),
    then: (onOk: (v: unknown) => unknown, onErr: (reason: unknown) => unknown) =>
      Promise.resolve({ data: harness.tables[table] ?? [], error: null }).then(onOk, onErr),
  };
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({ from: (table: string) => builder(table) }),
  createClient: () => ({ from: (table: string) => builder(table) }),
}));

vi.mock('@/lib/supabase/runtime', () => ({
  hasUsableSupabaseConfig: () => true,
  hasUsableSupabaseReadConfig: () => true,
}));

const { listSubmissions } = await import('@/server/openmic/persistence');

const CONTEST_ID = 'c7ab8479-0275-473d-a78f-b923664a3b54';
const WINNER_ENTRY = '22222222-2222-4222-8222-222222222222';
const RUNNER_UP_ENTRY = '33333333-3333-4333-8333-333333333333';

function entry(id: string, status: string) {
  return {
    id,
    competition_id: CONTEST_ID,
    user_id: '6c6d04cd-5635-4b94-acd1-b5378b8a2975',
    entry_title: 'Lagos After Dark',
    lyrical_concept_summary: JSON.stringify({ stageName: 'Lady Dee' }),
    category: 'Hip hop',
    status,
    submitted_at: '2026-11-19T09:00:00.000Z',
    created_at: '2026-11-19T09:00:00.000Z',
    public_vote_count: 12,
  };
}

beforeEach(() => {
  harness.queries.length = 0;
  harness.tables = {
    competition_entries: [entry(WINNER_ENTRY, 'winner'), entry(RUNNER_UP_ENTRY, 'published_for_voting')],
    winner_records: [
      { entry_id: WINNER_ENTRY, competition_id: CONTEST_ID, winner_tier: 'winner', award_title: 'Monthly Winner' },
    ],
  };
});

describe('the award a winner actually won', () => {
  it('carries the stored award title onto the winner row', async () => {
    const rows = await listSubmissions({ contestId: CONTEST_ID });
    const winner = rows.find((row) => row.id === WINNER_ENTRY);
    expect(winner?.isWinner).toBe(true);
    expect(winner?.awardTitle).toBe('Monthly Winner');
  });

  it('leaves the award empty for a row the records table has nothing about', async () => {
    const rows = await listSubmissions({ contestId: CONTEST_ID });
    const other = rows.find((row) => row.id === RUNNER_UP_ENTRY);
    expect(other?.awardTitle ?? null).toBeNull();
  });

  it('does not ask for winner records when the page has no winner', async () => {
    harness.tables.competition_entries = [entry(RUNNER_UP_ENTRY, 'published_for_voting')];
    await listSubmissions({ contestId: CONTEST_ID });
    expect(harness.queries.filter((q) => q.table === 'winner_records')).toHaveLength(0);
  });

  it('scopes the award read to the winner rows it has', async () => {
    await listSubmissions({ contestId: CONTEST_ID });
    const awardRead = harness.queries.filter((q) => q.table === 'winner_records');
    expect(awardRead.map((q) => q.method)).toEqual(['select', 'eq', 'in']);
    expect(awardRead[1].args).toEqual(['competition_id', CONTEST_ID]);
    expect(awardRead[2].args).toEqual(['entry_id', [WINNER_ENTRY]]);
  });
});
