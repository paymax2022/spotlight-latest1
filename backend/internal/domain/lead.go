package domain

type Lead struct {
	ID                string `json:"id"`
	SessionID         string `json:"sessionId"`
	LeadType          string `json:"leadType"`
	Status            string `json:"status"`
	Score             int    `json:"score"`
	SourcePage        string `json:"sourcePage"`
	Name              string `json:"name"`
	Email             string `json:"email"`
	Phone             string `json:"phone"`
	Notes             string `json:"notes"`
	TranscriptExcerpt string `json:"transcriptExcerpt"`
	CreatedAt         string `json:"createdAt"`
	UpdatedAt         string `json:"updatedAt"`
}
