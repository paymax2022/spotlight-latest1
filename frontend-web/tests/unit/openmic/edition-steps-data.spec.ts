// The steps block gets one serialisable object from the server so no client
// branch re-derives availability, re-filters the board, or has to know that
// `voteCountPublic` can be turned off by an admin.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listContests = vi.hoisted(() => vi.fn());
const getLeaderboard = vi.hoisted(() => vi.fn());
vi.mock('@/src/server/openmic/persistence', () => ({ listContests, getLeaderboard }));

import {
  buildOpenMicEditionStepsData,
  loadOpenMicEditionSteps,
  type OpenMicEditionStepsData,
} from '@/src/features/openmic/active-edition';
import type { OpenMicContest, OpenMicSubmission } from '@/src/features/openmic/types';

const START = '2026-11-01T00:00:00.000Z';
const END = '2026-11-30T23:59:59.000Z';

function contest(overrides: Partial<OpenMicContest> = {}): OpenMicContest {
  return {
    id: 'contest-1', slug: 'open-mic-dev', title: 'November Open Mic', status: 'voting_live',
    month: 11, year: 2026, season: 'Season 2', description: '', visibility: 'public',
    registrationFeeNgn: 1500, entryFeeRequired: true, selectionModel: 'hybrid',
    finalistsTarget: 10, judgeWeight: 30, publicVoteWeight: 70,
    registrationStartAt: START, registrationEndAt: END, submissionStartAt: START, submissionEndAt: END,
    votingConfig: { enabled: true, freeVoting: true, freeVotesPerDay: 3, paidVoting: true, votePrice: 100, leaderboardVisible: true, voteCountPublic: true, votingStartAt: START, votingEndAt: END },
    recurrence: { enabled: false, repeatMonths: 1, autoCreateNext: false, autoCopySettings: true, autoPublishFuture: false, requireNewBeatEveryMonth: true },
    finale: { venueName: 'Spotlight Lounge', venueType: 'lounge', address: '', city: 'Lagos', state: 'Lagos', playbackMode: 'top_10' },
    finalePlaylist: [], finalePlaylistLocked: false, prizes: [], createdAt: START, updatedAt: START,
    beat: {
      id: 'beat-1', contestId: 'contest-1', beatTitle: 'Street Light', producerName: 'DJ Wole',
      producerCredit: 'DJ Wole', previewUrl: '/api/open-mic/beats/abc', downloadUrl: '/api/open-mic/beats/abc?download=1',
      genre: 'Hip Hop', usageRules: 'Original bars only.', allowDownload: true, previewOnly: false,
      requiresPaidEntryForDownload: false, explicitLyricsAllowed: true, cleanVersionRequired: false,
    },
    ...overrides,
  } as OpenMicContest;
}

function entry(n: number, overrides: Partial<OpenMicSubmission> = {}): OpenMicSubmission {
  return {
    id: `entry-${n}`, contestId: 'contest-1', contestSlug: 'open-mic-dev',
    stageName: `Artist ${n}`, songTitle: `Track ${n}`, songUrl: `/api/open-mic/songs/entry-${n}`,
    genre: 'Hip Hop', status: 'published_for_voting', voteCount: n * 10, leaderboardScore: n * 10,
    explicitVersion: false, officialBeatConfirmed: true, ownershipConfirmed: true,
    isFinalist: false, isWinner: false, createdAt: START, updatedAt: START,
    ...overrides,
  } as OpenMicSubmission;
}

beforeEach(() => {
  listContests.mockReset();
  getLeaderboard.mockReset();
});

describe('buildOpenMicEditionStepsData', () => {
  it('normalises every window date to a string or null, never undefined', () => {
    const bare = buildOpenMicEditionStepsData(contest({ registrationStartAt: undefined, submissionEndAt: undefined }), []);
    expect(bare.registrationStartAt).toBeNull();
    expect(bare.submissionEndAt).toBeNull();
    expect(bare.votingStartAt).toBe(START);
    expect(JSON.parse(JSON.stringify(bare))).toEqual(bare);
  });

  it('exposes the beat that is publicly playable', () => {
    const data = buildOpenMicEditionStepsData(contest(), []);
    expect(data.beat).toMatchObject({
      title: 'Street Light', producerCredit: 'DJ Wole', usageRules: 'Original bars only.',
      previewUrl: '/api/open-mic/beats/abc', downloadUrl: '/api/open-mic/beats/abc?download=1',
      downloadable: true, requiresPaidEntry: false,
    });
  });

  it('nulls a legacy owner-only beat URL so no surface offers a player that 403s', () => {
    const data = buildOpenMicEditionStepsData(
      contest({ beat: { ...contest().beat!, previewUrl: '/api/registration/uploads/x.mp3', downloadUrl: '/api/registration/uploads/x.mp3' } }),
      [],
    );
    expect(data.beat?.previewUrl).toBeNull();
    expect(data.beat?.downloadUrl).toBeNull();
    expect(data.beat?.downloadable).toBe(false);
  });

  it('keeps the player but drops the download button when the admin switched download off', () => {
    const data = buildOpenMicEditionStepsData(contest({ beat: { ...contest().beat!, allowDownload: false } }), []);
    expect(data.beat?.previewUrl).toBe('/api/open-mic/beats/abc');
    expect(data.beat?.downloadable).toBe(false);
  });

  it('truncates the board to five in the order given, with canonical artist slugs', () => {
    const board = Array.from({ length: 8 }, (_, i) => entry(i + 1));
    const data = buildOpenMicEditionStepsData(contest(), board);
    expect(data.leaderboard.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(data.leaderboard[0]).toEqual({ rank: 1, artistSlug: 'artist-1', stageName: 'Artist 1', songTitle: 'Track 1', voteCount: 10 });
    expect(data.entryCount).toBe(8);
    expect(data.totalVotes).toBe(360);
  });

  it('slugifies a name with punctuation exactly as the entry page looks it up', () => {
    const data = buildOpenMicEditionStepsData(contest(), [entry(1, { stageName: 'K1ng$hoota' })]);
    expect(data.leaderboard[0].artistSlug).toBe('k1nghoota');
  });

  it('carries the two admin display switches through as booleans', () => {
    const hidden = buildOpenMicEditionStepsData(
      contest({ votingConfig: { ...contest().votingConfig, leaderboardVisible: false, voteCountPublic: false } }),
      [entry(1)],
    );
    expect(hidden.showLeaderboard).toBe(false);
    expect(hidden.showVoteCounts).toBe(false);
  });
});

describe('loadOpenMicEditionSteps', () => {
  it('returns null with no current edition and never queries a board', async () => {
    listContests.mockResolvedValue([contest({ status: 'draft' })]);
    expect(await loadOpenMicEditionSteps()).toBeNull();
    expect(getLeaderboard).not.toHaveBeenCalled();
  });

  it('degrades to an empty board when the leaderboard read throws, so the page still renders', async () => {
    listContests.mockResolvedValue([contest()]);
    getLeaderboard.mockRejectedValue(new Error('db down'));
    const data: OpenMicEditionStepsData | null = await loadOpenMicEditionSteps();
    expect(data?.leaderboard).toEqual([]);
    expect(data?.slug).toBe('open-mic-dev');
  });
});
