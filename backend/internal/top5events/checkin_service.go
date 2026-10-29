package top5events

// Events-commerce check-in: everything that happens at the door.
//
// Before this file, a scan was only "is this rotating token valid": the ticket was
// marked USED and nothing recorded who admitted it, at which gate, by which method,
// and no organiser-set window limited when entry was possible. This adds:
//
//   - the check-in window (checkin_opens_minutes / checkin_closes_minutes, clamped
//     to ends_at), enforced by the door itself and — for the lower bound only —
//     already enforced by the credential core, whose ValidFrom follows the window;
//   - attribution on the ticket row (current state) plus event_checkin_log (the
//     append-only history, including a reversal);
//   - manual check-in for an attendee whose phone is dead, and undo for a mistake
//     at the gate, which reissues a credential so the same ticket can still enter;
//   - the roster the door works from: attendee name, filters and counters.
//
// Every one of these is gated on Service.commerceReads: with the flag off ScanTicket
// behaves exactly as it did before, because the columns it would write do not exist.
//
// Ordering note: the window is checked BEFORE credential.Validate, never after. A
// Validate that returns OK has already consumed a single-use token, so rejecting
// after that point would burn the attendee's ticket for arriving early.

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/internal/credential"
)

var (
	ErrCheckinNotOpen   = errors.New("events: check-in has not opened for this event")
	ErrCheckinClosed    = errors.New("events: check-in has closed for this event")
	ErrAlreadyCheckedIn = errors.New("events: ticket is already checked in")
	ErrNotCheckedIn     = errors.New("events: ticket has not been checked in")
)

// ReasonCheckinWindow is returned in credential.Result.Reason when the token itself
// is fine but the doors are not open. The scanner app shows it as "too early /
// too late", distinct from a forged or replayed pass.
const ReasonCheckinWindow = "outside_checkin_window"

// Check-in log actions and methods (event_checkin_log CHECK constraints).
const (
	CheckinActionIn   = "CHECK_IN"
	CheckinActionUndo = "UNDO"

	CheckinMethodScan   = "SCAN"
	CheckinMethodManual = "MANUAL"
	CheckinMethodSync   = "SYNC"
)

// maxGateNameLen bounds the free-text gate label a scanner device sends.
const maxGateNameLen = 60

// checkinRow is the door's view of the ticket a scan or manual check-in acts on.
// The three window fields are only filled when the commerce flag is on.
type checkinRow struct {
	ticketID     string
	eventID      string
	organiserID  string
	ownerID      string
	state        string
	attendeeName string
	startsAt     time.Time
	endsAt       time.Time
	opensMins    int
	closesMins   int
}

// window is the interval entry is allowed. Without the commerce flag the columns
// are zero, and checkinWindow falls back to the platform defaults — which is why
// assertOpen is only ever called when the flag is on.
func (r checkinRow) window() (time.Time, time.Time) {
	return checkinWindow(&Event{StartsAt: r.startsAt, EndsAt: r.endsAt,
		CheckinOpensMinutes: r.opensMins, CheckinClosesMinutes: r.closesMins})
}

// assertOpen rejects a check-in attempt outside the window at time `at`.
func (r checkinRow) assertOpen(at time.Time) error {
	from, to := r.window()
	switch {
	case at.Before(from):
		return ErrCheckinNotOpen
	case at.After(to):
		return ErrCheckinClosed
	}
	return nil
}

// checkinSelectBase is safe on a pre-commerce database (events.state/starts_at/
// ends_at and the ticket columns all predate the module's commerce layer);
// checkinSelectCommerce is appended only when the flag is on.
const (
	checkinSelectBase = `t.id, t.event_id, e.organiser_id, t.owner_id, t.state, e.starts_at, e.ends_at`
	checkinSelectComm = `, e.checkin_opens_minutes, e.checkin_closes_minutes, COALESCE(t.attendee_name,'')`
)

const checkinFrom = `
	  FROM event_tickets t
	  JOIN events e ON e.id = t.event_id
	 WHERE `

