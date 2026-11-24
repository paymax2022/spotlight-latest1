// @vitest-environment node
/**
 * Memory mode and Postgres must give the same answer.
 *
 * The in-memory plane is not a toy: it is what `createSubmission` falls back to
 * when a Supabase read throws, so an artist whose database call failed lands
 * here. The duplicate rule existed twice — once in each plane — and that is
 * exactly how it went wrong once: localhost ran the Postgres copy while memory
 * mode ran a copy that happened to look right in tests. Both now call the same
 * `planSubmissionReplacement`, and this file is what keeps them calling it the
 * same way.
 */
import { describe, expect, it } from 'vitest';

const { createContest, createSubmission, listSubmissions, reviewSubmission } = await import(
  '@/src/server/openmic/store'
);

const MINE = 'memory-user-mine';
const THEIRS = 'memory-user-theirs';
const STAGE = 'Memory Artist';
const EMAIL = 'memory@spotlight.local';

function edition(slug: string) {
  const created = createContest(
    {
      title: `Memory Open Mic ${slug}`,
      slug,
      month: 12,
      year: 2026,
      season: 'Season 2026',
      description: 'Hand in a song over the official beat.',
      // `submission_open` is how the memory plane says "the window covers now",
      // so the window gate is not what these cases are about.
      status: 'submission_open',
      visibility: 'public',
      entryFeeRequired: false,
      beat: { beatTitle: 'Official Beat', previewUrl: 'https://cdn.example.test/beat.mp3' },
    } as any,
  ) as any;
  if (!created.success) throw new Error(JSON.stringify(created.errors));
  return created.contest as { id: string; slug: string };
}

function handIn(slug: string, submissionId: string, overrides: Record<string, any> = {}) {
  return createSubmission({
    contestSlug: slug,
    submissionId,
    artistUserId: MINE,
    stageName: STAGE,
    realName: 'Memory Artist',
    email: EMAIL,
    phone: '08000000000',
    country: 'Nigeria',
    state: 'Lagos',
    lga: 'Victoria Island',
    instagramHandle: '@memory',
    genre: 'afrobeats',
    songTitle: `Take ${submissionId}`,
    songUrl: `https://cdn.example.test/${submissionId}.mp3`,
    explicitVersion: false,
    officialBeatConfirmed: true,
    ownershipConfirmed: true,
    noUnauthorizedSamplesConfirmed: true,
    ...overrides,
  } as any);
}

describe('the memory plane replaces the same way the database plane does', () => {
  it('publishes a second take and retires the artist’s own first', () => {
    const editionA = edition('mem-replace');
    expect(handIn('mem-replace', 'mem-first').success).toBe(true);
    const second = handIn('mem-replace', 'mem-second');

    expect(second.success).toBe(true);
    if (!second.success) return;
    expect(second.submission.status).toBe('published_for_voting');

    const rows = listSubmissions({ contestId: editionA.id });
    expect(rows.find((row) => row.id === 'mem-first')?.status).toBe('draft');
    expect(rows.find((row) => row.id === 'mem-first')?.replacedByEntryId).toBe('mem-second');
    expect(rows.filter((row) => row.status !== 'draft').map((row) => row.id)).toEqual(['mem-second']);
  });

  it('still refuses a hand-in that collides with another account', () => {
    edition('mem-collide');
    const other = handIn('mem-collide', 'mem-other', {
      artistUserId: THEIRS,
      stageName: 'Memory Artist',
      email: 'other@spotlight.local',
    });
    expect(other.success).toBe(true);

    const mine = handIn('mem-collide', 'mem-mine');

    expect(mine.success).toBe(false);
    if (mine.success) return;
    expect(mine.errors.duplicateApplication).toBeTruthy();
    // Refused means untouched.
    const rows = listSubmissions({});
    expect(rows.find((row) => row.id === 'mem-other')?.status).toBe('published_for_voting');
  });

  it('leaves a decided row exactly as the reviewer filed it', () => {
    edition('mem-rejected');
    expect(handIn('mem-rejected', 'mem-rejected-first').success).toBe(true);
    reviewSubmission('mem-rejected-first', { status: 'rejected', note: 'off-beat' });

    const again = handIn('mem-rejected', 'mem-rejected-second');

    expect(again.success).toBe(true);
    const rows = listSubmissions({});
    expect(rows.find((row) => row.id === 'mem-rejected-first')?.status).toBe('rejected');
  });
});
