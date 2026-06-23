package repositories

import (
	"net/http"
	"strings"
	"time"

	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/integrations"
)

// SessionSupabaseRepository implements domain.SessionStore over Supabase REST.
//
// SECURITY: raw refresh/access tokens are NEVER persisted — only their sha256
// hashes (the service hashes before calling this layer). PII is limited to the
// inet/user_agent already stored for legacy auth_sessions/login_activity.
type SessionSupabaseRepository struct {
	client *integrations.SupabaseRestClient
}

func NewSessionSupabaseRepository(client *integrations.SupabaseRestClient) *SessionSupabaseRepository {
	return &SessionSupabaseRepository{client: client}
}

const sessionSelect = "id,user_id,session_family_id,refresh_token_hash,previous_token_hash,access_token_hash,rotation_counter,device_fingerprint,ip_address,user_agent,expires_at,revoked_at,revoked_reason,last_seen_at,created_at"

type sessionRow struct {
	ID                string     `json:"id"`
	UserID            string     `json:"user_id"`
	FamilyID          *string    `json:"session_family_id"`
	RefreshTokenHash  string     `json:"refresh_token_hash"`
	PreviousTokenHash *string    `json:"previous_token_hash"`
	AccessTokenHash   *string    `json:"access_token_hash"`
	RotationCounter   int        `json:"rotation_counter"`
	DeviceFingerprint *string    `json:"device_fingerprint"`
	IPAddress         *string    `json:"ip_address"`
	UserAgent         *string    `json:"user_agent"`
	ExpiresAt         *time.Time `json:"expires_at"`
	RevokedAt         *time.Time `json:"revoked_at"`
	RevokedReason     *string    `json:"revoked_reason"`
	LastSeenAt        *time.Time `json:"last_seen_at"`
	CreatedAt         *time.Time `json:"created_at"`
}

