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

// sqlExecer is the slice of pgx the extension writers need, so the same helper
// runs on the pool or inside a transaction.
type sqlExecer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// applyExtensionOn advances ends_at atomically from whichever is later (now, the
// row's current ends_at), then recomputes warn_at from the row's booked_start.
func applyExtensionOn(ctx context.Context, q sqlExecer, sessionID string, minutes int, now time.Time) (end, warn time.Time, err error) {
	const advance = `UPDATE consult_sessions
	                 SET ends_at = GREATEST(ends_at, $2) + ($3 * interval '1 minute'), updated_at=$2
	                 WHERE id=$1 AND state IN ('scheduled','live')
	                 RETURNING ends_at, booked_start`
	var bookedStart time.Time
	if err := q.QueryRow(ctx, advance, sessionID, now, minutes).Scan(&end, &bookedStart); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return time.Time{}, time.Time{}, ErrState
		}
		return time.Time{}, time.Time{}, fmt.Errorf("consult: advance session: %w", err)
	}
	warn = WarnAt(bookedStart, end)
	if _, err := q.Exec(ctx, `UPDATE consult_sessions SET warn_at=$2, warning_sent_at=NULL, updated_at=$3 WHERE id=$1`, sessionID, warn, now); err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("consult: rearm warning: %w", err)
	}
	return end, warn, nil
}

