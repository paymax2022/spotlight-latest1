package top5events

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/internal/finance/ledger"
)

// ErrEditLocked is returned when an edit is refused by the tiered-lock rules
// (see editability): the event's state or sold tickets forbid the change.
var ErrEditLocked = errors.New("events: edit locked")

// ErrInvalidTimes is returned when an edit would leave starts_at >= ends_at.
var ErrInvalidTimes = errors.New("events: starts_at must be before ends_at")

// editDecision says which classes of event fields an organiser may edit.
type editDecision struct {
	AllowSoft     bool
	AllowHardTime bool
	Reason        string
}

const (
	reasonHardTimeLocked = "date, time and venue are locked because tickets have been sold"
	reasonNotEditable    = "event cannot be edited in its current state"
)

// editability applies the tiered-lock rules and denies by default.
//
// Soft fields are editable ONLY in DRAFT, SUBMITTED, APPROVED, LIVE and PAUSED.
// Every other state (CLOSED, CANCELLED, SUSPENDED, and any unknown or empty
// value) blocks all edits. SUSPENDED is an admin hold: organisers must not edit
// while it applies. Within the editable set, hard-time fields additionally need
// either no ticket sold or a DRAFT event.
func editability(state EventState, anyTicketSold bool) editDecision {
	switch state {
	case EventDraft, EventSubmitted, EventApproved, EventLive, EventPaused:
	case EventSuspended:
		return editDecision{Reason: "event suspended"}
	default:
		return editDecision{Reason: reasonNotEditable}
	}
	d := editDecision{AllowSoft: true}
	if !anyTicketSold || state == EventDraft {
		d.AllowHardTime = true
	} else {
		d.Reason = reasonHardTimeLocked
	}
	return d
}

