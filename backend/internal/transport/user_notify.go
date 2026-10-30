package transport

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/notifications"
)

// UserNotifier delivers a member-facing transport notification (scheduled
// reminders, dispatch failures, insurance refunds). Optional: nil keeps the
// log-only behaviour. The audit event each caller records is the durable
// record; delivery is best-effort.
type UserNotifier interface {
	NotifyUser(ctx context.Context, userID, event, title, body string, data map[string]any) error
}

// notifyTimeout bounds a delivery attempt so a slow queue never stalls the
// scheduler tick or the request that triggered it.
const notifyTimeout = 5 * time.Second

// WithUserNotifier wires the platform notification seam. Nil is accepted.
func (s *Service) WithUserNotifier(n UserNotifier) *Service {
	s.userNotifier = n
	return s
}

// notifyTitle is the push title shown for a transport notification event.
func notifyTitle(event string) string {
	switch event {
	case "scheduled.reminder":
		return "Upcoming trip reminder"
	case "scheduled.failed_no_driver":
		return "Scheduled trip not dispatched"
	case "parcel.insurance_refunded":
		return "Parcel insurance refunded"
	default:
		return "Spotlight Mobility"
	}
}

// notifyUser logs the notification and, when a notifier is wired, hands it to
// the platform notification service. Never returns an error: callers' state
// transitions and idempotency columns must not depend on delivery.
func (s *Service) notifyUser(ctx context.Context, userID, event, bookingID, message string) {
	log.Printf("[transport] notify user=%s event=%s ref=%s: %s", userID, event, bookingID, message)
	if s.userNotifier == nil || userID == "" {
		return
	}
	nctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), notifyTimeout)
	defer cancel()
	data := map[string]any{"event": event}
	if bookingID != "" {
		data["ref"] = bookingID
	}
	if err := s.userNotifier.NotifyUser(nctx, userID, event, notifyTitle(event), message, data); err != nil {
		log.Printf("[transport] notify delivery failed user=%s event=%s ref=%s: %v", userID, event, bookingID, err)
	}
}

// pushSender is the subset of notifications.Service the push adapter needs.
type pushSender interface {
	Send(ctx context.Context, n notifications.Notification) error
}

// PushUserNotifier fans a transport notification out to every registered Expo
// device token of the member (device_push_tokens), the same resolution the
// health reminder and estate notifiers use.
type PushUserNotifier struct {
	db     *pgxpool.Pool
	sender pushSender
}

// NewPushUserNotifier builds the adapter over the shared notifications queue.
func NewPushUserNotifier(db *pgxpool.Pool, sender *notifications.Service) *PushUserNotifier {
	return &PushUserNotifier{db: db, sender: sender}
}

// NotifyUser implements UserNotifier. Zero device tokens is not an error.
func (p *PushUserNotifier) NotifyUser(ctx context.Context, userID, event, title, body string, data map[string]any) error {
	if p == nil || p.db == nil || p.sender == nil {
		return nil
	}
	rows, err := p.db.Query(ctx, `SELECT token FROM device_push_tokens WHERE user_id=$1`, userID)
	if err != nil {
		return fmt.Errorf("transport notify: resolve push tokens: %w", err)
	}
	var tokens []string
	for rows.Next() {
		var tok string
		if rows.Scan(&tok) == nil && tok != "" {
			tokens = append(tokens, tok)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("transport notify: scan push tokens: %w", err)
	}
	return sendToTokens(ctx, p.sender, tokens, notifications.Notification{
		UserID:   userID,
		Event:    notifications.EventTransportUpdate,
		Title:    title,
		Body:     body,
		Data:     data,
		Channels: []notifications.Channel{notifications.ChannelPush},
	})
}

// sendToTokens enqueues one push per device token and joins the failures.
func sendToTokens(ctx context.Context, sender pushSender, tokens []string, n notifications.Notification) error {
	var errs []error
	for _, tok := range tokens {
		n.PushToken = tok
		if err := sender.Send(ctx, n); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}
