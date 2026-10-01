import { createAdminClient, createClient } from '@/lib/supabase/server';
import { ApiError } from '@/lib/api/responses';
import { logger } from '@/lib/logger';

export type PaginationInput = {
  page?: number;
  limit?: number;
};

export type PaginatedResult<T> = {
  items: T[];
  page: number;
  limit: number;
};

export type ServiceResult<T> = {
  success: true;
  data: T;
};

export type CompetitionWindowStage =
  | 'registration'
  | 'submission'
  | 'shortlist'
  | 'voting'
  | 'judging'
  | 'finals';

export type CompetitionLifecycleStatus = 'draft' | 'active' | 'upcoming' | 'ended' | 'archived';

export type EntryLifecycleStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'correction_requested'
  | 'shortlisted'
  | 'live_for_voting'
  | 'finalist'
  | 'winner'
  | 'disqualified';

export type VoteSourceType = 'free' | 'paid' | 'bundle' | 'referral' | 'bonus';

export type UserServiceContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
};

export type AdminServiceContext = {
  supabase: ReturnType<typeof createAdminClient>;
};

export async function getUserServiceContext(): Promise<UserServiceContext> {
  return { supabase: await createClient() };
}

export function getAdminServiceContext(): AdminServiceContext {
  return { supabase: createAdminClient() };
}

export async function listSkillCategories(
  input: PaginationInput = {}
): Promise<PaginatedResult<Record<string, unknown>>> {
  const page = Math.max(1, input.page || 1);
  const limit = Math.min(100, Math.max(1, input.limit || 20));
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  const { supabase } = getAdminServiceContext();

  const { data, error } = await supabase
    .from('skill_categories')
    .select(
      'id, title, slug, description, vertical_group, active, featured, sort_order, created_at'
    )
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) throw error;
  return { items: data || [], page, limit };
}

