/**
 * Stages & Evictions (reality-show) admin data — the fifth console served over
 * PATH A (ADMIN CONSOLIDATION, slice 4; see
 * docs/adr/ADR-047-admin-console-consolidation-path-a.md).
 *
 * Its data has no Go module: seasons/contestants/weeks/votes/evictions live in
 * frontend-web's reality-show persistence layer (Supabase-backed — see
 * frontend-web/src/server/services/reality-show/persistence.ts) and arrive via
 * /api/web-proxy, same shape as contests/scoring/open-mic/registration. Every
 * route this calls already does its own Bearer-JWT auth via
 * assertAdminPermission(request, 'dashboard:view' | 'programs:manage') —
 * nothing changed on the frontend-web side, only a client + service on this
 * side reaching it through the proxy.
 *
 * Distinct from realityTvService.ts / /admin/reality-tv — that is a separate,
 * Go-backed module (universal voting engine) with its own applications and
 * vote counts. This console is the stages-evictions workflow: seasons,
 * bootcamp contestants, weekly eviction voting and finalization.
 */
import { webProxyBase } from '@/config/env';

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

export interface VoteTally {
  contestantId: string;
  voteCount: number;
  contestant: ShowContestant | null;
}

function webBase(): string {
  return webProxyBase();
}

function authHeaders(json = false): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  const headers: Record<string, string> = {};
  if (json) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function readJsonOrThrow(res: Response, label: string): Promise<Record<string, unknown>> {
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401) throw new Error(`${label} failed: 401 — sign in again.`);
  if (res.status === 403) throw new Error(`${label} failed: 403 — this account cannot manage this season.`);
  if (!res.ok) throw new Error(`${label} failed: ${(json.error as string) || res.status}`);
  return json;
}

async function getJson(path: string, label: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${webBase()}${path}`, { cache: 'no-store', headers: authHeaders() });
  return readJsonOrThrow(res, label);
}

async function postJson(path: string, body: unknown, label: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${webBase()}${path}`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(body ?? {}),
  });
  return readJsonOrThrow(res, label);
}

async function patchJson(path: string, body: unknown, label: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${webBase()}${path}`, {
    method: 'PATCH',
    headers: authHeaders(true),
    body: JSON.stringify(body ?? {}),
  });
  return readJsonOrThrow(res, label);
}

// ── Seasons ──────────────────────────────────────────────────────────────────

export async function listSeasons(): Promise<ShowSeason[]> {
  const json = await getJson('/api/admin/reality-show/seasons', 'Loading seasons');
  return (json.seasons as ShowSeason[]) ?? [];
}

export interface SeasonDetail {
  season: ShowSeason;
  contestants: ShowContestant[];
  weeks: EvictionWeek[];
  evictions: Eviction[];
}

export async function getSeasonDetail(seasonId: string): Promise<SeasonDetail> {
  const json = await getJson(`/api/admin/reality-show/seasons/${seasonId}`, 'Loading season');
  return {
    season: json.season as ShowSeason,
    contestants: (json.contestants as ShowContestant[]) ?? [],
    weeks: (json.weeks as EvictionWeek[]) ?? [],
    evictions: (json.evictions as Eviction[]) ?? [],
  };
}

export async function createSeason(input: {
  seasonName: string;
  seasonNumber: number;
  contestSlug?: string;
  auditionStartDate?: string;
  auditionEndDate?: string;
  bootcampStartDate?: string;
  bootcampEndDate?: string;
  notes?: string;
}): Promise<ShowSeason> {
  const json = await postJson('/api/admin/reality-show/seasons', input, 'Creating season');
  return json.season as ShowSeason;
}

export async function updateSeason(
  seasonId: string,
  patch: Partial<Pick<ShowSeason, 'seasonName' | 'seasonNumber' | 'currentPhase' | 'status' | 'notes'>>,
): Promise<ShowSeason> {
  const json = await patchJson(`/api/admin/reality-show/seasons/${seasonId}`, patch, 'Updating season');
  return json.season as ShowSeason;
}

// ── Contestants ──────────────────────────────────────────────────────────────

export async function addContestant(
  seasonId: string,
  input: { displayName: string; applicationId: string; stageName?: string; primaryTalent?: string; bioNotes?: string },
): Promise<ShowContestant> {
  const json = await postJson(`/api/admin/reality-show/seasons/${seasonId}/contestants`, input, 'Adding contestant');
  return json.contestant as ShowContestant;
}

export type ContestantAction = 'promote_to_bootcamp' | 'fail_audition' | 'declare_winner' | 'declare_finalist';

export async function actOnContestant(
  contestantId: string,
  action: ContestantAction,
  extra?: { position?: number },
): Promise<ShowContestant> {
  const json = await patchJson(
    `/api/admin/reality-show/contestants/${contestantId}`,
    { action, ...extra },
    'Updating contestant',
  );
  return json.contestant as ShowContestant;
}

// ── Weeks ────────────────────────────────────────────────────────────────────

export async function createWeek(
  seasonId: string,
  input: { weekNumber: number; title?: string; theme?: string; evictionCount?: number },
): Promise<EvictionWeek> {
  const json = await postJson(`/api/admin/reality-show/seasons/${seasonId}/weeks`, input, 'Creating week');
  return json.week as EvictionWeek;
}

export async function setWeekStatus(weekId: string, status: 'upcoming' | 'open' | 'closed'): Promise<EvictionWeek> {
  const json = await patchJson(`/api/admin/reality-show/weeks/${weekId}/status`, { status }, 'Updating week status');
  return json.week as EvictionWeek;
}

// ── Votes ────────────────────────────────────────────────────────────────────

export interface WeekVotes {
  week: EvictionWeek;
  votes: EvictionVote[];
  tallies: VoteTally[];
}

export async function getWeekVotes(weekId: string): Promise<WeekVotes> {
  const json = await getJson(`/api/admin/reality-show/weeks/${weekId}/vote`, 'Loading votes');
  return {
    week: json.week as EvictionWeek,
    votes: (json.votes as EvictionVote[]) ?? [],
    tallies: (json.tallies as VoteTally[]) ?? [],
  };
}

export async function castVote(weekId: string, contestantId: string, reason?: string): Promise<EvictionVote> {
  const json = await postJson(`/api/admin/reality-show/weeks/${weekId}/vote`, { contestantId, reason }, 'Casting vote');
  return json.vote as EvictionVote;
}

// ── Eviction finalization ────────────────────────────────────────────────────

export interface FinalizeEvictionResult {
  week: EvictionWeek;
  evictions: Eviction[];
  evictedContestants: ShowContestant[];
}

export async function finalizeEviction(weekId: string, note?: string): Promise<FinalizeEvictionResult> {
  const json = await postJson(`/api/admin/reality-show/weeks/${weekId}/evict`, { note }, 'Finalizing eviction');
  return {
    week: json.week as EvictionWeek,
    evictions: (json.evictions as Eviction[]) ?? [],
    evictedContestants: (json.evictedContestants as ShowContestant[]) ?? [],
  };
}
