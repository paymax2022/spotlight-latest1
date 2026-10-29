package top5events

// Events commerce read path and policy layer (migration 20271400000000).
//
// Everything here is flag-gated by Service.commerceReads, exactly the way
// events-social is gated by Service.socialReads. With the flag off no query in
// this file runs, no commerce column is read or written, and the event select and
// scan stay byte-for-byte what they were before — so a database that has not
// applied 20271400000000 keeps working. Turning the flag on WITHOUT the migration
// fails loudly on the first event read, which is the intended deploy gate.
//
// The two flags are independent, so an event row is assembled from up to three
// column groups in a fixed order: base eleven, then social six, then commerce ten.
// eventRowSelect and Service.scanEventRow are the only pair that may change
// together; scanEvent/scanLegacyEvent deliberately stay on the pre-commerce lists
// because social_flag_test.go pins them.

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Policy defaults, applied when an organiser leaves a field blank. Chosen to match
// the migration column defaults so a pre-migration row and a freshly created one
// behave identically.
const (
	defaultRefundCutoffHours   = 24
	defaultCheckinOpensMinutes = 360
	defaultCheckinClosesMin    = 120

	maxRefundCutoffHours    = 720  // 30 days
	maxCheckinWindowMinutes = 2880 // 48h either side of the start

	maxCityLen         = 60
	maxVenueAddressLen = 200
	maxRefundPolicyLen = 2000
	maxAttendeeNameLen = 120
)

// ticketColsBase is the ticket select every read path used before commerce;
// ticketColsCommerce is appended only when the commerce flag is on, so a database
// without the migration never sees those columns. Both lists are consumed by
// Service.ticketRowSQL and scanTicketRow and must stay in the same order.
const (
	ticketColsBase     = `id, event_id, tier_id, order_id, owner_id, state, COALESCE(credential_id::text,''), price_paid_kobo, created_at`
	ticketColsCommerce = `, attendee_name, checked_in_at, checkin_method, COALESCE(checked_in_by::text,''), checked_in_gate`
)

// ticketRowSQL builds a ticket select over the given WHERE fragment.
func (s *Service) ticketRowSQL(where string) string {
	cols := ticketColsBase
	if s.commerceReads {
		cols += ticketColsCommerce
	}
	return "SELECT " + cols + " FROM event_tickets WHERE " + where
}

// scanTicketRow scans one row read by ticketRowSQL, in that column order.
func scanTicketRow(row rowScanner, commerce bool) (*Ticket, error) {
	var (
		t     Ticket
		state string
		dests = []any{&t.ID, &t.EventID, &t.TierID, &t.OrderID, &t.OwnerID, &state,
			&t.CredentialID, &t.PricePaidKobo, &t.CreatedAt}
	)
	if commerce {
		dests = append(dests, &t.AttendeeName, &t.CheckedInAt, &t.CheckinMethod, &t.CheckedInBy, &t.CheckedInGate)
	}
	if err := row.Scan(dests...); err != nil {
		return nil, err
	}
	t.State = TicketState(state)
	return &t, nil
}

// Moderation review states (events.moderation_status). These are the review
// OUTCOME; events.state stays the lifecycle enum, so a rejection needs no change
// to the events_state_check constraint.
const (
	ModerationNone             = "NONE"
	ModerationPending          = "PENDING"
	ModerationApproved         = "APPROVED"
	ModerationRejected         = "REJECTED"
	ModerationChangesRequested = "CHANGES_REQUESTED"
)

// EnableCommerceReads switches event reads and writes to the events-commerce column
// set and turns on the commerce behaviours that depend on those columns (policy
// validation, the server-set platform fee, check-in windows, order snapshots).
// Call it only when FEATURE_EVENTS_COMMERCIAL is on, i.e. migration 20271400000000
// has been applied. Returns s for chaining.
func (s *Service) EnableCommerceReads() *Service {
	s.commerceReads = true
	return s
}

// eventRowSelect builds the by-id event select for the current flag combination.
// With both flags off it returns legacyEventByIDQuery verbatim (11 columns,
// unaliased FROM). Otherwise it always aliases events AS e, because the social
// variant needs the alias for its like join.
func (s *Service) eventRowSelect() string {
	if !s.socialReads && !s.commerceReads {
		return legacyEventByIDQuery
	}
	cols := eventBaseSelectCols
	if s.socialReads {
		cols = eventSelectCols // byte-identical to the pre-commerce social read
	}
	from := " FROM events e "
	if s.socialReads {
		from += eventLikedJoin + " "
	}
	if s.commerceReads {
		cols += ",\n\t\t" + commerceSelectCols
	}
	return "SELECT " + cols + from + "WHERE e.id=$1"
}

