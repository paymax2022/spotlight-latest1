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
	const q = `SELECT id, vertical, mode, patient_id, provider_owner_kind, provider_owner_id,
	                  provider_user_id, source_ref, package_id, duration_minutes, price_kobo,
	                  booked_start, ends_at, warn_at, warning_sent_at, state, room_name,
	                  base_hold_id, ended_at
	           FROM consult_sessions WHERE id=$1`
	var sess Session
	var vertical, mode, ownerKind, state string
	err := s.db.QueryRow(ctx, q, sessionID).Scan(
		&sess.ID, &vertical, &mode, &sess.PatientID, &ownerKind,
		&sess.ProviderOwnerID, &sess.ProviderUserID, &sess.SourceRef, &sess.PackageID,
		&sess.DurationMinutes, &sess.PriceKobo, &sess.BookedStart, &sess.EndsAt,
		&sess.WarnAt, &sess.WarningSentAt, &state, &sess.RoomName,
		&sess.BaseHoldID, &sess.EndedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrNotFound
	}
	if err != nil {
		return Session{}, fmt.Errorf("consult: load session: %w", err)
	}
	sess.Vertical, sess.Mode = Vertical(vertical), Mode(mode)
	sess.ProviderOwnerKind, sess.State = OwnerKind(ownerKind), State(state)
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
