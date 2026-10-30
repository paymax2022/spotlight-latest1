package top5events

// Admin console reads — GET /api/events/admin/*, gated on events.admin.view
// (seeded, previously unused). Mirrors the exact JSON shape
// frontend-admin/src/types/eventsAdmin.ts already declares, so the existing
// admin pages keep rendering without changes — this stage is backend +
// service wiring only, not a UI redesign.
//
// HONESTY RULE for every field below: real data or a clearly-neutral default
// (0, "", empty slice, false) — never a fabricated value. Several fields in
// the admin types have no backend concept at all (settlement-break detection,
// fraud signals, CMS completeness flags, an events-review "timeline"); those
// stay at their neutral default and are called out inline. Do not read a zero
// in these fields as "verified zero" — it means "not tracked yet."

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const rfc3339 = time.RFC3339

func nowRFC3339() string { return time.Now().Format(rfc3339) }

// timeScan is a scan target for a timestamptz column that's immediately
// formatted back to a string for the JSON response — avoids repeating a
// throwaway time.Time var at every call site.
type timeScan struct{ t time.Time }

// --- shared helpers ---

// adminStatus lowercases EventState to match the admin console's EventStatus
// union ('draft'|'submitted'|...), which is lowercase while the Go/DB enum is
// upper.
func adminStatus(s string) string { return strings.ToLower(s) }

// maskName renders a lightweight display mask ("Kemi Sound•••") from a real
// name, matching the admin UI's existing masking convention. Never used for
// anything security-relevant — this is display-only, the same as the mock
// fixtures it replaces.
func maskName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "Unknown•••"
	}
	if len(name) > 12 {
		name = name[:12]
	}
	return name + "•••"
}

// --- A. Dashboard ---

type AdminDashboardActivity struct {
	ID        string  `json:"id"`
	Kind      string  `json:"kind"`
	Label     string  `json:"label"`
	Ref       *string `json:"ref"`
	CreatedAt string  `json:"created_at"`
}

type AdminDashboard struct {
	GMVTodayKobo        int64                    `json:"gmv_today_kobo"`
	GMV30dKobo          int64                    `json:"gmv_30d_kobo"`
	TicketsSoldToday    int                      `json:"tickets_sold_today"`
	TicketsSold30d      int                      `json:"tickets_sold_30d"`
	TakeRate            float64                  `json:"take_rate"`
	NetRevenue30dKobo   int64                    `json:"net_revenue_30d_kobo"`
	AvgTicketPriceKobo  int64                    `json:"avg_ticket_price_kobo"`
	CashlessFloatKobo   int64                    `json:"cashless_float_kobo"`
	CashlessLiability   int64                    `json:"cashless_liability_kobo"`
	ResidualPendingKobo int64                    `json:"residual_refund_pending_kobo"`
	VendorFloatKobo     int64                    `json:"vendor_float_kobo"`
	EventsLive          int                      `json:"events_live"`
	EventsPending       int                      `json:"events_pending_approval"`
	VendorsActive       int                      `json:"vendors_active"`
	VendorPayoutsHold   int                      `json:"vendor_payouts_kyc_hold"`
	SettlementBreaks    int                      `json:"settlement_breaks_open"` // no break-detection exists; always 0
	SettlementBreakKobo int64                    `json:"settlement_break_value_kobo"`
	FraudOpen           int                      `json:"fraud_open"` // derived signals still open or investigating (admin_fraud.go)
	RefundsPending      int                      `json:"refunds_pending"`
	SupportCasesOpen    int                      `json:"support_cases_open"`
	TicketMix           []map[string]any         `json:"ticket_mix"`
	GMVTrend            []map[string]any         `json:"gmv_trend"`
	Activity            []AdminDashboardActivity `json:"activity"`
}

