// "The current edition" must mean one thing everywhere. listContests() already
// filters by contest_type and visibility, so the only judgement left is which
// statuses still count as live — and the old apply page answered it with
// `|| contests[0]`, which sent people to a draft or ended edition whenever
// nothing was live.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listContests = vi.hoisted(() => vi.fn());
vi.mock('@/src/server/openmic/persistence', () => ({ listContests }));

import { getActiveOpenMicEdition } from '@/src/features/openmic/active-edition';
import type { OpenMicContest } from '@/src/features/openmic/types';

const START = '2026-11-01T00:00:00.000Z';
const END = '2026-11-30T23:59:59.000Z';

function contest(overrides: Partial<OpenMicContest> = {}): OpenMicContest {
  return {
    id: 'contest-1',
    title: 'November Open Mic',
    slug: 'open-mic-dev',
    status: 'voting_live',
    visibility: 'public',
    month: 11,
    year: 2026,
    season: 'Season 2',
    description: '',
    registrationFeeNgn: 0,
    entryFeeRequired: false,
    selectionModel: 'hybrid',
    finalistsTarget: 10,
    judgeWeight: 30,
    publicVoteWeight: 70,
    registrationStartAt: START,
    registrationEndAt: END,
    submissionStartAt: START,
    submissionEndAt: END,
    votingConfig: { enabled: true, freeVoting: true, freeVotesPerDay: 3, paidVoting: true, votePrice: 100, leaderboardVisible: true, voteCountPublic: true, votingStartAt: START, votingEndAt: END },
    recurrence: { enabled: false, repeatMonths: 1, autoCreateNext: false, autoCopySettings: true, autoPublishFuture: false, requireNewBeatEveryMonth: true },
    finale: { venueName: 'Spotlight Lounge', venueType: 'lounge', address: '', city: 'Lagos', state: 'Lagos', playbackMode: 'top_10' },
    finalePlaylist: [],
    finalePlaylistLocked: false,
    prizes: [],
    createdAt: START,
    updatedAt: START,
    ...overrides,
  } as OpenMicContest;
}

beforeEach(() => {
  listContests.mockReset();
});

describe('getActiveOpenMicEdition', () => {
  it('returns the newest row whose status is still live', async () => {
    listContests.mockResolvedValue([contest({ slug: 'newest', status: 'submission_open' }), contest({ slug: 'oldest', status: 'voting_live' })]);
    const picked = await getActiveOpenMicEdition();
    expect(picked?.slug).toBe('newest');
  });

  // These two loops together must name all 18 members of OpenMicContestStatus.
  // A status missing from both is unclassified, and the selector silently
  // treats it as ended — which is how the finale statuses went blank.
  it('counts every status in which a step of the route is still live', async () => {
    for (const status of ['published', 'registration_open', 'beat_available', 'submission_open', 'submission_closed', 'under_review', 'voting_live', 'voting_closed', 'finalists_selected', 'grand_finale_scheduled', 'grand_finale_live']) {
      listContests.mockResolvedValue([contest({ status: status as OpenMicContest['status'] })]);
      expect(await getActiveOpenMicEdition()).not.toBeNull();
    }
  });

  it('ignores editions that never started, finished, or were called off', async () => {
    for (const status of ['draft', 'scheduled', 'winner_announced', 'completed', 'archived', 'suspended', 'cancelled']) {
      listContests.mockResolvedValue([contest({ status: status as OpenMicContest['status'] })]);
      expect(await getActiveOpenMicEdition()).toBeNull();
    }
  });

  it('never falls back to an unreadable edition when nothing qualifies', async () => {
    listContests.mockResolvedValue([contest({ status: 'draft', slug: 'draft-one' })]);
    expect(await getActiveOpenMicEdition()).toBeNull();
  });

  it('does not re-filter: it asks listContests for its default, public view', async () => {
    listContests.mockResolvedValue([]);
    await getActiveOpenMicEdition();
    expect(listContests).toHaveBeenCalledWith();
  });
});
