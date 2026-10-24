// Package stepup issues and checks short-lived step-up (re-verification)
// grants for privileged actions (ESTD-D014 / EST-UAT-0385, ADR-PR<pr-number>).
//
// Flow: an authenticated caller asks for a challenge (an email OTP with
// purpose otp.PurposeStepUp, through the SAME otp.Service, store, limits and
// attempt ceiling as every other code), submits the code, and receives a grant
// bound to (user, sha256(bearer token)) that expires after TTL. The gate
// (middleware.RequireStepUp) reads the grant through PostgresStore.GrantState.
package stepup

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/otp"
	"spotlight/backend/internal/services"
)

// TTL bounds. A grant is "sudo mode" for a few minutes, never a session.
const (
	DefaultTTL = 5 * time.Minute
	MinTTL     = time.Minute
	MaxTTL     = 15 * time.Minute
)

// ClampTTL normalises a configured TTL into [MinTTL, MaxTTL]; zero → DefaultTTL.
func ClampTTL(d time.Duration) time.Duration {
	switch {
	case d <= 0:
		return DefaultTTL
	case d < MinTTL:
		return MinTTL
	case d > MaxTTL:
		return MaxTTL
	}
	return d
}

// Grant is one persisted step-up grant.
type Grant struct {
	UserID          string
	AccessTokenHash string
	IPAddress       string
	UserAgent       string
	ExpiresAt       time.Time
}

// Store is the persistence seam.
type Store interface {
	middleware.StepUpVerifier
	Insert(ctx context.Context, g Grant) error
}

// PostgresStore persists grants in public.auth_step_up_grants.
type PostgresStore struct{ db *pgxpool.Pool }

// NewPostgresStore returns nil for a nil pool so callers can nil-check once.
func NewPostgresStore(db *pgxpool.Pool) *PostgresStore {
	if db == nil {
		return nil
	}
	return &PostgresStore{db: db}
}

// Insert stores a grant. Expired rows for the same user are swept in the same
// round-trip so the table stays bounded without a cron.
func (s *PostgresStore) Insert(ctx context.Context, g Grant) error {
	_, err := s.db.Exec(ctx, `
		WITH sweep AS (
		  DELETE FROM auth_step_up_grants WHERE user_id = $1 AND expires_at < now() - interval '1 day'
		)
		INSERT INTO auth_step_up_grants (user_id, access_token_hash, method, ip_address, user_agent, expires_at)
		VALUES ($1, $2, 'email_otp', NULLIF($3,''), NULLIF($4,''), $5)`,
		g.UserID, g.AccessTokenHash, g.IPAddress, g.UserAgent, g.ExpiresAt)
	return err
}

// GrantState reports the newest grant for (user, token). Expiry is judged by
// the database clock so app-server skew cannot extend a grant.
func (s *PostgresStore) GrantState(ctx context.Context, userID, accessTokenHash string) (middleware.StepUpGrantState, error) {
	var st middleware.StepUpGrantState
	err := s.db.QueryRow(ctx, `
		SELECT expires_at, expires_at > now()
		  FROM auth_step_up_grants
		 WHERE user_id = $1 AND access_token_hash = $2
		 ORDER BY expires_at DESC
		 LIMIT 1`, userID, accessTokenHash).Scan(&st.ExpiresAt, &st.Active)
	if errors.Is(err, pgx.ErrNoRows) {
		return middleware.StepUpGrantState{}, nil
	}
	if err != nil {
		return middleware.StepUpGrantState{}, err
	}
	st.Found = true
	return st, nil
}

// CodeIssuer / CodeVerifier are the otp.Service methods, injected as funcs so
// the service is testable without Brevo (same seam as handlers.OTPIssuer).
type (
	CodeIssuer   func(ctx context.Context, email, name, purpose, ip string) error
	CodeVerifier func(ctx context.Context, email, purpose, code, ip string) error
)