// AdminGetDashboard composes real aggregates from the same tables the other
// admin reads use. settlement_breaks_open and fraud_open stay at 0 because no
// break-detection or fraud-queue concept exists in this module — a zero there
// means "not tracked", never "verified none". Everything else, including the
// refund and support-desk queue badges, is a live count; the two commerce-only
// sources (refund/support case tables, the moderation trail behind the activity
// feed) are skipped while FEATURE_EVENTS_COMMERCIAL is off.
func (s *Service) AdminGetDashboard(ctx context.Context) (*AdminDashboard, error) {
	d := &AdminDashboard{TicketMix: []map[string]any{}, GMVTrend: []map[string]any{}, Activity: []AdminDashboardActivity{}}

	// GMV/sold are order-derived (event_orders.total_kobo, promo-net, PAID only):
	// the previous tiers.sold*price derivation counted refunded tickets at full
	// list price, treated comp issues as revenue, and ignored promo discounts —
	// and it windowed on events.created_at, so today's sales on an older event
	// never showed. Order created_at is the sale timestamp (EVT-UAT-208/234).
	const totals = `
		SELECT
			COALESCE((SELECT SUM(o.total_kobo) FROM event_orders o
			          WHERE o.status='PAID' AND o.created_at::date = current_date), 0),
			COALESCE((SELECT SUM(o.total_kobo) FROM event_orders o
			          WHERE o.status='PAID' AND o.created_at >= now() - interval '30 days'), 0),
			COALESCE((SELECT COUNT(*) FROM event_orders o
			          WHERE o.status='PAID' AND o.created_at::date = current_date), 0),
			COALESCE((SELECT COUNT(*) FROM event_orders o
			          WHERE o.status='PAID' AND o.created_at >= now() - interval '30 days'), 0),
			COALESCE((SELECT SUM(o.total_kobo) FROM event_orders o WHERE o.status='PAID'), 0),
			COALESCE((SELECT COUNT(*) FROM event_orders o WHERE o.status='PAID'), 0),
			(SELECT COUNT(*) FROM events WHERE state = 'LIVE'),
			(SELECT COUNT(*) FROM events WHERE state = 'SUBMITTED'),
			(SELECT COUNT(*) FROM event_vendors WHERE active = true)`
	var gmvToday, gmv30d, allTimeGMV int64
	var soldToday, sold30d, allTimeSold, eventsLive, eventsPending, vendorsActive int
	if err := s.db.QueryRow(ctx, totals).Scan(
		&gmvToday, &gmv30d, &soldToday, &sold30d, &allTimeGMV, &allTimeSold, &eventsLive, &eventsPending, &vendorsActive,
	); err != nil {
		return nil, fmt.Errorf("events: admin dashboard totals: %w", err)
	}
	d.GMVTodayKobo, d.GMV30dKobo = gmvToday, gmv30d
	d.TicketsSoldToday, d.TicketsSold30d = soldToday, sold30d
	d.EventsLive, d.EventsPending, d.VendorsActive = eventsLive, eventsPending, vendorsActive
	if allTimeSold > 0 {
		d.AvgTicketPriceKobo = allTimeGMV / int64(allTimeSold)
	}

	// take_rate / net_revenue_30d: platform's fee_bps varies per event, so this
	// is a GMV-weighted average over the same 30-day window, not a flat rate.
	const rev = `
		SELECT COALESCE(SUM(o.total_kobo * e.fee_bps / 10000), 0)
		FROM event_orders o JOIN events e ON e.id = o.event_id
		WHERE o.status='PAID' AND o.created_at >= now() - interval '30 days'`
	if err := s.db.QueryRow(ctx, rev).Scan(&d.NetRevenue30dKobo); err != nil {
		return nil, fmt.Errorf("events: admin dashboard revenue: %w", err)
	}
	if d.GMV30dKobo > 0 {
		d.TakeRate = float64(d.NetRevenue30dKobo) / float64(d.GMV30dKobo)
	}

	const cashless = `
		SELECT COALESCE(SUM(le.amount_kobo) FILTER (WHERE le.type = 'TOPUP'), 0),
		       COALESCE(SUM(le.amount_kobo) FILTER (WHERE le.type = 'TOPUP'), 0)
		       - COALESCE(SUM(le.amount_kobo) FILTER (WHERE le.type IN ('CHARGE','REFUND')), 0)
		FROM event_wallet_ledger le`
	if err := s.db.QueryRow(ctx, cashless).Scan(&d.CashlessFloatKobo, &d.CashlessLiability); err != nil {
		return nil, fmt.Errorf("events: admin dashboard cashless: %w", err)
	}

	const vendorFloatQ = `SELECT COALESCE(SUM(amount_kobo) FILTER (WHERE settled = false), 0) FROM vendor_float`
	if err := s.db.QueryRow(ctx, vendorFloatQ).Scan(&d.VendorFloatKobo); err != nil {
		return nil, fmt.Errorf("events: admin dashboard vendor float: %w", err)
	}
	// KYC-hold count: reuse GetUserTier (the same accessor every other KYC gate
	// in this service uses — SettleVendor, AdminListVendors) rather than
	// guessing at a tiers table's schema directly.
	holdRows, err := s.db.Query(ctx, `
		SELECT DISTINCT v.user_id FROM vendor_float vf
		JOIN event_vendors v ON v.id = vf.vendor_id
		WHERE vf.settled = false`)
	if err != nil {
		return nil, fmt.Errorf("events: admin dashboard vendor kyc holders: %w", err)
	}
	for holdRows.Next() {
		var userID string
		if err := holdRows.Scan(&userID); err != nil {
			holdRows.Close()
			return nil, fmt.Errorf("events: admin dashboard vendor kyc scan: %w", err)
		}
		tier, terr := s.tiers.GetUserTier(ctx, userID)
		if terr != nil || int(tier) < 1 {
			d.VendorPayoutsHold++
		}
	}
	holdRows.Close()
	if err := holdRows.Err(); err != nil {
		return nil, err
	}

	// ResidualPendingKobo: CloseWallet refunds the residual in the same
	// transaction that closes the wallet, so this should read 0. It is computed
	// rather than assumed so a CLOSED wallet left holding float surfaces here.
	if err := s.db.QueryRow(ctx, residualPendingSQL).Scan(&d.ResidualPendingKobo); err != nil {
		return nil, fmt.Errorf("events: admin dashboard residual pending: %w", err)
	}

	if err := s.adminDashboardMixTrend(ctx, d); err != nil {
		return nil, err
	}
	if err := s.adminDashboardQueues(ctx, d); err != nil {
		return nil, err
	}
	return d, nil
}

