package restaurant

import (
	"context"
	"log"
)

// Notifier delivers an order/chat notification to a user. The default
// LogNotifier just logs; inject a real implementation (push/in-app, backed by
// the notifications queue) via Service.SetNotifier. This seam keeps the
// restaurant service testable and prevents a hard dependency on asynq — when
// the queue is unavailable the module still functions (notifications are
// no-op/logged rather than failing the request).
type Notifier interface {
	Notify(ctx context.Context, n Notification) error
}

// Notification is the message delivered to one recipient.
type Notification struct {
	UserID string
	Event  string
	Title  string
	Body   string
	Data   map[string]any
}

// LogNotifier is the no-op default — it logs rather than delivering.
type LogNotifier struct{}

func (LogNotifier) Notify(ctx context.Context, n Notification) error {
	log.Printf("[restaurant] notify user=%s event=%s: %s", n.UserID, n.Event, n.Title)
	return nil
}

// NotifierFunc adapts a function to the Notifier interface.
type NotifierFunc func(ctx context.Context, n Notification) error

func (f NotifierFunc) Notify(ctx context.Context, n Notification) error { return f(ctx, n) }

// notify is a panic-safe, best-effort wrapper. Notification delivery never
// fails the surrounding money/order operation.
func (s *Service) notify(ctx context.Context, n Notification) {
	if s.notifier == nil {
		return
	}
	if err := s.notifier.Notify(ctx, n); err != nil {
		log.Printf("[restaurant] notify failed user=%s event=%s: %v", n.UserID, n.Event, err)
	}
}

// SetNotifier injects a real notifier (defaults to LogNotifier).
func (s *Service) SetNotifier(n Notifier) *Service {
	if n != nil {
		s.notifier = n
	}
	return s
}

// Event names emitted by the restaurant module.
const (
	EventOrderPlaced    = "restaurant.order.placed"
	EventOrderConfirmed = "restaurant.order.confirmed"
	EventOrderPreparing = "restaurant.order.preparing"
	EventOrderReady     = "restaurant.order.ready"
	EventOrderPickedUp  = "restaurant.order.picked_up"
	EventOrderDelivered = "restaurant.order.delivered"
	EventOrderCancelled = "restaurant.order.cancelled"
	EventOrderAssigned  = "restaurant.order.assigned"
	EventOrderAccepted  = "restaurant.order.accepted"
	EventOrderDispatch  = "restaurant.order.dispatch"  // offered to available riders
	EventOrderNoRiders  = "restaurant.order.no_riders" // dispatch found no available riders
	EventOrderHandoff   = "restaurant.order.handoff"   // delivered + handed off (code confirmed)
	EventNewMessage     = "restaurant.chat.message"
	// Admin ops-console onboarding decision (approve/reject) delivered to the owner.
	EventOnboardingDecision = "restaurant.onboarding.decision"
	// Payout run disbursed to a restaurant owner / rider wallet.
	EventPayoutDisbursed = "restaurant.payout.disbursed"
)
