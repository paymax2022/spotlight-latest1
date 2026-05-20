package domain

type RealityTVDashboardMetrics struct {
	TotalSeasons        int `json:"totalSeasons"`
	ActiveSeason        any `json:"activeSeason"`
	TotalApplications   int `json:"totalApplications"`
	PendingApplications int `json:"pendingApplications"`
	TotalContestants    int `json:"totalContestants"`
	ActiveVotingRounds  int `json:"activeVotingRounds"`
	TotalVotes          int `json:"totalVotes"`
	PaidVotes           int `json:"paidVotes"`
	FreeVotes           int `json:"freeVotes"`
	OpenTickets         int `json:"openTickets"`
}