// adminDashboardMixTrend fills the two chart series from PAID orders — the same
// rows the headline GMV/sold numbers above count, so a chart bar and the total
// it sums to can never disagree.
func (s *Service) adminDashboardMixTrend(ctx context.Context, d *AdminDashboard) error {
	const trend = `
		SELECT o.created_at::date AS day,
		       SUM(o.total_kobo) AS gmv_kobo,
		       SUM(o.total_kobo * e.fee_bps / 10000) AS net_kobo
		FROM event_orders o JOIN events e ON e.id = o.event_id
		WHERE o.status='PAID' AND o.created_at >= now() - interval '30 days'
		GROUP BY 1 ORDER BY 1 ASC`
	rows, err := s.db.Query(ctx, trend)
	if err != nil {
		return fmt.Errorf("events: admin dashboard trend: %w", err)
	}
	for rows.Next() {
		var day time.Time
		var gmv, net int64
		if err := rows.Scan(&day, &gmv, &net); err != nil {
			rows.Close()
			return fmt.Errorf("events: admin dashboard trend scan: %w", err)
		}
		d.GMVTrend = append(d.GMVTrend, map[string]any{
			"date":     day.Format("2006-01-02"),
			"gmv_kobo": gmv,
			"net_kobo": net,
		})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	const mix = `
		SELECT COALESCE(NULLIF(t.name,''),'General'), COUNT(*), SUM(o.total_kobo)
		FROM event_orders o JOIN event_ticket_tiers t ON t.id = o.tier_id
		WHERE o.status='PAID' AND o.created_at >= now() - interval '30 days'
		GROUP BY 1 ORDER BY SUM(o.total_kobo) DESC LIMIT 8`
	mixRows, err := s.db.Query(ctx, mix)
	if err != nil {
		return fmt.Errorf("events: admin dashboard mix: %w", err)
	}
	for mixRows.Next() {
		var tier string
		var sold int
		var gmv int64
		if err := mixRows.Scan(&tier, &sold, &gmv); err != nil {
			mixRows.Close()
			return fmt.Errorf("events: admin dashboard mix scan: %w", err)
		}
		share := 0.0
		if d.TicketsSold30d > 0 {
			share = float64(sold) / float64(d.TicketsSold30d) * 100
		}
		d.TicketMix = append(d.TicketMix, map[string]any{
			"tier":      tier,
			"sold":      sold,
			"gmv_kobo":  gmv,
			"share_pct": share,
		})
	}
	mixRows.Close()
	return mixRows.Err()
}

// adminDashboardQueues counts the work an admin actually has to do: refunds not
// yet finished and support cases not yet closed. Both tables arrive with the
// commerce migration, so with the flag off they report 0 = "not tracked" rather
// than asking a pre-migration database for a table it does not have. The
// activity feed's sales leg is always available; its governance leg joins the
// commerce-only trail.
func (s *Service) adminDashboardQueues(ctx context.Context, d *AdminDashboard) error {
	fraudOpen, err := s.adminFraudOpenCount(ctx)
	if err != nil {
		return err
	}
	d.FraudOpen = fraudOpen

	if s.commerceReads {
		if err := s.db.QueryRow(ctx,
			`SELECT COUNT(*) FROM event_refunds WHERE status IN ('REQUESTED','APPROVED','PROCESSING','FAILED')`).
			Scan(&d.RefundsPending); err != nil {
			return fmt.Errorf("events: admin dashboard refund queue: %w", err)
		}
		if err := s.db.QueryRow(ctx,
			`SELECT COUNT(*) FROM event_support_cases WHERE status IN ('OPEN','IN_PROGRESS')`).
			Scan(&d.SupportCasesOpen); err != nil {
			return fmt.Errorf("events: admin dashboard support queue: %w", err)
		}
	}

	type activityRow struct {
		a  AdminDashboardActivity
		at time.Time
	}
	rows := []activityRow{}

	const sales = `
		SELECT o.id, COALESCE(e.title,''), o.created_at
		FROM event_orders o JOIN events e ON e.id = o.event_id
		WHERE o.status='PAID'
		ORDER BY o.created_at DESC LIMIT 10`
	saleRows, err := s.db.Query(ctx, sales)
	if err != nil {
		return fmt.Errorf("events: admin dashboard activity sales: %w", err)
	}
	for saleRows.Next() {
		var id, title string
		var at timeScan
		if err := saleRows.Scan(&id, &title, &at.t); err != nil {
			saleRows.Close()
			return fmt.Errorf("events: admin dashboard activity sales scan: %w", err)
		}
		ref := id
		rows = append(rows, activityRow{AdminDashboardActivity{
			ID: id, Kind: "ticket_sale", Label: "Ticket sale · " + title, Ref: &ref,
			CreatedAt: at.t.Format(rfc3339),
		}, at.t})
	}
	saleRows.Close()
	if err := saleRows.Err(); err != nil {
		return err
	}

	if s.commerceReads {
		const decisions = `
			SELECT d.id, d.action, d.to_state, COALESCE(e.title,''), d.created_at
			FROM event_moderation_decisions d
			LEFT JOIN events e ON e.id = d.event_id
			ORDER BY d.created_at DESC LIMIT 10`
		decRows, err := s.db.Query(ctx, decisions)
		if err != nil {
			return fmt.Errorf("events: admin dashboard activity moderation: %w", err)
		}
		for decRows.Next() {
			var id, action, to, title string
			var at timeScan
			if err := decRows.Scan(&id, &action, &to, &title, &at.t); err != nil {
				decRows.Close()
				return fmt.Errorf("events: admin dashboard activity moderation scan: %w", err)
			}
			label := moderationLabel(action)
			if title != "" {
				label += " · " + title
			}
			ref := id
			rows = append(rows, activityRow{AdminDashboardActivity{
				ID: id, Kind: adminStatus(action), Label: label, Ref: &ref,
				CreatedAt: at.t.Format(rfc3339),
			}, at.t})
		}
		decRows.Close()
		if err := decRows.Err(); err != nil {
			return err
		}
	}

	sort.Slice(rows, func(i, j int) bool { return rows[i].at.After(rows[j].at) })
	if len(rows) > 20 {
		rows = rows[:20]
	}
	for _, r := range rows {
		d.Activity = append(d.Activity, r.a)
	}
	return nil
}

// --- C. Event catalog + detail ---

type AdminEventSummary struct {
	ID              string `json:"id"`
	Title           string `json:"title"`
	OrganiserMasked string `json:"organiser_masked"`
	Category        string `json:"category"`
	City            string `json:"city"`
	Status          string `json:"status"`
	StartsAt        string `json:"starts_at"`
	Capacity        int    `json:"capacity"`
	TicketsSold     int    `json:"tickets_sold"`
	GMVKobo         int64  `json:"gmv_kobo"`
	CashlessEnabled bool   `json:"cashless_enabled"`
	CreatedAt       string `json:"created_at"`

	// Commerce-only: populated when FEATURE_EVENTS_COMMERCIAL is on, omitted
	// otherwise (the columns below come from the commerce migration).
	RefundPolicy     string `json:"refund_policy,omitempty"`
	ModerationStatus string `json:"moderation_status,omitempty"`
	ModerationNote   string `json:"moderation_note,omitempty"`
	SubmittedAt      string `json:"submitted_at,omitempty"`
}

// tickets_sold = issued entitlements never refunded (comps count — they consume
// capacity); gmv_kobo = money actually collected (PAID orders, promo-net). The
// previous tiers.sold*price derivation overstated both — see AdminGetDashboard.
const adminEventColsBase = `
	SELECT e.id, e.title, COALESCE(up.full_name,''), COALESCE(e.category,''),
	       e.state, e.starts_at, e.created_at,
	       COALESCE((SELECT SUM(t.capacity) FROM event_ticket_tiers t WHERE t.event_id=e.id), 0),
	       COALESCE((SELECT COUNT(*) FROM event_tickets tk WHERE tk.event_id=e.id AND tk.state<>'REFUNDED'), 0),
	       COALESCE((SELECT SUM(o.total_kobo) FROM event_orders o WHERE o.event_id=e.id AND o.status='PAID'), 0),
	       EXISTS(SELECT 1 FROM event_wallets w WHERE w.event_id=e.id)`

// adminEventColsCommerce adds the columns the commerce migration owns. They are
// appended, never merged into the base list, so a database that has not applied
// 20271400000000 still answers the flag-off query with its original shape.
const adminEventColsCommerce = `,
	       e.city, e.refund_policy, e.moderation_status, e.moderation_note, e.submitted_at`

const adminEventFrom = `
	FROM events e
	LEFT JOIN user_profiles up ON up.id = e.organiser_id`

// adminEventSummarySQL builds the shared admin projection for a WHERE clause
// (pass "" for no predicate). Column order and adminEventTargets must agree.
func (s *Service) adminEventSummarySQL(where string) string {
	cols := adminEventColsBase
	if s.commerceReads {
		cols += adminEventColsCommerce
	}
	return cols + adminEventFrom + " " + where
}

// adminEventTargets returns the scan destinations for adminEventSummarySQL.
// submitted_at is nullable — an event that has never been submitted — so it
// scans through a **time.Time and stays empty in the JSON when NULL.
func (s *Service) adminEventTargets(e *AdminEventSummary, state, organiserName *string, startsAt, createdAt *timeScan, submittedAt **time.Time) []any {
	dests := []any{&e.ID, &e.Title, organiserName, &e.Category, state, &startsAt.t, &createdAt.t,
		&e.Capacity, &e.TicketsSold, &e.GMVKobo, &e.CashlessEnabled}
	if s.commerceReads {
		dests = append(dests, &e.City, &e.RefundPolicy, &e.ModerationStatus, &e.ModerationNote, submittedAt)
	}
	return dests
}

// adminEventFormats applies the enum-casing and timestamp formatting the admin
// console's TS types expect.
func adminEventFormats(e *AdminEventSummary, state, organiserName string, startsAt, createdAt time.Time, submittedAt *time.Time) {
	e.OrganiserMasked = maskName(organiserName)
	e.Status = adminStatus(state)
	e.StartsAt = startsAt.Format(rfc3339)
	e.CreatedAt = createdAt.Format(rfc3339)
	if submittedAt != nil {
		e.SubmittedAt = submittedAt.Format(rfc3339)
	}
}

// AdminListEvents lists events across ALL states (admin view — discovery's
// ListEvents restricts non-organiser callers to public states), with
// optional status/q filters. Also serves the reframed "approvals queue" via
// ?status=submitted — no separate /approvals route exists.
func (s *Service) AdminListEvents(ctx context.Context, status, q string) ([]AdminEventSummary, error) {
	where := "WHERE 1=1"
	args := []any{}
	if status != "" {
		args = append(args, strings.ToUpper(status))
		where += fmt.Sprintf(" AND e.state = $%d", len(args))
	}
	if q != "" {
		args = append(args, "%"+q+"%")
		where += fmt.Sprintf(" AND e.title ILIKE $%d", len(args))
	}
	query := s.adminEventSummarySQL(where) + " ORDER BY e.created_at DESC LIMIT 200"
	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("events: admin list: %w", err)
	}
	defer rows.Close()

	out := []AdminEventSummary{}
	for rows.Next() {
		var e AdminEventSummary
		var state, organiserName string
		var startsAt, createdAt timeScan
		var submittedAt *time.Time
		if err := rows.Scan(s.adminEventTargets(&e, &state, &organiserName, &startsAt, &createdAt, &submittedAt)...); err != nil {
			return nil, fmt.Errorf("events: admin list scan: %w", err)
		}
		adminEventFormats(&e, state, organiserName, startsAt.t, createdAt.t, submittedAt)
		out = append(out, e)
	}
	return out, rows.Err()
}

