// Package supportimpersonation implements the read-only support "view-as"
// capability (ESTD-D028 / EST-UAT-0422, ADR-PR<pr-number>).
//
// It owns the session lifecycle (start / stop / expiry), the per-request and
// refusal audit trail, and the user-visible notice. The request-time guards
// that make it read-only live in middleware/support_impersonation.go and reach
// this package only through middleware.ImpersonationSessions.
package supportimpersonation

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
)

var uuidShape = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// IsUUID reports whether s is a canonical UUID (so bad input never reaches a
// ::uuid cast and turns into a 500).
func IsUUID(s string) bool { return uuidShape.MatchString(s) }

// Session is one view-as session row.
type Session struct {
	ID           string     `json:"id"`
	ActorUserID  string     `json:"actor_user_id"`
	TargetUserID string     `json:"target_user_id"`
	Reason       string     `json:"reason"`
	TicketRef    string     `json:"ticket_ref"`
	Mode         string     `json:"mode"`
	StartedAt    time.Time  `json:"started_at"`
	ExpiresAt    time.Time  `json:"expires_at"`
	EndedAt      *time.Time `json:"ended_at,omitempty"`
	EndReason    string     `json:"end_reason,omitempty"`
}

// StartParams is a validated start request.
type StartParams struct {
	ActorUserID    string
	ActorTokenHash string
	TargetUserID   string
	Reason         string
	TicketRef      string
	Duration       time.Duration
	IPAddress      string
	UserAgent      string
}

// PostgresStore persists sessions and events.
type PostgresStore struct{ db *pgxpool.Pool }

// NewPostgresStore returns nil for a nil pool.
func NewPostgresStore(db *pgxpool.Pool) *PostgresStore {
	if db == nil {
		return nil
	}
	return &PostgresStore{db: db}
}

var _ middleware.ImpersonationSessions = (*PostgresStore)(nil)

// TargetStatus reports whether the user exists in platform_users and its status.
func (s *PostgresStore) TargetStatus(ctx context.Context, userID string) (bool, string, error) {
	var status string
	err := s.db.QueryRow(ctx, `SELECT COALESCE(status,'') FROM platform_users WHERE id = $1::uuid`, userID).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, "", nil
	}
	if err != nil {
		return false, "", err
	}
	return true, status, nil
}

const sessionCols = `id::text, actor_user_id::text, target_user_id::text, reason, ticket_ref, mode, started_at, expires_at, ended_at, COALESCE(end_reason,'')`

func scanSession(row pgx.Row) (Session, error) {
	var x Session
	err := row.Scan(&x.ID, &x.ActorUserID, &x.TargetUserID, &x.Reason, &x.TicketRef, &x.Mode, &x.StartedAt, &x.ExpiresAt, &x.EndedAt, &x.EndReason)
	return x, err
}

