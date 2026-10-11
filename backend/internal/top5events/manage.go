package top5events

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
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
type EventPatch struct {
	Title       *string    `json:"title,omitempty"`
	Description *string    `json:"description,omitempty"`
	Venue       *string    `json:"venue,omitempty"`
	Category    *string    `json:"category,omitempty"`
	StartsAt    *time.Time `json:"starts_at,omitempty"`
	EndsAt      *time.Time `json:"ends_at,omitempty"`
}

// UpdateEvent applies a patch under the tiered-lock rules. The owner or a
// MANAGER may edit. Time changes are refused (ErrEditLocked) once tickets are
// sold, except in DRAFT; nothing is written on any refusal.
func (s *Service) UpdateEvent(ctx context.Context, callerID, eventID string, patch EventPatch) (*Event, error) {
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

// DuplicateEvent clones an event into a fresh DRAFT owned by callerID, in one
// transaction. Copies title (suffixed " (copy)"), description, venue, category,
// times, fee_bps, every ticket tier (sold reset to 0) and every promo code
// (used reset to 0). Tickets, orders and wallets are never copied. Mirrors
// CreateEvent's authz: any authenticated caller may duplicate any event.
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
