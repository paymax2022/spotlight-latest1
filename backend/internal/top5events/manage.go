package top5events

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

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
