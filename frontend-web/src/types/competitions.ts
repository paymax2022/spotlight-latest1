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
