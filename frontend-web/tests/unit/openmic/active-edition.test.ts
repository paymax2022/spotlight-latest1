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

// The selector's contract is that it classifies the whole status vocabulary,
// and the union in `types.ts` is the only place that vocabulary is written
// down — nothing in this repo enumerates it at runtime. So completeness can
// only be checked by the compiler: drop any status from the two lists below
// and `tsc` fails on the assertion after them, which is the mistake that made
// the finale statuses look ended. Exported so it reads as deliberate rather
// than an unused local.
const LIVE_STATUSES = [
  'published', 'registration_open', 'beat_available', 'submission_open',
  'submission_closed', 'under_review', 'voting_live', 'voting_closed',
  'finalists_selected', 'grand_finale_scheduled', 'grand_finale_live',
] as const satisfies readonly OpenMicContest['status'][];

const ENDED_STATUSES = [
  'draft', 'scheduled', 'winner_announced', 'completed', 'archived', 'suspended', 'cancelled',
] as const satisfies readonly OpenMicContest['status'][];

type Unclassified = Exclude<OpenMicContest['status'], typeof LIVE_STATUSES[number] | typeof ENDED_STATUSES[number]>;

export const EVERY_STATUS_IS_CLASSIFIED: [Unclassified] extends [never] ? true : ['status classified nowhere', Unclassified] = true;

describe('getActiveOpenMicEdition', () => {
  it('returns the newest row whose status is still live', async () => {
    listContests.mockResolvedValue([contest({ slug: 'newest', status: 'submission_open' }), contest({ slug: 'oldest', status: 'voting_live' })]);
    const picked = await getActiveOpenMicEdition();
    expect(picked?.slug).toBe('newest');
  });

  it('counts every status in which a step of the route is still live', async () => {
    for (const status of LIVE_STATUSES) {
      listContests.mockResolvedValue([contest({ status })]);
      expect(await getActiveOpenMicEdition()).not.toBeNull();
    }
  });

  it('ignores editions that never started, finished, or were called off', async () => {
    for (const status of ENDED_STATUSES) {
      listContests.mockResolvedValue([contest({ status })]);
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
