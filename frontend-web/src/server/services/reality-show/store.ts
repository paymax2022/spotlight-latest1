import { randomUUID } from 'crypto';

// ── Types ────────────────────────────────────────────────────────────────────

export type ShowPhase = 'pre_audition' | 'audition' | 'bootcamp' | 'finale' | 'completed';
export type SeasonStatus = 'draft' | 'active' | 'completed';
export type PhaseStatus = 'audition' | 'bootcamp' | 'evicted' | 'finalist' | 'winner';
export type AuditionResult = 'pending' | 'passed' | 'failed';
export type WeekStatus = 'upcoming' | 'open' | 'closed' | 'eviction_declared';

export interface ShowSeason {
  id: string;
  seasonName: string;
  seasonNumber: number;
  contestSlug: string;
  currentPhase: ShowPhase;
  auditionStartDate: string;
  auditionEndDate: string;
  bootcampStartDate: string;
  bootcampEndDate: string;
  status: SeasonStatus;
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShowContestant {
  id: string;
  seasonId: string;
  applicationId: string;
  userId: string;
  displayName: string;
  stageName: string;
  primaryTalent: string;
  photoUrl: string;
  phaseStatus: PhaseStatus;
  auditionResult: AuditionResult;
  enteredBootcampAt: string | null;
  evictedAt: string | null;
  evictedWeek: number | null;
  finalistPosition: number | null;
  isActive: boolean;
  bioNotes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface EvictionWeek {
  id: string;
  seasonId: string;
  weekNumber: number;
  title: string;
  theme: string;
  votingOpensAt: string | null;
  votingClosesAt: string | null;
  status: WeekStatus;
  evictionCount: number;
  evictionFinalized: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface EvictionVote {
  id: string;
  weekId: string;
  voterId: string;
  voterName: string;
  voterRole: string;
  contestantId: string;
  reason: string;
  votedAt: string;
}

export interface Eviction {
  id: string;
  weekId: string;
  seasonId: string;
  contestantId: string;
  voteCount: number;
  evictionOrder: number;
  evictionNote: string;
  evictedBy: string;
  evictedAt: string;
}

// ── In-memory store ───────────────────────────────────────────────────────────

interface RealityShowStore {
  seasons: Map<string, ShowSeason>;
  contestants: Map<string, ShowContestant>;
  weeks: Map<string, EvictionWeek>;
  votes: Map<string, EvictionVote>;
  evictions: Map<string, Eviction>;
}

function getStore(): RealityShowStore {
  const key = '__spotlightRealityShowStore';
  const g = globalThis as unknown as Record<string, RealityShowStore | undefined>;
  if (!g[key]) {
    g[key] = {
      seasons: new Map(),
      contestants: new Map(),
      weeks: new Map(),
      votes: new Map(),
      evictions: new Map(),
    };
  }
  return g[key] as RealityShowStore;
}

function now(): string {
  return new Date().toISOString();
}

// ── Seasons ───────────────────────────────────────────────────────────────────

export function listSeasons(): ShowSeason[] {
  return Array.from(getStore().seasons.values()).sort((a, b) => b.seasonNumber - a.seasonNumber);
}

export function getSeason(id: string): ShowSeason | null {
  return getStore().seasons.get(id) ?? null;
}

export function createSeason(input: {
  seasonName: string;
  seasonNumber: number;
  contestSlug?: string;
  auditionStartDate?: string;
  auditionEndDate?: string;
  bootcampStartDate?: string;
  bootcampEndDate?: string;
  notes?: string;
  createdBy: string;
}): ShowSeason {
  const season: ShowSeason = {
    id: randomUUID(),
    seasonName: input.seasonName,
    seasonNumber: input.seasonNumber,
    contestSlug: input.contestSlug ?? 'reality-tv-show',
    currentPhase: 'pre_audition',
    auditionStartDate: input.auditionStartDate ?? '',
    auditionEndDate: input.auditionEndDate ?? '',
    bootcampStartDate: input.bootcampStartDate ?? '',
    bootcampEndDate: input.bootcampEndDate ?? '',
    status: 'draft',
    notes: input.notes ?? '',
    createdBy: input.createdBy,
    createdAt: now(),
    updatedAt: now(),
  };
  getStore().seasons.set(season.id, season);
  return season;
}

export function updateSeason(id: string, patch: Partial<Omit<ShowSeason, 'id' | 'createdAt' | 'createdBy'>>): ShowSeason {
  const store = getStore();
  const season = store.seasons.get(id);
  if (!season) throw new Error('Season not found');
  const updated: ShowSeason = { ...season, ...patch, updatedAt: now() };
  store.seasons.set(id, updated);
  return updated;
}

// ── Contestants ───────────────────────────────────────────────────────────────

export function listContestants(seasonId: string, phaseStatus?: PhaseStatus): ShowContestant[] {
  return Array.from(getStore().contestants.values())
    .filter((c) => c.seasonId === seasonId && (!phaseStatus || c.phaseStatus === phaseStatus))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getContestant(id: string): ShowContestant | null {
  return getStore().contestants.get(id) ?? null;
}

export function addContestant(input: {
  seasonId: string;
  applicationId: string;
  userId: string;
  displayName: string;
  stageName?: string;
  primaryTalent?: string;
  photoUrl?: string;
  bioNotes?: string;
  createdBy: string;
}): ShowContestant {
  const store = getStore();
  // Prevent duplicates
  const exists = Array.from(store.contestants.values()).find(
    (c) => c.seasonId === input.seasonId && c.applicationId === input.applicationId
  );
  if (exists) return exists;

  const contestant: ShowContestant = {
    id: randomUUID(),
    seasonId: input.seasonId,
    applicationId: input.applicationId,
    userId: input.userId,
    displayName: input.displayName,
    stageName: input.stageName ?? '',
    primaryTalent: input.primaryTalent ?? '',
    photoUrl: input.photoUrl ?? '',
    phaseStatus: 'audition',
    auditionResult: 'pending',
    enteredBootcampAt: null,
    evictedAt: null,
    evictedWeek: null,
    finalistPosition: null,
    isActive: true,
    bioNotes: input.bioNotes ?? '',
    createdBy: input.createdBy,
    createdAt: now(),
    updatedAt: now(),
  };
  store.contestants.set(contestant.id, contestant);
  return contestant;
}

export function updateContestant(
  id: string,
  patch: Partial<Omit<ShowContestant, 'id' | 'seasonId' | 'applicationId' | 'createdAt' | 'createdBy'>>
): ShowContestant {
  const store = getStore();
  const c = store.contestants.get(id);
  if (!c) throw new Error('Contestant not found');
  const updated: ShowContestant = { ...c, ...patch, updatedAt: now() };
  store.contestants.set(id, updated);
  return updated;
}

export function promoteToBootcamp(contestantId: string): ShowContestant {
  return updateContestant(contestantId, {
    phaseStatus: 'bootcamp',
    auditionResult: 'passed',
    enteredBootcampAt: now(),
    isActive: true,
  });
}

export function failAudition(contestantId: string): ShowContestant {
  return updateContestant(contestantId, {
    auditionResult: 'failed',
    isActive: false,
  });
}

// ── Weekly rounds ─────────────────────────────────────────────────────────────

export function listWeeks(seasonId: string): EvictionWeek[] {
  return Array.from(getStore().weeks.values())
    .filter((w) => w.seasonId === seasonId)
    .sort((a, b) => a.weekNumber - b.weekNumber);
}

export function getWeek(id: string): EvictionWeek | null {
  return getStore().weeks.get(id) ?? null;
}

export function createWeek(input: {
  seasonId: string;
  weekNumber: number;
  title?: string;
  theme?: string;
  votingOpensAt?: string;
  votingClosesAt?: string;
  evictionCount?: number;
  createdBy: string;
}): EvictionWeek {
  const store = getStore();
  const existing = Array.from(store.weeks.values()).find(
    (w) => w.seasonId === input.seasonId && w.weekNumber === input.weekNumber
  );
  if (existing) throw new Error(`Week ${input.weekNumber} already exists for this season`);

  const week: EvictionWeek = {
    id: randomUUID(),
    seasonId: input.seasonId,
    weekNumber: input.weekNumber,
    title: input.title ?? `Week ${input.weekNumber} Eviction`,
    theme: input.theme ?? '',
    votingOpensAt: input.votingOpensAt ?? null,
    votingClosesAt: input.votingClosesAt ?? null,
    status: 'upcoming',
    evictionCount: input.evictionCount ?? 1,
    evictionFinalized: false,
    createdBy: input.createdBy,
    createdAt: now(),
    updatedAt: now(),
  };
  store.weeks.set(week.id, week);
  return week;
}

export function updateWeek(id: string, patch: Partial<Omit<EvictionWeek, 'id' | 'seasonId' | 'createdAt' | 'createdBy'>>): EvictionWeek {
  const store = getStore();
  const week = store.weeks.get(id);
  if (!week) throw new Error('Week not found');
  const updated: EvictionWeek = { ...week, ...patch, updatedAt: now() };
  store.weeks.set(id, updated);
  return updated;
}

export function openVoting(weekId: string): EvictionWeek {
  return updateWeek(weekId, { status: 'open' });
}

export function closeVoting(weekId: string): EvictionWeek {
  return updateWeek(weekId, { status: 'closed' });
}

// ── Votes ─────────────────────────────────────────────────────────────────────

export function getVotesForWeek(weekId: string): EvictionVote[] {
  return Array.from(getStore().votes.values()).filter((v) => v.weekId === weekId);
}

export function getVoteTallies(weekId: string): Array<{ contestantId: string; voteCount: number }> {
  const votes = getVotesForWeek(weekId);
  const map = new Map<string, number>();
  for (const v of votes) {
    map.set(v.contestantId, (map.get(v.contestantId) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([contestantId, voteCount]) => ({ contestantId, voteCount }))
    .sort((a, b) => b.voteCount - a.voteCount);
}

export function castVote(input: {
  weekId: string;
  voterId: string;
  voterName: string;
  voterRole: string;
  contestantId: string;
  reason?: string;
}): EvictionVote {
  const store = getStore();

  // Idempotent: same voter, same week, same contestant
  const existing = Array.from(store.votes.values()).find(
    (v) => v.weekId === input.weekId && v.voterId === input.voterId && v.contestantId === input.contestantId
  );
  if (existing) return existing;

  const vote: EvictionVote = {
    id: randomUUID(),
    weekId: input.weekId,
    voterId: input.voterId,
    voterName: input.voterName,
    voterRole: input.voterRole,
    contestantId: input.contestantId,
    reason: input.reason ?? '',
    votedAt: now(),
  };
  store.votes.set(vote.id, vote);
  return vote;
}

export function retractVote(weekId: string, voterId: string, contestantId: string): boolean {
  const store = getStore();
  const vote = Array.from(store.votes.values()).find(
    (v) => v.weekId === weekId && v.voterId === voterId && v.contestantId === contestantId
  );
  if (!vote) return false;
  store.votes.delete(vote.id);
  return true;
}

// ── Eviction finalization ─────────────────────────────────────────────────────

export interface FinalizeEvictionResult {
  week: EvictionWeek;
  evictions: Eviction[];
  evictedContestants: ShowContestant[];
}

export function finalizeEviction(weekId: string, evictedBy: string, note?: string): FinalizeEvictionResult {
  const store = getStore();
  const week = store.weeks.get(weekId);
  if (!week) throw new Error('Week not found');
  if (week.evictionFinalized) throw new Error('Eviction already finalized for this week');
  if (week.status !== 'closed') throw new Error('Close voting before finalizing eviction');

  const tallies = getVoteTallies(weekId);
  if (tallies.length === 0) throw new Error('No votes cast yet');

  // Evict the top N contestants by vote count
  const toEvict = tallies.slice(0, week.evictionCount);
  const evictionRecords: Eviction[] = [];
  const evictedContestants: ShowContestant[] = [];

  toEvict.forEach((tally, idx) => {
    const eviction: Eviction = {
      id: randomUUID(),
      weekId,
      seasonId: week.seasonId,
      contestantId: tally.contestantId,
      voteCount: tally.voteCount,
      evictionOrder: idx + 1,
      evictionNote: note ?? '',
      evictedBy,
      evictedAt: now(),
    };
    store.evictions.set(eviction.id, eviction);
    evictionRecords.push(eviction);

    const updated = updateContestant(tally.contestantId, {
      phaseStatus: 'evicted',
      isActive: false,
      evictedAt: now(),
      evictedWeek: week.weekNumber,
    });
    evictedContestants.push(updated);
  });

  const updatedWeek = updateWeek(weekId, { status: 'eviction_declared', evictionFinalized: true });
  return { week: updatedWeek, evictions: evictionRecords, evictedContestants };
}

export function getEvictionsForSeason(seasonId: string): Eviction[] {
  return Array.from(getStore().evictions.values())
    .filter((e) => e.seasonId === seasonId)
    .sort((a, b) => a.evictedAt.localeCompare(b.evictedAt));
}

export function getEvictionsForWeek(weekId: string): Eviction[] {
  return Array.from(getStore().evictions.values()).filter((e) => e.weekId === weekId);
}
