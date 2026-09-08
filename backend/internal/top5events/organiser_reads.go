package top5events

// Organiser "manage" reads — GET endpoints the mobile organiser dashboard,
// attendees, and vendor screens need but never had, so they fell back to
// client-derived or mock data (see the individual comments below). All pure
// reads/aggregates: no ledger/wallet mutation, standard testing.

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// OrganiserEventStats is one organiser's event with real, server-computed
// ticket/revenue aggregates — replacing the mobile client's previous
// derive-from-an-unscoped-listEvents() workaround.
type OrganiserEventStats struct {
	Event        EventSummary `json:"event"`
	TicketsSold  int          `json:"tickets_sold"`
	TicketsTotal *int         `json:"tickets_total"` // null when the event has no active tiers yet
	GrossKobo    int64        `json:"gross_kobo"`
}

// ListMyOrganiserEvents lists the caller's own events (any state) with sold/
// capacity/gross aggregated from their ticket tiers. Object-level scope only —
// no separate "organiser" identity, same as the rest of this module.
func (s *Service) ListMyOrganiserEvents(ctx context.Context, organiserID string) ([]OrganiserEventStats, error) {
	const q = `
		SELECT e.id, e.title, e.venue, e.state, COALESCE(e.category,''), e.starts_at, e.ends_at,
		       COALESCE((SELECT MIN(t.price_kobo) FROM event_ticket_tiers t WHERE t.event_id = e.id AND t.active = true), 0) AS min_price_kobo,
		       COALESCE((SELECT bool_and(t.capacity > 0 AND t.sold >= t.capacity) FROM event_ticket_tiers t WHERE t.event_id = e.id AND t.active = true), false) AS sold_out,
		       COALESCE((SELECT SUM(t.sold) FROM event_ticket_tiers t WHERE t.event_id = e.id), 0) AS tickets_sold,
		       (SELECT SUM(t.capacity) FROM event_ticket_tiers t WHERE t.event_id = e.id) AS tickets_total,
		       COALESCE((SELECT SUM(t.sold * t.price_kobo) FROM event_ticket_tiers t WHERE t.event_id = e.id), 0) AS gross_kobo
		FROM events e
		WHERE e.organiser_id = $1
		ORDER BY e.starts_at DESC`
	rows, err := s.db.Query(ctx, q, organiserID)
	if err != nil {
		return nil, fmt.Errorf("events: list mine: %w", err)
	}
	defer rows.Close()

	out := []OrganiserEventStats{}
	for rows.Next() {
		var st OrganiserEventStats
		var state string
		if err := rows.Scan(
			&st.Event.ID, &st.Event.Title, &st.Event.Venue, &state, &st.Event.Category,
			&st.Event.StartsAt, &st.Event.EndsAt, &st.Event.MinPriceKobo, &st.Event.SoldOut,
			&st.TicketsSold, &st.TicketsTotal, &st.GrossKobo,
		); err != nil {
			return nil, fmt.Errorf("events: list mine scan: %w", err)
		}
		st.Event.State = EventState(state)
		out = append(out, st)
	}
	return out, rows.Err()
}

// AttendeeRow is one ticket-holder on an event's roster, for the organiser/
// steward check-in screen.
type AttendeeRow struct {
	ID          string  `json:"id"` // ticket id
	Name        string  `json:"name"`
	Cashtag     string  `json:"cashtag"`
	TierName    string  `json:"tier_name"`
	TicketID    string  `json:"ticket_id"`
	State       string  `json:"state"`
	CheckedIn   bool    `json:"checked_in"`
	CheckedInAt *string `json:"checked_in_at"` // ISO 8601, null if never scanned
}

// AttendeesForEvent lists an event's ticket holders. Organiser-or-steward
// gated — the same authorization ScanTicket enforces, since this is the
// roster a steward checks people in against.
func (s *Service) AttendeesForEvent(ctx context.Context, callerID, eventID string) ([]AttendeeRow, error) {
	var organiserID string
	if err := s.db.QueryRow(ctx, `SELECT organiser_id FROM events WHERE id=$1`, eventID).Scan(&organiserID); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if err := s.assertStewardOrOrganiser(ctx, eventID, organiserID, callerID); err != nil {
		return nil, err
	}

	const q = `
		SELECT t.id, COALESCE(up.full_name,''), COALESCE(ch.handle,''), tr.name, t.id, t.state,
		       t.checked_in_at IS NOT NULL, to_char(t.checked_in_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM event_tickets t
		JOIN event_ticket_tiers tr ON tr.id = t.tier_id
		LEFT JOIN user_profiles up ON up.id = t.owner_id
		LEFT JOIN cashtag_handles ch ON ch.user_id = t.owner_id
		WHERE t.event_id = $1
		ORDER BY t.created_at DESC`
	rows, err := s.db.Query(ctx, q, eventID)
	if err != nil {
		return nil, fmt.Errorf("events: attendees: %w", err)
	}
	defer rows.Close()

	out := []AttendeeRow{}
	for rows.Next() {
		var a AttendeeRow
		var checkedInAt *string
		if err := rows.Scan(&a.ID, &a.Name, &a.Cashtag, &a.TierName, &a.TicketID, &a.State, &a.CheckedIn, &checkedInAt); err != nil {
			return nil, fmt.Errorf("events: attendees scan: %w", err)
		}
		a.CheckedInAt = checkedInAt
		out = append(out, a)
	}
	return out, rows.Err()
}

// VendorsForEvent lists an event's registered vendors — identity only
// ({id, name, active}), no ownership gate: any attendee should see who they
// can tap-pay. Priced menu items have no backend concept and stay mock-only
// on the client (see the mobile api.ts comment on listVendors).
func (s *Service) VendorsForEvent(ctx context.Context, eventID string) ([]Vendor, error) {
	const q = `SELECT id, event_id, user_id, name, active, COALESCE(credential_id::text,''), created_at
	           FROM event_vendors WHERE event_id = $1 AND active = true ORDER BY name ASC`
	rows, err := s.db.Query(ctx, q, eventID)
	if err != nil {
		return nil, fmt.Errorf("events: vendors: %w", err)
	}
	defer rows.Close()

	out := []Vendor{}
	for rows.Next() {
		var v Vendor
		if err := rows.Scan(&v.ID, &v.EventID, &v.UserID, &v.Name, &v.Active, &v.CredentialID, &v.CreatedAt); err != nil {
			return nil, fmt.Errorf("events: vendors scan: %w", err)
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// WalletEntries lists an event-wallet's ledger history. Owner-only — matches
// GetWallet's existing authorization exactly (no organiser exception; adding
// one would be a new, separate visibility decision this stage doesn't need
// to make).
func (s *Service) WalletEntries(ctx context.Context, ownerID, walletID string) ([]EventWalletEntry, error) {
	w, err := s.loadWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	if w.OwnerID != ownerID {
		return nil, ErrForbidden
	}

	const q = `SELECT id, wallet_id, type, amount_kobo, reference, idempotency_key, created_at
	           FROM event_wallet_ledger WHERE wallet_id = $1 ORDER BY created_at DESC`
	rows, err := s.db.Query(ctx, q, walletID)
	if err != nil {
		return nil, fmt.Errorf("events: wallet entries: %w", err)
	}
	defer rows.Close()

	out := []EventWalletEntry{}
	for rows.Next() {
		var e EventWalletEntry
		if err := rows.Scan(&e.ID, &e.WalletID, &e.Type, &e.AmountKobo, &e.Reference, &e.IdempotencyKey, &e.CreatedAt); err != nil {
			return nil, fmt.Errorf("events: wallet entries scan: %w", err)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
