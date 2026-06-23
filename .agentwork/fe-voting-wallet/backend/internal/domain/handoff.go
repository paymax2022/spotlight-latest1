package domain

type Handoff struct {
	ID          string `json:"id"`
	SessionID   string `json:"session_id"`
	HandoffType string `json:"handoff_type"`
	Destination string `json:"destination"`
	Status      string `json:"status"`
	RequestedAt string `json:"requested_at"`
	ResolvedAt  string `json:"resolved_at,omitempty"`
}
