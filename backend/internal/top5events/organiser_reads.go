package top5events

// Organiser "manage" reads — GET endpoints the mobile organiser dashboard,
// attendees, and vendor screens need but never had, so they fell back to
// client-derived or mock data (see the individual comments below). All pure
// reads/aggregates: no ledger/wallet mutation, standard testing.

import (
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

// OrganiserEventStats is one organiser's event with real, server-computed
// ticket/revenue aggregates — replacing the mobile client's previous
// derive-from-an-unscoped-listEvents() workaround.
type OrganiserEventStats struct {
	Event           EventSummary `json:"event"`
	TicketsSold     int          `json:"tickets_sold"`      // issued entitlements not yet refunded
	TicketsTotal    *int         `json:"tickets_total"`     // null when the event has no active tiers yet
	GrossKobo       int64        `json:"gross_kobo"`        // SUM(event_orders.total_kobo WHERE status='PAID') — money actually collected, promo-net
	PlatformFeeKobo int64        `json:"platform_fee_kobo"` // gross * fee_bps / 10000 (integer, truncates)
	NetKobo         int64        `json:"net_kobo"`          // gross - platform_fee
	RefundedCount   int          `json:"refunded_count"`
	RefundsKobo     int64        `json:"refunds_kobo"`
	CheckedIn       int          `json:"checked_in"`
}

// ListMyOrganiserEvents lists the caller's own events (any state) with sold/
// capacity/gross/refund/check-in aggregates. Money figures come from the order
// rows (event_orders.total_kobo, promo-net), NOT tiers.sold*price — that older
// derivation counted refunded tickets at full list price, treated comp issues
// as revenue and ignored promo discounts (EVT-UAT-208). tickets_sold counts
// issued entitlements that were never refunded (comps included — they consume
// capacity), and the refunded/checked-in counts let the dashboard reconcile
// instead of overstating. Object-level scope only — no separate "organiser"
// identity, same as the rest of this module.
func (s *Service) ListMyOrganiserEvents(ctx context.Context, organiserID string) ([]OrganiserEventStats, error) {
	const q = `
		SELECT e.id, e.title, e.venue, e.state, COALESCE(e.category,''), e.starts_at, e.ends_at,
		       COALESCE((SELECT MIN(t.price_kobo) FROM event_ticket_tiers t WHERE t.event_id = e.id AND t.active = true), 0) AS min_price_kobo,
		       COALESCE((SELECT bool_and(t.capacity > 0 AND t.sold >= t.capacity) FROM event_ticket_tiers t WHERE t.event_id = e.id AND t.active = true), false) AS sold_out,
		       COALESCE((SELECT COUNT(*) FROM event_tickets tk WHERE tk.event_id = e.id AND tk.state <> 'REFUNDED'), 0) AS tickets_sold,
		       (SELECT SUM(t.capacity) FROM event_ticket_tiers t WHERE t.event_id = e.id) AS tickets_total,
		       COALESCE((SELECT SUM(o.total_kobo) FROM event_orders o WHERE o.event_id = e.id AND o.status = 'PAID'), 0) AS gross_kobo,
		       COALESCE((SELECT COUNT(*) FROM event_tickets tk WHERE tk.event_id = e.id AND tk.state = 'REFUNDED'), 0) AS tickets_refunded,
		       COALESCE((SELECT SUM(o.total_kobo) FROM event_orders o WHERE o.event_id = e.id AND o.status = 'REFUNDED'), 0) AS refunds_kobo,
		       COALESCE((SELECT COUNT(*) FROM event_tickets tk WHERE tk.event_id = e.id AND tk.checked_in_at IS NOT NULL), 0) AS checked_in,
		       e.fee_bps
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
		var feeBps int
		if err := rows.Scan(
			&st.Event.ID, &st.Event.Title, &st.Event.Venue, &state, &st.Event.Category,
			&st.Event.StartsAt, &st.Event.EndsAt, &st.Event.MinPriceKobo, &st.Event.SoldOut,
			&st.TicketsSold, &st.TicketsTotal, &st.GrossKobo,
			&st.RefundedCount, &st.RefundsKobo, &st.CheckedIn, &feeBps,
		); err != nil {
			return nil, fmt.Errorf("events: list mine scan: %w", err)
		}
		st.Event.State = EventState(state)
		st.PlatformFeeKobo = st.GrossKobo * int64(feeBps) / 10000
		st.NetKobo = st.GrossKobo - st.PlatformFeeKobo
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

	// Door attribution (events-commerce). Name is the account owner, which after a
	// gift is not the person in the seat, so the seat keeps its own attendee name;
	// CheckedInBy is the steward who admitted them. All zero with the flag off.
	AttendeeName  string `json:"attendee_name,omitempty"`
	Gate          string `json:"gate,omitempty"`
	Method        string `json:"checkin_method,omitempty"`
	CheckedInBy   string `json:"checked_in_by,omitempty"`
	CheckedInName string `json:"checked_in_by_name,omitempty"`
}

// AttendeesForEvent lists an event's ticket holders. Organiser-or-steward
// gated — the same authorization ScanTicket enforces, since this is the
// roster a steward checks people in against.
func (s *Service) AttendeesForEvent(ctx context.Context, callerID, eventID string) ([]AttendeeRow, error) {
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

	return s.attendeeRows(ctx, eventID)
}

// attendeeRows is the roster query shared by AttendeesForEvent and
// AttendeesCSV. It performs NO authorization — callers must gate first.
func (s *Service) attendeeRows(ctx context.Context, eventID string) ([]AttendeeRow, error) {
	return s.attendeeRowsFiltered(ctx, eventID, CheckinFilter{})
}

// The roster is one query with two column groups: the eight columns it shipped
// with, then the door attribution group that exists only after migration
// 20271400000000. Commerce columns are appended at the END so the pre-commerce
// positions (and the CSV's column indexes) never move.
const (
	attendeeSelectBase = `t.id, COALESCE(up.full_name,''), COALESCE(ch.handle,''), tr.name, t.id, t.state,
		       t.checked_in_at IS NOT NULL, to_char(t.checked_in_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`
	attendeeSelectCommerce = `, COALESCE(t.attendee_name,''), t.checked_in_gate, t.checkin_method,
		       COALESCE(t.checked_in_by::text,''), COALESCE(ab.full_name,'')`
	attendeeJoins = `FROM event_tickets t
		JOIN event_ticket_tiers tr ON tr.id = t.tier_id
		LEFT JOIN user_profiles up ON up.id = t.owner_id
		LEFT JOIN cashtag_handles ch ON ch.user_id = t.owner_id`
	attendeeJoinsCommerce = `
		LEFT JOIN user_profiles ab ON ab.id = t.checked_in_by`
)

// attendeeRowsFiltered is attendeeRows with the door's filters applied. An empty
// filter is the unfiltered roster: no LIMIT clause at all, so the roster and the
// CSV export keep returning every ticket the way they did before.
//
// Gate and attendee-name search are commerce-only (those columns do not exist
// otherwise) and are dropped silently when the flag is off, rather than producing
// a query that fails on an un-migrated database.
func (s *Service) attendeeRowsFiltered(ctx context.Context, eventID string, f CheckinFilter) ([]AttendeeRow, error) {
	cols, joins := attendeeSelectBase, attendeeJoins
	if s.commerceReads {
		cols += attendeeSelectCommerce
		joins += attendeeJoinsCommerce
	}
	args := []any{eventID}
	where := []string{"t.event_id = $1"}

	switch st := strings.ToLower(strings.TrimSpace(f.State)); st {
	case "", "all":
	case "waiting":
		where = append(where, `t.state IN ('ISSUED','TRANSFERRED') AND t.checked_in_at IS NULL`)
	case "checked_in":
		where = append(where, `t.state = 'USED'`)
	default:
		args = append(args, strings.ToUpper(st))
		where = append(where, fmt.Sprintf("t.state = $%d", len(args)))
	}
	if g := clampTrim(f.Gate, maxGateNameLen); g != "" && s.commerceReads {
		args = append(args, g)
		where = append(where, fmt.Sprintf("t.checked_in_gate = $%d", len(args)))
	}
	if q := clampTrim(f.Q, 100); q != "" {
		args = append(args, "%"+q+"%")
		n := fmt.Sprintf("$%d", len(args))
		like := fmt.Sprintf(`(COALESCE(up.full_name,'') ILIKE %s OR COALESCE(ch.handle,'') ILIKE %s`, n, n)
		if s.commerceReads {
			like = fmt.Sprintf(`(COALESCE(up.full_name,'') ILIKE %s OR COALESCE(ch.handle,'') ILIKE %s OR COALESCE(t.attendee_name,'') ILIKE %s`, n, n, n)
		}
		where = append(where, like+fmt.Sprintf(` OR t.id::text = %s)`, n))
	}

	sql := "SELECT " + cols + " " + joins + " WHERE " + strings.Join(where, " AND ") + " ORDER BY t.created_at DESC"
	if f.Limit > 0 {
		limit := f.Limit
		if limit > 500 {
			limit = 500
		}
		offset := f.Offset
		if offset < 0 {
			offset = 0
		}
		args = append(args, limit, offset)
		sql += fmt.Sprintf(" LIMIT $%d OFFSET $%d", len(args)-1, len(args))
	}

	rows, err := s.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("events: attendees: %w", err)
	}
	defer rows.Close()

	out := []AttendeeRow{}
	for rows.Next() {
		var a AttendeeRow
		dests := []any{&a.ID, &a.Name, &a.Cashtag, &a.TierName, &a.TicketID, &a.State, &a.CheckedIn, &a.CheckedInAt}
		if s.commerceReads {
			dests = append(dests, &a.AttendeeName, &a.Gate, &a.Method, &a.CheckedInBy, &a.CheckedInName)
		}
		if err := rows.Scan(dests...); err != nil {
			return nil, fmt.Errorf("events: attendees scan: %w", err)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// AttendeesCSV exports an event's roster as CSV. Gated on authorizeManage
// (owner or MANAGER) — stricter than AttendeesForEvent: bulk export of attendee
// PII is a stronger action than viewing the check-in roster, so stewards are
// excluded.
func (s *Service) AttendeesCSV(ctx context.Context, callerID, eventID string) ([]byte, error) {
	if _, err := s.authorizeManage(ctx, callerID, eventID); err != nil {
		return nil, err
	}
	rows, err := s.attendeeRows(ctx, eventID)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	w := csv.NewWriter(&buf)
	header := []string{"name", "cashtag", "tier_name", "ticket_id", "state", "checked_in", "checked_in_at"}
	if s.commerceReads {
		// Appended, never inserted: the pre-commerce column positions are part of
		// the export contract.
		header = append(header, "attendee_name", "gate", "checkin_method", "checked_in_by")
	}
	if err := w.Write(header); err != nil {
		return nil, err
	}
	for _, a := range rows {
		at := ""
		if a.CheckedInAt != nil {
			at = *a.CheckedInAt
		}
		// Sanitize user-controlled free-text cells against spreadsheet formula
		// injection (a cell beginning =,+,-,@ executes when opened in Excel/Sheets).
		// ticket_id/state/checked_in/timestamp are machine-controlled and left as-is.
		rec := []string{csvSafe(a.Name), csvSafe(a.Cashtag), csvSafe(a.TierName), a.TicketID, a.State, strconv.FormatBool(a.CheckedIn), at}
		if s.commerceReads {
			rec = append(rec, csvSafe(a.AttendeeName), csvSafe(a.Gate), a.Method, csvSafe(a.CheckedInName))
		}
		if err := w.Write(rec); err != nil {
			return nil, err
		}
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// csvSafe neutralizes spreadsheet formula injection by prefixing a leading
// formula-trigger character (= + - @, and the tab/CR control chars some parsers
// treat as leaders) with an apostrophe, which spreadsheet apps render as text.
func csvSafe(v string) string {
	if v == "" {
		return v
	}
	switch v[0] {
	case '=', '+', '-', '@', '\t', '\r':
		return "'" + v
	}
	return v
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
