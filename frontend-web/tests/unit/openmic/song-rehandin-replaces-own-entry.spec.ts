// @vitest-environment node
/**
 * Re-handing in a song replaces the artist's OWN entry; it never touches anyone
 * else's.
 *
 * THE BUG THIS PINS
 * `uploads/presign` mints a fresh `submissionId` with `randomUUID()` on every
 * call, and `uploads/complete` books a `draft` row under that new id. So the
 * second time an artist records a better verse, the hand-in arrives as a row the
 * contest has never seen. The duplicate scan in `createSubmission` exempted only
 * `row.id === submissionId` and matched every other row on stage name or e-mail —
 * including the artist's own entry that was already live. Result:
 * `duplicateApplication` — "You already have an active submission for this
 * contest" — a 400 that the artist cannot act on and no admin can clear, forever.
 * Observed on localhost with `test sd` / `dctest@spotlight.local`: the 13:03
 * hand-in went live as `a4210c57…`, the 14:30 re-record was refused by that very
 * row, and the abandoned `draft` from the refused attempt became the NEWEST row,
 * so `/me/eligibility` pointed the artist's own screen at it and the page fell
 * back from "Your song is live" to "Uploaded — one step left". Pressing submit
 * again hit the same wall.
 *
 * WHY THE FIX IS OWNERSHIP, NOT IDENTITY
 * The duplicate rule protects a real thing: two accounts cannot occupy one
 * entry slot. So the answer is not "drop the rule" but "ask whose row it is".
 * A row on another `user_id` still refuses the hand-in — replacing another
 * artist's entry from a form would be an account takeover. A row that is
 * provably this artist's is the previous draft of the same entry: the new song
 * publishes and the old one retires to `draft` with its `submitted_at` cleared,
 * so the contest keeps exactly one live entry per artist and the leaderboard,
 * the voter list and the admin review queue all follow without new code.
 *
 * The fake Postgres applies the writes it is given, so these assertions are
 * about the rows the NEXT reader sees, not about a call somebody remembered to
 * make.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  contests: [] as Array<Record<string, any>>,
  enrollments: [] as Array<Record<string, any>>,
  entries: [] as Array<Record<string, any>>,
  /** Tables the code under test is not supposed to reach in this flow. */
  unexpected: [] as string[],
}));

type Filter = (row: Record<string, any>) => boolean;

/**
 * A query builder that keeps only what the flow needs and records what it was
 * asked for, so an unmodelled filter shows up instead of silently passing.
 */
