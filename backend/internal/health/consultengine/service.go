package consultengine

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Auditor is the immutable-audit slice the engine uses. nil is safe.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// Escrow is the money rail the engine needs. Implemented in app by an adapter
// over *escrow.Service, so this package stays free of ledger dependencies.
type Escrow interface {
	HoldWithPayee(ctx context.Context, payerID, payeeID, reference, moduleType, idemKey string, amountKobo int64) (string, error)
	Release(ctx context.Context, escrowID, payeeID string) error
	// Refund compensates a hold whose extension could not be applied.
	Refund(ctx context.Context, escrowID string) error
}

// RoomMedia provisions rooms and mints join tokens. nil means "media is off":
// every session operation that needs media fails closed with ErrMediaUnavailable.
type RoomMedia interface {
	EnsureRoom(ctx context.Context, room string) error
	CloseRoom(ctx context.Context, room string) error
	JoinToken(ctx context.Context, room, identity string, role MediaRole, ttl time.Duration) (string, error)
	URL() string
	TokenTTL() time.Duration
}

type Service struct {
	db    *pgxpool.Pool
	media RoomMedia
	esc   Escrow
	audit Auditor
	now   func() time.Time
}

func NewService(db *pgxpool.Pool, media RoomMedia, esc Escrow, audit Auditor) *Service {
	return &Service{db: db, media: media, esc: esc, audit: audit, now: time.Now}
}

// WithClock replaces the clock (tests and deterministic sweeps).
func (s *Service) WithClock(now func() time.Time) *Service {
	if now != nil {
		s.now = now
	}
	return s
}

func (s *Service) audited(actorID, targetID, action, resourceID string, oldV, newV map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actorID, targetID, action, "health.consult", "consult_session", resourceID, oldV, newV, "", "", "info")
}

// view fills the computed fields every client reads.
func (s *Service) view(sess Session) Session {
	now := s.now()
	sess.ServerNow = now
	sess.Extendable = (sess.State == StateScheduled || sess.State == StateLive) && now.Before(sess.EndsAt)
	return sess
}

func roomName(v Vertical, sessionID string) string {
	return "consult-" + string(v) + "-" + sessionID
}

// load reads one session without authorization. Callers must scope it.
func (s *Service) load(ctx context.Context, sessionID string) (Session, error) {
	q := `SELECT ` + sessionColumns + ` FROM consult_sessions WHERE id=$1`
	sess, err := scanSession(s.db.QueryRow(ctx, q, sessionID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrNotFound
	}
	if err != nil {
		return Session{}, fmt.Errorf("consult: load session: %w", err)
	}
	return sess, nil
}

// loadBySource finds the one session pinned to a module appointment. The unique
// index on (vertical, source_ref) guarantees at most one row.
func (s *Service) loadBySource(ctx context.Context, vertical Vertical, sourceRef string) (Session, error) {
	q := `SELECT ` + sessionColumns + ` FROM consult_sessions WHERE vertical=$1 AND source_ref=$2`
	sess, err := scanSession(s.db.QueryRow(ctx, q, vertical, sourceRef))
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrNotFound
	}
	if err != nil {
		return Session{}, fmt.Errorf("consult: load session by source: %w", err)
	}
	return sess, nil
}

// loadForCaller folds "missing" and "not a participant" into the same error so
// a foreign actor cannot probe for session existence.
func (s *Service) loadForCaller(ctx context.Context, sessionID, callerID string) (Session, bool, error) {
	sess, err := s.load(ctx, sessionID)
	if err != nil {
		return Session{}, false, err
	}
	callerID = strings.TrimSpace(callerID)
	if callerID == "" {
		return Session{}, false, ErrNotFound
	}
	if callerID == sess.PatientID {
		return sess, false, nil
	}
	if callerID == sess.ProviderUserID {
		return sess, true, nil
	}
	return Session{}, false, ErrNotFound
}