type AdminPromoCode struct {
	Code           string `json:"code"`
	DiscountPct    int    `json:"discount_pct"`
	MaxRedemptions int    `json:"max_redemptions"`
	Redeemed       int    `json:"redeemed"`
	Active         bool   `json:"active"`
}

type AdminTicketTier struct {
	ID            string           `json:"id"`
	EventID       string           `json:"event_id"`
	EventTitle    string           `json:"event_title"`
	Name          string           `json:"name"`
	PriceKobo     int64            `json:"price_kobo"`
	Quantity      int              `json:"quantity"`
	Sold          int              `json:"sold"`
	Held          int              `json:"held"`
	Status        string           `json:"status"`
	ConfigVersion int              `json:"config_version"` // no per-tier versioning exists; always 1
	PromoCodes    []AdminPromoCode `json:"promo_codes"`
}

type AdminEventDetail struct {
	AdminEventSummary

	Description       string                    `json:"description"`
	Venue             string                    `json:"venue"`
	CapacitySoldPct   float64                   `json:"capacity_sold_pct"`
	NetRevenueKobo    int64                     `json:"net_revenue_kobo"`
	CashlessFloatKobo int64                     `json:"cashless_float_kobo"`
	CashlessLiability int64                     `json:"cashless_liability_kobo"`
	Tiers             []AdminTicketTier         `json:"tiers"`
	Timeline          []AdminEventTimelineEntry `json:"timeline"`
}

