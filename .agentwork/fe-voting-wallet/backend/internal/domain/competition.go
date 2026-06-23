package domain

type CompetitionOverview struct {
	TotalContests      int `json:"totalContests"`
	RealityTVContests  int `json:"realityTvContests"`
	OpenMicContests    int `json:"openMicContests"`
	MultiSkillContests int `json:"multiSkillContests"`
}

type OpenMicCompetition struct {
	ID         string `json:"id"`
	Slug       string `json:"slug"`
	Name       string `json:"name"`
	Status     string `json:"status"`
	StartDate  string `json:"start_date,omitempty"`
	EndDate    string `json:"end_date,omitempty"`
	IsFeatured bool   `json:"is_featured"`
	CreatedAt  string `json:"created_at,omitempty"`
}

type OpenMicCreateInput struct {
	Name            string `json:"name"`
	Slug            string `json:"slug,omitempty"`
	Description     string `json:"description,omitempty"`
	Status          string `json:"status,omitempty"`
	Category        string `json:"category,omitempty"`
	StartDate       string `json:"start_date,omitempty"`
	EndDate         string `json:"end_date,omitempty"`
	IsFeatured      bool   `json:"is_featured"`
	EntryFeeNGN     int    `json:"entry_fee_ngn,omitempty"`
	VotePriceNGN    int    `json:"vote_price_ngn,omitempty"`
	RulesText       string `json:"rules_text,omitempty"`
	EligibilityText string `json:"eligibility_text,omitempty"`
}