// Start ends any session the actor still has open (one view-as at a time),
// opens the new one and writes its 'start' event — all in one transaction, so
// a session can never exist without its audit row.
func (s *PostgresStore) Start(ctx context.Context, p StartParams) (Session, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Session{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `
		WITH ended AS (
		  UPDATE support_impersonation_sessions
		     SET ended_at = now(), end_reason = 'superseded'
		   WHERE actor_user_id = $1::uuid AND ended_at IS NULL
		  RETURNING id, actor_user_id, target_user_id
		)
		INSERT INTO support_impersonation_events (session_id, actor_user_id, target_user_id, event, detail, ip_address, user_agent)
		SELECT id, actor_user_id, target_user_id, 'stop', 'superseded', NULLIF($2,''), NULLIF($3,'') FROM ended`,
		p.ActorUserID, p.IPAddress, p.UserAgent); err != nil {
		return Session{}, fmt.Errorf("supportimpersonation: supersede: %w", err)
	}

	sess, err := scanSession(tx.QueryRow(ctx, `
		INSERT INTO support_impersonation_sessions
		       (actor_user_id, target_user_id, reason, ticket_ref, actor_token_hash, expires_at, ip_address, user_agent)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5, now() + make_interval(secs => $6), NULLIF($7,''), NULLIF($8,''))
		RETURNING `+sessionCols,
		p.ActorUserID, p.TargetUserID, p.Reason, p.TicketRef, p.ActorTokenHash, p.Duration.Seconds(), p.IPAddress, p.UserAgent))
	if err != nil {
		return Session{}, fmt.Errorf("supportimpersonation: insert session: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO support_impersonation_events (session_id, actor_user_id, target_user_id, event, detail, ip_address, user_agent)
		VALUES ($1::uuid, $2::uuid, $3::uuid, 'start', $4, NULLIF($5,''), NULLIF($6,''))`,
		sess.ID, sess.ActorUserID, sess.TargetUserID, "ticket="+p.TicketRef, p.IPAddress, p.UserAgent); err != nil {
		return Session{}, fmt.Errorf("supportimpersonation: start event: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Session{}, err
	}
	return sess, nil
}

// Stop ends the actor's own open session and writes its 'stop' event. It
// returns (false, nil) when there is no such open session for this actor.
func (s *PostgresStore) Stop(ctx context.Context, sessionID, actorUserID, ip, ua string) (Session, bool, error) {
	if !IsUUID(sessionID) {
		return Session{}, false, nil
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Session{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	sess, err := scanSession(tx.QueryRow(ctx, `
		UPDATE support_impersonation_sessions
		   SET ended_at = LEAST(now(), expires_at), end_reason = CASE WHEN expires_at <= now() THEN 'expired' ELSE 'stopped' END
		 WHERE id = $1::uuid AND actor_user_id = $2::uuid AND ended_at IS NULL
		RETURNING `+sessionCols, sessionID, actorUserID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, false, nil
	}
	if err != nil {
		return Session{}, false, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO support_impersonation_events (session_id, actor_user_id, target_user_id, event, detail, ip_address, user_agent)
		VALUES ($1::uuid, $2::uuid, $3::uuid, 'stop', $4, NULLIF($5,''), NULLIF($6,''))`,
		sess.ID, sess.ActorUserID, sess.TargetUserID, sess.EndReason, ip, ua); err != nil {
		return Session{}, false, fmt.Errorf("supportimpersonation: stop event: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Session{}, false, err
	}
	return sess, true, nil
}

// Active returns the actor's live session, if any.
func (s *PostgresStore) Active(ctx context.Context, actorUserID string) (*Session, error) {
	sess, err := scanSession(s.db.QueryRow(ctx, `
		SELECT `+sessionCols+` FROM support_impersonation_sessions
		 WHERE actor_user_id = $1::uuid AND ended_at IS NULL AND expires_at > now()
		 ORDER BY started_at DESC LIMIT 1`, actorUserID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &sess, nil
}

// ListForTarget is the impersonated user's notice: every support access to
// their account, newest first.
func (s *PostgresStore) ListForTarget(ctx context.Context, targetUserID string, limit int) ([]Session, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.db.Query(ctx, `
		SELECT `+sessionCols+` FROM support_impersonation_sessions
		 WHERE target_user_id = $1::uuid
		 ORDER BY started_at DESC LIMIT $2`, targetUserID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Session{}
	for rows.Next() {
		x, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

// Resolve implements middleware.ImpersonationSessions.
func (s *PostgresStore) Resolve(ctx context.Context, sessionID, actorUserID, actorTokenHash string) (middleware.SupportImpersonation, error) {
	if !IsUUID(sessionID) || !IsUUID(actorUserID) {
		return middleware.SupportImpersonation{}, middleware.ErrImpersonationNotFound
	}
	var (
		actor, target, tokenHash string
		live                     bool
	)
	err := s.db.QueryRow(ctx, `
		SELECT actor_user_id::text, target_user_id::text, actor_token_hash, (ended_at IS NULL AND expires_at > now())
		  FROM support_impersonation_sessions WHERE id = $1::uuid`, sessionID).Scan(&actor, &target, &tokenHash, &live)
	if errors.Is(err, pgx.ErrNoRows) {
		return middleware.SupportImpersonation{}, middleware.ErrImpersonationNotFound
	}
	if err != nil {
		return middleware.SupportImpersonation{}, err
	}
	// Another agent's session, or this agent from a different login: not theirs.
	if actor != actorUserID || subtle.ConstantTimeCompare([]byte(tokenHash), []byte(actorTokenHash)) != 1 {
		return middleware.SupportImpersonation{}, middleware.ErrImpersonationNotFound
	}
	if !live {
		// Close an expired-but-open row lazily so the notice shows it ended.
		_, _ = s.db.Exec(ctx, `
			UPDATE support_impersonation_sessions SET ended_at = expires_at, end_reason = 'expired'
			 WHERE id = $1::uuid AND ended_at IS NULL AND expires_at <= now()`, sessionID)
		return middleware.SupportImpersonation{}, middleware.ErrImpersonationExpired
	}
	return middleware.SupportImpersonation{SessionID: sessionID, ActorUserID: actor, TargetUserID: target}, nil
}

// RecordRequest implements middleware.ImpersonationSessions.
func (s *PostgresStore) RecordRequest(ctx context.Context, x middleware.SupportImpersonation, ev middleware.ImpersonationRequestEvent) (int64, error) {
	var id int64
	err := s.db.QueryRow(ctx, `
		INSERT INTO support_impersonation_events
		       (session_id, actor_user_id, target_user_id, event, method, path, route, detail, ip_address, user_agent)
		VALUES ($1::uuid, $2::uuid, $3::uuid, 'request', $4, $5, $6, NULLIF($7,''), NULLIF($8,''), NULLIF($9,''))
		RETURNING id`,
		x.SessionID, x.ActorUserID, x.TargetUserID, ev.Method, ev.Path, ev.Route, ev.Detail, ev.IPAddress, ev.UserAgent).Scan(&id)
	return id, err
}

// FinishRequest implements middleware.ImpersonationSessions.
func (s *PostgresStore) FinishRequest(ctx context.Context, eventID int64, status int) error {
	_, err := s.db.Exec(ctx, `UPDATE support_impersonation_events SET status_code = $2 WHERE id = $1 AND event = 'request'`, eventID, status)
	return err
}

// RecordRefusal implements middleware.ImpersonationSessions.
func (s *PostgresStore) RecordRefusal(ctx context.Context, sessionID, event string, ev middleware.ImpersonationRequestEvent) error {
	if !IsUUID(sessionID) {
		return nil
	}
	if event != "refused" && event != "expired" {
		event = "refused"
	}
	_, err := s.db.Exec(ctx, `
		INSERT INTO support_impersonation_events
		       (session_id, actor_user_id, target_user_id, event, method, path, route, status_code, detail, ip_address, user_agent)
		SELECT id, actor_user_id, target_user_id, $2, $3, $4, $5, 403, NULLIF($6,''), NULLIF($7,''), NULLIF($8,'')
		  FROM support_impersonation_sessions WHERE id = $1::uuid`,
		sessionID, event, ev.Method, ev.Path, ev.Route, ev.Detail, ev.IPAddress, ev.UserAgent)
	return err
}