type AdminEventTimelineEntry struct {
	ID          string `json:"id"`
	Status      string `json:"status"`
	Label       string `json:"label"`
	ActorMasked string `json:"actor_masked"`
	AuditID     string `json:"audit_id"`
	At          string `json:"at"`
	Reason      string `json:"reason,omitempty"`
}

// AdminGetEvent returns full detail for one event, admin-scoped (any state).
func (s *Service) AdminGetEvent(ctx context.Context, eventID string) (*AdminEventDetail, error) {
	row := s.db.QueryRow(ctx, s.adminEventSummarySQL("WHERE e.id=$1"), eventID)
	var d AdminEventDetail
	var state, organiserName string
	var startsAt, createdAt timeScan
	var submittedAt *time.Time
	if err := row.Scan(s.adminEventTargets(&d.AdminEventSummary, &state, &organiserName, &startsAt, &createdAt, &submittedAt)...); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("events: admin get: %w", err)
	}
	adminEventFormats(&d.AdminEventSummary, state, organiserName, startsAt.t, createdAt.t, submittedAt)
	d.Tiers = []AdminTicketTier{}
	d.Timeline = []AdminEventTimelineEntry{}

	var feeBps int
	if err := s.db.QueryRow(ctx, `SELECT COALESCE(description,''), venue, fee_bps FROM events WHERE id=$1`, eventID).
		Scan(&d.Description, &d.Venue, &feeBps); err != nil {
		return nil, fmt.Errorf("events: admin get details: %w", err)
	}
	if d.Capacity > 0 {
		d.CapacitySoldPct = float64(d.TicketsSold) / float64(d.Capacity)
	}
	d.NetRevenueKobo = d.GMVKobo * int64(feeBps) / 10000

	const cashless = `
		SELECT COALESCE(SUM(le.amount_kobo) FILTER (WHERE le.type='TOPUP'),0),
		       COALESCE(SUM(le.amount_kobo) FILTER (WHERE le.type='TOPUP'),0)
		       - COALESCE(SUM(le.amount_kobo) FILTER (WHERE le.type IN ('CHARGE','REFUND')),0)
		FROM event_wallet_ledger le JOIN event_wallets w ON w.id = le.wallet_id
		WHERE w.event_id = $1`
	if err := s.db.QueryRow(ctx, cashless, eventID).Scan(&d.CashlessFloatKobo, &d.CashlessLiability); err != nil {
		return nil, fmt.Errorf("events: admin get cashless: %w", err)
	}

	tiers, err := s.adminTiersForEvent(ctx, eventID, d.Title)
	if err != nil {
		return nil, err
	}
	d.Tiers = tiers

	// The review trail is real once FEATURE_EVENTS_COMMERCIAL is on: every
	// submit / approve / reject / request-changes / suspend / reinstate the
	// platform took against this event is a row in event_moderation_decisions,
	// with the actor who took it. Flag off, that table does not exist, so the
	// timeline stays empty instead of failing the whole detail read.
	if s.commerceReads {
		tl, terr := s.adminEventTimeline(ctx, eventID)
		if terr != nil {
			return nil, terr
		}
		d.Timeline = tl
	}
	return &d, nil
}

// adminEventTimeline reads the event's append-only governance trail, oldest
// first — the console renders it as the event's history.
func (s *Service) adminEventTimeline(ctx context.Context, eventID string) ([]AdminEventTimelineEntry, error) {
	rows, err := s.db.Query(ctx, `
		SELECT d.id, d.action, d.from_state, d.to_state, d.reason, d.note,
		       COALESCE(up.full_name,''), d.created_at
		FROM event_moderation_decisions d
		LEFT JOIN user_profiles up ON up.id = d.actor_id
		WHERE d.event_id = $1
		ORDER BY d.created_at ASC, d.id ASC`, eventID)
	if err != nil {
		return nil, fmt.Errorf("events: admin timeline: %w", err)
	}
	defer rows.Close()

	out := []AdminEventTimelineEntry{}
	for rows.Next() {
		var (
			id, action, from, to, reason, note, actor string
			at                                        timeScan
		)
		if err := rows.Scan(&id, &action, &from, &to, &reason, &note, &actor, &at.t); err != nil {
			return nil, fmt.Errorf("events: admin timeline scan: %w", err)
		}
		status := to
		if status == "" {
			status = from // platform-wide decisions (FEE_SET) change no event state
		}
		if reason == "" {
			reason = note
		}
		out = append(out, AdminEventTimelineEntry{
			ID:          id,
			Status:      adminStatus(status),
			Label:       moderationLabel(action),
			ActorMasked: maskName(actor),
			AuditID:     id,
			At:          at.t.Format(rfc3339),
			Reason:      reason,
		})
	}
	return out, rows.Err()
}

// moderationLabel turns a trail action into the console's human row title.
func moderationLabel(action string) string {
	switch action {
	case ModerationActSubmit:
		return "Submitted for review"
	case ModerationActApprove:
		return "Approved"
	case ModerationActReject:
		return "Rejected"
	case ModerationActRequestChanges:
		return "Changes requested"
	case ModerationActSuspend:
		return "Suspended"
	case ModerationActReinstate:
		return "Reinstated"
	case ModerationActFeeSet:
		return "Platform fee changed"
	}
	return action
}

