package top5events

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"

	"github.com/jackc/pgx/v5"
)

// NotificationSender is the minimal seam Announce needs to push a message to one
// user. app-wiring adapts the notifications service to it; the core package never
// imports notifications. Nil is safe: Announce still records the row.
type NotificationSender interface {
	Send(ctx context.Context, userID, title, body string) error
}

// SetNotifier injects the notification seam (app-wiring, post-construction).
func (s *Service) SetNotifier(n NotificationSender) { s.notifier = n }

const announceChannel = "push,in_app"

// Announce sends a message to every DISTINCT ticket holder of the event and
// records one event_announcements history row. Owner or MANAGER only.
//
// Idempotent on (event, idemKey): the history row is claimed first via the
// unique index (ON CONFLICT DO NOTHING); only the caller that wins the claim
// sends, so a replay (or a concurrent duplicate) returns the stored
// recipient_count with no second send. Sending is best-effort: a failed send is
// logged and skipped and never aborts the batch or fails the call.
// Recipients are scoped strictly by event_id.
//
// Delivery is AT-MOST-ONCE by design. The history row is committed (the claim)
// before any send, so a process crash between claim and send — or a total queue
// outage (Redis down / nil notifier) — leaves a recorded row whose idemKey a
// retry will short-circuit, meaning those holders are never (re)notified. The
// returned recipient_count is the distinct-holder count at claim time and does
// NOT reflect per-send success. This is acceptable for best-effort push/in-app
// notices; a guaranteed-delivery redesign (a sent_at marker + replay re-send
// when NULL) is a tracked follow-up, not done here.
func (s *Service) Announce(ctx context.Context, callerID, eventID, subject, body, idemKey string) (int, error) {
	if idemKey == "" {
		return 0, fmt.Errorf("%w: events: idempotency key required", ErrValidation)
	}
	subject = strings.TrimSpace(subject)
	body = strings.TrimSpace(body)
	if body == "" {
		return 0, fmt.Errorf("%w: events: announcement body required", ErrValidation)
	}
	if _, err := s.authorizeManage(ctx, callerID, eventID); err != nil {
		return 0, err
	}

	// Fast replay path.
	var existing int
	err := s.db.QueryRow(ctx,
		`SELECT recipient_count FROM event_announcements WHERE event_id=$1 AND idempotency_key=$2`,
		eventID, idemKey).Scan(&existing)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return 0, fmt.Errorf("events: announce lookup: %w", err)
	}

	rows, err := s.db.Query(ctx, `SELECT DISTINCT owner_id FROM event_tickets WHERE event_id=$1`, eventID)
	if err != nil {
		return 0, fmt.Errorf("events: announce holders: %w", err)
	}
	var holders []string
	for rows.Next() {
		var uid string
		if err := rows.Scan(&uid); err != nil {
			rows.Close()
			return 0, fmt.Errorf("events: announce holders scan: %w", err)
		}
		holders = append(holders, uid)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("events: announce holders: %w", err)
	}

	// Claim the idempotency slot (records history). Loser of a race re-reads.
	var claimed string
	err = s.db.QueryRow(ctx,
		`INSERT INTO event_announcements (event_id, sender_id, channel, subject, body, recipient_count, idempotency_key)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)
		 ON CONFLICT (event_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
		 RETURNING id`,
		eventID, callerID, announceChannel, subject, body, len(holders), idemKey).Scan(&claimed)
	if errors.Is(err, pgx.ErrNoRows) {
		if qerr := s.db.QueryRow(ctx,
			`SELECT recipient_count FROM event_announcements WHERE event_id=$1 AND idempotency_key=$2`,
			eventID, idemKey).Scan(&existing); qerr != nil {
			return 0, fmt.Errorf("events: announce replay lookup: %w", qerr)
		}
		return existing, nil
	}
	if err != nil {
		return 0, fmt.Errorf("events: announce record: %w", err)
	}

	if s.notifier != nil {
		title := subject
		if title == "" {
			title = "Event update"
		}
		// The slot is already claimed, so these sends must run to completion even
		// if the caller's request context is cancelled mid-batch (a client
		// disconnect would otherwise silently drop the rest of the fan-out).
		sendCtx := context.WithoutCancel(ctx)
		for _, uid := range holders {
			if serr := s.notifier.Send(sendCtx, uid, title, body); serr != nil {
				log.Printf("[top5events] announce send (event=%s user=%s) failed, continuing: %v", eventID, uid, serr)
			}
		}
	}
	s.log(callerID, "events.announce", eventID, map[string]any{"recipients": len(holders)})
	return len(holders), nil
}