// eventRowArgs are the arguments for eventRowSelect: the event id, plus the caller
// for the social like join (which numbers it as $2).
func (s *Service) eventRowArgs(eventID, callerID string) []any {
	if s.socialReads {
		return []any{eventID, likeCaller(callerID)}
	}
	return []any{eventID}
}

// scanEventRow scans one row read by eventRowSelect, taking exactly the
// destinations its column list provides. The order of the three append groups must
// not drift from eventRowSelect.
func (s *Service) scanEventRow(row rowScanner) (*Event, error) {
	var (
		e     Event
		state string
		dests = []any{&e.ID, &e.OrganiserID, &e.Title, &e.Description, &e.Venue, &state,
			&e.Category, &e.StartsAt, &e.EndsAt, &e.FeeBps, &e.CreatedAt}
	)
	if s.socialReads {
		dests = append(dests, &e.BannerURL, &e.VenueLat, &e.VenueLng, &e.VenuePlaceID, &e.LikeCount, &e.Liked)
	}
	if s.commerceReads {
		dests = append(dests, &e.City, &e.VenueAddress, &e.RefundPolicy, &e.RefundCutoffHours,
			&e.CheckinOpensMinutes, &e.CheckinClosesMinutes, &e.SubmittedAt,
			&e.ModerationStatus, &e.ModerationNote, &e.ModerationDecidedAt)
	}
	if err := row.Scan(dests...); err != nil {
		return nil, err
	}
	e.State = EventState(state)
	return &e, nil
}

// platformFeeBps reads the ops-set platform fee. The fee is policy, not client
// input: CreateEvent takes it from here rather than from the request body whenever
// the commerce flag is on. A missing row (ErrNoRows) falls back to the default the
// migration seeds; any other read error is returned so the caller fails closed
// rather than drafting an event at an invented rate.
func (s *Service) platformFeeBps(ctx context.Context) (int, error) {
	var bps int
	err := s.db.QueryRow(ctx, `SELECT fee_bps FROM event_fee_settings WHERE id = 1`).Scan(&bps)
	if errors.Is(err, pgx.ErrNoRows) {
		return defaultFeeBps, nil
	}
	if err != nil {
		return 0, fmt.Errorf("events: platform fee settings: %w", err)
	}
	if bps < 0 || bps > 10000 {
		return 0, fmt.Errorf("events: platform fee settings out of range (%d bps)", bps)
	}
	return bps, nil
}

// defaultFeeBps is the 10% platform fee the module shipped with, and the fallback
// when event_fee_settings has no row yet.
const defaultFeeBps = 1000

// applyEventPolicy fills in the commerce defaults and range-checks the values an
// organiser supplied, so a draft always carries a complete, publishable disclosure
// set. Called only when the commerce flag is on.
func applyEventPolicy(e *Event) error {
	e.City = clampTrim(e.City, maxCityLen)
	e.VenueAddress = clampTrim(e.VenueAddress, maxVenueAddressLen)
	e.RefundPolicy = clampTrim(e.RefundPolicy, maxRefundPolicyLen)

	if e.RefundCutoffHours == 0 {
		e.RefundCutoffHours = defaultRefundCutoffHours
	}
	if e.CheckinOpensMinutes == 0 {
		e.CheckinOpensMinutes = defaultCheckinOpensMinutes
	}
	if e.CheckinClosesMinutes == 0 {
		e.CheckinClosesMinutes = defaultCheckinClosesMin
	}
	if e.RefundCutoffHours < 0 || e.RefundCutoffHours > maxRefundCutoffHours {
		return fmt.Errorf("%w: events: refund_cutoff_hours must be between 0 and %d", ErrValidation, maxRefundCutoffHours)
	}
	for name, mins := range map[string]int{
		"checkin_opens_minutes":  e.CheckinOpensMinutes,
		"checkin_closes_minutes": e.CheckinClosesMinutes,
	} {
		if mins < 0 || mins > maxCheckinWindowMinutes {
			return fmt.Errorf("%w: events: %s must be between 0 and %d", ErrValidation, name, maxCheckinWindowMinutes)
		}
	}
	return nil
}

