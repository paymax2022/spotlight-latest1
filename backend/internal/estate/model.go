package estate

import "time"

// Estate is a gated community or building complex.
type Estate struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Address   string    `json:"address,omitempty"`
	AdminID   string    `json:"admin_id"`
	CreatedAt time.Time `json:"created_at"`
}

// Resident is a verified occupant of an estate.
type Resident struct {
	ID        string    `json:"id"`
	EstateID  string    `json:"estate_id"`
	UserID    string    `json:"user_id"`
	Unit      string    `json:"unit"` // e.g. "Block A, Flat 3"
	Role      string    `json:"role"` // resident | estate_admin
	CreatedAt time.Time `json:"created_at"`
}

// VisitorPass is a one-time or time-bounded entry permit issued by a resident.
type VisitorPass struct {
	ID         string     `json:"id"`
	EstateID   string     `json:"estate_id"`
	IssuedBy   string     `json:"issued_by"`
	VisitorName string    `json:"visitor_name"`
	Purpose    string     `json:"purpose,omitempty"`
	QRCode     string     `json:"qr_code"`
	ValidFrom  time.Time  `json:"valid_from"`
	ValidUntil time.Time  `json:"valid_until"`
	UsedAt     *time.Time `json:"used_at,omitempty"`
	Status     string     `json:"status"` // active | used | expired | revoked
	CreatedAt  time.Time  `json:"created_at"`
}

// Election is a private vote within an estate (e.g. AGM, committee election).
type Election struct {
	ID         string    `json:"id"`
	EstateID   string    `json:"estate_id"`
	Title      string    `json:"title"`
	Description string   `json:"description,omitempty"`
	StartsAt   time.Time `json:"starts_at"`
	EndsAt     time.Time `json:"ends_at"`
	Status     string    `json:"status"` // draft | open | closed | tallied
	CreatedBy  string    `json:"created_by"`
	CreatedAt  time.Time `json:"created_at"`
}

// Candidate is a choice in an election.
type Candidate struct {
	ID         string `json:"id"`
	ElectionID string `json:"election_id"`
	Name       string `json:"name"`
	Bio        string `json:"bio,omitempty"`
	Votes      int    `json:"votes,omitempty"` // only populated after close
}

// Vote is a single cast vote — stored as a commitment hash to preserve anonymity.
// VoterID is retained for eligibility checks (one-vote-per-resident enforcement).
type Vote struct {
	ID          string    `json:"id"`
	ElectionID  string    `json:"election_id"`
	VoterID     string    `json:"voter_id"`
	CandidateID string    `json:"candidate_id"`
	CastAt      time.Time `json:"cast_at"`
}

// CreateEstateRequest is the body for POST /estate.
type CreateEstateRequest struct {
	Name    string `json:"name" binding:"required,min=2,max=200"`
	Address string `json:"address"`
}

// IssuePassRequest is the body for POST /estate/:id/passes.
type IssuePassRequest struct {
	VisitorName string    `json:"visitor_name" binding:"required"`
	Purpose     string    `json:"purpose"`
	ValidFrom   time.Time `json:"valid_from" binding:"required"`
	ValidUntil  time.Time `json:"valid_until" binding:"required"`
}

// CreateElectionRequest is the body for POST /estate/:id/elections.
type CreateElectionRequest struct {
	Title       string      `json:"title" binding:"required,min=2,max=200"`
	Description string      `json:"description"`
	StartsAt    time.Time   `json:"starts_at" binding:"required"`
	EndsAt      time.Time   `json:"ends_at" binding:"required"`
	Candidates  []Candidate `json:"candidates" binding:"required,min=2"`
}

// CastVoteRequest is the body for POST /estate/:id/elections/:electionId/vote.
type CastVoteRequest struct {
	CandidateID string `json:"candidate_id" binding:"required"`
}
