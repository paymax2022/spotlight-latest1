/**
 * Reality-show storage, backed by Postgres.
 *
 * WHY THIS EXISTS
 * ---------------
 * `./store` keeps seasons, contestants, weeks, votes and evictions in five
 * `Map`s hanging off globalThis. Everything the stages-evictions console shows
 * lives in the web app's process: an eviction declared on Monday is gone when
 * the app restarts, and two instances disagree about who is still in the show.
 *
 * The tables for all five entities ALREADY EXISTED (reality_show_seasons,
 * _contestants, _weeks, _eviction_votes, _evictions) with columns matching the
 * TypeScript model field for field, RLS policies, and the two uniqueness
 * constraints this logic needs. They were simply never wired up. This module is
 * that wiring — there is no migration, because the schema was already right.
 *
 * SHAPE
 * -----
 * The API mirrors ./store exactly, except every function is async. Callers must
 * await. The memory store remains the fallback for environments with no usable
 * Supabase config (the same pattern as openmic/persistence), so local work
 * without a database keeps functioning.
 *
 * WHAT THE DATABASE ENFORCES THAT MEMORY COULD NOT
 * ------------------------------------------------
 *  • castVote  — UNIQUE (week_id, voter_id, contestant_id). The memory version
 *    read-then-wrote, which races; this upserts on the constraint, so a double
 *    submit is one vote by construction rather than by timing.
 *  • finalizeEviction — UNIQUE (week_id, contestant_id). The memory version
 *    would duplicate eviction rows if retried after a partial failure. Writes
 *    are ordered evictions → contestants → week, and every step is idempotent,
 *    so an interrupted finalize can simply be run again.
 */
import { createAdminClient } from '@/lib/supabase/server';
import { hasUsableSupabaseConfig } from '@/lib/supabase/runtime';
import type {
  Eviction,
  EvictionVote,
  EvictionWeek,
  FinalizeEvictionResult,
  PhaseStatus,
  ShowContestant,
  ShowSeason,
} from './store';
import {
  addContestant as addContestantMemory,
  castVote as castVoteMemory,
  closeVoting as closeVotingMemory,
  createSeason as createSeasonMemory,
  createWeek as createWeekMemory,
  failAudition as failAuditionMemory,
  finalizeEviction as finalizeEvictionMemory,
  getContestant as getContestantMemory,
  getEvictionsForSeason as getEvictionsForSeasonMemory,
  getEvictionsForWeek as getEvictionsForWeekMemory,
  getSeason as getSeasonMemory,
  getVotesForWeek as getVotesForWeekMemory,
  getVoteTallies as getVoteTalliesMemory,
  getWeek as getWeekMemory,
  listContestants as listContestantsMemory,
  listSeasons as listSeasonsMemory,
  listWeeks as listWeeksMemory,
  openVoting as openVotingMemory,
  promoteToBootcamp as promoteToBootcampMemory,
  retractVote as retractVoteMemory,
  updateContestant as updateContestantMemory,
  updateSeason as updateSeasonMemory,
  updateWeek as updateWeekMemory,
} from './store';

const live = () => hasUsableSupabaseConfig();
const db = () => createAdminClient();
const nowIso = () => new Date().toISOString();

// `created_by` is a nullable uuid FK; the TS model uses '' for "nobody".
const uid = (v: string | null | undefined) => (v && v.trim() ? v : null);
const str = (v: unknown) => (v == null ? '' : String(v));

// ── Row mappers ──────────────────────────────────────────────────────────────