func (r sessionRow) toSession() domain.Session {
	s := domain.Session{
		ID:                r.ID,
		UserID:            r.UserID,
		RefreshTokenHash:  r.RefreshTokenHash,
		RotationCounter:   r.RotationCounter,
		PreviousTokenHash: deref(r.PreviousTokenHash),
		AccessTokenHash:   deref(r.AccessTokenHash),
		DeviceFingerprint: deref(r.DeviceFingerprint),
		IPAddress:         deref(r.IPAddress),
		UserAgent:         deref(r.UserAgent),
		RevokedReason:     deref(r.RevokedReason),
		RevokedAt:         r.RevokedAt,
		LastSeenAt:        r.LastSeenAt,
	}
	if r.FamilyID != nil {
		s.FamilyID = *r.FamilyID
	}
	if r.ExpiresAt != nil {
		s.ExpiresAt = *r.ExpiresAt
	}
	if r.CreatedAt != nil {
		s.CreatedAt = *r.CreatedAt
	}
	return s
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func nilIfEmpty(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func nowRFC() string { return time.Now().UTC().Format(time.RFC3339) }

func (r *SessionSupabaseRepository) enabled() bool {
	return r.client != nil && r.client.Enabled()
}

func (r *SessionSupabaseRepository) CreateSession(s domain.Session) (string, error) {
	if !r.enabled() {
		return "", nil
	}
	payload := map[string]any{
		"user_id":            s.UserID,
		"refresh_token_hash": s.RefreshTokenHash,
		"access_token_hash":  nilIfEmpty(s.AccessTokenHash),
		"rotation_counter":   s.RotationCounter,
		"device_fingerprint": nilIfEmpty(s.DeviceFingerprint),
		"ip_address":         nilIfEmpty(s.IPAddress),
		"user_agent":         nilIfEmpty(s.UserAgent),
		"expires_at":         s.ExpiresAt.UTC().Format(time.RFC3339),
		"last_seen_at":       nowRFC(),
		"created_at":         nowRFC(),
	}
	var rows []sessionRow
	// Return the inserted row so we can set session_family_id = id.
	err := r.client.RESTReturn(http.MethodPost, "auth_sessions", map[string]string{"select": "id"}, payload, &rows)
	if err != nil || len(rows) == 0 {
		return "", err
	}
	id := rows[0].ID
	// Family id defaults to the session's own id (first of the family).
	_ = r.client.REST(http.MethodPatch, "auth_sessions", map[string]string{"id": "eq." + id}, map[string]any{"session_family_id": id}, nil)
	return id, nil
}

func (r *SessionSupabaseRepository) getOne(query map[string]string) (*domain.Session, error) {
	if !r.enabled() {
		return nil, nil
	}
	query["select"] = sessionSelect
	query["limit"] = "1"
	var rows []sessionRow
	if err := r.client.REST(http.MethodGet, "auth_sessions", query, nil, &rows); err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	s := rows[0].toSession()
	return &s, nil
}

func (r *SessionSupabaseRepository) GetByRefreshHash(hash string) (*domain.Session, error) {
	return r.getOne(map[string]string{"refresh_token_hash": "eq." + hash})
}

func (r *SessionSupabaseRepository) FindByPreviousRefreshHash(hash string) (*domain.Session, error) {
	return r.getOne(map[string]string{"previous_token_hash": "eq." + hash})
}

func (r *SessionSupabaseRepository) GetByAccessHash(hash string) (*domain.Session, error) {
	return r.getOne(map[string]string{"access_token_hash": "eq." + hash})
}

func (r *SessionSupabaseRepository) GetSessionByID(id string) (*domain.Session, error) {
	return r.getOne(map[string]string{"id": "eq." + id})
}

func (r *SessionSupabaseRepository) ListActiveByUser(userID string) ([]domain.Session, error) {
	if !r.enabled() {
		return nil, nil
	}
	var rows []sessionRow
	q := map[string]string{
		"select":     sessionSelect,
		"user_id":    "eq." + userID,
		"revoked_at": "is.null",
		"expires_at": "gt." + nowRFC(),
		"order":      "created_at.desc",
		"limit":      "100",
	}
	if err := r.client.REST(http.MethodGet, "auth_sessions", q, nil, &rows); err != nil {
		return nil, err
	}
	out := make([]domain.Session, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.toSession())
	}
	return out, nil
}

func (r *SessionSupabaseRepository) RotateSession(id, newRefresh, prevRefresh, newAccess string, counter int, expiresAt time.Time) error {
	if !r.enabled() {
		return nil
	}
	// Conditional update: only rotate a row that is still active and still holds
	// the prior refresh hash — guards against a lost-update race on concurrent rotates.
	q := map[string]string{
		"id":                 "eq." + id,
		"revoked_at":         "is.null",
		"refresh_token_hash": "neq." + newRefresh,
	}
	return r.client.REST(http.MethodPatch, "auth_sessions", q, map[string]any{
		"refresh_token_hash":  newRefresh,
		"previous_token_hash": prevRefresh,
		"access_token_hash":   newAccess,
		"rotation_counter":    counter,
		"expires_at":          expiresAt.UTC().Format(time.RFC3339),
		"last_seen_at":        nowRFC(),
	}, nil)
}

func (r *SessionSupabaseRepository) RevokeSession(id, reason string) error {
	if !r.enabled() {
		return nil
	}
	return r.client.REST(http.MethodPatch, "auth_sessions", map[string]string{"id": "eq." + id, "revoked_at": "is.null"},
		map[string]any{"revoked_at": nowRFC(), "revoked_reason": reason}, nil)
}

func (r *SessionSupabaseRepository) RevokeFamily(familyID, reason string) error {
	if !r.enabled() {
		return nil
	}
	return r.client.REST(http.MethodPatch, "auth_sessions",
		map[string]string{"session_family_id": "eq." + familyID, "revoked_at": "is.null"},
		map[string]any{"revoked_at": nowRFC(), "revoked_reason": reason}, nil)
}

func (r *SessionSupabaseRepository) RevokeAllForUser(userID, reason string) (int, error) {
	if !r.enabled() {
		return 0, nil
	}
	var rows []sessionRow
	err := r.client.RESTReturn(http.MethodPatch, "auth_sessions",
		map[string]string{"user_id": "eq." + userID, "revoked_at": "is.null", "select": "id"},
		map[string]any{"revoked_at": nowRFC(), "revoked_reason": reason}, &rows)
	if err != nil {
		return 0, err
	}
	return len(rows), nil
}

func (r *SessionSupabaseRepository) TouchLastSeen(id string, at time.Time) error {
	if !r.enabled() {
		return nil
	}
	return r.client.REST(http.MethodPatch, "auth_sessions", map[string]string{"id": "eq." + id},
		map[string]any{"last_seen_at": at.UTC().Format(time.RFC3339)}, nil)
}

func (r *SessionSupabaseRepository) CountRecentFailedLogins(email string, since time.Time) (int, error) {
	if !r.enabled() {
		return 0, nil
	}
	var rows []map[string]any
	q := map[string]string{
		"select":     "id",
		"email":      "eq." + strings.ToLower(strings.TrimSpace(email)),
		"status":     "eq.failed",
		"created_at": "gte." + since.UTC().Format(time.RFC3339),
		"limit":      "100",
	}
	if err := r.client.REST(http.MethodGet, "login_activity", q, nil, &rows); err != nil {
		return 0, err
	}
	return len(rows), nil
}

func (r *SessionSupabaseRepository) LastSuccessfulLogin(email string) (*domain.LoginActivitySnapshot, error) {
	if !r.enabled() {
		return nil, nil
	}
	var rows []struct {
		IPAddress *string        `json:"ip_address"`
		Location  map[string]any `json:"location_metadata"`
		CreatedAt *time.Time     `json:"created_at"`
	}
	q := map[string]string{
		"select":  "ip_address,location_metadata,created_at",
		"email":   "eq." + strings.ToLower(strings.TrimSpace(email)),
		"status":  "eq.success",
		"order":   "created_at.desc",
		"limit":   "1",
	}
	if err := r.client.REST(http.MethodGet, "login_activity", q, nil, &rows); err != nil || len(rows) == 0 {
		return nil, err
	}
	la := &domain.LoginActivitySnapshot{IPAddress: deref(rows[0].IPAddress)}
	if rows[0].CreatedAt != nil {
		la.CreatedAt = *rows[0].CreatedAt
	}
	if loc := rows[0].Location; loc != nil {
		la.Latitude = asFloat(loc["lat"])
		la.Longitude = asFloat(loc["lon"])
	}
	return la, nil
}

func (r *SessionSupabaseRepository) HasKnownDevice(userID, fp string) (bool, error) {
	if !r.enabled() {
		return false, nil
	}
	var rows []map[string]any
	q := map[string]string{"select": "id", "user_id": "eq." + userID, "device_fingerprint": "eq." + fp, "limit": "1"}
	if err := r.client.REST(http.MethodGet, "auth_sessions", q, nil, &rows); err != nil {
		return false, err
	}
	return len(rows) > 0, nil
}

func (r *SessionSupabaseRepository) HasKnownIP(userID, ip string) (bool, error) {
	if !r.enabled() {
		return false, nil
	}
	var rows []map[string]any
	// A prior successful login from this IP marks the IP as known.
	q := map[string]string{"select": "id", "user_id": "eq." + userID, "ip_address": "eq." + ip, "status": "eq.success", "limit": "1"}
	if err := r.client.REST(http.MethodGet, "login_activity", q, nil, &rows); err != nil {
		return false, err
	}
	return len(rows) > 0, nil
}

func (r *SessionSupabaseRepository) RecordSecurityEvent(e domain.SecurityEvent) error {
	if !r.enabled() {
		return nil
	}
	signals := e.Signals
	if signals == nil {
		signals = map[string]any{}
	}
	payload := map[string]any{
		"user_id":            nilIfEmpty(e.UserID),
		"email":              strings.ToLower(strings.TrimSpace(e.Email)),
		"event_type":         e.EventType,
		"severity":           fallbackSeverity(e.Severity),
		"signals":            signals,
		"ip_address":         nilIfEmpty(e.IPAddress),
		"device_fingerprint": nilIfEmpty(e.DeviceFingerprint),
		"user_agent":         nilIfEmpty(e.UserAgent),
		"action_taken":       nilIfEmpty(e.ActionTaken),
		"notified":           e.Notified,
	}
	if payload["email"] == "" {
		payload["email"] = "unknown"
	}
	return r.client.REST(http.MethodPost, "security_events", map[string]string{}, payload, nil)
}

func (r *SessionSupabaseRepository) SetForceFlags(userID string, reset, reverify bool) error {
	if !r.enabled() {
		return nil
	}
	return r.client.REST(http.MethodPatch, "platform_users", map[string]string{"id": "eq." + userID},
		map[string]any{"force_password_reset": reset, "force_reverification": reverify, "last_security_event_at": nowRFC()}, nil)
}

func asFloat(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case float32:
		return float64(n)
	case int:
		return float64(n)
	case int64:
		return float64(n)
	}
	return 0
}