// Errors the handler maps to responses.
var (
	ErrUnavailable = errors.New("stepup: not available")
	ErrNoEmail     = errors.New("stepup: account has no email to challenge")
)

// Service runs the challenge/verify flow.
type Service struct {
	store  Store
	issue  CodeIssuer
	verify CodeVerifier
	audit  services.AuditSink
	ttl    time.Duration
	now    func() time.Time
}

// NewService wires the flow. Any nil dependency yields a service whose every
// call returns ErrUnavailable (fail closed, routes answer 503).
func NewService(store Store, issue CodeIssuer, verify CodeVerifier, audit services.AuditSink, ttl time.Duration) *Service {
	return &Service{store: store, issue: issue, verify: verify, audit: audit, ttl: ClampTTL(ttl), now: time.Now}
}

// Available reports whether a grant can actually be obtained.
func (s *Service) Available() bool {
	return s != nil && s.store != nil && s.issue != nil && s.verify != nil
}

// TTL is the configured grant lifetime.
func (s *Service) TTL() time.Duration { return s.ttl }

// Caller is the authenticated identity the flow runs for.
type Caller struct {
	UserID    string
	Email     string
	Token     string
	IPAddress string
	UserAgent string
}

// Challenge sends a step-up code to the caller's account email.
func (s *Service) Challenge(ctx context.Context, c Caller) error {
	if !s.Available() {
		return ErrUnavailable
	}
	email := strings.TrimSpace(c.Email)
	if email == "" {
		return ErrNoEmail
	}
	if err := s.issue(ctx, email, "", otp.PurposeStepUp, c.IPAddress); err != nil {
		return err
	}
	s.log(c, "auth.step_up.challenge", nil)
	return nil
}

// Verify redeems the code and, on success, records a grant bound to the
// caller's user id and bearer token. Returns the grant expiry.
func (s *Service) Verify(ctx context.Context, c Caller, code string) (time.Time, error) {
	if !s.Available() {
		return time.Time{}, ErrUnavailable
	}
	email := strings.TrimSpace(c.Email)
	if email == "" {
		return time.Time{}, ErrNoEmail
	}
	if strings.TrimSpace(c.UserID) == "" || strings.TrimSpace(c.Token) == "" {
		return time.Time{}, ErrUnavailable
	}
	if err := s.verify(ctx, email, otp.PurposeStepUp, strings.TrimSpace(code), c.IPAddress); err != nil {
		s.log(c, "auth.step_up.failed", map[string]any{"reason": err.Error()})
		return time.Time{}, err
	}
	exp := s.now().UTC().Add(s.ttl)
	if err := s.store.Insert(ctx, Grant{
		UserID:          c.UserID,
		AccessTokenHash: services.HashToken(c.Token),
		IPAddress:       c.IPAddress,
		UserAgent:       c.UserAgent,
		ExpiresAt:       exp,
	}); err != nil {
		return time.Time{}, fmt.Errorf("stepup: store grant: %w", err)
	}
	s.log(c, "auth.step_up.granted", map[string]any{"expires_at": exp.Format(time.RFC3339), "ttl_seconds": int(s.ttl.Seconds())})
	return exp, nil
}

// Status reports the grant state for the caller's current token.
func (s *Service) Status(ctx context.Context, c Caller) (middleware.StepUpGrantState, error) {
	if s == nil || s.store == nil {
		return middleware.StepUpGrantState{}, ErrUnavailable
	}
	return s.store.GrantState(ctx, c.UserID, services.HashToken(c.Token))
}

func (s *Service) log(c Caller, action string, meta map[string]any) {
	if s.audit == nil {
		return
	}
	severity := "medium"
	if action == "auth.step_up.failed" {
		severity = "high"
	}
	s.audit.LogAction(c.UserID, c.UserID, action, "auth", "step_up", "", nil, meta, c.IPAddress, c.UserAgent, severity)
}