function toSeason(r: any): ShowSeason {
  return {
    id: r.id,
    seasonName: str(r.season_name),
    seasonNumber: Number(r.season_number ?? 1),
    contestSlug: str(r.contest_slug),
    currentPhase: r.current_phase,
    auditionStartDate: str(r.audition_start_date),
    auditionEndDate: str(r.audition_end_date),
    bootcampStartDate: str(r.bootcamp_start_date),
    bootcampEndDate: str(r.bootcamp_end_date),
    status: r.status,
    notes: str(r.notes),
    createdBy: str(r.created_by),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

function toContestant(r: any): ShowContestant {
  return {
    id: r.id,
    seasonId: r.season_id,
    applicationId: str(r.application_id),
    userId: str(r.user_id),
    displayName: str(r.display_name),
    stageName: str(r.stage_name),
    primaryTalent: str(r.primary_talent),
    photoUrl: str(r.photo_url),
    phaseStatus: r.phase_status,
    auditionResult: r.audition_result,
    enteredBootcampAt: r.entered_bootcamp_at ?? null,
    evictedAt: r.evicted_at ?? null,
    evictedWeek: r.evicted_week ?? null,
    finalistPosition: r.finalist_position ?? null,
    isActive: Boolean(r.is_active),
    bioNotes: str(r.bio_notes),
    createdBy: str(r.created_by),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

function toWeek(r: any): EvictionWeek {
  return {
    id: r.id,
    seasonId: r.season_id,
    weekNumber: Number(r.week_number ?? 0),
    title: str(r.title),
    theme: str(r.theme),
    votingOpensAt: r.voting_opens_at ?? null,
    votingClosesAt: r.voting_closes_at ?? null,
    status: r.status,
    evictionCount: Number(r.eviction_count ?? 1),
    evictionFinalized: Boolean(r.eviction_finalized),
    createdBy: str(r.created_by),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  } as EvictionWeek;
}

function toVote(r: any): EvictionVote {
  return {
    id: r.id,
    weekId: r.week_id,
    voterId: str(r.voter_id),
    voterName: str(r.voter_name),
    voterRole: str(r.voter_role),
    contestantId: r.contestant_id,
    reason: str(r.reason),
    votedAt: str(r.voted_at),
  };
}

function toEviction(r: any): Eviction {
  return {
    id: r.id,
    weekId: r.week_id,
    seasonId: r.season_id,
    contestantId: r.contestant_id,
    voteCount: Number(r.vote_count ?? 0),
    evictionOrder: Number(r.eviction_order ?? 1),
    evictionNote: str(r.eviction_note),
    evictedBy: str(r.evicted_by),
    evictedAt: str(r.evicted_at),
  };
}

function fail(what: string, error: { message: string } | null) {
  if (error) throw new Error(`reality-show: ${what}: ${error.message}`);
}

// ── Seasons ──────────────────────────────────────────────────────────────────

export async function listSeasons(): Promise<ShowSeason[]> {
  if (!live()) return listSeasonsMemory();
  const { data, error } = await db()
    .from('reality_show_seasons')
    .select('*')
    .order('season_number', { ascending: false });
  fail('list seasons', error);
  return (data ?? []).map(toSeason);
}

export async function getSeason(id: string): Promise<ShowSeason | null> {
  if (!live()) return getSeasonMemory(id);
  const { data } = await db().from('reality_show_seasons').select('*').eq('id', id).maybeSingle();
  return data ? toSeason(data) : null;
}

export async function createSeason(input: Parameters<typeof createSeasonMemory>[0]): Promise<ShowSeason> {
  if (!live()) return createSeasonMemory(input);
  const { data, error } = await db()
    .from('reality_show_seasons')
    .insert({
      season_name: input.seasonName,
      season_number: input.seasonNumber,
      contest_slug: input.contestSlug,
      audition_start_date: input.auditionStartDate || null,
      audition_end_date: input.auditionEndDate || null,
      bootcamp_start_date: input.bootcampStartDate || null,
      bootcamp_end_date: input.bootcampEndDate || null,
      notes: input.notes ?? '',
      created_by: uid(input.createdBy),
    })
    .select('*')
    .single();
  fail('create season', error);
  return toSeason(data);
}

export async function updateSeason(
  id: string,
  patch: Partial<Omit<ShowSeason, 'id' | 'createdAt' | 'createdBy'>>,
): Promise<ShowSeason> {
  if (!live()) return updateSeasonMemory(id, patch);
  const row: Record<string, unknown> = { updated_at: nowIso() };
  if (patch.seasonName !== undefined) row.season_name = patch.seasonName;
  if (patch.seasonNumber !== undefined) row.season_number = patch.seasonNumber;
  if (patch.contestSlug !== undefined) row.contest_slug = patch.contestSlug;
  if (patch.currentPhase !== undefined) row.current_phase = patch.currentPhase;
  if (patch.auditionStartDate !== undefined) row.audition_start_date = patch.auditionStartDate || null;
  if (patch.auditionEndDate !== undefined) row.audition_end_date = patch.auditionEndDate || null;
  if (patch.bootcampStartDate !== undefined) row.bootcamp_start_date = patch.bootcampStartDate || null;
  if (patch.bootcampEndDate !== undefined) row.bootcamp_end_date = patch.bootcampEndDate || null;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.notes !== undefined) row.notes = patch.notes;

  const { data, error } = await db()
    .from('reality_show_seasons').update(row).eq('id', id).select('*').single();
  fail('update season', error);
  return toSeason(data);
}

// ── Contestants ──────────────────────────────────────────────────────────────

export async function listContestants(seasonId: string, phaseStatus?: PhaseStatus): Promise<ShowContestant[]> {
  if (!live()) return listContestantsMemory(seasonId, phaseStatus);
  let q = db().from('reality_show_contestants').select('*').eq('season_id', seasonId);
  if (phaseStatus) q = q.eq('phase_status', phaseStatus);
  const { data, error } = await q.order('created_at', { ascending: true });
  fail('list contestants', error);
  return (data ?? []).map(toContestant);
}

export async function getContestant(id: string): Promise<ShowContestant | null> {
  if (!live()) return getContestantMemory(id);
  const { data } = await db().from('reality_show_contestants').select('*').eq('id', id).maybeSingle();
  return data ? toContestant(data) : null;
}

export async function addContestant(input: Parameters<typeof addContestantMemory>[0]): Promise<ShowContestant> {
  if (!live()) return addContestantMemory(input);
  const { data, error } = await db()
    .from('reality_show_contestants')
    .insert({
      season_id: input.seasonId,
      application_id: uid(input.applicationId),
      user_id: uid(input.userId),
      display_name: input.displayName,
      stage_name: input.stageName ?? '',
      primary_talent: input.primaryTalent ?? '',
      photo_url: input.photoUrl ?? '',
      bio_notes: input.bioNotes ?? '',
      created_by: uid(input.createdBy),
    })
    .select('*')
    .single();
  fail('add contestant', error);
  return toContestant(data);
}

export async function updateContestant(
  id: string,
  patch: Partial<Omit<ShowContestant, 'id' | 'seasonId' | 'createdAt' | 'createdBy'>>,
): Promise<ShowContestant> {
  if (!live()) return updateContestantMemory(id, patch);
  const row: Record<string, unknown> = { updated_at: nowIso() };
  if (patch.applicationId !== undefined) row.application_id = uid(patch.applicationId);
  if (patch.userId !== undefined) row.user_id = uid(patch.userId);
  if (patch.displayName !== undefined) row.display_name = patch.displayName;
  if (patch.stageName !== undefined) row.stage_name = patch.stageName;
  if (patch.primaryTalent !== undefined) row.primary_talent = patch.primaryTalent;
  if (patch.photoUrl !== undefined) row.photo_url = patch.photoUrl;
  if (patch.phaseStatus !== undefined) row.phase_status = patch.phaseStatus;
  if (patch.auditionResult !== undefined) row.audition_result = patch.auditionResult;
  if (patch.enteredBootcampAt !== undefined) row.entered_bootcamp_at = patch.enteredBootcampAt;
  if (patch.evictedAt !== undefined) row.evicted_at = patch.evictedAt;
  if (patch.evictedWeek !== undefined) row.evicted_week = patch.evictedWeek;
  if (patch.finalistPosition !== undefined) row.finalist_position = patch.finalistPosition;
  if (patch.isActive !== undefined) row.is_active = patch.isActive;
  if (patch.bioNotes !== undefined) row.bio_notes = patch.bioNotes;

  const { data, error } = await db()
    .from('reality_show_contestants').update(row).eq('id', id).select('*').single();
  fail('update contestant', error);
  return toContestant(data);
}

export async function promoteToBootcamp(contestantId: string): Promise<ShowContestant> {
  if (!live()) return promoteToBootcampMemory(contestantId);
  return updateContestant(contestantId, {
    phaseStatus: 'bootcamp',
    auditionResult: 'passed',
    enteredBootcampAt: nowIso(),
  });
}

export async function failAudition(contestantId: string): Promise<ShowContestant> {
  if (!live()) return failAuditionMemory(contestantId);
  return updateContestant(contestantId, { auditionResult: 'failed', isActive: false });
}

// ── Weeks ────────────────────────────────────────────────────────────────────

export async function listWeeks(seasonId: string): Promise<EvictionWeek[]> {
  if (!live()) return listWeeksMemory(seasonId);
  const { data, error } = await db()
    .from('reality_show_weeks').select('*').eq('season_id', seasonId)
    .order('week_number', { ascending: true });
  fail('list weeks', error);
  return (data ?? []).map(toWeek);
}

export async function getWeek(id: string): Promise<EvictionWeek | null> {
  if (!live()) return getWeekMemory(id);
  const { data } = await db().from('reality_show_weeks').select('*').eq('id', id).maybeSingle();
  return data ? toWeek(data) : null;
}

export async function createWeek(input: Parameters<typeof createWeekMemory>[0]): Promise<EvictionWeek> {
  if (!live()) return createWeekMemory(input);
  const { data, error } = await db()
    .from('reality_show_weeks')
    .insert({
      season_id: input.seasonId,
      week_number: input.weekNumber,
      title: input.title ?? '',
      theme: input.theme ?? '',
      voting_opens_at: input.votingOpensAt ?? null,
      voting_closes_at: input.votingClosesAt ?? null,
      eviction_count: input.evictionCount ?? 1,
      created_by: uid(input.createdBy),
    })
    .select('*')
    .single();
  fail('create week', error);
  return toWeek(data);
}

export async function updateWeek(
  id: string,
  patch: Partial<Omit<EvictionWeek, 'id' | 'seasonId' | 'createdAt' | 'createdBy'>>,
): Promise<EvictionWeek> {
  if (!live()) return updateWeekMemory(id, patch);
  const row: Record<string, unknown> = { updated_at: nowIso() };
  if (patch.weekNumber !== undefined) row.week_number = patch.weekNumber;
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.theme !== undefined) row.theme = patch.theme;
  if (patch.votingOpensAt !== undefined) row.voting_opens_at = patch.votingOpensAt;
  if (patch.votingClosesAt !== undefined) row.voting_closes_at = patch.votingClosesAt;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.evictionCount !== undefined) row.eviction_count = patch.evictionCount;
  if (patch.evictionFinalized !== undefined) row.eviction_finalized = patch.evictionFinalized;

  const { data, error } = await db()
    .from('reality_show_weeks').update(row).eq('id', id).select('*').single();
  fail('update week', error);
  return toWeek(data);
}

export async function openVoting(weekId: string): Promise<EvictionWeek> {
  if (!live()) return openVotingMemory(weekId);
  return updateWeek(weekId, { status: 'open' });
}

export async function closeVoting(weekId: string): Promise<EvictionWeek> {
  if (!live()) return closeVotingMemory(weekId);
  return updateWeek(weekId, { status: 'closed' });
}

// ── Votes ────────────────────────────────────────────────────────────────────

export async function getVotesForWeek(weekId: string): Promise<EvictionVote[]> {
  if (!live()) return getVotesForWeekMemory(weekId);
  const { data, error } = await db()
    .from('reality_show_eviction_votes').select('*').eq('week_id', weekId);
  fail('list votes', error);
  return (data ?? []).map(toVote);
}

export async function getVoteTallies(weekId: string): Promise<Array<{ contestantId: string; voteCount: number }>> {
  if (!live()) return getVoteTalliesMemory(weekId);
  const votes = await getVotesForWeek(weekId);
  const tally = new Map<string, number>();
  for (const v of votes) tally.set(v.contestantId, (tally.get(v.contestantId) ?? 0) + 1);
  return Array.from(tally.entries())
    .map(([contestantId, voteCount]) => ({ contestantId, voteCount }))
    .sort((a, b) => b.voteCount - a.voteCount);
}

export async function castVote(input: Parameters<typeof castVoteMemory>[0]): Promise<EvictionVote> {
  if (!live()) return castVoteMemory(input);
  // One vote per (week, voter, contestant) is a UNIQUE CONSTRAINT, so a repeat
  // submit resolves on the constraint instead of a read-then-write race. The
  // original vote's votedAt is preserved — a duplicate must not look newer.
  const { data, error } = await db()
    .from('reality_show_eviction_votes')
    .upsert(
      {
        week_id: input.weekId,
        voter_id: uid(input.voterId),
        voter_name: input.voterName,
        voter_role: input.voterRole,
        contestant_id: input.contestantId,
        reason: input.reason ?? '',
      },
      { onConflict: 'week_id,voter_id,contestant_id', ignoreDuplicates: false },
    )
    .select('*')
    .single();
  fail('cast vote', error);
  return toVote(data);
}

export async function retractVote(weekId: string, voterId: string, contestantId: string): Promise<boolean> {
  if (!live()) return retractVoteMemory(weekId, voterId, contestantId);
  const { data, error } = await db()
    .from('reality_show_eviction_votes')
    .delete()
    .eq('week_id', weekId)
    .eq('voter_id', voterId)
    .eq('contestant_id', contestantId)
    .select('id');
  fail('retract vote', error);
  return (data ?? []).length > 0;
}

// ── Eviction finalization ────────────────────────────────────────────────────

export async function finalizeEviction(
  weekId: string,
  evictedBy: string,
  note?: string,
): Promise<FinalizeEvictionResult> {
  if (!live()) return finalizeEvictionMemory(weekId, evictedBy, note);

  const week = await getWeek(weekId);
  if (!week) throw new Error('Week not found');
  if (week.evictionFinalized) throw new Error('Eviction already finalized for this week');
  if (week.status !== 'closed') throw new Error('Close voting before finalizing eviction');

  const tallies = await getVoteTallies(weekId);
  if (tallies.length === 0) throw new Error('No votes cast yet');

  const toEvict = tallies.slice(0, week.evictionCount);

  // Ordered so an interrupted run is safely repeatable: the eviction rows carry
  // the record and are unique per (week, contestant); contestant flags are
  // idempotent; the week is marked finalized LAST, so a failure before that
  // point leaves the guard above still allowing a retry.
  const { data: evictionRows, error: evictionError } = await db()
    .from('reality_show_evictions')
    .upsert(
      toEvict.map((t, idx) => ({
        week_id: weekId,
        season_id: week.seasonId,
        contestant_id: t.contestantId,
        vote_count: t.voteCount,
        eviction_order: idx + 1,
        eviction_note: note ?? '',
        evicted_by: uid(evictedBy),
      })),
      { onConflict: 'week_id,contestant_id', ignoreDuplicates: false },
    )
    .select('*');
  fail('record evictions', evictionError);

  const evictedContestants: ShowContestant[] = [];
  for (const t of toEvict) {
    evictedContestants.push(
      await updateContestant(t.contestantId, {
        phaseStatus: 'evicted',
        isActive: false,
        evictedAt: nowIso(),
        evictedWeek: week.weekNumber,
      }),
    );
  }

  const updatedWeek = await updateWeek(weekId, { status: 'eviction_declared', evictionFinalized: true });

  return {
    week: updatedWeek,
    evictions: (evictionRows ?? []).map(toEviction),
    evictedContestants,
  };
}

export async function getEvictionsForSeason(seasonId: string): Promise<Eviction[]> {
  if (!live()) return getEvictionsForSeasonMemory(seasonId);
  const { data, error } = await db()
    .from('reality_show_evictions').select('*').eq('season_id', seasonId)
    .order('evicted_at', { ascending: true });
  fail('list season evictions', error);
  return (data ?? []).map(toEviction);
}

export async function getEvictionsForWeek(weekId: string): Promise<Eviction[]> {
  if (!live()) return getEvictionsForWeekMemory(weekId);
  const { data, error } = await db()
    .from('reality_show_evictions').select('*').eq('week_id', weekId);
  fail('list week evictions', error);
  return (data ?? []).map(toEviction);
}

// Re-exported so a caller needs only this module, not the memory store beside it.
export type { Eviction, EvictionVote, EvictionWeek, FinalizeEvictionResult, PhaseStatus, ShowContestant, ShowSeason };