// authorizeManage reports whether callerID may manage the event: the owning
// organiser (isOwner=true) or a MANAGER team member (isOwner=false). Anyone else
// gets ErrForbidden; a missing event gets ErrNotFound.
func (s *Service) authorizeManage(ctx context.Context, callerID, eventID string) (bool, error) {
	var organiser string
	if err := s.db.QueryRow(ctx, `SELECT organiser_id FROM events WHERE id=$1`, eventID).Scan(&organiser); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, ErrNotFound
		}
		return false, fmt.Errorf("events: fetch: %w", err)
	}
	if organiser == callerID {
		return true, nil
	}
	var ok bool
	if err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM event_team_members WHERE event_id=$1 AND user_id=$2 AND role='MANAGER')`,
		eventID, callerID).Scan(&ok); err != nil {
		return false, fmt.Errorf("events: team lookup: %w", err)
	}
	if !ok {
		return false, ErrForbidden
	}
	return false, nil
}

// Pause suspends sales on a LIVE event (LIVE -> PAUSED). Owner or MANAGER.
func (s *Service) Pause(ctx context.Context, callerID, eventID string) error {
	if _, err := s.authorizeManage(ctx, callerID, eventID); err != nil {
		return err
	}
	// ownerCheck=nil: authorizeManage already authorized (a MANAGER is not the organiser).
	return s.transition(ctx, eventID, EventLive, EventPaused, nil, "events.pause")
}

// Resume re-opens sales on a PAUSED event (PAUSED -> LIVE). Owner or MANAGER.
func (s *Service) Resume(ctx context.Context, callerID, eventID string) error {
	if _, err := s.authorizeManage(ctx, callerID, eventID); err != nil {
		return err
	}
	return s.transition(ctx, eventID, EventPaused, EventLive, nil, "events.resume")
}

// EventPatch carries optional edits; nil fields are left unchanged.
//
// The venue coordinates (events-social, ruling R44) need three states, like
// OrganiserPatch.BannerURL, so each has a Set flag recording whether the key was
// present: absent means no change, null clears the column, a value sets it (an
// empty venue_place_id also clears). They are applied only when the social flag
// is on; with it off they are ignored, as unknown keys were before.
type EventPatch struct {
	Title       *string    `json:"title,omitempty"`
	Description *string    `json:"description,omitempty"`
	Venue       *string    `json:"venue,omitempty"`
	Category    *string    `json:"category,omitempty"`
	StartsAt    *time.Time `json:"starts_at,omitempty"`
	EndsAt      *time.Time `json:"ends_at,omitempty"`

	VenueLat        *float64 `json:"-"`
	VenueLatSet     bool     `json:"-"`
	VenueLng        *float64 `json:"-"`
	VenueLngSet     bool     `json:"-"`
	VenuePlaceID    *string  `json:"-"`
	VenuePlaceIDSet bool     `json:"-"`
}

// UnmarshalJSON decodes the plain fields as before and reads venue_lat,
// venue_lng and venue_place_id as raw values, so an absent key and an explicit
// null stay distinguishable.
func (p *EventPatch) UnmarshalJSON(b []byte) error {
	type plain EventPatch // no methods: avoids recursing into this UnmarshalJSON
	var aux struct {
		plain
		VenueLat     json.RawMessage `json:"venue_lat"`
		VenueLng     json.RawMessage `json:"venue_lng"`
		VenuePlaceID json.RawMessage `json:"venue_place_id"`
	}
	if err := json.Unmarshal(b, &aux); err != nil {
		return err
	}
	*p = EventPatch(aux.plain)
	var err error
	if p.VenueLat, p.VenueLatSet, err = rawNullable[float64](aux.VenueLat, "venue_lat"); err != nil {
		return err
	}
	if p.VenueLng, p.VenueLngSet, err = rawNullable[float64](aux.VenueLng, "venue_lng"); err != nil {
		return err
	}
	if p.VenuePlaceID, p.VenuePlaceIDSet, err = rawNullable[string](aux.VenuePlaceID, "venue_place_id"); err != nil {
		return err
	}
	return nil
}

// rawNullable decodes one optional, nullable JSON value: set is false when the key
// was absent, and the pointer is nil for an explicit null.
func rawNullable[T any](raw json.RawMessage, name string) (v *T, set bool, err error) {
	if raw == nil {
		return nil, false, nil
	}
	if string(raw) == "null" {
		return nil, true, nil
	}
	var x T
	if err := json.Unmarshal(raw, &x); err != nil {
		return nil, true, fmt.Errorf("%s has the wrong type: %w", name, err)
	}
	return &x, true, nil
}

// UpdateEvent applies a patch under the tiered-lock rules. The owner or a
// MANAGER may edit. Time changes are refused (ErrEditLocked) once tickets are
// sold, except in DRAFT; nothing is written on any refusal.
func (s *Service) UpdateEvent(ctx context.Context, callerID, eventID string, patch EventPatch) (*Event, error) {
	// Venue coordinates are range-checked before any database access, and only
	// when the social flag is on (with it off they are ignored).
	if s.socialReads {
		if err := checkVenueCoords(patch.VenueLat, patch.VenueLng); err != nil {
			return nil, err
		}
	}
	if _, err := s.authorizeManage(ctx, callerID, eventID); err != nil {
		return nil, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("events: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var state string
	var startsAt, endsAt time.Time
	if err := tx.QueryRow(ctx, `SELECT state, starts_at, ends_at FROM events WHERE id=$1 FOR UPDATE`, eventID).
		Scan(&state, &startsAt, &endsAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("events: fetch: %w", err)
	}
	var sold bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM event_tickets WHERE event_id=$1)`, eventID).Scan(&sold); err != nil {
		return nil, fmt.Errorf("events: ticket check: %w", err)
	}
	dec := editability(EventState(state), sold)
	if !dec.AllowSoft {
		return nil, fmt.Errorf("%w: %s", ErrEditLocked, dec.Reason)
	}
	if (patch.StartsAt != nil || patch.EndsAt != nil) && !dec.AllowHardTime {
		return nil, fmt.Errorf("%w: %s", ErrEditLocked, dec.Reason)
	}
	if patch.StartsAt != nil {
		startsAt = *patch.StartsAt
	}
	if patch.EndsAt != nil {
		endsAt = *patch.EndsAt
	}
	if (patch.StartsAt != nil || patch.EndsAt != nil) && !startsAt.Before(endsAt) {
		return nil, ErrInvalidTimes
	}

	var sets []string
	args := []any{eventID}
	changed := map[string]any{}
	add := func(col string, v any) {
		args = append(args, v)
		sets = append(sets, fmt.Sprintf("%s=$%d", col, len(args)))
		changed[col] = v
	}
	if patch.Title != nil {
		add("title", *patch.Title)
	}
	if patch.Description != nil {
		add("description", *patch.Description)
	}
	if patch.Venue != nil {
		add("venue", *patch.Venue)
	}
	if patch.Category != nil {
		add("category", *patch.Category)
	}
	if patch.StartsAt != nil {
		add("starts_at", *patch.StartsAt)
	}
	if patch.EndsAt != nil {
		add("ends_at", *patch.EndsAt)
	}
	if s.socialReads {
		// Soft fields, like venue: editable whenever soft edits are. A nil value
		// with its Set flag writes NULL (clears the pin).
		if patch.VenueLatSet {
			add("venue_lat", nullableValue(patch.VenueLat))
		}
		if patch.VenueLngSet {
			add("venue_lng", nullableValue(patch.VenueLng))
		}
		if patch.VenuePlaceIDSet {
			add("venue_place_id", nullableValue(normPlaceID(patch.VenuePlaceID)))
		}
	}
	if len(sets) > 0 {
		sets = append(sets, "updated_at=now()")
		if _, err := tx.Exec(ctx, "UPDATE events SET "+strings.Join(sets, ", ")+" WHERE id=$1", args...); err != nil {
			return nil, fmt.Errorf("events: update: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("events: commit: %w", err)
	}
	for col, v := range changed {
		s.log(callerID, "events.update", eventID, map[string]any{"field": col, "new": v})
	}
	return s.GetEvent(ctx, eventID)
}

// nullableValue unwraps a pointer for an SQL argument: nil becomes SQL NULL.
func nullableValue[T any](v *T) any {
	if v == nil {
		return nil
	}
	return *v
}

// DuplicateEvent clones an event into a fresh DRAFT owned by callerID, in one
// transaction. Copies title (suffixed " (copy)"), description, venue, category,
// times, fee_bps, every ticket tier (sold reset to 0) and every promo code
// (used reset to 0). Tickets, orders and wallets are never copied. The caller
// must own or manage the source event, or the source must be publicly visible
// (publiclyVisibleStates); otherwise ErrForbidden.
func (s *Service) DuplicateEvent(ctx context.Context, callerID, eventID string) (*Event, error) {
	if callerID == "" {
		return nil, errors.New("events: caller required")
	}
	// Visibility gate: owner/manager, or the source is publicly discoverable
	// (same states ListEvents exposes to strangers). Else a stranger could
	// copy, and thus read, someone's private draft.
	if _, err := s.authorizeManage(ctx, callerID, eventID); err != nil {
		if !errors.Is(err, ErrForbidden) {
			return nil, err
		}
		src, gerr := s.GetEvent(ctx, eventID)
		if gerr != nil {
			return nil, gerr
		}
		if !slices.Contains(publiclyVisibleStates, string(src.State)) {
			return nil, ErrForbidden
		}
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("events: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	newID := uuid.New().String()
	// organizer_id (legacy, NOT NULL) and organiser_id get the SAME value, as in CreateEvent.
	const insEvent = `
		INSERT INTO events (id, organizer_id, organiser_id, title, description, venue, state, category, starts_at, ends_at, fee_bps)
		SELECT $1, $2, $2, title || ' (copy)', description, venue, 'DRAFT', category, starts_at, ends_at, fee_bps
		FROM events WHERE id=$3`
	tag, err := tx.Exec(ctx, insEvent, newID, callerID, eventID)
	if err != nil {
		return nil, fmt.Errorf("events: duplicate insert: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO event_ticket_tiers (id, event_id, name, price_kobo, capacity, sold, active)
		 SELECT gen_random_uuid(), $1, name, price_kobo, capacity, 0, active FROM event_ticket_tiers WHERE event_id=$2`,
		newID, eventID); err != nil {
		return nil, fmt.Errorf("events: duplicate tiers: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO event_promo_codes (id, event_id, code, version, percent_off, max_uses, used, active)
		 SELECT gen_random_uuid(), $1, code, version, percent_off, max_uses, 0, active FROM event_promo_codes WHERE event_id=$2`,
		newID, eventID); err != nil {
		return nil, fmt.Errorf("events: duplicate promos: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("events: duplicate commit: %w", err)
	}
	s.log(callerID, "events.duplicate", newID, map[string]any{"source_event_id": eventID})
	return s.GetEvent(ctx, newID)
}

// ErrEventClosed is returned when Cancel is attempted on a CLOSED (finished) event.
var ErrEventClosed = errors.New("events: event is closed and cannot be cancelled")

// cancelTicket is one not-yet-refunded ticket of a cancelled event, joined to
// its order for the payer.
type cancelTicket struct {
	id           string
	buyerID      string // order.buyer_id (the payer, NOT the ticket's current owner)
	pricePaid    int64
	credentialID *string
}

// Cancel cancels an event and refunds every buyer 90/10 (the event's fee_bps is
// retained as the platform fee). OWNER-ONLY: unlike edit/pause, a MANAGER may
// not cancel.
//
// Idempotent and resumable: an already-CANCELLED event is not an error, the
// refund sweep simply re-runs. Per-ticket ledger keys are derived from the
// ticket id (never the caller's idemKey) so a retry, a concurrent Cancel or the
// reconciler converge on exactly one refund per ticket. idemKey satisfies the
// handler-layer Idempotency-Key contract and is recorded in the audit log.
func (s *Service) Cancel(ctx context.Context, ownerID, eventID, reason, idemKey string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("events: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var organiser, state string
	if err := tx.QueryRow(ctx, `SELECT organiser_id, state FROM events WHERE id=$1 FOR UPDATE`, eventID).Scan(&organiser, &state); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("events: fetch: %w", err)
	}
	if organiser != ownerID {
		return ErrForbidden
	}
	switch EventState(state) {
	case EventClosed:
		return ErrEventClosed
	case EventCancelled:
		// Resume: fall through to the refund sweep without rewriting cancelled_at/reason.
	default:
		if _, err := tx.Exec(ctx,
			`UPDATE events SET state='CANCELLED', cancelled_at=now(), cancel_reason=$2 WHERE id=$1`,
			eventID, reason); err != nil {
			return fmt.Errorf("events: cancel: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("events: commit: %w", err)
	}
	if EventState(state) != EventCancelled {
		s.log(ownerID, "events.cancel", eventID, map[string]any{"from": state, "reason": reason, "idempotency_key": idemKey})
	}

	ev, err := s.GetEvent(ctx, eventID)
	if err != nil {
		return err
	}
	return s.refundCancelledEvent(ctx, ev)
}

// refundCancelledEvent refunds every not-yet-REFUNDED ticket of a CANCELLED
// event. A per-ticket failure does not stop the sweep (one bad ticket must not
// strand the others); the joined error is returned so the caller/reconciler
// retries, and every step is idempotent.
func (s *Service) refundCancelledEvent(ctx context.Context, ev *Event) error {
	rows, err := s.db.Query(ctx, `
		SELECT t.id, COALESCE(o.buyer_id::text,''), t.price_paid_kobo, t.credential_id::text
		FROM event_tickets t LEFT JOIN event_orders o ON o.id = t.order_id
		WHERE t.event_id=$1 AND t.state <> 'REFUNDED'
		ORDER BY t.created_at, t.id`, ev.ID)
	if err != nil {
		return fmt.Errorf("events: list tickets to refund: %w", err)
	}
	var todo []cancelTicket
	for rows.Next() {
		var ct cancelTicket
		if err := rows.Scan(&ct.id, &ct.buyerID, &ct.pricePaid, &ct.credentialID); err != nil {
			rows.Close()
			return fmt.Errorf("events: scan ticket: %w", err)
		}
		todo = append(todo, ct)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("events: list tickets to refund: %w", err)
	}
	var errs []error
	for _, ct := range todo {
		if err := s.cancelRefundOneTicket(ctx, ev, ct.id, ct.buyerID, ct.pricePaid, ct.credentialID); err != nil {
			errs = append(errs, fmt.Errorf("ticket %s: %w", ct.id, err))
		}
	}
	return errors.Join(errs...)
}

// cancelRefundOneTicket refunds one ticket of a cancelled event. A paid ticket
// (pricePaid > 0) returns pricePaid - fee to the PAYER (the order's buyer, not
// the ticket's current owner, who may be a gift recipient) out of escrow and
// moves fee escrow -> platform revenue, where fee = pricePaid*FeeBps/10000
// (integer; refund+fee == pricePaid exactly). A comp ticket (pricePaid == 0)
// moves no money.
//
// Ledger idempotency keys are derived from the ticket id only, so every retry
// and the reconciler converge on one posting. Crash-safe ordering mirrors
// SettleVendor: money legs FIRST, then revoke the credential, then mark the
// order and finally the ticket REFUNDED (the ticket flip is the "done" marker
// the sweep selects on).
func (s *Service) cancelRefundOneTicket(ctx context.Context, ev *Event, ticketID, buyerID string, pricePaidKobo int64, credentialID *string) error {
	if pricePaidKobo > 0 {
		if buyerID == "" {
			return errors.New("events: paid ticket has no order/payer to refund")
		}
		fee := pricePaidKobo * int64(ev.FeeBps) / 10000
		refund := pricePaidKobo - fee
		// Fail closed: post nothing unless the split is consistent.
		if refund < 0 || fee < 0 || refund+fee != pricePaidKobo {
			return fmt.Errorf("events: inconsistent cancel split (price=%d fee=%d refund=%d)", pricePaidKobo, fee, refund)
		}
		escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
		if err != nil {
			return err
		}
		if refund > 0 {
			if err := s.led.Credit(ctx, buyerID, "evt-cancel-refund:"+ticketID, "evt-cancel:"+ticketID+":refund", escrowAcc.ID, refund); !alreadyApplied(err) {
				return fmt.Errorf("events: cancel refund credit: %w", err)
			}
		}
		if fee > 0 {
			revAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
			if err != nil {
				return err
			}
			if err := s.led.PostJournal(ctx, ledger.JournalEntry{
				Reference: "evt-cancel-fee:" + ticketID, IdempotencyKey: "evt-cancel:" + ticketID + ":fee",
				AmountKobo: fee, DebitAccountID: escrowAcc.ID, CreditAccountID: revAcc.ID,
			}); !alreadyApplied(err) {
				return fmt.Errorf("events: cancel fee posting: %w", err)
			}
		}
	}
	if credentialID != nil {
		// credential.Revoke cannot distinguish "already terminal" from a real
		// failure (both are generic errors), so read the state first: a missing or
		// non-ACTIVE credential (REVOKED/USED/EXPIRED) is already dead and fine.
		// Any other Revoke error aborts BEFORE the ticket is marked REFUNDED, so
		// the sweep retries instead of leaving a refunded ticket with a live QR.
		var cstate string
		err := s.db.QueryRow(ctx, `SELECT state FROM credentials WHERE id=$1`, *credentialID).Scan(&cstate)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
		case err != nil:
			return fmt.Errorf("events: credential state: %w", err)
		case cstate == "ACTIVE":
			if err := s.cred.Revoke(ctx, *credentialID); err != nil {
				return fmt.Errorf("events: revoke credential: %w", err)
			}
		}
	}
	if _, err := s.db.Exec(ctx,
		`UPDATE event_orders SET status='REFUNDED' WHERE status='PAID' AND id=(SELECT order_id FROM event_tickets WHERE id=$1)`, ticketID); err != nil {
		return fmt.Errorf("events: mark order refunded: %w", err)
	}
	if _, err := s.db.Exec(ctx, `UPDATE event_tickets SET state='REFUNDED' WHERE id=$1 AND state <> 'REFUNDED'`, ticketID); err != nil {
		return fmt.Errorf("events: mark ticket refunded: %w", err)
	}
	s.log(buyerID, "events.cancel.refund", ticketID, map[string]any{"event": ev.ID, "paid": pricePaidKobo})
	return nil
}

// ReconcileCancelledEvents re-drives the refund sweep for CANCELLED events that
// still have non-REFUNDED tickets (a Cancel that crashed or partially failed).
// It reuses the same ticket-derived idempotency keys, so it can overlap Cancel
// or another instance without double-refunding. Returns the events swept clean.
func (s *Service) ReconcileCancelledEvents(ctx context.Context) (int, error) {
	rows, err := s.db.Query(ctx, `
		SELECT e.id FROM events e
		WHERE e.state='CANCELLED'
		  AND EXISTS (SELECT 1 FROM event_tickets t WHERE t.event_id=e.id AND t.state <> 'REFUNDED')
		ORDER BY random() LIMIT 50`) // random: a permanently failing event must not starve newer ones
	if err != nil {
		return 0, fmt.Errorf("events: list cancelled events: %w", err)
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	var errs []error
	n := 0
	for _, id := range ids {
		ev, err := s.GetEvent(ctx, id)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		if err := s.refundCancelledEvent(ctx, ev); err != nil {
			errs = append(errs, fmt.Errorf("event %s: %w", id, err))
			continue
		}
		n++
	}
	return n, errors.Join(errs...)
}
