// Contest stages — CRUD for public.contest_stages.
//
// Go's connect/voting module (backend/internal/connect/voting) already reads
// this table (GetStages, GetContestantsByStage) and has admin routes for the
// EVICTION mechanics (evict/save/finalize), but no route to create or edit a
// stage's definition — that half was never built. Rather than modify the
// protected voting module (CLAUDE.md brownfield rule), this is a new adapter
// in the same place the rest of the admin contest CRUD already lives
// (registration-v2/contest-store.ts) — writes go straight to Postgres via the
// admin Supabase client, and Go's reads see them immediately since both sides
// hit the same table with no cache in between.
//
// contest_stages.contest_id references public.contests(id), which is the
// SAME id connect_contests rows carry (20261223000000 mirrors contests ->
// connect_contests preserving the id) — so a stage created against a
// contest's id here is exactly the stage Go's /connect/contests/:id/stages
// resolves for that contest on mobile.
import { createAdminClient } from '@/lib/supabase/server';

export type ContestStage = {
  id: string;
  contestId: string;
  stageNumber: number;
  stageName: string;
  stageDescription: string | null;
  promotionCriteria: string | null;
  evictionPercentage: number;
  minContestantsToEvict: number;
  votingStartsAt: string | null;
  votingEndsAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type StageRow = {
  id: string;
  contest_id: string;
  stage_number: number;
  stage_name: string;
  stage_description: string | null;
  promotion_criteria: string | null;
  eviction_percentage: number;
  min_contestants_to_evict: number;
  voting_starts_at: string | null;
  voting_ends_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

function fromRow(row: StageRow): ContestStage {
  return {
    id: row.id,
    contestId: row.contest_id,
    stageNumber: row.stage_number,
    stageName: row.stage_name,
    stageDescription: row.stage_description,
    promotionCriteria: row.promotion_criteria,
    evictionPercentage: row.eviction_percentage,
    minContestantsToEvict: row.min_contestants_to_evict,
    votingStartsAt: row.voting_starts_at,
    votingEndsAt: row.voting_ends_at,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const STAGE_COLUMNS =
  'id, contest_id, stage_number, stage_name, stage_description, promotion_criteria, ' +
  'eviction_percentage, min_contestants_to_evict, voting_starts_at, voting_ends_at, ' +
  'is_active, created_at, updated_at';

export async function listContestStages(contestId: string): Promise<ContestStage[]> {
  const { data, error } = await createAdminClient()
    .from('contest_stages')
    .select(STAGE_COLUMNS)
    .eq('contest_id', contestId)
    .order('stage_number', { ascending: true });
  if (error) throw new Error(`Failed to list contest stages: ${error.message}`);
  return (data ?? []).map((row) => fromRow(row as unknown as StageRow));
}

/**
 * Stage counts for a batch of contests, keyed by contest id. Used by the
 * admin contest list to show a "N stages" badge per row without an N+1 of
 * per-contest requests — one query, tallied client-side since a GROUP BY
 * count isn't expressible through supabase-js without an RPC.
 */
export async function getStageCounts(contestIds: string[]): Promise<Record<string, number>> {
  if (contestIds.length === 0) return {};
  const { data, error } = await createAdminClient()
    .from('contest_stages')
    .select('contest_id')
    .in('contest_id', contestIds);
  if (error) throw new Error(`Failed to load contest stage counts: ${error.message}`);
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { contest_id: string }[]) {
    counts[row.contest_id] = (counts[row.contest_id] ?? 0) + 1;
  }
  return counts;
}

export type StageInput = {
  stageNumber: number;
  stageName: string;
  stageDescription?: string;
  promotionCriteria?: string;
  votingStartsAt?: string | null;
  votingEndsAt?: string | null;
  /** Bottom % of this stage's contestants (by vote count) evicted when an admin
   *  triggers eviction. DB default 20 applies when omitted. */
  evictionPercentage?: number;
};

export async function createContestStage(contestId: string, input: StageInput): Promise<ContestStage> {
  const { data, error } = await createAdminClient()
    .from('contest_stages')
    .insert({
      contest_id: contestId,
      stage_number: input.stageNumber,
      stage_name: input.stageName,
      stage_description: input.stageDescription || null,
      promotion_criteria: input.promotionCriteria || null,
      voting_starts_at: input.votingStartsAt || null,
      voting_ends_at: input.votingEndsAt || null,
      ...(input.evictionPercentage !== undefined ? { eviction_percentage: input.evictionPercentage } : {}),
    })
    .select(STAGE_COLUMNS)
    .single();
  if (error) throw new Error(`Failed to create contest stage: ${error.message}`);
  return fromRow(data as unknown as StageRow);
}

export async function updateContestStage(
  contestId: string,
  stageId: string,
  input: Partial<StageInput>,
): Promise<ContestStage> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.stageNumber !== undefined) patch.stage_number = input.stageNumber;
  if (input.stageName !== undefined) patch.stage_name = input.stageName;
  if (input.stageDescription !== undefined) patch.stage_description = input.stageDescription || null;
  if (input.promotionCriteria !== undefined) patch.promotion_criteria = input.promotionCriteria || null;
  if (input.votingStartsAt !== undefined) patch.voting_starts_at = input.votingStartsAt || null;
  if (input.votingEndsAt !== undefined) patch.voting_ends_at = input.votingEndsAt || null;
  if (input.evictionPercentage !== undefined) patch.eviction_percentage = input.evictionPercentage;

  const { data, error } = await createAdminClient()
    .from('contest_stages')
    .update(patch)
    .eq('id', stageId)
    .eq('contest_id', contestId)
    .select(STAGE_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`Failed to update contest stage: ${error.message}`);
  if (!data) throw new Error('Contest stage not found.');
  return fromRow(data as unknown as StageRow);
}

export async function deleteContestStage(contestId: string, stageId: string): Promise<void> {
  const { error, count } = await createAdminClient()
    .from('contest_stages')
    .delete({ count: 'exact' })
    .eq('id', stageId)
    .eq('contest_id', contestId);
  if (error) throw new Error(`Failed to delete contest stage: ${error.message}`);
  if (!count) throw new Error('Contest stage not found.');
}
