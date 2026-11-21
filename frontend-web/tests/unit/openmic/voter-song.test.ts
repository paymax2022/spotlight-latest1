import { describe, expect, it } from 'vitest';
import { pickPlayableSong } from '@/src/server/openmic/voter-song';
import type { OpenMicSubmission } from '@/src/features/openmic/types';

const SONG_KEY = 'openmic/open-mic-competition/artist-1/submission-1.mp3';

function submission(overrides: Partial<OpenMicSubmission> & { id: string }): OpenMicSubmission {
  return {
    contestId: 'contest-1',
    contestSlug: 'open-mic-competition',
    stageName: 'Artist',
    genre: 'Afrobeats',
    songTitle: 'Latest Take',
    songUrl: `/api/open-mic/songs/${overrides.id}`,
    songObjectKey: SONG_KEY.replace('submission-1', overrides.id),
    explicitVersion: false,
    cleanVersionAvailable: false,
    officialBeatConfirmed: true,
    ownershipConfirmed: true,
    noUnauthorizedSamplesConfirmed: true,
    finaleAvailabilityConfirmed: true,
    status: 'published_for_voting',
    voteCount: 0,
    leaderboardScore: 0,
    isFinalist: false,
    isWinner: false,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  } as OpenMicSubmission;
}

describe('pickPlayableSong', () => {
  it('hands the voter the reader URL for a playable submission', () => {
    const picked = pickPlayableSong([submission({ id: 'sub-1' })]);
    expect(picked).toEqual({
      submissionId: 'sub-1',
      audioUrl: '/api/open-mic/songs/sub-1',
      songTitle: 'Latest Take',
    });
  });

  it('takes the first playable row, which listSubmissions orders newest first', () => {
    const picked = pickPlayableSong([
      submission({ id: 'sub-new', songTitle: 'New take' }),
      submission({ id: 'sub-old', songTitle: 'Old take' }),
    ]);
    expect(picked?.submissionId).toBe('sub-new');
  });

  it('skips a draft so an unsubmitted upload never reaches a voter', () => {
    const picked = pickPlayableSong([
      submission({ id: 'sub-draft', status: 'draft', songTitle: 'Work in progress' }),
      submission({ id: 'sub-live', songTitle: 'Approved take' }),
    ]);
    expect(picked?.submissionId).toBe('sub-live');
  });

  it.each(['rejected', 'disqualified', 'under_review', 'correction_requested', 'awaiting_payment'] as const)(
    'keeps a %s entry out of the public player',
    (status) => {
      expect(pickPlayableSong([submission({ id: 'sub-x', status })])).toBeNull();
    },
  );

  it('skips a playable row that has no bytes behind it', () => {
    const picked = pickPlayableSong([
      submission({ id: 'sub-empty', songObjectKey: undefined, songUrl: '' }),
      submission({ id: 'sub-real' }),
    ]);
    expect(picked?.submissionId).toBe('sub-real');
  });

  it('returns null when there is nothing at all', () => {
    expect(pickPlayableSong([])).toBeNull();
  });

  it('reads a status of any case, because the column is text', () => {
    const shouted = 'Published_For_Voting' as unknown as OpenMicSubmission['status'];
    expect(pickPlayableSong([submission({ id: 'sub-1', status: shouted })])).not.toBeNull();
  });
});