func scanExtension(row rowScanner) (Extension, error) {
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
	isUnique := func(err error) bool {
		// The partial unique index allows one open request per session; a
		// second concurrent request is a state conflict, not a server fault.
		var pgErr *pgconn.PgError
		return errors.As(err, &pgErr) && pgErr.Code == "23505"
	}
	var ext Extension
	if isProvider {
		// The grant row and its minutes commit together, so a free grant can
		// never exist without the time it granted.
		tx, err := s.db.Begin(ctx)
		if err != nil {
			return Extension{}, fmt.Errorf("consult: begin extension grant: %w", err)
		}
		defer tx.Rollback(ctx)
		ext, err = scanExtension(tx.QueryRow(ctx, q, sessionID, callerID, minutes, price, status, approved, paid))
		if err != nil {
			if isUnique(err) {
				return Extension{}, ErrState
			}
			return Extension{}, fmt.Errorf("consult: request extension: %w", err)
		}
		if _, _, err := applyExtensionOn(ctx, tx, sessionID, minutes, now); err != nil {
			return Extension{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return Extension{}, fmt.Errorf("consult: commit extension grant: %w", err)
		}
	} else {
		var err error
		ext, err = scanExtension(s.db.QueryRow(ctx, q, sessionID, callerID, minutes, price, status, approved, paid))
		if err != nil {
			if isUnique(err) {
				return Extension{}, ErrState
			}
			return Extension{}, fmt.Errorf("consult: request extension: %w", err)
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
	if sess.State == StateEnded || sess.State == StateCancelled {
		return Extension{}, ErrState
	}
	if now.Before(sess.EndsAt) == false {
		return Extension{}, ErrState
	}
	var updated Extension
	if approve {
		expires := now.Add(ExtensionPaymentWindow)
		if expires.After(sess.EndsAt) {
			expires = sess.EndsAt
		}
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
// the added minutes in one transaction, so escrow can never fund a session
// whose minutes were not granted. The escrow key is the extension id, so a
// retry cannot charge twice.
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
	if sess.State == StateEnded || sess.State == StateCancelled {
		return Extension{}, Session{}, ErrState
	}
	// A zero-price extension moves no money and must not depend on escrow.
	if ext.PriceKobo > 0 && s.esc == nil {
		return Extension{}, Session{}, ErrEscrowUnavailable
	}
	// A recorded escrow_id on a row that is still awaiting payment IS this
	// request's hold — reuse it. Refunding and re-holding under the same key is
	// never safe: the escrow replay would hand back the REFUNDED row.
	escrowID := ext.EscrowID
	if escrowID == nil && ext.PriceKobo > 0 {
		id, err := s.esc.HoldWithPayee(ctx, sess.PatientID, sess.ProviderUserID,
			sess.SourceRef, "consult_extension", "consult-ext:"+ext.ID, ext.PriceKobo)
		if err != nil {
			return Extension{}, Session{}, fmt.Errorf("consult: hold extension payment: %w", err)
		}
		escrowID = &id
		if _, err := s.db.Exec(ctx, `UPDATE consult_extension_requests SET escrow_id=$2, updated_at=$3
		                             WHERE id=$1 AND status='approved_awaiting_payment'`, extID, id, now); err != nil {
			// The stamp may have landed despite the error, and another attempt may
			// have committed the row paid meanwhile. Claim the row with the same
			// status guard used everywhere else before touching money; a zero-row
			// claim means a paid winner owns the hold and it must not be refunded.
			tag, cerr := s.db.Exec(ctx, `UPDATE consult_extension_requests
			                             SET status='expired', escrow_id=$2, updated_at=$3
			                             WHERE id=$1 AND status='approved_awaiting_payment'`, extID, id, now)
			if cerr == nil && tag.RowsAffected() == 1 {
				if rerr := s.esc.Refund(ctx, id); rerr == nil {
					_, _ = s.db.Exec(ctx, `UPDATE consult_extension_requests
					                       SET escrow_id=NULL, released_at=$3 WHERE id=$1 AND escrow_id=$2`, extID, id, now)
				}
			}
			return Extension{}, Session{}, fmt.Errorf("consult: record extension hold: %w", err)
		}
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		s.retireUnapplied(ctx, extID, escrowID, now)
		return Extension{}, Session{}, fmt.Errorf("consult: begin extension payment: %w", err)
	}
	defer tx.Rollback(ctx)

	const markPaid = `UPDATE consult_extension_requests
	                  SET status='paid', paid_at=$2, escrow_id=$3, updated_at=$2
	                  WHERE id=$1 AND status='approved_awaiting_payment'
	                    AND escrow_id IS NOT DISTINCT FROM $3
	                  RETURNING ` + extColumns
	paid, err := scanExtension(tx.QueryRow(ctx, markPaid, extID, now, escrowID))
	if err != nil {
		_ = tx.Rollback(ctx)
		if errors.Is(err, pgx.ErrNoRows) {
			// The request left the payable state underneath us. A concurrent
			// winner's paid row owns the hold, so leave its escrow untouched.
			if cur, lerr := s.loadExtension(ctx, sessionID, extID); lerr == nil && cur.Status == ExtPaid {
				return Extension{}, Session{}, ErrExtensionNotPayable
			}
			s.retireUnapplied(ctx, extID, escrowID, now)
			return Extension{}, Session{}, ErrPaymentExpired
		}
		s.retireUnapplied(ctx, extID, escrowID, now)
		return Extension{}, Session{}, fmt.Errorf("consult: mark extension paid: %w", err)
	}
	if _, _, err := applyExtensionOn(ctx, tx, sess.ID, ext.AddedMinutes, now); err != nil {
		_ = tx.Rollback(ctx)
		s.retireUnapplied(ctx, extID, escrowID, now)
		return Extension{}, Session{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		// Guarded claim: if the commit actually landed as paid, retireUnapplied
		// does nothing and the hold stays releasable.
		s.retireUnapplied(ctx, extID, escrowID, now)
		return Extension{}, Session{}, fmt.Errorf("consult: commit extension payment: %w", err)
	}
	updated, err := s.load(ctx, sess.ID)
	if err != nil {
		return Extension{}, Session{}, err
	}
	var esc any
	if escrowID != nil {
		esc = *escrowID
	}
	s.audited(callerID, sess.ProviderUserID, "health.consult.extension.pay", extID, nil,
		map[string]any{"price_kobo": ext.PriceKobo, "escrow_id": esc})
	return paid, s.view(updated), nil
}

// retireUnapplied retires a request whose extension was not applied and returns
// its hold to the patient. The status flip is the claim that decides ownership:
// a row another attempt committed as paid is left alone and its hold is not
// refunded. A failed refund leaves the row expired with escrow_id set so the
// sweep refund lane retries it; a successful refund stamps released_at so the
// lane cannot refund the same hold twice (escrow forbids REFUNDED → REFUNDED).
func (s *Service) retireUnapplied(ctx context.Context, extID string, escrowID *string, now time.Time) {
	var tag pgconn.CommandTag
	var err error
	if escrowID == nil {
		tag, err = s.db.Exec(ctx, `UPDATE consult_extension_requests
		                           SET status='expired', updated_at=$2
		                           WHERE id=$1 AND status IN ('approved_awaiting_payment','expired')
		                             AND escrow_id IS NULL`, extID, now)
	} else {
		tag, err = s.db.Exec(ctx, `UPDATE consult_extension_requests
		                           SET status='expired', updated_at=$3
		                           WHERE id=$1 AND status IN ('approved_awaiting_payment','expired')
		                             AND escrow_id IS NOT DISTINCT FROM $2`, extID, escrowID, now)
	}
	if err != nil || tag.RowsAffected() == 0 {
		return // lost the claim: another attempt owns the outcome, or the DB is down
	}
	if escrowID == nil {
		return
	}
	if err := s.esc.Refund(ctx, *escrowID); err != nil {
		return // lane retries: expired + escrow_id still set
	}
	_, _ = s.db.Exec(ctx, `UPDATE consult_extension_requests SET escrow_id=NULL, released_at=$2 WHERE id=$1`, extID, now)
}

// releaseExtensions settles every extension hold for an ended session, once:
// money that bought minutes is released to the provider, money held for an
// extension that was never granted is refunded to the patient. A failure is
// retried by the next sweep because released_at stays NULL.
func (s *Service) releaseExtensions(ctx context.Context, sess Session) error {
	if s.esc == nil {
		return nil
	}
	rows, err := s.db.Query(ctx, `SELECT id, status, escrow_id FROM consult_extension_requests
	                              WHERE session_id=$1 AND status IN ('paid','expired')
	                                AND escrow_id IS NOT NULL AND released_at IS NULL`, sess.ID)
	if err != nil {
		return fmt.Errorf("consult: list extension escrows: %w", err)
	}
	type pending struct{ id, status, escrow string }
	var items []pending
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.id, &p.status, &p.escrow); err != nil {
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
		var err error
		if ExtensionStatus(p.status) == ExtExpired {
			if err = s.esc.Refund(ctx, p.escrow); err != nil {
				return fmt.Errorf("consult: refund extension escrow: %w", err)
			}
		} else if err = s.esc.Release(ctx, p.escrow, sess.ProviderUserID); err != nil {
			return fmt.Errorf("consult: release extension escrow: %w", err)
		}
		if _, err := s.db.Exec(ctx, `UPDATE consult_extension_requests SET released_at=$2 WHERE id=$1`, p.id, s.now()); err != nil {
			return fmt.Errorf("consult: mark extension released: %w", err)
		}
	}
	return nil
}

// ListExtensions returns the session's extension requests, newest first, to a
// participant only. Both sides poll this while the warning is up, so a patient
// sees an approval without a manual refresh and a provider sees the request
// that needs a decision.
func (s *Service) ListExtensions(ctx context.Context, sessionID, callerID string) ([]Extension, error) {
	if _, _, err := s.loadForCaller(ctx, sessionID, callerID); err != nil {
		return nil, err
	}
	q := `SELECT ` + extColumns + ` FROM consult_extension_requests
	      WHERE session_id=$1 ORDER BY created_at DESC LIMIT 50`
	rows, err := s.db.Query(ctx, q, sessionID)
	if err != nil {
		return nil, fmt.Errorf("consult: list extensions: %w", err)
	}
	defer rows.Close()
	out := []Extension{}
	for rows.Next() {
		ext, err := scanExtension(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, ext)
	}
	return out, rows.Err()
}