function builder(table: string): any {
  const state: {
    op: 'select' | 'upsert' | 'update' | 'insert';
    payload?: any;
    filters: Filter[];
    shape?: 'single';
  } = { op: 'select', filters: [] };
  const rows = (): Array<Record<string, any>> =>
    table === 'contests'
      ? harness.contests
      : table === 'competition_enrollments'
        ? harness.enrollments
        : table === 'competition_entries'
          ? harness.entries
          : [];

  const eq = (col: string, val: unknown) => state.filters.push((row) => row[col] === val);
  const chain: any = {
    select: () => chain,
    eq: (col: string, val: unknown) => (eq(col, val), chain),
    neq: (col: string, val: unknown) => (state.filters.push((row) => row[col] !== val), chain),
    in: (col: string, val: unknown[]) => (state.filters.push((row) => Array.isArray(val) && val.includes(row[col])), chain),
    not: (col: string, _op: string, val: unknown) => (state.filters.push((row) => row[col] !== val), chain),
    ilike: (col: string, val: string) =>
      (state.filters.push((row) => String(row[col] ?? '').toLowerCase() === String(val).toLowerCase()), chain),
    // Used only by the eligibility probe, which is already satisfied by the
    // enrollment fixture; refuse to guess its semantics.
    or: () => {
      state.filters.push(() => true);
      return chain;
    },
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => ((state.shape = 'single'), Promise.resolve(terminal())),
    single: () => ((state.shape = 'single'), Promise.resolve(terminal())),
    upsert: (payload: Record<string, any>) => ((state.op = 'upsert'), (state.payload = payload), chain),
    update: (payload: Record<string, any>) => ((state.op = 'update'), (state.payload = payload), chain),
    insert: (payload: Record<string, any>) => ((state.op = 'insert'), (state.payload = payload), chain),
    then: (onOk: (v: unknown) => unknown, onErr: (reason: unknown) => unknown) =>
      Promise.resolve(terminal()).then(onOk, onErr),
  };

  function terminal() {
    const matched = rows().filter((row) => state.filters.every((f) => f(row)));
    // `maybeSingle`/`single` hand back one row; an awaited query hands back the
    // array. The shape is what the caller asked for, not which table it is.
    const data = state.shape === 'single' ? matched[0] ?? null : matched;
    if (state.op === 'select') return { data, error: null };
    if (state.op === 'upsert') {
      const index = harness.entries.findIndex((row) => row.id === state.payload.id);
      if (index >= 0) harness.entries[index] = { ...harness.entries[index], ...state.payload };
      else harness.entries.push({ ...state.payload });
      return { data: harness.entries.find((row) => row.id === state.payload.id) ?? null, error: null };
    }
    if (state.op === 'update') {
      for (const row of matched) Object.assign(row, state.payload);
      return { data: matched, error: null };
    }
    if (state.op === 'insert') {
      if (table === 'competition_entries') harness.entries.push({ ...state.payload });
      else harness.unexpected.push(table);
      return { data: state.payload, error: null };
    }
    return { data: null, error: null };
  }

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

const { createSubmission } = await import('@/src/server/openmic/persistence');

const CONTEST_ID = '9c93c999-1867-4c14-9069-1e2cd629cd24';
const CONTEST_SLUG = 'open-mic-christmas-edition';
const ARTIST = 'a1111111-1111-4111-8111-111111111111';
const OTHER = 'b2222222-2222-4222-8222-222222222222';
const EMAIL = 'dctest@spotlight.local';
const STAGE = 'test sd';
const LIVE_ROW_ID = 'a4210c57-a79b-422c-87a2-c124ea4655fc';
const NEW_ROW_ID = '1e581baa-cc65-46ab-8870-7a7750483a70';

const DAY = 86_400_000;

function summaryJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ contestSlug: CONTEST_SLUG, stageName: STAGE, email: EMAIL, ...overrides });
}

/** An entry as `createSubmission` writes it: live, owned, identity in the summary. */
function liveEntry(id: string, userId: string | null, createdAtMs: number) {
  return {
    id,
    competition_id: CONTEST_ID,
    user_id: userId,
    entry_title: 'Christmas Test Verse',
    category: 'afrobeats',
    status: 'published_for_voting',
    submitted_at: new Date(createdAtMs).toISOString(),
    live_at: new Date(createdAtMs).toISOString(),
    created_at: new Date(createdAtMs).toISOString(),
    lyrical_concept_summary: summaryJson(),
  };
}

function handIn(submissionId: string) {
  return createSubmission({
    contestSlug: CONTEST_SLUG,
    submissionId,
    artistUserId: ARTIST,
    stageName: STAGE,
    realName: 'Test Artist',
    email: EMAIL,
    phone: '08000000000',
    country: 'Nigeria',
    state: 'Lagos',
    lga: 'Victoria Island',
    instagramHandle: '@testsd',
    genre: 'afrobeats',
    songTitle: 'Christmas Test Verse (take two)',
    songUrl: 'https://cdn.example.test/take-two.mp3',
    story: 'second take',
    explicitVersion: false,
    cleanVersionAvailable: true,
    officialBeatConfirmed: true,
    ownershipConfirmed: true,
    noUnauthorizedSamplesConfirmed: true,
    finaleAvailabilityConfirmed: true,
  } as any);
}

function entry(id: string) {
  return harness.entries.find((row) => row.id === id);
}