export async function getCompetitionById(competitionId: string) {
  const { supabase } = getAdminServiceContext();
  const { data, error } = await supabase
    .from('contests')
    .select(
      'id, slug, name, description, status, contest_type, visibility, is_featured, start_date, end_date, created_at'
    )
    .eq('id', competitionId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function listCompetitionCategories(competitionId: string) {
  const { supabase } = getAdminServiceContext();
  const { data, error } = await supabase
    .from('competition_categories')
    .select(
      'id, competition_id, category_id, subcategory_slug, config_overrides, is_active, skill_categories(id, title, slug)'
    )
    .eq('competition_id', competitionId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function assertEnrollmentEligibility(competitionId: string, userId: string) {
  const { supabase } = getAdminServiceContext();
  const { data: competition, error } = await supabase
    .from('contests')
    .select('id, status, visibility, age_min, age_max')
    .eq('id', competitionId)
    .maybeSingle();

  if (error) {
    logger.error(
      { error, competitionId, userId },
      'Database error during enrollment eligibility check'
    );
    throw error;
  }
  if (!competition) throw new ApiError('Competition not found', 404);
  if (competition.visibility !== 'public')
    throw new ApiError('Competition is not open for enrollment', 403);

  const { data: existing, error: existingError } = await supabase
    .from('competition_enrollments')
    .select('id')
    .eq('competition_id', competitionId)
    .eq('user_id', userId)
    .limit(1);

  if (existingError) {
    logger.error(
      { error: existingError, competitionId, userId },
      'Error checking existing enrollment'
    );
    throw existingError;
  }

  logger.info({ competitionId, userId }, 'Enrollment eligibility verified');
  return { competition, already_enrolled: (existing || []).length > 0 };
}

export async function getEntryForOwner(entryId: string, userId: string) {
  const { supabase } = getAdminServiceContext();
  const { data, error } = await supabase
    .from('competition_entries')
    .select('id, competition_id, user_id, status, submitted_at, updated_at')
    .eq('id', entryId)
    .maybeSingle();

  if (error) throw error;
  if (!data || data.user_id !== userId) {
    throw new ApiError('Entry not found', 404);
  }

  return data;
}

export async function createModerationLog(input: {
  entryId: string;
  competitionId: string;
  actorId: string;
  action: string;
  previousStatus: string;
  newStatus: string;
  reason?: string;
  notes?: string;
}) {
  const { supabase } = getAdminServiceContext();
  const { error } = await supabase.from('moderation_logs').insert({
    entry_id: input.entryId,
    competition_id: input.competitionId,
    actor_id: input.actorId,
    action: input.action,
    previous_status: input.previousStatus,
    new_status: input.newStatus,
    reason: input.reason || '',
    notes: input.notes || '',
  });

  if (error) throw error;
}

export async function assertJudgeAssignment(
  competitionId: string,
  judgeId: string,
  category?: string
) {
  const { supabase } = getAdminServiceContext();
  const { data, error } = await supabase
    .from('judge_assignments')
    .select('id, judge_id, category, active')
    .eq('competition_id', competitionId)
    .eq('judge_id', judgeId)
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new ApiError('Judge is not assigned to this competition', 403);
  if (category && data.category && category !== data.category) {
    throw new ApiError('Judge is not assigned to this category', 403);
  }

  return data;
}

export async function getCompetitionVotePolicy(competitionId: string) {
  const { supabase } = getAdminServiceContext();
  const { data, error } = await supabase
    .from('contests')
    .select('id, vote_price_ngn, judge_weight, public_vote_weight')
    .eq('id', competitionId)
    .maybeSingle();

  if (error) {
    logger.error({ error, competitionId }, 'Error fetching competition vote policy');
    throw error;
  }
  return data;
}

export async function fetchLeaderboard(competitionId: string, limit = 100) {
  const { supabase } = getAdminServiceContext();
  const { data, error } = await supabase
    .from('competition_entries')
    .select(
      'id, competition_id, entry_title, category, status, judge_score, public_vote_count, leaderboard_score'
    )
    .eq('competition_id', competitionId)
    .in('status', ['live_for_voting', 'finalist', 'winner'])
    .order('leaderboard_score', { ascending: false })
    .order('public_vote_count', { ascending: false })
    .limit(Math.max(1, Math.min(500, limit)));

  if (error) {
    logger.error({ error, competitionId }, 'Error fetching competition leaderboard');
    throw error;
  }

  logger.info({ competitionId, count: data?.length }, 'Leaderboard fetched successfully');
  return data || [];
}

export async function listCompetitionWinners(competitionId: string) {
  const { supabase } = getAdminServiceContext();
  const { data, error } = await supabase
    .from('winner_records')
    .select('id, competition_id, entry_id, user_id, rank_position, title, winner_type, created_at')
    .eq('competition_id', competitionId)
    .order('rank_position', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function listActivePlacements(competitionId: string) {
  const { supabase } = getAdminServiceContext();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('sponsor_placements')
    .select('id, placement_key, sponsor_name, campaign_name, asset_url, target_url, tracking_code')
    .eq('competition_id', competitionId)
    .eq('is_active', true)
    .or(`starts_at.is.null,starts_at.lte.${now}`)
    .or(`ends_at.is.null,ends_at.gte.${now}`)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function listPipelineRecords(competitionId: string) {
  const { supabase } = getAdminServiceContext();
  const { data, error } = await supabase
    .from('talent_pipeline_records')
    .select(
      'id, user_id, competition_id, category_id, stage, tags, assigned_admin_id, next_action_at, is_alumni, created_at'
    )
    .eq('competition_id', competitionId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getCompetitionReportSummary(competitionId: string) {
  const { supabase } = getAdminServiceContext();

  const [enrollmentsRes, entriesRes, votesRes] = await Promise.all([
    supabase
      .from('competition_enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('competition_id', competitionId),
    supabase
      .from('competition_entries')
      .select('id', { count: 'exact', head: true })
      .eq('competition_id', competitionId),
    supabase
      .from('contestant_votes')
      .select('id', { count: 'exact', head: true })
      .eq('contest_id', competitionId),
  ]);

  if (enrollmentsRes.error) throw enrollmentsRes.error;
  if (entriesRes.error) throw entriesRes.error;
  if (votesRes.error) throw votesRes.error;

  return {
    enrollments: enrollmentsRes.count || 0,
    entries: entriesRes.count || 0,
    votes: votesRes.count || 0,
  };
}
