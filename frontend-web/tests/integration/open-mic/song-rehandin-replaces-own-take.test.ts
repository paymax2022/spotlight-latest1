/**
 * Re-handing in a song replaces the artist's own previous take — against the
 * real stack, not a fake.
 *
 * WHY THIS EXISTS — the defect it reproduces.
 * An Open Mic artist who uploaded a second take got HTTP 400 with
 * `{ errors: { duplicateApplication: "You already have an active submission for
 * this contest." } }`, because the duplicate scan matched rows by lowercased
 * stage name and e-mail and exempted only the row whose id equalled the incoming
 * `submissionId`. The upload route mints a fresh id every time
 * (`randomUUID()` in `requestSongUploadTicket`), so an artist's own live row
 * always looked like somebody else's, and the retry was refused forever.
 * `tests/unit/openmic/song-rehandin-replaces-own-entry.spec.ts` pins the rule
 * with a fake query builder; like every other fake in this folder it cannot see
 * the shape of the real table. The live lesson from
 * `applicant-action-sources.test.ts` one directory up is that a wrong column or a
 * write the database rejects only shows up when the production writer runs
 * against a migrated Postgres — and here the retirement writes through
 * `lyrical_concept_summary`, a TEXT column holding JSON, so the parse-and-merge
 * is exactly the kind of thing a fake cannot vouch for.
 *
 * What runs is the production path: `createContest` / `upsertBeat` /
 * `createSubmission` from `src/server/openmic/persistence.ts`, including the
 * eligibility gate and the auto-approval write. No source module is mocked.
 *
 * Runs locally only, and skips without a stack:
 *   set -a; source frontend-web/.env.local; set +a
 *   npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createContest, createSubmission, upsertBeat } from '@/src/server/openmic/persistence';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const live = Boolean(URL && KEY);
const db = () => createClient(URL as string, KEY as string, { auth: { persistSession: false } });

const STAMP = Date.now();
const SLUG = `open-mic-rehandin-spec-${STAMP}`;
const TITLE = `Open Mic replacement spec ${STAMP}`;
const EMAIL = `rehandin-spec-${STAMP}@seed.test`;
const STAGE = `ReHandIn Spec ${STAMP}`;
/** Two distinct hand-in ids, the way the real upload route issues them. */
const FIRST_ID = crypto.randomUUID();
const SECOND_ID = crypto.randomUUID();

let contestId = '';
let userId = '';

function handIn(submissionId: string, songTitle: string) {
  return createSubmission({
    contestSlug: SLUG,
    submissionId,
    songTitle,
    stageName: STAGE,
    realName: STAGE,
    email: EMAIL,
    country: 'Nigeria',
    state: 'Lagos',
    lga: 'Ikeja',
    genre: 'Hip Hop',
    instagramHandle: '@rehandin_spec',
    artistUserId: userId,
    officialBeatConfirmed: true,
    ownershipConfirmed: true,
    noUnauthorizedSamplesConfirmed: true,
  } as never);
}

async function entryRows(): Promise<Array<Record<string, any>>> {
  const { data, error } = await db()
    .from('competition_entries')
    .select('id, status, user_id, entry_title, submitted_at, live_at, lyrical_concept_summary')
    .eq('competition_id', contestId)
    .order('created_at', { ascending: true });
  expect(error, error?.message).toBeNull();
  return data ?? [];
}

