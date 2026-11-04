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

// Join mints a room token for one participant and returns the server clock so
// the client can render the countdown without trusting the device clock.
func (s *Service) Join(ctx context.Context, sessionID, callerID string) (Join, error) {
	sess, isProvider, err := s.loadForCaller(ctx, sessionID, callerID)
	if err != nil {
		return Join{}, err
	}
	now := s.now()
	if sess.State == StateEnded || sess.State == StateCancelled || !now.Before(sess.EndsAt) {
		return Join{}, ErrState
	}
	if s.media == nil {
		return Join{}, ErrMediaUnavailable
	}
	if sess.State == StateScheduled {
		if _, err := s.db.Exec(ctx, `UPDATE consult_sessions SET state='live', updated_at=$2
		                              WHERE id=$1 AND state='scheduled'`, sess.ID, now); err != nil {
			return Join{}, fmt.Errorf("consult: mark live: %w", err)
		}
		sess.State = StateLive
	}
	if err := s.media.EnsureRoom(ctx, sess.RoomName); err != nil {
		return Join{}, fmt.Errorf("consult: ensure room: %w", err)
	}
	role := MediaPeer
	if isProvider {
		role = MediaPeerAdmin
	}
	ttl := JoinTTL(now, sess.EndsAt, s.media.TokenTTL())
	token, err := s.media.JoinToken(ctx, sess.RoomName, callerID, role, ttl)
	if err != nil {
		return Join{}, fmt.Errorf("consult: join token: %w", err)
	}
	return Join{
		Token:   token,
		RTC:     RTC{Provider: "livekit", URL: s.media.URL(), Room: sess.RoomName},
		Session: s.view(sess),
	}, nil
}

// endSession marks a session ended, cuts the room and releases extension money.
// It is idempotent: a second call on an ended session does nothing.
func (s *Service) endSession(ctx context.Context, sess Session) error {
	if sess.State == StateEnded {
		return nil
	}
	now := s.now()
	tag, err := s.db.Exec(ctx, `UPDATE consult_sessions SET state='ended', ended_at=$2, updated_at=$2
	                            WHERE id=$1 AND state <> 'ended'`, sess.ID, now)
	if err != nil {
		return fmt.Errorf("consult: mark ended: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil
	}
	if s.media != nil {
		if err := s.media.CloseRoom(ctx, sess.RoomName); err != nil {
			// The token TTL and LiveKit's empty-room timeout finish the cut; the
			// state is already authoritative.
			fmt.Printf("[consult] close room %s: %v\n", sess.RoomName, err)
		}
	}
	return s.releaseExtensions(ctx, sess)
}

// Complete ends a session on a participant's request.
func (s *Service) Complete(ctx context.Context, sessionID, callerID string) error {
	sess, _, err := s.loadForCaller(ctx, sessionID, callerID)
	if err != nil {
		return err
	}
	return s.endSession(ctx, sess)
}

// Sweep records warnings and ends due sessions. It is the timer backstop when
// both clients vanish.
func (s *Service) Sweep(ctx context.Context) error {
	now := s.now()
	if _, err := s.db.Exec(ctx, `UPDATE consult_sessions SET warning_sent_at=$1, updated_at=$1
	                              WHERE state IN ('scheduled','live')
	                                AND warning_sent_at IS NULL
	                                AND warn_at <= $1 AND ends_at > $1`, now); err != nil {
		return fmt.Errorf("consult: sweep warnings: %w", err)
	}

	rows, err := s.db.Query(ctx, `SELECT id, vertical, mode, patient_id, provider_owner_kind,
	                                     provider_owner_id, provider_user_id, source_ref, package_id,
	                                     duration_minutes, price_kobo, booked_start, ends_at, warn_at,
	                                     warning_sent_at, state, room_name, base_hold_id, ended_at
	                              FROM consult_sessions
	                              WHERE state IN ('scheduled','live') AND ends_at <= $1`, now)
	if err != nil {
		return fmt.Errorf("consult: sweep due sessions: %w", err)
	}
	var due []Session
	for rows.Next() {
		var sess Session
		var vertical, mode, ownerKind, state string
		if err := rows.Scan(&sess.ID, &vertical, &mode, &sess.PatientID,
			&ownerKind, &sess.ProviderOwnerID, &sess.ProviderUserID,
			&sess.SourceRef, &sess.PackageID, &sess.DurationMinutes, &sess.PriceKobo,
			&sess.BookedStart, &sess.EndsAt, &sess.WarnAt, &sess.WarningSentAt,
			&state, &sess.RoomName, &sess.BaseHoldID, &sess.EndedAt); err != nil {
			rows.Close()
			return err
		}
		sess.Vertical, sess.Mode = Vertical(vertical), Mode(mode)
		sess.ProviderOwnerKind, sess.State = OwnerKind(ownerKind), State(state)
		due = append(due, sess)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, sess := range due {
		if err := s.endSession(ctx, sess); err != nil {
			return err
		}
	}

	// A release that failed after the session ended is retried here: the session
	// is no longer in the due set, so endSession will not run again for it.
	rows, err = s.db.Query(ctx, `SELECT DISTINCT e.session_id
	                             FROM consult_extension_requests e
	                             JOIN consult_sessions s ON s.id=e.session_id
	                             WHERE s.state='ended' AND e.status='paid'
	                               AND e.escrow_id IS NOT NULL AND e.released_at IS NULL`)
	if err != nil {
		return fmt.Errorf("consult: list unreleased escrows: %w", err)
	}
	var retry []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		retry = append(retry, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, id := range retry {
		sess, err := s.load(ctx, id)
		if err != nil {
			return err
		}
		if err := s.releaseExtensions(ctx, sess); err != nil {
			return err
		}
	}

	if _, err := s.db.Exec(ctx, `UPDATE consult_extension_requests e
	                              SET status='expired', updated_at=$1
	                              FROM consult_sessions s
	                              WHERE e.session_id=s.id
	                                AND e.status IN ('pending_approval','approved_awaiting_payment')
	                                AND (s.state='ended' OR s.ends_at <= $1
	                                     OR (e.payment_expires_at IS NOT NULL AND e.payment_expires_at <= $1))`, now); err != nil {
		return fmt.Errorf("consult: expire extensions: %w", err)
	}
	return nil
}

// RunSweeper runs Sweep on an interval until ctx is cancelled.
func (s *Service) RunSweeper(ctx context.Context, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			sweepCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
			if err := s.Sweep(sweepCtx); err != nil {
				fmt.Printf("[consult] sweep: %v\n", err)
			}
			cancel()
		}
	}
}

// releaseExtensions is a temporary no-op; Task 6 replaces it with the escrow
// release over paid extension requests.
func (s *Service) releaseExtensions(context.Context, Session) error { return nil }
