package restaurant

import (
	"context"
	"strconv"
	"strings"
	"time"
)

// ─────────────────────────────────────────────────────────────────────────────
// The platform-wide order feed — GET /api/restaurant/admin/orders.
//
// WHY THIS EXISTS
// The ops console had no admin order feed at all. It called the MEMBER route
// `GET /api/finance/restaurant/orders?role=restaurant`, which is owner-scoped
// (`JOIN restaurants r ON r.id = o.restaurant_id WHERE r.owner_id = $1`) — so it
// returned the orders of restaurants the signed-in ADMIN personally owns, which
// is none. 2,174 orders exist; the console could see zero of them, and its
// `?status=` was ignored by that handler outright.
//
// This is the real thing: every order on the platform, joined to its restaurant
// and rider, paged, filtered in SQL, fail-closed behind RBAC restaurant.manage.
//
// READ-ONLY. It projects money (integer kobo) for display and moves none: no
// ledger entries, no state transitions, so no Idempotency-Key applies here.
// Order mutations keep going through the existing member/rider/dispatch routes.
// ─────────────────────────────────────────────────────────────────────────────

const (
	defaultAdminOrderLimit = 25
	maxAdminOrderLimit     = 200
)

// AdminOrderStatuses is the authoritative order vocabulary, matching the
// `orders_status_check` CHECK constraint in the database.
//
// It is exported because the console has to filter on it, and the console had
// invented its own list — `placed`, `accepted`, `assigned`, `refunded`,
// `no_rider` — none of which are values this column can hold. Five of its ten
// filter chips could never match a row, and five real states (pending,
// confirmed, rejected, dispatch_failed, delivery_failed) had no chip at all.
var AdminOrderStatuses = []string{
	"pending", "confirmed", "preparing", "ready", "picked_up",
	"delivered", "cancelled", "rejected", "dispatch_failed", "delivery_failed",
}

// adminOrderActive are the states an order passes through before it settles or
// closes — the ones that mean someone is still waiting on food.
var adminOrderActive = []string{"pending", "confirmed", "preparing", "ready", "picked_up"}

func isKnownOrderStatus(s string) bool {
	for _, v := range AdminOrderStatuses {
		if v == s {
			return true
		}
	}
	return false
}

// AdminOrderParams filters the feed. The zero value returns the newest page of
// every order on the platform.
type AdminOrderParams struct {
	Status       string // exact order status; "" = any. An unknown value is rejected, not silently ignored.
	Dispatch     string // dispatch_status (none|searching|assigned|delivered); "" = any
	Query        string // order id prefix, restaurant name, or delivery address
	RestaurantID string
	RiderID      string
	Unassigned   bool   // no rider yet, and not already closed
	Sort         string // newest (default) | oldest | total | updated
	Limit        int
	Offset       int
}

func (p AdminOrderParams) normalized() AdminOrderParams {
	out := p
	out.Status = strings.ToLower(strings.TrimSpace(p.Status))
	out.Dispatch = strings.ToLower(strings.TrimSpace(p.Dispatch))
	out.Query = strings.TrimSpace(p.Query)
	out.RestaurantID = strings.TrimSpace(p.RestaurantID)
	out.RiderID = strings.TrimSpace(p.RiderID)
	// An unrecognised status is dropped rather than passed to SQL, so a stale
	// client asking for `no_rider` gets the unfiltered feed instead of a
	// confidently empty one. ValidateStatus lets the handler 400 instead.
	if !isKnownOrderStatus(out.Status) {
		out.Status = ""
	}
	if out.Limit <= 0 || out.Limit > maxAdminOrderLimit {
		out.Limit = defaultAdminOrderLimit
	}
	if out.Offset < 0 {
		out.Offset = 0
	}
	switch out.Sort {
	case "oldest", "total", "updated", "newest":
	default:
		out.Sort = "newest"
	}
	return out
}

