package consultengine

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const extColumns = `id, session_id, requested_by, added_minutes, price_kobo, status,
                    approved_at, payment_expires_at, paid_at, escrow_id, decided_by,
                    decline_reason, created_at`

func scanExtension(row pgx.Row) (Extension, error) {
	var e Extension
	var status string
	err := row.Scan(&e.ID, &e.SessionID, &e.RequestedBy, &e.AddedMinutes, &e.PriceKobo,
		&status, &e.ApprovedAt, &e.PaymentExpiresAt, &e.PaidAt, &e.EscrowID,
		&e.DecidedBy, &e.DeclineReason, &e.CreatedAt)
	e.Status = ExtensionStatus(status)
	return e, err
}

func (s *Service) loadExtension(ctx context.Context, sessionID, extID string) (Extension, error) {
	q := `SELECT ` + extColumns + ` FROM consult_extension_requests WHERE id=$1 AND session_id=$2`
	ext, err := scanExtension(s.db.QueryRow(ctx, q, extID, sessionID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Extension{}, ErrNotFound
	}
	if err != nil {
		return Extension{}, fmt.Errorf("consult: load extension: %w", err)
	}
	return ext, nil
}

// RequestExtension records an extension request. A provider's request is a free
// grant applied at once; a patient's waits for provider approval.
func (s *Service) RequestExtension(ctx context.Context, sessionID, callerID string, minutes int) (Extension, error) {
	sess, isProvider, err := s.loadForCaller(ctx, sessionID, callerID)
	if err != nil {
		return Extension{}, err
	}
	now := s.now()
	if sess.State == StateEnded || sess.State == StateCancelled || !now.Before(sess.EndsAt) {
		return Extension{}, ErrState
	}
	if minutes < 1 || minutes > MaxExtensionMinutes {
		return Extension{}, ErrInvalid
	}
	if sess.EndsAt.Add(time.Duration(minutes) * time.Minute).After(sess.BookedStart.Add(MaxSessionWindow)) {
		return Extension{}, ErrInvalid
	}
	price := ExtensionPriceKobo(sess.PriceKobo, sess.DurationMinutes, minutes)
	status := ExtPending
	if isProvider {
		status, price = ExtPaid, 0
	}

	const q = `INSERT INTO consult_extension_requests
	             (session_id, requested_by, added_minutes, price_kobo, status,
	              approved_at, paid_at)
	           VALUES ($1,$2,$3,$4,$5,$6,$7)
	           RETURNING ` + extColumns
	var approved, paid *time.Time
	if isProvider {
		approved, paid = &now, &now
	}
	ext, err := scanExtension(s.db.QueryRow(ctx, q, sessionID, callerID, minutes, price, status, approved, paid))
	if err != nil {
		// The partial unique index allows one open request per session; a
		// second concurrent request is a state conflict, not a server fault.
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return Extension{}, ErrState
		}
		return Extension{}, fmt.Errorf("consult: request extension: %w", err)
	}
	if isProvider {
		if _, err := s.applyExtension(ctx, sess, minutes); err != nil {
			return Extension{}, err
		}
	}
	s.audited(callerID, sess.PatientID, "health.consult.extension.request", ext.ID, nil,
		map[string]any{"added_minutes": minutes, "price_kobo": price, "status": string(status)})
	return ext, nil
}

// DecideExtension is the provider's approval or decline of a patient request.
func (s *Service) DecideExtension(ctx context.Context, sessionID, extID, callerID string, approve bool, reason string) (Extension, error) {
	sess, isProvider, err := s.loadForCaller(ctx, sessionID, callerID)
	if err != nil {
		return Extension{}, err
	}
	if !isProvider {
		return Extension{}, ErrNotFound
	}
	ext, err := s.loadExtension(ctx, sessionID, extID)
	if err != nil {
		return Extension{}, err
	}
	if ext.Status != ExtPending {
		return Extension{}, ErrExtensionNotPayable
	}
	now := s.now()
	if now.Before(sess.EndsAt) == false {
		return Extension{}, ErrState
	}
	var updated Extension
	if approve {
		expires := now.Add(ExtensionPaymentWindow)
		q := `UPDATE consult_extension_requests
		      SET status='approved_awaiting_payment', approved_at=$2, payment_expires_at=$3,
		          decided_by=$4, updated_at=$2
		      WHERE id=$1 AND status='pending_approval'
		      RETURNING ` + extColumns
		updated, err = scanExtension(s.db.QueryRow(ctx, q, extID, now, expires, callerID))
	} else {
		reason = strings.TrimSpace(reason)
		var why *string
		if reason != "" {
			why = &reason
		}
		q := `UPDATE consult_extension_requests
		      SET status='declined', decided_by=$2, decline_reason=$3, updated_at=$4
		      WHERE id=$1 AND status='pending_approval'
		      RETURNING ` + extColumns
		updated, err = scanExtension(s.db.QueryRow(ctx, q, extID, callerID, why, now))
	}
	if err != nil {
		return Extension{}, fmt.Errorf("consult: decide extension: %w", err)
	}
	s.audited(callerID, sess.PatientID, "health.consult.extension.decide", extID, nil,
		map[string]any{"approved": approve})
	return updated, nil
}

