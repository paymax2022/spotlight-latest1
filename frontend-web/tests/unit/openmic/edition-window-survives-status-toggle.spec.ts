// @vitest-environment node
/**
 * Publishing an edition must not erase the hand-in window it was configured with.
 *
 * `updateContest` has two shapes. The admin editor sends the whole form, so the
 * `sponsor_assets` blob it writes is rebuilt from the hydrated contest and every
 * field survives. The contest list's publish/draft toggle sends exactly one key
 * (`{ status }`) and takes a fast path that rebuilds `sponsor_assets` from the
 * fields the author happened to list there — and `submissionStartAt`,
 * `submissionEndAt`, `reviewEndAt` were not among them.
 *
 * That is not cosmetic: those three keys are the ONLY place the submission window
 * lives (`mapContestRow` reads `assets.submissionStartAt/EndAt`, there is no
 * `competition_windows` column behind it), and `describeSubmissionWindow` is
 * deliberately strict — a contest with no dates is `no_window_configured`, i.e.
 * CLOSED. So one click on "Publish" in the console turned an edition that was
 * accepting songs into one that refuses every upload with "the organiser has not
 * set a hand-in window", and the only way to find out was an applicant pressing a
 * dead button. An Open Mic edition that cannot take a hand-in has no beat-to-song
 * flow at all, which is the flow this whole feature is.
 *
 * The fast path is under test through the real function against a fake Postgres
 * that applies the written blob, so the assertion is about the row the next reader
 * sees — not about a field list somebody remembered to copy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  contests: [] as Array<Record<string, any>>,
  updates: [] as Array<Record<string, any>>,
}));

/** A query builder minimal enough to be honest: it stores filters, applies updates. */
function builder(table: string): any {
  const state: { op: 'select' | 'update'; payload?: Record<string, any>; filters: Array<[string, unknown]> } = {
    op: 'select',
    filters: [],
  };
  const matchRow = () =>
    table === 'contests'
      ? harness.contests.find((row) => state.filters.every(([col, val]) => row[col] === val)) ?? null
      : null;
  const terminal = () => {
    const row = matchRow();
    if (!row) return { data: null, error: null };
    if (state.op === 'update' && state.payload) {
      harness.updates.push(state.payload);
      Object.assign(row, state.payload);
    }
    return { data: row, error: null };
  };
  const chain: any = {
    select: () => chain,
    eq: (col: string, val: unknown) => (state.filters.push([col, val]), chain),
    update: (payload: Record<string, any>) => ((state.op = 'update'), (state.payload = payload), chain),
    maybeSingle: () => Promise.resolve(terminal()),
    then: (onOk: (v: unknown) => unknown, onErr: (reason: unknown) => unknown) =>
      Promise.resolve(terminal()).then(onOk, onErr),
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

const { updateContest, getContestById } = await import('@/server/openmic/persistence');
const { describeSubmissionWindow } = await import('@/src/server/openmic/submission-window');

const CONTEST_ID = 'b2737863-33b8-4786-8e12-664b13360fd3';
const STARTS = '2026-11-24T11:44:20.722Z';
const ENDS = '2026-12-24T12:44:20.722Z';
const REVIEW_ENDS = '2026-12-31T23:59:59.000Z';

function storedContestRow() {
  return {
    id: CONTEST_ID,
    name: 'Spotlight Open Mic — Christmas Edition',
    slug: 'open-mic-christmas-edition',
    contest_type: 'one_beat_one_verse',
    status: 'active',
    visibility: 'public',
    description: 'Record over the official beat, hand in your song, voters decide.',
    entry_fee_ngn: 0,
    vote_price_ngn: 200,
    shortlisting_limit: 10,
    judge_weight: 30,
    public_vote_weight: 70,
    start_date: null,
    end_date: null,
    sponsor_assets: {
      month: 12,
      year: 2026,
      season: 'Season',
      status: 'published',
      voting: { enabled: true },
      finalePlaylist: [],
      selectionModel: 'hybrid',
      finalistsTarget: 10,
      submissionStartAt: STARTS,
      submissionEndAt: ENDS,
      reviewEndAt: REVIEW_ENDS,
    },
    competition_beats: [],
  };
}

beforeEach(() => {
  harness.contests = [storedContestRow()];
  harness.updates = [];
});

describe('the status-only save keeps the edition schedule', () => {
  it('writes the window it read, instead of writing a blob without one', async () => {
    await updateContest(CONTEST_ID, { status: 'published' });

    expect(harness.updates).toHaveLength(1);
    expect(harness.updates[0].sponsor_assets).toMatchObject({
      submissionStartAt: STARTS,
      submissionEndAt: ENDS,
      reviewEndAt: REVIEW_ENDS,
    });
  });

  it('leaves the edition open for hand-ins after a publish toggle', async () => {
    await updateContest(CONTEST_ID, { status: 'published' });

    // The read the eligibility gate performs: contest -> mapped row -> window.
    const after = await getContestById(CONTEST_ID);
    const verdict = describeSubmissionWindow(after, Date.parse('2026-12-01T09:00:00.000Z'));
    expect(verdict).toMatchObject({ open: true, reason: 'open', startsAt: STARTS, endsAt: ENDS });
  });

  it('still keeps the window when the whole form is saved', async () => {
    await updateContest(CONTEST_ID, { status: 'published', title: 'Spotlight Open Mic — Christmas' });

    const after = await getContestById(CONTEST_ID);
    expect(after?.submissionStartAt).toBe(STARTS);
    expect(after?.submissionEndAt).toBe(ENDS);
    expect(after?.reviewEndAt).toBe(REVIEW_ENDS);
  });
});
