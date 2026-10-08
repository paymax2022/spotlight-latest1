package domain

import (
	"time"
)

type AdminMenuCounts struct {
	Contestants int `json:"contestants"`
	Auditions   int `json:"auditions"`
	Academy     int `json:"academy"`
	RealityTV   int `json:"reality_tv"`
	SMEPitch    int `json:"sme_pitch"`
	Stem        int `json:"stem"`
	Bootcamp    int `json:"bootcamp"`
	OpenMic     int `json:"open_mic"`
}

type AdminUser struct {
	ID               string `json:"id"`
	FirstName        string `json:"firstName"`
	LastName         string `json:"lastName"`
	Email            string `json:"email"`
	Phone            string `json:"phone"`
	UserType         string `json:"userType"`
	Status           string `json:"status"`
	ProfileCompleted bool   `json:"profileCompleted"`
	State            string `json:"state"`
	Country          string `json:"country"`
	ProgramID        string `json:"programId"`
	ContestID        string `json:"contestId"`
	SchoolID         string `json:"schoolId"`
	CreatedAt        string `json:"createdAt"`
}

type AdminUserFilter struct {
	Role     string
	UserType string
	Status   string
	State    string
	Program  string
	Contest  string
	School   string
	Country  string
	Search   string
	Limit    int
}

type ChatAnalytics struct {
	SessionsTotal int            `json:"sessionsTotal"`
	MessagesTotal int            `json:"messagesTotal"`
	LeadsTotal    int            `json:"leadsTotal"`
	ByPage        map[string]int `json:"byPage"`
	ByIntent      map[string]int `json:"byIntent"`
	LeadsByType   map[string]int `json:"leadsByType"`
}

type AuditFilter struct {
	Limit      int
	ActorUser  string
	TargetUser string
	Module     string
	Action     string
	Severity   string
	DateFrom   string
	DateTo     string
	Status     string
	Email      string
}

type ChatSession struct {
	ID          string `json:"id"`
	PageContext string `json:"pageContext"`
	Status      string `json:"status"`
	StartedAt   string `json:"startedAt"`
}

type ChatMessage struct {
	ID          string   `json:"id"`
	Role        string   `json:"role"`
	MessageText string   `json:"message_text,omitempty"`
	Text        string   `json:"text,omitempty"`
	Intent      string   `json:"intent,omitempty"`
	Confidence  *float64 `json:"confidence,omitempty"`
	CreatedAt   string   `json:"created_at,omitempty"`
}

type ChatEvent struct {
	ID           string         `json:"id,omitempty"`
	EventName    string         `json:"event_name,omitempty"`
	Event        string         `json:"event,omitempty"`
	EventPayload map[string]any `json:"event_payload,omitempty"`
	Payload      map[string]any `json:"payload,omitempty"`
	CreatedAt    string         `json:"created_at,omitempty"`
}

type ChatSessionDetail struct {
	Session  *ChatSession  `json:"session,omitempty"`
	Messages []ChatMessage `json:"messages"`
	Events   []ChatEvent   `json:"events"`
}

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

type Handoff struct {
	ID          string `json:"id"`
	SessionID   string `json:"session_id"`
	HandoffType string `json:"handoff_type"`
	Destination string `json:"destination"`
	Status      string `json:"status"`
	RequestedAt string `json:"requested_at"`
	ResolvedAt  string `json:"resolved_at,omitempty"`
}

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

type UserScope struct {
	ScopeType string `json:"scopeType"`
	ScopeID   string `json:"scopeId"`
}

// Session is a persisted auth session (one row of auth_sessions). Lives in the
// domain package so both the service and repository layers can depend on it
// without creating an import cycle.
type Session struct {
	ID                string
	UserID            string
	FamilyID          string
	RefreshTokenHash  string
	PreviousTokenHash string
	AccessTokenHash   string
	RotationCounter   int
	DeviceFingerprint string
	IPAddress         string
	UserAgent         string
	ExpiresAt         time.Time
	RevokedAt         *time.Time
	RevokedReason     string
	LastSeenAt        *time.Time
	CreatedAt         time.Time
}

// Active reports whether the session may still be used.
func (s Session) Active(now time.Time) bool {
	return s.RevokedAt == nil && s.ExpiresAt.After(now)
}

// LoginActivitySnapshot is the subset of login_activity needed for
// impossible-travel detection.
type LoginActivitySnapshot struct {
	IPAddress string
	Latitude  float64
	Longitude float64
	CreatedAt time.Time
}

// SecurityEvent is an immutable suspicious-login / escalation record.
type SecurityEvent struct {
	UserID            string
	Email             string
	EventType         string
	Severity          string
	Signals           map[string]any
	IPAddress         string
	DeviceFingerprint string
	UserAgent         string
	ActionTaken       string
	Notified          bool
}

// SessionStore persists and queries auth_sessions / security_events. Implemented
// over Supabase REST in the repositories layer; faked in unit tests.
type SessionStore interface {
	CreateSession(s Session) (string, error)
	GetByRefreshHash(hash string) (*Session, error)
	FindByPreviousRefreshHash(hash string) (*Session, error)
	GetByAccessHash(hash string) (*Session, error)
	GetSessionByID(sessionID string) (*Session, error)
	ListActiveByUser(userID string) ([]Session, error)
	RotateSession(sessionID, newRefreshHash, prevRefreshHash, newAccessHash string, counter int, expiresAt time.Time) error
	RevokeSession(sessionID, reason string) error
	RevokeFamily(familyID, reason string) error
	RevokeAllForUser(userID, reason string) (int, error)
	TouchLastSeen(sessionID string, at time.Time) error
	CountRecentFailedLogins(email string, since time.Time) (int, error)
	LastSuccessfulLogin(email string) (*LoginActivitySnapshot, error)
	HasKnownDevice(userID, deviceFingerprint string) (bool, error)
	HasKnownIP(userID, ip string) (bool, error)
	RecordSecurityEvent(e SecurityEvent) error
	SetForceFlags(userID string, forceReset, forceReverify bool) error
}