describe.skipIf(!live)('open mic re-hand-in replaces the artist’s own take (live)', () => {
  beforeAll(async () => {
    const created = await createContest(
      {
        title: TITLE,
        slug: SLUG,
        description: 'Throwaway edition for the re-hand-in spec.',
        status: 'submission_open',
        month: 12,
        year: 2026,
        season: 'Holiday',
        registrationFeeNgn: 0,
        finalistsTarget: 3,
        entryFeeRequired: false,
      } as never,
    );
    expect(created.success, JSON.stringify(created)).toBeTruthy();
    contestId = String((created as any).contest.id);

    const beat = await upsertBeat(contestId, {
      beatTitle: 'Replacement spec beat',
      producerName: 'Spec Producer',
      downloadUrl: 'https://example.test/beat.mp3',
      genre: 'Hip Hop',
      durationSeconds: 12,
    });
    // upsertBeat answers with the beat itself, not an envelope.
    expect(beat?.beatTitle, JSON.stringify(beat)).toBe('Replacement spec beat');

    const seeded = await db().auth.admin.createUser({
      email: EMAIL,
      email_confirm: true,
      user_metadata: { full_name: STAGE },
    });
    expect(seeded.error, seeded.error?.message).toBeNull();
    userId = seeded.data!.user!.id!;
    await db().from('user_profiles').upsert({
      id: userId,
      email: EMAIL,
      full_name: STAGE,
      stage_name: STAGE,
      phone: '',
    });

    // Approval through the enrollment plane, which is the cheapest source the
    // eligibility union recognises and the one this spec can fully clean up.
    const enrollment = await db()
      .from('competition_enrollments')
      .insert({ competition_id: contestId, user_id: userId, stage_name: STAGE, email: EMAIL, status: 'approved' });
    expect(enrollment.error, enrollment.error?.message).toBeNull();
  }, 120_000);

  afterAll(async () => {
    // entries → contest cascade, but delete explicitly so a failed cascade can
    // never leave a row behind that the next run reads as someone else’s slot.
    await db().from('competition_entries').delete().eq('competition_id', contestId);
    await db().from('competition_enrollments').delete().eq('competition_id', contestId);
    await db().from('contests').delete().eq('id', contestId);
    await db().from('user_profiles').delete().eq('id', userId);
    await db().auth.admin.deleteUser(userId).catch(() => {});
    // A run that died before an id was recorded cannot clean up by id, and the
    // seeded accounts live in a schema PostgREST will not list. Sweep by the
    // address prefix through the admin API so repeated failures do not pile up.
    const users = await db().auth.admin.listUsers({ page: 1, perPage: 1000 });
    const strays = (users.data.users ?? []).filter((u) => String(u.email || '').startsWith('rehandin-'));
    for (const stray of strays) await db().auth.admin.deleteUser(stray.id).catch(() => {});

    const leftovers = await db().from('contests').select('id, slug').like('slug', 'open-mic-rehandin-spec-%');
    for (const row of leftovers.data ?? []) {
      await db().from('competition_entries').delete().eq('competition_id', row.id);
      await db().from('competition_enrollments').delete().eq('competition_id', row.id);
      await db().from('contests').delete().eq('id', row.id);
    }
    const left = await db().from('contests').select('id').eq('slug', SLUG);
    expect(left.data ?? [], 'fixture must not leak').toHaveLength(0);
  }, 120_000);

  it('publishes the first take as an approved, votable entry', async () => {
    const result = await handIn(FIRST_ID, 'First take');
    expect(result.success, JSON.stringify(result)).toBe(true);

    const rows = await entryRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('published_for_voting');
    // Auto-approval is a real timestamp pair, not a status string alone: the
    // hand-in and the live moment come from the same statement.
    expect(rows[0]!.submitted_at).toBeTruthy();
    expect(rows[0]!.live_at).toBeTruthy();
  });

  it('publishes the second take instead of refusing it as a duplicate', async () => {
    const result = await handIn(SECOND_ID, 'Second take');
    // The 400 this spec exists for: the refusal arrives as
    // `{ success: false, errors: { duplicateApplication: … } }`.
    expect(result.success, JSON.stringify(result)).toBe(true);

    const rows = await entryRows();
    const byId = new Map(rows.map((row) => [String(row.id), row]));
    expect(byId.get(SECOND_ID)!.status).toBe('published_for_voting');
    expect(byId.get(SECOND_ID)!.submitted_at).toBeTruthy();
  });

  it('retires the replaced take to an unsubmitted draft and records the lineage', async () => {
    const rows = await entryRows();
    const retired = rows.find((row) => String(row.id) === FIRST_ID);
    expect(retired, 'the first take must still exist — it is history, not trash').toBeTruthy();
    // `draft` is the status every reader already treats as "not in the contest":
    // the leaderboard allowlist, the vote stream, the Go roster join and the
    // mobile stage machine.
    expect(retired!.status).toBe('draft');
    expect(retired!.submitted_at, 'a retired row must not claim a hand-in time').toBeNull();
    expect(retired!.live_at, 'a retired row must not claim it is live').toBeNull();

    // The summary is TEXT holding JSON; the merge must survive the round trip and
    // keep the fields the upload route wrote.
    const summary = JSON.parse(String(retired!.lyrical_concept_summary));
    expect(summary.replacedByEntryId).toBe(SECOND_ID);
    expect(summary.stageName).toBe(STAGE);
    expect(new Date(String(summary.replacedAt)).toString() !== 'Invalid Date').toBe(true);
  });

  it('leaves the edition with exactly one entry voters can hear', async () => {
    const rows = await entryRows();
    const votable = rows.filter((row) => ['submitted', 'published_for_voting', 'live_for_voting', 'finalist', 'winner'].includes(String(row.status)));
    expect(votable.map((row) => String(row.id))).toEqual([SECOND_ID]);
  });

  it('still refuses a hand-in that collides with another account', async () => {
    // The guard the fix must not weaken: the same stage name and e-mail on a row
    // owned by a different user_id is somebody else’s slot.
    const otherSeed = await db().auth.admin.createUser({
      email: `rehandin-other-${STAMP}@seed.test`,
      email_confirm: true,
    });
    expect(otherSeed.error, otherSeed.error?.message).toBeNull();
    const otherId = otherSeed.data!.user!.id!;
    // competition_entries.user_id is a foreign key to user_profiles, not to
    // auth.users, so the other account needs its profile row before it can hold
    // an entry.
    await db().from('user_profiles').upsert({
      id: otherId,
      email: `rehandin-other-${STAMP}@seed.test`,
      full_name: 'Other Artist',
      phone: '',
    });
    await db()
      .from('competition_entries')
      .insert({
        competition_id: contestId,
        user_id: otherId,
        entry_title: 'Somebody else’s take',
        entry_description: '',
        // The identity fields are what the scan reads, so the collision is the
        // takeover shape: this row carries OUR stage name and e-mail while
        // belonging to a different account. A row with somebody else's names is
        // simply not this artist's slot and must not stop them.
        lyrical_concept_summary: JSON.stringify({ stageName: STAGE, email: EMAIL }),
        status: 'published_for_voting',
        submitted_at: new Date().toISOString(),
      });

    const result = await handIn(crypto.randomUUID(), 'Third take');
    expect(result.success, 'a collision with another account must not be auto-replaced').toBe(false);
    expect((result as any).errors?.duplicateApplication).toBeTruthy();

    const ours = await entryRows();
    expect(ours.filter((row) => String(row.id) === SECOND_ID).map((row) => row.status)).toEqual(['published_for_voting']);

    await db().from('competition_entries').delete().eq('user_id', otherId);
    // A PostgREST builder is thenable but has no `.catch`, so no guard here.
    await db().from('user_profiles').delete().eq('id', otherId);
    await db().auth.admin.deleteUser(otherId).catch(() => {});
  }, 120_000);
});
