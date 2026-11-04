package consultengine

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// verifyProviderUser proves the user id really belongs to the pricing owner.
func (s *Service) verifyProviderUser(ctx context.Context, req BookRequest) error {
	switch req.ProviderOwnerKind {
	case OwnerDoctor:
		if req.ProviderUserID != req.ProviderOwnerID {
			return ErrInvalid
		}
		return nil
	case OwnerHealthProvider:
		var owner string
		err := s.db.QueryRow(ctx, `SELECT owner_user_id::text FROM health_providers WHERE id=$1`, req.ProviderOwnerID).Scan(&owner)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrInvalid
		}
		if err != nil {
			return fmt.Errorf("consult: resolve provider owner: %w", err)
		}
		if owner != req.ProviderUserID {
			return ErrInvalid
		}
		return nil
	default:
		return ErrInvalid
	}
}

// Book prices a session from a published package, snapshots it, provisions the
// room and stores the row. Media is required: a patient is never sold a session
// that cannot start.
func (s *Service) Book(ctx context.Context, req BookRequest) (Session, error) {
	if !validVertical(req.Vertical) || !validMode(req.Mode) {
		return Session{}, ErrInvalid
	}
	if strings.TrimSpace(req.PatientID) == "" || strings.TrimSpace(req.SourceRef) == "" || strings.TrimSpace(req.PackageID) == "" {
		return Session{}, ErrInvalid
	}
	if err := s.verifyProviderUser(ctx, req); err != nil {
		return Session{}, err
	}
	if s.media == nil {
		return Session{}, ErrMediaUnavailable
	}

	const pq = `SELECT duration_minutes, price_kobo
	            FROM consult_session_packages
	            WHERE id=$1 AND owner_kind=$2 AND owner_id=$3 AND vertical=$4 AND mode=$5 AND active=true`
	var duration int
	var price int64
	err := s.db.QueryRow(ctx, pq, req.PackageID, req.ProviderOwnerKind, req.ProviderOwnerID, req.Vertical, req.Mode).Scan(&duration, &price)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrInvalid
	}
	if err != nil {
		return Session{}, fmt.Errorf("consult: load package: %w", err)
	}

	now := s.now()
	start := req.Start
	if start.IsZero() {
		start = now
	}
	if start.Before(now.Add(-5 * time.Minute)) {
		return Session{}, ErrInvalid
	}
	ends := start.Add(time.Duration(duration) * time.Minute)
	warn := WarnAt(start, ends)

	id := uuid.NewString()
	room := roomName(req.Vertical, id)
	if err := s.media.EnsureRoom(ctx, room); err != nil {
		return Session{}, fmt.Errorf("consult: provision room: %w", err)
	}

	const q = `INSERT INTO consult_sessions
	             (id, vertical, mode, patient_id, provider_owner_kind, provider_owner_id,
	              provider_user_id, source_ref, package_id, duration_minutes, price_kobo,
	              booked_start, ends_at, warn_at, state, room_name, base_hold_id)
	           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'scheduled',$15,$16)
	           RETURNING id, vertical, mode, patient_id, provider_owner_kind, provider_owner_id,
	                     provider_user_id, source_ref, package_id, duration_minutes, price_kobo,
	                     booked_start, ends_at, warn_at, warning_sent_at, state, room_name,
	                     base_hold_id, ended_at`
	var hold *string
	if strings.TrimSpace(req.BaseHoldID) != "" {
		hold = &req.BaseHoldID
	}
	var sess Session
	var vertical, mode, ownerKind, state string
	err = s.db.QueryRow(ctx, q, id, req.Vertical, req.Mode, req.PatientID, req.ProviderOwnerKind,
		req.ProviderOwnerID, req.ProviderUserID, req.SourceRef, req.PackageID, duration, price,
		start, ends, warn, room, hold).Scan(
		&sess.ID, &vertical, &mode, &sess.PatientID, &ownerKind,
		&sess.ProviderOwnerID, &sess.ProviderUserID, &sess.SourceRef, &sess.PackageID,
		&sess.DurationMinutes, &sess.PriceKobo, &sess.BookedStart, &sess.EndsAt,
		&sess.WarnAt, &sess.WarningSentAt, &state, &sess.RoomName,
		&sess.BaseHoldID, &sess.EndedAt)
	if err != nil {
		return Session{}, fmt.Errorf("consult: book session: %w", err)
	}
	sess.Vertical, sess.Mode, sess.ProviderOwnerKind = Vertical(vertical), Mode(mode), OwnerKind(ownerKind)
	sess.State = State(state)
	s.audited(req.PatientID, req.ProviderUserID, "health.consult.book", sess.ID, nil, map[string]any{
		"vertical": string(req.Vertical), "mode": string(req.Mode),
		"duration_minutes": duration, "price_kobo": price,
	})
	return s.view(sess), nil
}

// Get returns one session to a participant, folded to not-found otherwise.
func (s *Service) Get(ctx context.Context, sessionID, callerID string) (Session, error) {
	sess, _, err := s.loadForCaller(ctx, sessionID, callerID)
	if err != nil {
		return Session{}, err
	}
	return s.view(sess), nil
}
