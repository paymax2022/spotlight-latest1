export type RealityTVActiveSeason = {
  season_title: string;
  season_number: number;
  status: string;
} | null;

export type RealityTVDashboardMetrics = {
  totalSeasons: number;
  activeSeason: RealityTVActiveSeason;
  totalApplications: number;
  pendingApplications: number;
  totalContestants: number;
  activeVotingRounds: number;
  totalVotes: number;
  paidVotes: number;
  freeVotes: number;
  openTickets: number;
};