// AdminOrderRow is one row of the feed: the order, plus the names an operator
// needs to read it without a second lookup.
type AdminOrderRow struct {
	ID             string  `json:"id"`
	RestaurantID   string  `json:"restaurant_id"`
	RestaurantName string  `json:"restaurant_name"`
	CustomerID     string  `json:"customer_id"`
	RiderID        *string `json:"rider_id,omitempty"`
	RiderName      *string `json:"rider_name,omitempty"`

	Status         string `json:"status"`
	DispatchStatus string `json:"dispatch_status"`
	// StatusReason is the operator-visible why for a rejected / failed order.
	StatusReason *string `json:"status_reason,omitempty"`

	// ItemCount is SUM(order_items.quantity) — the number of things being
	// delivered, not the number of distinct lines.
	ItemCount int `json:"item_count"`

	// Money, integer kobo. Display-only projections of what was already charged.
	SubtotalKobo     int64 `json:"subtotal_kobo"`
	DeliveryFeeKobo  int64 `json:"delivery_fee_kobo"`
	ServiceFeeKobo   int64 `json:"service_fee_kobo"`
	PackagingFeeKobo int64 `json:"packaging_fee_kobo"`
	SurgeKobo        int64 `json:"surge_kobo"`
	TipKobo          int64 `json:"tip_kobo"`
	DiscountKobo     int64 `json:"discount_kobo"`
	TotalKobo        int64 `json:"total_kobo"`

	DeliveryAddress string     `json:"delivery_address"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	ReadyAt         *time.Time `json:"ready_at,omitempty"`
	DeliveredAt     *time.Time `json:"delivered_at,omitempty"`
	DisputedAt      *time.Time `json:"disputed_at,omitempty"`

	// AgeMinutes is how long this order has been open, computed server-side so
	// every operator's console agrees regardless of clock skew. Zero once the
	// order reaches a terminal state — a delivered order is not "waiting".
	AgeMinutes int `json:"age_minutes"`
}

// AdminOrderPage is one page of the feed plus aggregates over the WHOLE filtered
// set.
//
// The aggregates are the point of returning them here rather than letting the
// console add up what it rendered: the console's KPI tiles used to count the
// array it held, so once the feed is paged "Active orders" would have meant
// "active orders among the 25 currently on screen".
type AdminOrderPage struct {
	Orders  []AdminOrderRow `json:"orders"`
	Total   int             `json:"total"`
	Limit   int             `json:"limit"`
	Offset  int             `json:"offset"`
	HasMore bool            `json:"has_more"`

	// StatusCounts is every status and its count under the current filters
	// EXCLUDING the status filter itself — so the status tabs keep showing what
	// selecting them would yield, instead of collapsing to the one in effect.
	// Statuses with no matching rows are present with a 0.
	StatusCounts map[string]int `json:"status_counts"`
	// ActiveTotal is the sum of StatusCounts over the pre-terminal states.
	ActiveTotal int `json:"active_total"`
	// GrossDeliveredKobo totals delivered orders under the same non-status
	// filters. Integer kobo.
	GrossDeliveredKobo int64 `json:"gross_delivered_kobo"`
}

// ValidateStatus reports whether a caller-supplied status is a real order state.
// The handler uses it to 400 on a bad filter; normalized() then drops it so the
// service can never build SQL from an unknown value.
func ValidateStatus(s string) bool {
	s = strings.ToLower(strings.TrimSpace(s))
	return s == "" || isKnownOrderStatus(s)
}

// buildAdminOrderWhere renders the feed's WHERE clause + args. PURE (no DB).
// includeStatus is false for the aggregate query, which must span every status.
// Caller-supplied values are placeholders only — injection-safe by construction.
func buildAdminOrderWhere(p AdminOrderParams, includeStatus bool) (string, []any) {
	var args []any
	ph := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}

	var b strings.Builder
	b.WriteString("WHERE TRUE")
	if includeStatus && p.Status != "" {
		b.WriteString(" AND o.status = " + ph(p.Status))
	}
	if p.Dispatch != "" {
		b.WriteString(" AND o.dispatch_status = " + ph(p.Dispatch))
	}
	if p.RestaurantID != "" {
		b.WriteString(" AND o.restaurant_id = " + ph(p.RestaurantID) + "::uuid")
	}
	if p.RiderID != "" {
		b.WriteString(" AND o.rider_id = " + ph(p.RiderID) + "::uuid")
	}
	if p.Unassigned {
		// "Nobody is carrying this" — an unassigned CLOSED order is not a
		// dispatch problem, so terminal states are excluded.
		b.WriteString(" AND o.rider_id IS NULL AND o.status NOT IN (" + terminalOrderStatusSQL() + ")")
	}
	if p.Query != "" {
		like := ph("%" + p.Query + "%")
		// o.id is a uuid; cast before matching so a partial id ("3f2a") works
		// without the caller having to know the full key.
		b.WriteString(" AND (o.id::text ILIKE " + like +
			" OR r.name ILIKE " + like +
			" OR o.delivery_address ILIKE " + like + ")")
	}
	return b.String(), args
}

// Same unique-tiebreaker rule as the other paged reads: ties in the sort column
// would otherwise let Postgres reshuffle rows between pages.
func adminOrderOrderBy(sort string) string {
	switch sort {
	case "oldest":
		return " ORDER BY o.created_at ASC, o.id ASC"
	case "total":
		return " ORDER BY o.total_kobo DESC, o.created_at DESC, o.id DESC"
	case "updated":
		return " ORDER BY o.updated_at DESC, o.id DESC"
	default:
		return " ORDER BY o.created_at DESC, o.id DESC"
	}
}

// terminalOrderStatuses are the states an order will not move on from. An order
// in one of these is finished: nothing more will be dispatched, delivered or
// settled for it.
//
// This is the single definition (ADR-PR141). Two admin reads had drifted to a stale
// two-value idea of "finished" (`delivered, cancelled`) written before the
// lifecycle gained rejected / dispatch_failed / delivery_failed, which left 183
// of the dispatch board's 345 rows showing CLOSED orders as awaiting a rider —
// see terminalOrderStatusSQL.
var terminalOrderStatuses = []string{"delivered", "cancelled", "rejected", "dispatch_failed", "delivery_failed"}

// terminalOrderStatusSQL renders terminalOrderStatuses as a SQL IN-list literal,
// e.g. `'delivered','cancelled',…`.
//
// A literal rather than a placeholder because it is a fixed, code-owned set with
// no caller input in it, and because embedding it lets the several queries that
// need "is this order finished?" share ONE definition instead of each spelling
// out its own — which is exactly how the two stale copies came about. There is a
// test asserting this and terminalOrderStatus() never disagree.
func terminalOrderStatusSQL() string {
	quoted := make([]string, 0, len(terminalOrderStatuses))
	for _, s := range terminalOrderStatuses {
		quoted = append(quoted, "'"+s+"'")
	}
	return strings.Join(quoted, ",")
}

// terminalOrderStatus reports a state the order will not move on from, so age
// stops accruing.
func terminalOrderStatus(s string) bool {
	for _, v := range terminalOrderStatuses {
		if v == s {
			return true
		}
	}
	return false
}

// AdminListOrders returns one page of the platform-wide feed plus aggregates.
func (s *Service) AdminListOrders(ctx context.Context, params AdminOrderParams) (*AdminOrderPage, error) {
	p := params.normalized()

	// ── Aggregates, over every status under the OTHER filters ────────────────
	aggWhere, aggArgs := buildAdminOrderWhere(p, false)
	counts := map[string]int{}
	for _, st := range AdminOrderStatuses {
		counts[st] = 0 // a status with no rows must report 0, not be absent
	}
	aggRows, err := s.db.Query(ctx,
		`SELECT o.status, COUNT(*), COALESCE(SUM(o.total_kobo) FILTER (WHERE o.status = 'delivered'), 0)
		 FROM orders o JOIN restaurants r ON r.id = o.restaurant_id `+aggWhere+
			` GROUP BY o.status`, aggArgs...)
	if err != nil {
		return nil, err
	}
	var grossDelivered int64
	total := 0
	activeTotal := 0
	for aggRows.Next() {
		var st string
		var n int
		var gross int64
		if err := aggRows.Scan(&st, &n, &gross); err != nil {
			aggRows.Close()
			return nil, err
		}
		counts[st] = n
		grossDelivered += gross
	}
	aggRows.Close()
	if err := aggRows.Err(); err != nil {
		return nil, err
	}
	for _, st := range adminOrderActive {
		activeTotal += counts[st]
	}
	// `total` is the count under the FULL filters (status included), because it
	// is what the page's paging arithmetic is based on.
	if p.Status != "" {
		total = counts[p.Status]
	} else {
		for _, n := range counts {
			total += n
		}
	}

	// ── The page itself ──────────────────────────────────────────────────────
	where, args := buildAdminOrderWhere(p, true)
	full := append([]any{}, args...)
	full = append(full, p.Limit, p.Offset)
	q := `SELECT o.id, o.restaurant_id, r.name, o.customer_id, o.rider_id,
	             (SELECT d.name FROM drivers d WHERE d.user_id = o.rider_id) AS rider_name,
	             o.status, COALESCE(o.dispatch_status,'none'), o.status_reason,
	             (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
	             o.subtotal_kobo, o.delivery_kobo, o.service_fee_kobo, o.packaging_fee_kobo,
	             o.surge_kobo, o.tip_kobo, o.discount_kobo, o.total_kobo,
	             o.delivery_address, o.created_at, o.updated_at, o.ready_at, o.delivered_at, o.disputed_at
	      FROM orders o JOIN restaurants r ON r.id = o.restaurant_id ` + where + adminOrderOrderBy(p.Sort) +
		" LIMIT $" + strconv.Itoa(len(full)-1) + " OFFSET $" + strconv.Itoa(len(full))

	rows, err := s.db.Query(ctx, q, full...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	now := time.Now()
	out := []AdminOrderRow{}
	for rows.Next() {
		var o AdminOrderRow
		if err := rows.Scan(&o.ID, &o.RestaurantID, &o.RestaurantName, &o.CustomerID, &o.RiderID, &o.RiderName,
			&o.Status, &o.DispatchStatus, &o.StatusReason, &o.ItemCount,
			&o.SubtotalKobo, &o.DeliveryFeeKobo, &o.ServiceFeeKobo, &o.PackagingFeeKobo,
			&o.SurgeKobo, &o.TipKobo, &o.DiscountKobo, &o.TotalKobo,
			&o.DeliveryAddress, &o.CreatedAt, &o.UpdatedAt, &o.ReadyAt, &o.DeliveredAt, &o.DisputedAt); err != nil {
			return nil, err
		}
		if !terminalOrderStatus(o.Status) {
			if mins := int(now.Sub(o.CreatedAt).Minutes()); mins > 0 {
				o.AgeMinutes = mins
			}
		}
		out = append(out, o)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return &AdminOrderPage{
		Orders:             out,
		Total:              total,
		Limit:              p.Limit,
		Offset:             p.Offset,
		HasMore:            p.Offset+len(out) < total,
		StatusCounts:       counts,
		ActiveTotal:        activeTotal,
		GrossDeliveredKobo: grossDelivered,
	}, nil
}