function summary(id: string): Record<string, any> {
  try {
    return JSON.parse(String(entry(id)?.lyrical_concept_summary ?? '{}'));
  } catch {
    return {};
  }
}

beforeEach(() => {
  const now = Date.now();
  harness.contests = [
    {
      id: CONTEST_ID,
      name: 'Spotlight Open Mic — Christmas Edition',
      slug: CONTEST_SLUG,
      contest_type: 'one_beat_one_verse',
      status: 'active',
      visibility: 'public',
      description: 'Download the beat, record a song, hand it in.',
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
        season: 'Season 2026',
        status: 'submission_open',
        voting: { enabled: true },
        finalePlaylist: [],
        selectionModel: 'hybrid',
        finalistsTarget: 10,
        submissionStartAt: new Date(now - DAY).toISOString(),
        submissionEndAt: new Date(now + 30 * DAY).toISOString(),
        reviewEndAt: new Date(now + 37 * DAY).toISOString(),
      },
      competition_beats: [
        {
          id: 'beat-1',
          beat_title: 'Spotlight Christmas Beat',
          producer_name: 'Producer',
          genre: 'afrobeats',
          duration_seconds: 180,
          usage_rules: 'Use the official beat.',
          preview_url: 'https://cdn.example.test/beat.mp3',
          download_url: 'https://cdn.example.test/beat.mp3',
          allow_download: true,
          preview_only: false,
          requires_paid_entry_for_download: false,
        },
      ],
    },
  ];
  // Approved through the enrollment plane, which is also the eligibility signal.
  harness.enrollments = [
    {
      id: 'enr-1',
      competition_id: CONTEST_ID,
      user_id: ARTIST,
      status: 'approved',
      payment_status: 'not_required',
      stage_name: STAGE,
      full_name: 'Test Artist',
      email: EMAIL,
      phone: '08000000000',
      country: 'Nigeria',
      state: 'Lagos',
      lga: 'Victoria Island',
      beat_download_status: 'downloaded',
      beat_downloaded_at: new Date(now - 2 * DAY).toISOString(),
      submitted_at: new Date(now - DAY).toISOString(),
      created_at: new Date(now - 3 * DAY).toISOString(),
      user_profiles: { id: ARTIST, full_name: 'Test Artist', email: EMAIL, stage_name: STAGE },
      competition_votes: [],
    },
  ];
  harness.entries = [liveEntry(LIVE_ROW_ID, ARTIST, now - DAY)];
  harness.unexpected = [];
});

describe('an artist re-handing in a song', () => {
  it('publishes the new take instead of refusing it as a duplicate', async () => {
    const result = await handIn(NEW_ROW_ID);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.submission.id).toBe(NEW_ROW_ID);
    expect(result.submission.status).toBe('published_for_voting');
  });

  it('retires the artist’s own earlier entry rather than leaving two live rows', async () => {
    await handIn(NEW_ROW_ID);

    const previous = entry(LIVE_ROW_ID);
    expect(previous?.status).toBe('draft');
    expect(previous?.submitted_at).toBeNull();
    // The song is not deleted: the row an admin can still audit stays in the table.
    expect(harness.entries).toHaveLength(2);
    expect(summary(LIVE_ROW_ID).replacedByEntryId).toBe(NEW_ROW_ID);
  });

  it('leaves the contest with exactly one entry that can take votes', async () => {
    await handIn(NEW_ROW_ID);

    const active = harness.entries.filter((row) => row.status !== 'draft');
    expect(active.map((row) => row.id)).toEqual([NEW_ROW_ID]);
  });

  it('still works on a third take, and retires both earlier rows', async () => {
    await handIn(NEW_ROW_ID);
    const second = await handIn('c3333333-3333-4333-8333-333333333333');

    expect(second.success).toBe(true);
    const active = harness.entries.filter((row) => row.status !== 'draft');
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('c3333333-3333-4333-8333-333333333333');
  });

  it('publishes the row the upload route already booked as a draft', async () => {
    // `uploads/complete` writes this shape: same id, no `submitted_at`, no
    // identity fields in the summary.
    harness.entries.push({
      id: NEW_ROW_ID,
      competition_id: CONTEST_ID,
      user_id: ARTIST,
      status: 'draft',
      submitted_at: null,
      created_at: new Date().toISOString(),
      lyrical_concept_summary: JSON.stringify({ uploadedAt: new Date().toISOString() }),
    });

    const result = await handIn(NEW_ROW_ID);

    expect(result.success).toBe(true);
    expect(entry(NEW_ROW_ID)?.status).toBe('published_for_voting');
    expect(entry(LIVE_ROW_ID)?.status).toBe('draft');
  });
});

