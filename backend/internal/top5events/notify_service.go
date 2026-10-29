package top5events

// Events-commerce notifications: the customer-facing inbox for this module.
//
// A buyer who pays, is refunded, or finds their event cancelled must be told, not
// left to discover it by opening the app three days later (UAT EVT-104/232). The
// row is written in the same flow as the thing it reports, but never inside the
// money transaction: a failed inbox write must not roll back a completed refund, so
// every emit here is best-effort and loud in the audit trail when it fails.
//
// Dedup is the database's job: event_notifications has a unique index on
// (user_id, order_id, kind) for order-scoped rows, which is what makes a
// crash-replayed purchase or a re-driven refund sweep notify exactly once.

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Notification kinds. The mobile inbox keys its icon and deep link off these, so
// they are part of the contract, not free text.
const (
	NotifyPurchase        = "purchase"
	NotifyRefundRequested = "refund_requested"
	NotifyRefundApproved  = "refund_approved"
	NotifyRefundDone      = "refund_completed"
	NotifyRefundRejected  = "refund_rejected"
	NotifyEventCancelled  = "event_cancelled"
	NotifyModeration      = "moderation"
	NotifySupportReply    = "support_reply"
)

// Notification is one inbox row for one user.
type Notification struct {
	ID        string     `json:"id"`
	Kind      string     `json:"kind"`
	Title     string     `json:"title"`
	Body      string     `json:"body"`
	EventID   string     `json:"event_id,omitempty"`
	OrderID   string     `json:"order_id,omitempty"`
	RefundID  string     `json:"refund_id,omitempty"`
	ReadAt    *time.Time `json:"read_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

// notify inserts one inbox row. eventID/orderID/refundID are empty for "not
// relevant". It never returns an error to a caller that is on a money path: the
// failure is recorded in the audit trail instead, because the alternative —
// failing a paid refund because an inbox row could not be written — is worse.
//
// It is a no-op with the commerce flag off: event_notifications is created by that
// migration, so a database that has not applied it must not be asked for the table.
func (s *Service) notify(ctx context.Context, userID, kind, title, body, eventID, orderID, refundID string) {
	if !s.commerceReads || userID == "" || kind == "" {
		return
	}
	const q = `
		INSERT INTO event_notifications (id, user_id, kind, title, body, event_id, order_id, refund_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		ON CONFLICT (user_id, order_id, kind) WHERE order_id IS NOT NULL DO NOTHING`
	if _, err := s.db.Exec(ctx, q, uuid.New().String(), userID, kind,
		clampTrim(title, 140), clampTrim(body, 800),
		nullIfEmpty(eventID), nullIfEmpty(orderID), nullIfEmpty(refundID)); err != nil {
		s.log(userID, "events.notify.failed", kind, map[string]any{"event": eventID, "order": orderID, "error": err.Error()})
	}
}

// Notifications is the caller's events inbox: the page plus the total unread count,
// so the badge and the list come from one round trip.
func (s *Service) Notifications(ctx context.Context, userID string, limit, offset int, unreadOnly bool) ([]Notification, int, error) {
	return s.notifyPage(ctx, userID, limit, offset, unreadOnly)
}

// notifyPage is the caller's inbox. unreadOnly narrows it to what they have not
// seen, and the returned count is always the full unread total so a badge stays
// correct while the list is filtered or paged.
func (s *Service) notifyPage(ctx context.Context, userID string, limit, offset int, unreadOnly bool) ([]Notification, int, error) {
	if userID == "" {
		return nil, 0, ErrValidation
	}
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	if offset < 0 {
		offset = 0
	}
	var unread int
	if err := s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM event_notifications WHERE user_id=$1 AND read_at IS NULL`, userID).Scan(&unread); err != nil {
		return nil, 0, fmt.Errorf("events: notification count: %w", err)
	}

	where := "user_id = $1"
	if unreadOnly {
		where += " AND read_at IS NULL"
	}
	rows, err := s.db.Query(ctx,
		`SELECT id, kind, title, body,
		        COALESCE(event_id::text,''), COALESCE(order_id::text,''), COALESCE(refund_id::text,''),
		        read_at, created_at
		   FROM event_notifications WHERE `+where+` ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
		userID, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("events: notifications: %w", err)
	}
	defer rows.Close()

	out := []Notification{}
	for rows.Next() {
		var n Notification
		if err := rows.Scan(&n.ID, &n.Kind, &n.Title, &n.Body, &n.EventID, &n.OrderID, &n.RefundID,
			&n.ReadAt, &n.CreatedAt); err != nil {
			return nil, unread, fmt.Errorf("events: notifications scan: %w", err)
		}
		out = append(out, n)
	}
	return out, unread, rows.Err()
}

// MarkNotificationRead marks one of the caller's own rows. The user_id predicate is
// what makes this safe to expose on an unguessable-but-not-authorised id: another
// user's notification is ErrNotFound, not ErrForbidden, so ids cannot be probed.
func (s *Service) MarkNotificationRead(ctx context.Context, userID, id string) error {
	if userID == "" {
		return ErrValidation
	}
	tag, err := s.db.Exec(ctx,
		`UPDATE event_notifications SET read_at = now() WHERE id=$1 AND user_id=$2 AND read_at IS NULL`, id, userID)
	if err != nil {
		return fmt.Errorf("events: mark read: %w", err)
	}
	if tag.RowsAffected() == 0 {
		var exists bool
		if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM event_notifications WHERE id=$1 AND user_id=$2)`,
			id, userID).Scan(&exists); err != nil {
			return fmt.Errorf("events: notification lookup: %w", err)
		}
		if !exists {
			return ErrNotFound
		}
	}
	return nil
}

// MarkAllNotificationsRead clears the caller's badge and returns how many rows it
// touched.
func (s *Service) MarkAllNotificationsRead(ctx context.Context, userID string) (int, error) {
	if userID == "" {
		return 0, ErrValidation
	}
	tag, err := s.db.Exec(ctx, `UPDATE event_notifications SET read_at = now() WHERE user_id=$1 AND read_at IS NULL`, userID)
	if err != nil {
		return 0, fmt.Errorf("events: mark all read: %w", err)
	}
	return int(tag.RowsAffected()), nil
}