// PayExtension moves the patient's approved extension into escrow and applies
// the added minutes. The escrow key is the extension id, so a retry cannot
// charge twice.
func (s *Service) PayExtension(ctx context.Context, sessionID, extID, callerID string) (Extension, Session, error) {
	sess, _, err := s.loadForCaller(ctx, sessionID, callerID)
	if err != nil {
		return Extension{}, Session{}, err
	}
	if callerID != sess.PatientID {
		return Extension{}, Session{}, ErrNotFound
	}
	ext, err := s.loadExtension(ctx, sessionID, extID)
	if err != nil {
		return Extension{}, Session{}, err
	}
	if ext.Status != ExtAwaitingPayment {
		return Extension{}, Session{}, ErrExtensionNotPayable
	}
	now := s.now()
	if ext.PaymentExpiresAt == nil || !now.Before(*ext.PaymentExpiresAt) || !now.Before(sess.EndsAt) {
		_, _ = s.db.Exec(ctx, `UPDATE consult_extension_requests SET status='expired', updated_at=$2
		                       WHERE id=$1 AND status='approved_awaiting_payment'`, extID, now)
		return Extension{}, Session{}, ErrPaymentExpired
	}
	if s.esc == nil {
		return Extension{}, Session{}, ErrEscrowUnavailable
	}
	escrowID, err := s.esc.HoldWithPayee(ctx, sess.PatientID, sess.ProviderUserID,
		sess.SourceRef, "consult_extension", "consult-ext:"+ext.ID, ext.PriceKobo)
	if err != nil {
		return Extension{}, Session{}, fmt.Errorf("consult: hold extension payment: %w", err)
	}
	q := `UPDATE consult_extension_requests
	      SET status='paid', paid_at=$2, escrow_id=$3, updated_at=$2
	      WHERE id=$1 AND status='approved_awaiting_payment'
	      RETURNING ` + extColumns
	paid, err := scanExtension(s.db.QueryRow(ctx, q, extID, now, escrowID))
	if err != nil {
		return Extension{}, Session{}, fmt.Errorf("consult: mark extension paid: %w", err)
	}
	updated, err := s.applyExtension(ctx, sess, ext.AddedMinutes)
	if err != nil {
		return Extension{}, Session{}, err
	}
	s.audited(callerID, sess.ProviderUserID, "health.consult.extension.pay", extID, nil,
		map[string]any{"price_kobo": ext.PriceKobo, "escrow_id": escrowID})
	return paid, s.view(updated), nil
}

// applyExtension moves ends_at forward from whichever is later (now, current
// end) and resets the warning so the new end is announced.
func (s *Service) applyExtension(ctx context.Context, sess Session, minutes int) (Session, error) {
	now := s.now()
	base := sess.EndsAt
	if now.After(base) {
		base = now
	}
	ends := base.Add(time.Duration(minutes) * time.Minute)
	warn := WarnAt(sess.BookedStart, ends)
	const q = `UPDATE consult_sessions
	           SET ends_at=$2, warn_at=$3, warning_sent_at=NULL, updated_at=$4
	           WHERE id=$1 AND state IN ('scheduled','live')
	           RETURNING ends_at, warn_at`
	var gotEnd, gotWarn time.Time
	if err := s.db.QueryRow(ctx, q, sess.ID, ends, warn, now).Scan(&gotEnd, &gotWarn); err != nil {
		return Session{}, fmt.Errorf("consult: apply extension: %w", err)
	}
	updated, err := s.load(ctx, sess.ID)
	if err != nil {
		return Session{}, err
	}
	return updated, nil
}

// releaseExtensions releases every paid extension hold for an ended session,
// once. A release failure is retried by the next sweep because released_at
// stays NULL.
func (s *Service) releaseExtensions(ctx context.Context, sess Session) error {
	if s.esc == nil {
		return nil
	}
	rows, err := s.db.Query(ctx, `SELECT id, escrow_id FROM consult_extension_requests
	                              WHERE session_id=$1 AND status='paid'
	                                AND escrow_id IS NOT NULL AND released_at IS NULL`, sess.ID)
	if err != nil {
		return fmt.Errorf("consult: list extension escrows: %w", err)
	}
	type pending struct{ id, escrow string }
	var items []pending
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.id, &p.escrow); err != nil {
			rows.Close()
			return err
		}
		items = append(items, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, p := range items {
		if err := s.esc.Release(ctx, p.escrow, sess.ProviderUserID); err != nil {
			return fmt.Errorf("consult: release extension escrow: %w", err)
		}
		if _, err := s.db.Exec(ctx, `UPDATE consult_extension_requests SET released_at=$2 WHERE id=$1`, p.id, s.now()); err != nil {
			return fmt.Errorf("consult: mark extension released: %w", err)
		}
	}
	return nil
}