describe('the duplicate rule still protects a slot that is not yours', () => {
  it('refuses a hand-in that collides with another account’s entry', async () => {
    const now = Date.now();
    harness.entries.push({
      ...liveEntry('d4444444-4444-4444-8444-444444444444', OTHER, now - DAY),
      lyrical_concept_summary: summaryJson({ stageName: STAGE, email: 'someone-else@spotlight.local' }),
    });

    const result = await handIn(NEW_ROW_ID);

    expect(result.success).toBe(false);
    if (result.success) return;
    // `errors` is a union of every refusal shape the route can answer with, so
    // the key is read through the shape this refusal has.
    const errors = result.errors as { duplicateApplication?: string };
    expect(errors.duplicateApplication, 'a cross-account collision must name the entry slot it protects').toBeTruthy();
    // Refusing must not retire anything: the other artist keeps their entry.
    expect(harness.entries.every((row) => row.status !== 'draft')).toBe(true);
  });

  it('refuses when one of the matching rows is someone else’s, even if another is ours', async () => {
    const now = Date.now();
    harness.entries.push({
      ...liveEntry('e5555555-5555-4555-8555-555555555555', OTHER, now - DAY),
      lyrical_concept_summary: summaryJson({ email: 'someone-else@spotlight.local' }),
    });

    const result = await handIn(NEW_ROW_ID);

    expect(result.success).toBe(false);
    expect(entry(LIVE_ROW_ID)?.status).toBe('published_for_voting');
  });

  it('treats a row with no owner as someone else’s when only the stage name matches', async () => {
    const now = Date.now();
    harness.entries.push({
      ...liveEntry('f6666666-6666-4666-8666-666666666666', null, now - DAY),
      lyrical_concept_summary: summaryJson({ email: 'someone-else@spotlight.local' }),
    });

    const result = await handIn(NEW_ROW_ID);

    expect(result.success).toBe(false);
    if (result.success) return;
    // `errors` is a union of every refusal shape the route can answer with, so
    // the key is read through the shape this refusal has.
    const errors = result.errors as { duplicateApplication?: string };
    expect(errors.duplicateApplication, 'a cross-account collision must name the entry slot it protects').toBeTruthy();
  });

  it('still refuses a stage-name collision with an unowned legacy row', async () => {
    const now = Date.now();
    harness.entries.push({
      ...liveEntry('07777777-7777-4777-8777-777777777777', null, now - DAY),
      lyrical_concept_summary: summaryJson({ email: 'someone-else@spotlight.local' }),
    });

    const result = await handIn(NEW_ROW_ID);

    expect(result.success).toBe(false);
    expect(entry(LIVE_ROW_ID)?.status).toBe('published_for_voting');
  });

  it('counts a rejected or disqualified row as nobody’s slot', async () => {
    harness.entries = [
      {
        ...entry(LIVE_ROW_ID)!,
        status: 'rejected',
      },
    ];

    const result = await handIn(NEW_ROW_ID);

    expect(result.success).toBe(true);
    // The refused take is left exactly as the reviewer filed it: retirement is
    // for the artist's own ACTIVE entry, and rewriting a decision row would
    // erase why it was rejected.
    expect(entry(LIVE_ROW_ID)?.status).toBe('rejected');
    expect(entry(NEW_ROW_ID)?.status).toBe('published_for_voting');
  });
});
