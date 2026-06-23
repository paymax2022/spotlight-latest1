package domain

import "time"

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
