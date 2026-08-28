export type CompetitionOverview = {
  totalContests: number;
  realityTvContests: number;
  openMicContests: number;
  multiSkillContests: number;
};

export type OpenMicCompetition = {
  id: string;
  slug: string;
  name: string;
  status: string;
  start_date?: string | null;
  end_date?: string | null;
  is_featured?: boolean;
  created_at?: string | null;
};

// Mirrors backend/internal/connect/voting/models.go Contest — the row shape
// of public.connect_contests, the table mobile's getContests() reads.
export type VotingContest = {
  id: string;
  title: string;
  description?: string | null;
  status: 'draft' | 'open' | 'closed' | string;
  paid_vote_kobo: number;
  free_votes_per_user: number;
  velocity_per_minute: number;
  opens_at?: string | null;
  closes_at?: string | null;
  created_at: string;
  contestant_count: number;
  total_votes: number;
};

// Mirrors backend/internal/connect/voting/repo.go RosterEntry — one row of
// GET /contests/:id/contestants, already ranked by total votes server-side.
export type ContestRosterEntry = {
  contestant_id: string;
  name: string;
  stage_name: string;
  category: string;
  state: string;
  bio: string;
  photo_url: string;
  media_url: string;
  status: string;
  is_active: boolean;
  contest_id?: string;
  free_votes: number;
  paid_votes: number;
  total_votes: number;
  rank: number;
};

// Mirrors backend/internal/connect/voting/eviction_handlers.go EvictionResponse —
// one row per contestant just marked for eviction by TriggerEvictions.
export type StageEvictionResult = {
  contestant_id: string;
  vote_count: number;
  eviction_rank: number;
  eviction_id: string;
  evicted_at: string;
  grace_period_end: string;
};

// Mirrors backend/internal/connect/voting/eviction_service.go StageContestant —
// one row per contestant currently in a stage, with their eviction status.
export type StageContestant = {
  id: string;
  name: string;
  photo_url: string;
  vote_count: number;
  eviction_status: string;
  eviction_template: string;
  eviction_id?: string | null;
  grace_period_end?: string | null;
};
