// ── Arena spectator reads — mock fallback (dev / offline) ────────────────────
// The public spectator screens (home leaderboard, State Pride, pot, driver
// profile) read from the Go backend. When it isn't running in dev these 404;
// these deterministic mocks keep the screens walkable. No effect once the backend
// is live (the api reads only fall back on error/empty).

import type {
  Competition,
  MeritLeaderboardEntry,
  StateStanding,
  PotSnapshot,
  PeoplesChampionTally,
} from './types';

const DRIVERS: { id: string; name: string; state: string; merit: number }[] = [
  { id: 'c1', name: 'Chidinma Okafor', state: 'Lagos', merit: 92 },
  { id: 'c2', name: 'Musa Ibrahim', state: 'Kano', merit: 88 },
  { id: 'c3', name: 'Tobi Adeyemi', state: 'Oyo', merit: 85 },
  { id: 'c4', name: 'Ngozi Eze', state: 'Rivers', merit: 81 },
  { id: 'c5', name: 'Fatima Bello', state: 'Kaduna', merit: 78 },
  { id: 'c6', name: 'Emeka Nwosu', state: 'Anambra', merit: 74 },
];

export function mockCompetition(id: string): Competition {
  return {
    id,
    title: 'Naija Driver Challenge 2026',
    season: '2026',
    status: 'LIVE',
    nextEventAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    nextEventLabel: 'Theory Batch 1',
    applicationsOpen: true,
    requiredKycTier: 1,
    summary: 'Nigeria’s national safe-driving competition.',
  };
}

export function mockCompetitions(): Competition[] {
  return [mockCompetition('6a07be6c-6a4b-4e55-b0b8-adb5e23da3c6')];
}

export function mockMeritLeaderboard(): MeritLeaderboardEntry[] {
  return DRIVERS.map((d, i) => ({
    rank: i + 1,
    contestantId: d.id,
    displayName: d.name,
    homeState: d.state,
    meritPoints: d.merit,
    state: i < 3 ? 'FINALIST' : 'QUALIFIED',
  }));
}

export function mockStatePride(): StateStanding[] {
  // Aggregate SUPPORT (real Naira, in kobo) by state — a display-only tally that
  // feeds the pot + State Pride award. Never Merit (NDC-1).
  const rows = [
    { state: 'Lagos', supportKobo: 125_000_000, contestants: 3 },   // ₦1,250,000
    { state: 'Kano', supportKobo: 98_000_000, contestants: 2 },     // ₦980,000
    { state: 'Rivers', supportKobo: 87_000_000, contestants: 2 },
    { state: 'Oyo', supportKobo: 64_000_000, contestants: 1 },
    { state: 'Kaduna', supportKobo: 51_000_000, contestants: 1 },
    { state: 'Anambra', supportKobo: 43_000_000, contestants: 1 },
  ];
  return rows
    .sort((a, b) => b.supportKobo - a.supportKobo)
    .map((r, i) => ({ rank: i + 1, ...r }));
}

export function mockPot(): PotSnapshot {
  return {
    totalKobo: 4_580_000_00,
    contributions: 1_284,
    split: [
      { label: 'Naija Driver crown prize', fraction: 0.6 },
      { label: 'People’s Champion', fraction: 0.15, note: 'Fan-funded — separate from the crown.' },
      { label: 'Scholarships & training', fraction: 0.2 },
      { label: 'Platform & processing', fraction: 0.05 },
    ],
    disbursements: [
      { label: 'Crown prize', amountKobo: 2_748_000_00, status: 'PENDING' },
      { label: 'People’s Champion', amountKobo: 687_000_00, status: 'PENDING' },
    ],
    updatedAt: new Date().toISOString(),
  };
}

export function mockPeoplesChampion(contestantId: string): PeoplesChampionTally {
  const idx = Math.max(0, DRIVERS.findIndex((d) => d.id === contestantId));
  return {
    contestantId,
    supportTotalKobo: (6 - idx) * 210_000_00,
    backers: (6 - idx) * 47,
    rank: idx + 1,
  };
}

export function mockDriverProfile(contestantId: string): {
  merit: MeritLeaderboardEntry | null;
  peoplesChampion: PeoplesChampionTally | null;
} {
  const merit = mockMeritLeaderboard().find((m) => m.contestantId === contestantId) ?? null;
  return { merit, peoplesChampion: mockPeoplesChampion(contestantId) };
}
