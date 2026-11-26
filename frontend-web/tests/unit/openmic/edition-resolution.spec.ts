/**
 * "Which edition did this applicant actually apply to?"
 *
 * The registration plane stores the CATALOG slug (`open-mic-competition`) on the
 * `registrations` row, while the edition an admin published has its own slug
 * (`open-mic-dev`, `open-mic-christmas-edition`). `registrations` has no
 * `contest_id`, so the slug is the only link — and when no `contests` row carries
 * the catalog slug, every Open Mic lookup keyed on it found nothing:
 * `getApplicationWorkflow` answered `isOpenMic: false` and
 * `/api/open-mic/me/eligibility` answered 404 `Contest not found`, so an approved
 * artist was shown neither the beat nor the song upload on either plane.
 *
 * These cases pin the one rule that replaces the two dead ends: an exact slug
 * match wins, and only a registration that IS Open Mic falls back to the live
 * edition — never a talent search or a film audition.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getContestBySlug = vi.hoisted(() => vi.fn());
const listContests = vi.hoisted(() => vi.fn());
vi.mock('@/src/server/openmic/persistence', () => ({ getContestBySlug, listContests }));

import { isOpenMicRegistration } from '@/src/server/openmic/edition-identity';
import { resolveOpenMicEdition } from '@/src/server/openmic/edition-resolution';
import type { OpenMicContest } from '@/src/features/openmic/types';

function edition(overrides: Partial<OpenMicContest> = {}): OpenMicContest {
  return {
    id: 'edition-live',
    title: 'November Open Mic',
    slug: 'open-mic-dev',
    status: 'submission_open',
    visibility: 'public',
    month: 11,
    year: 2026,
    description: '',
    registrationFeeNgn: 0,
    entryFeeRequired: false,
    submissionStartAt: '2026-11-01T00:00:00.000Z',
    submissionEndAt: '2026-12-30T23:59:59.000Z',
    votingConfig: { enabled: true, freeVoting: true, freeVotesPerDay: 3, paidVoting: true, votePrice: 100, leaderboardVisible: true, voteCountPublic: true },
    ...overrides,
  } as OpenMicContest;
}

beforeEach(() => {
  getContestBySlug.mockReset();
  listContests.mockReset();
});

describe('isOpenMicRegistration', () => {
  it('accepts the catalog slug a registration row stores', () => {
    expect(isOpenMicRegistration({ slug: 'open-mic-competition' })).toBe(true);
  });

  it('accepts the catalog type the registration plane locked onto the draft', () => {
    expect(isOpenMicRegistration({ slug: 'some-edition-slug', contestType: 'one_beat_one_verse' })).toBe(true);
  });

  it('accepts the catalog category', () => {
    expect(isOpenMicRegistration({ contestCategory: 'open_mic' })).toBe(true);
  });

  it('refuses a different contest, whatever its slug looks like', () => {
    expect(isOpenMicRegistration({ slug: 'talent-search-2026', contestType: 'online_contest', contestCategory: 'entertainment' })).toBe(false);
  });

  it('refuses nothing at all', () => {
    expect(isOpenMicRegistration(null)).toBe(false);
    expect(isOpenMicRegistration({})).toBe(false);
    expect(isOpenMicRegistration({ slug: '   ' })).toBe(false);
  });
});

describe('resolveOpenMicEdition', () => {
  it('returns the edition whose slug the caller asked for', async () => {
    const exact = edition({ id: 'edition-exact', slug: 'open-mic-christmas-edition' });
    getContestBySlug.mockResolvedValue(exact);

    await expect(resolveOpenMicEdition('open-mic-christmas-edition')).resolves.toEqual(exact);
    expect(getContestBySlug).toHaveBeenCalledWith('open-mic-christmas-edition');
    // An exact answer must not be second-guessed against the live edition.
    expect(listContests).not.toHaveBeenCalled();
  });

  it('falls back to the live edition for a catalog slug no contests row carries', async () => {
    getContestBySlug.mockResolvedValue(null);
    listContests.mockResolvedValue([edition()]);

    await expect(
      resolveOpenMicEdition('open-mic-competition', { contestType: 'one_beat_one_verse', contestCategory: 'open_mic' }),
    ).resolves.toMatchObject({ id: 'edition-live', slug: 'open-mic-dev' });
  });

  it('falls back on the slug alone when that slug is the catalog slug', async () => {
    getContestBySlug.mockResolvedValue(null);
    listContests.mockResolvedValue([edition({ status: 'voting_live' })]);

    await expect(resolveOpenMicEdition('open-mic-competition')).resolves.toMatchObject({ id: 'edition-live' });
  });

  it('falls back on the type the registration plane locked, for a slug that is not in the catalog list', async () => {
    getContestBySlug.mockResolvedValue(null);
    listContests.mockResolvedValue([edition()]);

    // An admin who renames an edition leaves registrations pointing at a slug no
    // row carries and no catalog list contains; the locked catalog type is what
    // still identifies the application as Open Mic.
    await expect(
      resolveOpenMicEdition('spotlight-open-mic-2026-11', { contestType: 'one_beat_one_verse' }),
    ).resolves.toMatchObject({ id: 'edition-live' });
  });

  it('does not fall back for a registration that is not Open Mic', async () => {
    getContestBySlug.mockResolvedValue(null);
    listContests.mockResolvedValue([edition()]);

    await expect(
      resolveOpenMicEdition('talent-search-2026', { contestType: 'online_contest', contestCategory: 'entertainment' }),
    ).resolves.toBeNull();
    // The fallback must not even be looked for: an Open Mic edition attached to a
    // talent search application would give that applicant a beat to download.
    expect(listContests).not.toHaveBeenCalled();
  });

  it('is null when nothing is live to fall back to', async () => {
    getContestBySlug.mockResolvedValue(null);
    listContests.mockResolvedValue([edition({ status: 'winner_announced' }), edition({ id: 'draft-one', status: 'draft' })]);

    await expect(resolveOpenMicEdition('open-mic-competition')).resolves.toBeNull();
  });

  it('is null for an empty slug and no identity', async () => {
    await expect(resolveOpenMicEdition('')).resolves.toBeNull();
    await expect(resolveOpenMicEdition(null)).resolves.toBeNull();
    expect(getContestBySlug).not.toHaveBeenCalled();
  });

  it('ignores case and padding on the catalog slug', async () => {
    getContestBySlug.mockResolvedValue(null);
    listContests.mockResolvedValue([edition()]);

    await expect(resolveOpenMicEdition('  Open-Mic-Competition ')).resolves.toMatchObject({ id: 'edition-live' });
  });
});
