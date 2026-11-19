import type { OpenMicContest, OpenMicFinaleConfig, OpenMicPrizePackage, OpenMicVotingConfig } from './types';

export const OPEN_MIC_CONTEST_TYPE = 'one_beat_one_verse';

/**
 * `contests.category` the registration plane writes for Open Mic, from the
 * catalog entry in `src/features/registration/reference-data.ts`. It is a second
 * identity for the same edition, and older rows carry only this one.
 */
export const OPEN_MIC_REGISTRATION_CATEGORY = 'open_mic';

/**
 * Slugs a `registrations` row or an edition may use for Open Mic.
 *
 * `open-mic-competition` is the registration catalog slug, `open-mic` is what the
 * programme pages link, and `open-mic-2026` is an edition the admin created by
 * hand. A registration stores the catalog slug while an edition has its own, so
 * approval on either must count — see `src/server/openmic/edition-identity.ts`.
 */
export const OPEN_MIC_CONTEST_SLUGS = ['open-mic-competition', 'open-mic', 'open-mic-2026'];

export const defaultVotingConfig: OpenMicVotingConfig = {
  enabled: true,
  freeVoting: true,
  freeVotesPerDay: 5,
  paidVoting: true,
  votePrice: 50,
  voteBundlePrice: 200,
  voteBundleCount: 5,
  leaderboardVisible: true,
  voteCountPublic: true,
  minVotePurchase: 1,
  maxVotePurchase: 500,
  suspiciousVoteThreshold: 100,
  suspiciousVoteHighThreshold: 300,
};

export const defaultFinaleConfig: OpenMicFinaleConfig = {
  venueName: 'Spotlight Lounge',
  venueType: 'lounge',
  address: 'Victoria Island',
  city: 'Lagos',
  state: 'Lagos',
  playbackMode: 'top_10',
};

export const defaultPrizePackages: OpenMicPrizePackage[] = [
  {
    id: 'monthly-winner',
    title: 'Monthly Winner Package',
    description: 'Studio session, promotion, and ecosystem progression',
    prizeType: 'monthly_winner',
    cashValueNgn: 250000,
    nonCashValue: 'Studio session, promo rollout, and Spotlight media interview',
    numberOfWinners: 1,
  },
];

export function buildDefaultOpenMicContest(now = new Date()): Partial<OpenMicContest> {
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const monthName = now.toLocaleString('en-US', { month: 'long' });
  return {
    title: `Spotlight Open Mic - ${monthName} Edition`,
    slug: `spotlight-open-mic-${year}-${String(month).padStart(2, '0')}`,
    month,
    year,
    season: `Season ${year}`,
    description: `One Beat. One Song. One Shot at the Spotlight - ${monthName} ${year} edition.`,
    objective: 'Discover and elevate emerging music talents through monthly beat-based song contests.',
    theme: 'One Beat One Song',
    hashtag: '#SpotlightOpenMic',
    status: 'draft',
    visibility: 'public',
    registrationFeeNgn: 0,
    entryFeeRequired: false,
    votingConfig: { ...defaultVotingConfig },
    recurrence: {
      enabled: false,
      repeatMonths: 1,
      autoCreateNext: false,
      autoCopySettings: true,
      autoPublishFuture: false,
      requireNewBeatEveryMonth: true,
    },
    selectionModel: 'hybrid',
    finalistsTarget: 10,
    judgeWeight: 30,
    publicVoteWeight: 70,
    finale: { ...defaultFinaleConfig },
    finalePlaylist: [],
    finalePlaylistLocked: false,
    prizes: [...defaultPrizePackages],
  };
}