// clampTrim trims and hard-caps caller text so an oversized payload is a
// truncation, not a 22001 (value too long) on insert.
func clampTrim(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) > max {
		return s[:max]
	}
	return s
}

// isUniqueViolation recognises SQLSTATE 23505 so a caller can turn a failed insert
// into the right sentinel (a duplicate refund request, a duplicate live row)
// instead of a generic 500.
func isUniqueViolation(err error) bool {
	var st sqlStater
	return errors.As(err, &st) && st.SQLState() == "23505"
}

// prepareCommerceEvent is the commerce half of CreateEvent's input hygiene: the
// moderation columns are platform-owned, so whatever a caller sent for them is
// dropped, and the disclosure/policy fields get their defaults. Returns the fields
// to insert; the platform fee is resolved separately by the caller because reading
// event_fee_settings can fail.
func prepareCommerceEvent(e *Event) error {
	e.ModerationStatus = ModerationNone
	e.ModerationNote = ""
	e.SubmittedAt = nil
	e.ModerationDecidedAt = nil
	return applyEventPolicy(e)
}

// validatePatchPolicy range-checks the policy fields an organiser may patch, before
// any database access. Absent fields are not validated — UpdateEvent writes only
// what is present.
func validatePatchPolicy(p EventPatch) error {
	if p.RefundCutoffHours != nil && (*p.RefundCutoffHours < 0 || *p.RefundCutoffHours > maxRefundCutoffHours) {
		return fmt.Errorf("%w: events: refund_cutoff_hours must be between 0 and %d", ErrValidation, maxRefundCutoffHours)
	}
	for name, v := range map[string]*int{
		"checkin_opens_minutes":  p.CheckinOpensMinutes,
		"checkin_closes_minutes": p.CheckinClosesMinutes,
	} {
		if v != nil && (*v < 0 || *v > maxCheckinWindowMinutes) {
			return fmt.Errorf("%w: events: %s must be between 0 and %d", ErrValidation, name, maxCheckinWindowMinutes)
		}
	}
	return nil
}

// bookingRefFromIdem recovers the booking a seat belongs to from its per-unit
// idempotency key. PurchaseTickets keys seat i of an n>1 batch as "<base>:<i>" and
// leaves a single-unit key verbatim, so a trailing all-digit segment is the seat
// index and the rest is the booking. This mirrors the migration's
// regexp_replace(idempotency_key, ':[0-9]+$', ”) backfill — change one, change
// both.
func bookingRefFromIdem(idem string) string {
	i := strings.LastIndexByte(idem, ':')
	if i <= 0 || i == len(idem)-1 {
		return idem
	}
	digits := true
	for _, r := range idem[i+1:] {
		if r < '0' || r > '9' {
			digits = false
			break
		}
	}
	if !digits {
		return idem
	}
	return idem[:i]
}

// checkinWindow returns the interval during which a ticket for ev may be scanned:
// from opens minutes before the start until the earlier of the event end and
// closes minutes after the start. The end is clamped to ends_at so a multi-day
// event cannot be entered after it is over.
func checkinWindow(ev *Event) (from, to time.Time) {
	opens := ev.CheckinOpensMinutes
	closes := ev.CheckinClosesMinutes
	if opens <= 0 {
		opens = defaultCheckinOpensMinutes
	}
	if closes <= 0 {
		closes = defaultCheckinClosesMin
	}
	from = ev.StartsAt.Add(-time.Duration(opens) * time.Minute)
	to = ev.StartsAt.Add(time.Duration(closes) * time.Minute)
	if ev.EndsAt.After(from) && ev.EndsAt.Before(to) {
		to = ev.EndsAt
	}
	return from, to
}

// credentialValidFrom is the earliest instant the rotating QR for a ticket of ev is
// valid. With commerce on it follows the organiser's check-in window (so a scan
// attempt before the doors open is refused by the credential core itself, not just
// by ScanTicket); with it off the pre-commerce six-hour lead is kept, because the
// window columns do not exist yet.
func credentialValidFrom(ev *Event, commerce bool) time.Time {
	if commerce {
		from, _ := checkinWindow(ev)
		return from
	}
	return ev.StartsAt.Add(-6 * time.Hour)
}