// loadCheckinRow reads one ticket with its event. found is false for an unknown id.
func (s *Service) loadCheckinRow(ctx context.Context, where string, args ...any) (checkinRow, bool, error) {
	cols := checkinSelectBase
	if s.commerceReads {
		cols += checkinSelectComm
	}
	var (
		r     checkinRow
		dests = []any{&r.ticketID, &r.eventID, &r.organiserID, &r.ownerID, &r.state, &r.startsAt, &r.endsAt}
	)
	if s.commerceReads {
		dests = append(dests, &r.opensMins, &r.closesMins, &r.attendeeName)
	}
	err := s.db.QueryRow(ctx, "SELECT "+cols+checkinFrom+where, args...).Scan(dests...)
	if errors.Is(err, pgx.ErrNoRows) {
		return r, false, nil
	}
	if err != nil {
		return r, false, fmt.Errorf("events: check-in lookup: %w", err)
	}
	return r, true, nil
}

// logCheckin appends one door event to event_checkin_log. It is called AFTER the
// ticket has been marked, because a lost audit row must not lock a valid attendee
// out of the venue; a failure is loud in the server log and in the platform audit
// trail, which is written separately.
func (s *Service) logCheckin(ctx context.Context, eventID, ticketID, actorID, action, method, gate, credentialID, reason string) {
	if !s.commerceReads {
		return
	}
	if _, err := s.db.Exec(ctx,
		`INSERT INTO event_checkin_log (id, event_id, ticket_id, actor_id, action, method, gate, credential_id, reason)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		uuid.New().String(), eventID, ticketID, actorID, action, method, clampTrim(gate, maxGateNameLen),
		nullIfEmpty(credentialID), clampTrim(reason, 500)); err != nil {
		s.log(actorID, "events.checkin.log_failed", ticketID,
			map[string]any{"event": eventID, "action": action, "method": method, "error": err.Error()})
	}
}

// markCheckedIn flips a live ticket to USED and records the door attribution. The
// state guard means a concurrent scan cannot be double-counted.
func (s *Service) markCheckedIn(ctx context.Context, credentialID, actorID, gate, method string) error {
	_, err := s.db.Exec(ctx,
		`UPDATE event_tickets
		    SET state='USED', checked_in_at=now(), checked_in_by=$2, checked_in_gate=$3, checkin_method=$4
		  WHERE credential_id=$1 AND state IN ('ISSUED','TRANSFERRED')`,
		credentialID, actorID, clampTrim(gate, maxGateNameLen), method)
	if err != nil {
		return fmt.Errorf("events: mark checked in: %w", err)
	}
	return nil
}

// scanGateCheck is the pre-Validate door check: authority first, then the window.
// With the commerce flag off only authority is consulted, which is exactly the
// pre-commerce behaviour.
func (s *Service) scanGateCheck(ctx context.Context, row checkinRow, callerID string) error {
	if err := s.assertStewardOrOrganiser(ctx, row.eventID, row.organiserID, callerID); err != nil {
		return err
	}
	if !s.commerceReads {
		return nil
	}
	return row.assertOpen(time.Now())
}

// ManualCheckIn admits an attendee whose rotating pass cannot be presented (dead
// phone, no signal, paper list). Same authority as a scan: organiser or a steward
// of THAT event, inside the same window. reason is required — a manual entry with
// no stated reason is the audit hole this route exists to close.
func (s *Service) ManualCheckIn(ctx context.Context, callerID, ticketID, gate, reason string) (*Ticket, error) {
	if callerID == "" || ticketID == "" {
		return nil, ErrValidation
	}
	reason = clampTrim(reason, 500)
	if reason == "" {
		return nil, fmt.Errorf("%w: events: a manual check-in requires a reason", ErrValidation)
	}
	row, found, err := s.loadCheckinRow(ctx, "t.id = $1", ticketID)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, ErrNotFound
	}
	if err := s.scanGateCheck(ctx, row, callerID); err != nil {
		return nil, err
	}
	switch TicketState(row.state) {
	case TicketIssued, TicketTransferred:
	case TicketUsed:
		return nil, ErrAlreadyCheckedIn
	default:
		return nil, fmt.Errorf("%w: events: ticket state %s cannot be checked in", ErrValidation, row.state)
	}

	// Guarded on the state we just read: a concurrent scan that wins the race
	// changes it, this update then matches zero rows and the caller learns the
	// ticket was already admitted rather than being double-marked.
	tag, err := s.db.Exec(ctx,
		`UPDATE event_tickets
		    SET state='USED', checked_in_at=now(), checked_in_by=$2, checked_in_gate=$3, checkin_method='MANUAL'
		  WHERE id=$1 AND state IN ('ISSUED','TRANSFERRED')`,
		ticketID, callerID, clampTrim(gate, maxGateNameLen))
	if err != nil {
		return nil, fmt.Errorf("events: manual check-in: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrAlreadyCheckedIn
	}
	s.logCheckin(ctx, row.eventID, ticketID, callerID, CheckinActionIn, CheckinMethodManual, gate, "", reason)
	s.log(callerID, "events.checkin.manual", ticketID,
		map[string]any{"event": row.eventID, "gate": clampTrim(gate, maxGateNameLen), "reason": reason})
	return s.getTicket(ctx, ticketID)
}

// UndoCheckIn reverses a check-in at the gate: a mis-scan, the wrong person
// admitted, an attendee who leaves and must come back through the same door.
//
// Reissuing the credential is not optional. A consumed single-use token cannot be
// un-consumed, so simply flipping the ticket back to ISSUED would leave a ticket
// that reads as valid but scans as a replay. The old credential is revoked and a
// fresh one is issued to the SAME owner, exactly as a gift does.
func (s *Service) UndoCheckIn(ctx context.Context, callerID, ticketID, reason string) (*Ticket, error) {
	if callerID == "" || ticketID == "" {
		return nil, ErrValidation
	}
	reason = clampTrim(reason, 500)
	if reason == "" {
		return nil, fmt.Errorf("%w: events: undoing a check-in requires a reason", ErrValidation)
	}
	row, found, err := s.loadCheckinRow(ctx, "t.id = $1", ticketID)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, ErrNotFound
	}
	if err := s.assertStewardOrOrganiser(ctx, row.eventID, row.organiserID, callerID); err != nil {
		return nil, err
	}
	if TicketState(row.state) != TicketUsed {
		return nil, ErrNotCheckedIn
	}

	t, err := s.getTicket(ctx, ticketID)
	if err != nil {
		return nil, err
	}
	ev, err := s.GetEvent(ctx, row.eventID)
	if err != nil {
		return nil, err
	}
	cred, err := s.cred.Issue(ctx, t.OwnerID, credential.KindEventTicket, credential.Policy{
		SingleUse:    true,
		AllowReentry: false,
		RotateTTL:    30 * time.Second,
		ValidFrom:    credentialValidFrom(ev, s.commerceReads),
		ValidTo:      ev.EndsAt,
	})
	if err != nil {
		return nil, fmt.Errorf("events: reissue credential: %w", err)
	}
	if _, err := s.db.Exec(ctx,
		`UPDATE event_tickets
		    SET state='ISSUED', checked_in_at=NULL, checked_in_by=NULL, checked_in_gate='', checkin_method='', credential_id=$2
		  WHERE id=$1`, ticketID, cred.ID); err != nil {
		_ = s.cred.Revoke(ctx, cred.ID) // never leave an orphan credential pointing at a USED ticket
		return nil, fmt.Errorf("events: undo check-in: %w", err)
	}
	if t.CredentialID != "" {
		_ = s.cred.Revoke(ctx, t.CredentialID)
	}
	s.logCheckin(ctx, row.eventID, ticketID, callerID, CheckinActionUndo, CheckinMethodManual,
		t.CheckedInGate, t.CredentialID, reason)
	s.log(callerID, "events.checkin.undo", ticketID, map[string]any{"event": row.eventID, "reason": reason})
	return s.getTicket(ctx, ticketID)
}

// CheckinFilter narrows the door roster. Empty fields do not filter.
type CheckinFilter struct {
	// State: "" (all), "waiting" (ISSUED/TRANSFERRED, not in), "checked_in", or a
	// raw ticket state (ISSUED/TRANSFERRED/USED/REFUNDED).
	State  string
	Gate   string
	Q      string // attendee name / cashtag / ticket id, case-insensitive
	Limit  int
	Offset int
}

// AttendeesFiltered is the roster with the door's filters, and — with commerce on —
// the attendee name and check-in attribution. Authorization is the same as the
// plain roster: organiser or steward of that event.
func (s *Service) AttendeesFiltered(ctx context.Context, callerID, eventID string, f CheckinFilter) ([]AttendeeRow, error) {
	var organiserID string
	if err := s.db.QueryRow(ctx, `SELECT organiser_id FROM events WHERE id=$1`, eventID).Scan(&organiserID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if err := s.assertStewardOrOrganiser(ctx, eventID, organiserID, callerID); err != nil {
		return nil, err
	}
	return s.attendeeRowsFiltered(ctx, eventID, f)
}

// CheckinStats is the door console's counters: how many seats exist, how many have
// entered, per gate, and how many are still waiting.
type CheckinStats struct {
	Total      int            `json:"total"`
	CheckedIn  int            `json:"checked_in"`
	Waiting    int            `json:"waiting"`
	Refunded   int            `json:"refunded"`
	ByGate     map[string]int `json:"by_gate"`
	ByMethod   map[string]int `json:"by_method"`
	WindowFrom *time.Time     `json:"window_opens_at,omitempty"`
	WindowTo   *time.Time     `json:"window_closes_at,omitempty"`
	Open       bool           `json:"open"`
}

// AttendeeStats computes the door counters for an event the caller may scan for.
func (s *Service) AttendeeStats(ctx context.Context, callerID, eventID string) (*CheckinStats, error) {
	rows, err := s.AttendeesFiltered(ctx, callerID, eventID, CheckinFilter{})
	if err != nil {
		return nil, err
	}
	st := &CheckinStats{ByGate: map[string]int{}, ByMethod: map[string]int{}}
	for _, r := range rows {
		st.Total++
		switch TicketState(r.State) {
		case TicketRefunded:
			st.Refunded++
		case TicketUsed:
			st.CheckedIn++
			if r.Gate != "" {
				st.ByGate[r.Gate]++
			}
			if r.Method != "" {
				st.ByMethod[r.Method]++
			}
		default:
			st.Waiting++
		}
	}
	if s.commerceReads {
		if ev, err := s.GetEvent(ctx, eventID); err == nil {
			from, to := checkinWindow(ev)
			st.WindowFrom, st.WindowTo = &from, &to
			now := time.Now()
			st.Open = !now.Before(from) && !now.After(to)
		}
	}
	return st, nil
}

// CheckinEntry is one row of the append-only door history.
type CheckinEntry struct {
	ID         string    `json:"id"`
	TicketID   string    `json:"ticket_id"`
	ActorID    string    `json:"actor_id"`
	ActorName  string    `json:"actor_name,omitempty"`
	Action     string    `json:"action"`
	Method     string    `json:"method"`
	Gate       string    `json:"gate,omitempty"`
	Reason     string    `json:"reason,omitempty"`
	OccurredAt time.Time `json:"occurred_at"`
}

// CheckinHistory is the reversal/audit view behind a disputed entry: who admitted
// whom, how, and what they said why. Organiser or steward of the event.
func (s *Service) CheckinHistory(ctx context.Context, callerID, eventID string, limit, offset int) ([]CheckinEntry, error) {
	var organiserID string
	if err := s.db.QueryRow(ctx, `SELECT organiser_id FROM events WHERE id=$1`, eventID).Scan(&organiserID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if err := s.assertStewardOrOrganiser(ctx, eventID, organiserID, callerID); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := s.db.Query(ctx, `
		SELECT l.id, l.ticket_id, l.actor_id, COALESCE(up.full_name,''), l.action, l.method,
		       l.gate, l.reason, l.created_at
		  FROM event_checkin_log l
		  LEFT JOIN user_profiles up ON up.id = l.actor_id
		 WHERE l.event_id = $1
		 ORDER BY l.created_at DESC, l.id DESC
		 LIMIT $2 OFFSET $3`, eventID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("events: check-in history: %w", err)
	}
	defer rows.Close()

	out := []CheckinEntry{}
	for rows.Next() {
		var e CheckinEntry
		if err := rows.Scan(&e.ID, &e.TicketID, &e.ActorID, &e.ActorName, &e.Action, &e.Method,
			&e.Gate, &e.Reason, &e.OccurredAt); err != nil {
			return nil, fmt.Errorf("events: check-in history scan: %w", err)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