// AdminListTickets lists ticket tiers across events (admin inventory view),
// filterable by event_id/status/q.
func (s *Service) AdminListTickets(ctx context.Context, eventID, status, q string) ([]AdminTicketTier, error) {
	where := "WHERE 1=1"
	args := []any{}
	if eventID != "" {
		args = append(args, eventID)
		where += fmt.Sprintf(" AND t.event_id = $%d", len(args))
	}
	if q != "" {
		args = append(args, "%"+q+"%")
		where += fmt.Sprintf(" AND (t.name ILIKE $%d OR e.title ILIKE $%d)", len(args), len(args))
	}
	query := `
		SELECT t.id, t.event_id, e.title, t.name, t.price_kobo, t.capacity, t.sold, t.active, e.state,
		       COALESCE((SELECT COUNT(*) FROM event_orders o WHERE o.tier_id=t.id AND o.status='PENDING'), 0)
		FROM event_ticket_tiers t JOIN events e ON e.id = t.event_id ` + where + ` ORDER BY t.created_at DESC LIMIT 200`
	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("events: admin tickets: %w", err)
	}
	defer rows.Close()

	out := []AdminTicketTier{}
	for rows.Next() {
		var t AdminTicketTier
		var active bool
		var eventState string
		if err := rows.Scan(&t.ID, &t.EventID, &t.EventTitle, &t.Name, &t.PriceKobo, &t.Quantity, &t.Sold, &active, &eventState, &t.Held); err != nil {
			return nil, fmt.Errorf("events: admin tickets scan: %w", err)
		}
		t.Status = tierStatus(active, t.Sold, t.Quantity, eventState)
		t.ConfigVersion = 1
		t.PromoCodes = []AdminPromoCode{}
		if status == "" || status == t.Status {
			out = append(out, t)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func tierStatus(active bool, sold, capacity int, eventState string) string {
	if !active {
		return "paused"
	}
	if eventState == "CLOSED" {
		return "ended"
	}
	if capacity > 0 && sold >= capacity {
		return "sold_out"
	}
	return "on_sale"
}

// adminTiersForEvent attaches every one of the event's promo codes to every
// tier: the schema associates promo codes with the EVENT, not a specific
// tier, so there is no real per-tier promo scoping to report — this mirrors
// that real shape rather than inventing a false association.
func (s *Service) adminTiersForEvent(ctx context.Context, eventID, eventTitle string) ([]AdminTicketTier, error) {
	var eventState string
	if err := s.db.QueryRow(ctx, `SELECT state FROM events WHERE id=$1`, eventID).Scan(&eventState); err != nil {
		return nil, fmt.Errorf("events: admin tiers event state: %w", err)
	}

	promos := []AdminPromoCode{}
	promoRows, err := s.db.Query(ctx, `SELECT code, percent_off, max_uses, used, active FROM event_promo_codes WHERE event_id=$1`, eventID)
	if err != nil {
		return nil, fmt.Errorf("events: admin promos: %w", err)
	}
	for promoRows.Next() {
		var p AdminPromoCode
		if err := promoRows.Scan(&p.Code, &p.DiscountPct, &p.MaxRedemptions, &p.Redeemed, &p.Active); err != nil {
			promoRows.Close()
			return nil, fmt.Errorf("events: admin promos scan: %w", err)
		}
		promos = append(promos, p)
	}
	promoRows.Close()
	if err := promoRows.Err(); err != nil {
		return nil, err
	}

	rows, err := s.db.Query(ctx, `
		SELECT t.id, t.name, t.price_kobo, t.capacity, t.sold, t.active,
		       COALESCE((SELECT COUNT(*) FROM event_orders o WHERE o.tier_id=t.id AND o.status='PENDING'), 0)
		FROM event_ticket_tiers t WHERE t.event_id=$1 ORDER BY t.created_at ASC`, eventID)
	if err != nil {
		return nil, fmt.Errorf("events: admin tiers: %w", err)
	}
	defer rows.Close()

	out := []AdminTicketTier{}
	for rows.Next() {
		var t AdminTicketTier
		var active bool
		if err := rows.Scan(&t.ID, &t.Name, &t.PriceKobo, &t.Quantity, &t.Sold, &active, &t.Held); err != nil {
			return nil, fmt.Errorf("events: admin tiers scan: %w", err)
		}
		t.EventID, t.EventTitle = eventID, eventTitle
		t.Status = tierStatus(active, t.Sold, t.Quantity, eventState)
		t.ConfigVersion = 1
		t.PromoCodes = promos
		out = append(out, t)
	}
	return out, rows.Err()
}

// --- E. Cashless float & liability ---

type AdminCashlessLine struct {
	EventID              string  `json:"event_id"`
	EventTitle           string  `json:"event_title"`
	WalletStatus         string  `json:"wallet_status"`
	LoadedKobo           int64   `json:"loaded_kobo"`
	SpentKobo            int64   `json:"spent_kobo"`
	LiabilityKobo        int64   `json:"liability_kobo"`
	ResidualRefundedKobo int64   `json:"residual_refunded_kobo"`
	ResidualPendingKobo  int64   `json:"residual_pending_kobo"` // float still held by CLOSED wallets; 0 when every close refunded
	ClosedAt             *string `json:"closed_at"`
}

type AdminCashlessFloat struct {
	GeneratedAt              string              `json:"generated_at"`
	TotalLoadedKobo          int64               `json:"total_loaded_kobo"`
	TotalSpentKobo           int64               `json:"total_spent_kobo"`
	TotalLiabilityKobo       int64               `json:"total_liability_kobo"`
	TotalResidualPendingKobo int64               `json:"total_residual_pending_kobo"`
	LedgerBalanceKobo        int64               `json:"ledger_balance_kobo"`
	CustodyBalanceKobo       int64               `json:"custody_balance_kobo"` // no separate custody/bank reconciliation feed exists; mirrors ledger_balance_kobo so delta_kobo reads 0 rather than a fabricated mismatch
	DeltaKobo                int64               `json:"delta_kobo"`
	Lines                    []AdminCashlessLine `json:"lines"`
}

func (s *Service) AdminGetCashlessFloat(ctx context.Context) (*AdminCashlessFloat, error) {
	f := &AdminCashlessFloat{GeneratedAt: nowRFC3339(), Lines: []AdminCashlessLine{}}

	rows, err := s.db.Query(ctx, `
		SELECT w.event_id, e.title, w.state, w.updated_at,
		       COALESCE(SUM(le.amount_kobo) FILTER (WHERE le.type='TOPUP'),0),
		       COALESCE(SUM(le.amount_kobo) FILTER (WHERE le.type IN ('CHARGE','REFUND')),0),
		       COALESCE(SUM(le.amount_kobo) FILTER (WHERE le.type='REFUND'),0)
		FROM event_wallets w
		JOIN events e ON e.id = w.event_id
		LEFT JOIN event_wallet_ledger le ON le.wallet_id = w.id
		GROUP BY w.id, w.event_id, e.title, w.state, w.updated_at`)
	if err != nil {
		return nil, fmt.Errorf("events: admin cashless: %w", err)
	}
	defer rows.Close()

	// One row per wallet (event_wallets is one row per attendee per event —
	// UNIQUE(event_id, owner_id) — not one per event), re-aggregated here into
	// one line per event across every attendee's wallet for that event.
	lineByEvent := map[string]*AdminCashlessLine{}
	for rows.Next() {
		var eventID, title, state string
		var updatedAt timeScan
		var loaded, spent, refunded int64
		if err := rows.Scan(&eventID, &title, &state, &updatedAt.t, &loaded, &spent, &refunded); err != nil {
			return nil, fmt.Errorf("events: admin cashless scan: %w", err)
		}
		line, ok := lineByEvent[eventID]
		if !ok {
			line = &AdminCashlessLine{EventID: eventID, EventTitle: title}
			lineByEvent[eventID] = line
		}
		line.LoadedKobo += loaded
		line.SpentKobo += spent
		line.LiabilityKobo = line.LoadedKobo - line.SpentKobo
		line.ResidualRefundedKobo += refunded
		line.WalletStatus = strings.ToLower(state)
		if state == "CLOSED" {
			ts := updatedAt.t.Format(rfc3339)
			line.ClosedAt = &ts
			if held := loaded - spent; held > 0 {
				line.ResidualPendingKobo += held
				f.TotalResidualPendingKobo += held
			}
		}
		f.TotalLoadedKobo += loaded
		f.TotalSpentKobo += spent
	}
	for _, line := range lineByEvent {
		f.Lines = append(f.Lines, *line)
	}
	f.TotalLiabilityKobo = f.TotalLoadedKobo - f.TotalSpentKobo
	f.LedgerBalanceKobo = f.TotalLiabilityKobo
	f.CustodyBalanceKobo = f.TotalLiabilityKobo
	return f, rows.Err()
}

// --- F. Vendors ---

type AdminVendorRecord struct {
	ID             string `json:"id"`
	NameMasked     string `json:"name_masked"`
	EventID        string `json:"event_id"`
	EventTitle     string `json:"event_title"`
	KYCTier        string `json:"kyc_tier"`
	KYCVerified    bool   `json:"kyc_verified"`
	CollectedKobo  int64  `json:"collected_kobo"`
	FeesKobo       int64  `json:"fees_kobo"` // fee SettleVendor would take on the unsettled float now (event fee_bps)
	NetPayableKobo int64  `json:"net_payable_kobo"`
	PayoutStatus   string `json:"payout_status"`
	Active         bool   `json:"active"`
	CreatedAt      string `json:"created_at"`
}

func (s *Service) AdminListVendors(ctx context.Context, payoutStatus, q string) ([]AdminVendorRecord, error) {
	where := "WHERE 1=1"
	args := []any{}
	if q != "" {
		args = append(args, "%"+q+"%")
		where += fmt.Sprintf(" AND (v.name ILIKE $%d OR e.title ILIKE $%d)", len(args), len(args))
	}
	query := `
		SELECT v.id, v.name, v.event_id, e.title, v.user_id, v.active, v.created_at, e.fee_bps,
		       COALESCE((SELECT SUM(amount_kobo) FROM vendor_float WHERE vendor_id=v.id AND settled=false), 0),
		       EXISTS(SELECT 1 FROM vendor_float WHERE vendor_id=v.id AND settled=true)
		FROM event_vendors v JOIN events e ON e.id = v.event_id ` + where + ` ORDER BY v.created_at DESC LIMIT 200`
	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("events: admin vendors: %w", err)
	}
	defer rows.Close()

	out := []AdminVendorRecord{}
	for rows.Next() {
		var v AdminVendorRecord
		var userID string
		var createdAt timeScan
		var unsettled int64
		var feeBps int
		var hasSettled bool
		if err := rows.Scan(&v.ID, &v.NameMasked, &v.EventID, &v.EventTitle, &userID, &v.Active, &createdAt.t, &feeBps, &unsettled, &hasSettled); err != nil {
			return nil, fmt.Errorf("events: admin vendors scan: %w", err)
		}
		v.NameMasked = maskName(v.NameMasked)
		v.CreatedAt = createdAt.t.Format(rfc3339)
		v.CollectedKobo = unsettled
		v.FeesKobo, v.NetPayableKobo = vendorFeeSplit(unsettled, feeBps)

		tier, err := s.tiers.GetUserTier(ctx, userID)
		verified := err == nil && int(tier) >= 1
		v.KYCVerified = verified
		v.KYCTier = fmt.Sprintf("tier%d", maxInt(0, int(tier)))
		switch {
		case !verified:
			v.PayoutStatus = "kyc_hold"
		case unsettled > 0:
			v.PayoutStatus = "pending"
		case hasSettled:
			v.PayoutStatus = "paid"
		default:
			v.PayoutStatus = "pending"
		}
		if payoutStatus == "" || payoutStatus == v.PayoutStatus {
			out = append(out, v)
		}
	}
	return out, rows.Err()
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// --- G. Settlement ---

type AdminSettlementLine struct {
	ID                  string  `json:"id"`
	EventID             string  `json:"event_id"`
	EventTitle          string  `json:"event_title"`
	GrossKobo           int64   `json:"gross_kobo"`
	FeesKobo            int64   `json:"fees_kobo"`
	VendorPayoutsKobo   int64   `json:"vendor_payouts_kobo"`
	OrganiserNetKobo    int64   `json:"organiser_net_kobo"`
	ResidualRefundsKobo int64   `json:"residual_refunds_kobo"` // cashless residual refunded to attendees' main wallets (event_wallet_ledger REFUND)
	Status              string  `json:"status"`
	BreakKobo           int64   `json:"break_kobo"` // no reconciliation-break detection exists; always 0
	SettledAt           *string `json:"settled_at"`
}

type AdminSettlement struct {
	GeneratedAt            string                `json:"generated_at"`
	TotalGrossKobo         int64                 `json:"total_gross_kobo"`
	TotalFeesKobo          int64                 `json:"total_fees_kobo"`
	TotalOrganiserNetKobo  int64                 `json:"total_organiser_net_kobo"`
	TotalVendorPayoutsKobo int64                 `json:"total_vendor_payouts_kobo"`
	TotalBreakKobo         int64                 `json:"total_break_kobo"` // always 0, see AdminSettlementLine.BreakKobo
	BreaksOpen             int                   `json:"breaks_open"`      // always 0, no break-detection exists
	Lines                  []AdminSettlementLine `json:"lines"`
}

// AdminGetSettlement aggregates real event_settlements rows (written by
// SettleVendor) per event. Every real row here represents money that has
// already moved — there is no "open"/"investigating" review state in this
// model, so every line's status is "settled".
func (s *Service) AdminGetSettlement(ctx context.Context) (*AdminSettlement, error) {
	out := &AdminSettlement{GeneratedAt: nowRFC3339(), Lines: []AdminSettlementLine{}}

	rows, err := s.db.Query(ctx, `
		SELECT es.event_id, e.title, SUM(es.gross_kobo), SUM(es.fee_kobo), SUM(es.net_kobo), MAX(es.created_at),
		       COALESCE((SELECT SUM(le.amount_kobo) FROM event_wallet_ledger le
		                 JOIN event_wallets w ON w.id = le.wallet_id
		                 WHERE w.event_id = es.event_id AND le.type = 'REFUND'), 0)
		FROM event_settlements es JOIN events e ON e.id = es.event_id
		GROUP BY es.event_id, e.title ORDER BY MAX(es.created_at) DESC LIMIT 200`)
	if err != nil {
		return nil, fmt.Errorf("events: admin settlement: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var l AdminSettlementLine
		var settledAt timeScan
		if err := rows.Scan(&l.EventID, &l.EventTitle, &l.GrossKobo, &l.FeesKobo, &l.VendorPayoutsKobo, &settledAt.t, &l.ResidualRefundsKobo); err != nil {
			return nil, fmt.Errorf("events: admin settlement scan: %w", err)
		}
		l.ID = "set_" + l.EventID
		l.OrganiserNetKobo = l.GrossKobo - l.FeesKobo - l.VendorPayoutsKobo
		l.Status = "settled"
		ts := settledAt.t.Format(rfc3339)
		l.SettledAt = &ts
		out.Lines = append(out.Lines, l)

		out.TotalGrossKobo += l.GrossKobo
		out.TotalFeesKobo += l.FeesKobo
		out.TotalVendorPayoutsKobo += l.VendorPayoutsKobo
		out.TotalOrganiserNetKobo += l.OrganiserNetKobo
	}
	return out, rows.Err()
}

// residualPendingSQL sums float still held by CLOSED event wallets
// (TOPUP − CHARGE − REFUND > 0). CloseWallet refunds atomically, so a non-zero
// value is a defect worth surfacing, not an expected queue.
const residualPendingSQL = `
	SELECT COALESCE(SUM(held), 0) FROM (
		SELECT COALESCE(SUM(le.amount_kobo) FILTER (WHERE le.type='TOPUP'),0)
		     - COALESCE(SUM(le.amount_kobo) FILTER (WHERE le.type IN ('CHARGE','REFUND')),0) AS held
		FROM event_wallets w LEFT JOIN event_wallet_ledger le ON le.wallet_id = w.id
		WHERE w.state = 'CLOSED'
		GROUP BY w.id
	) per_wallet WHERE held > 0`

// vendorFeeSplit mirrors SettleVendor's arithmetic exactly (integer bps,
// truncating toward zero, fee+net == gross) so the admin preview can never
// disagree with what settlement will post.
// Returns (fee, net).
func vendorFeeSplit(grossKobo int64, feeBps int) (int64, int64) {
	if grossKobo <= 0 {
		return 0, 0
	}
	fee := (grossKobo * int64(feeBps)) / 10000
	return fee, grossKobo - fee
}
