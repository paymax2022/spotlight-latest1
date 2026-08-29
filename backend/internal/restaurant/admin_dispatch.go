package restaurant

import (
	"context"
	"strconv"
	"strings"
	"time"
)

// ─────────────────────────────────────────────────────────────────────────────
// Paged dispatch-board reads: the rider roster and the courier queue.
//
// Both were unbounded — SELECT everything, ORDER BY, hand the console the lot —
// the last two reads in this module still shaped that way. `orders` and
// `drivers` are the two tables here that grow with traffic rather than with the
// merchant estate, so these are the ones that eventually hurt.
//
// Filtering moves server-side WITH the page, for the same reason it did on
// discovery: a board that pages 25 rows and then filters them locally shows
// "3 stalled" when the truth is 3 among the 25 it happens to be holding.
// ─────────────────────────────────────────────────────────────────────────────

const (
	defaultDispatchLimit = 25
	maxDispatchLimit     = 200

	// StalledAfterMinutes is how long an order may sit in `searching` before the
	// board calls it stalled. Auto-dispatch broadcasts in rounds, so a couple of
	// minutes of searching is normal operation, not a problem; past this the
	// rounds should have found someone and a human offering it to a specific
	// rider is the intervention that helps.
	//
	// Served to the client in the page response so the console renders the
	// SERVER's threshold instead of keeping its own copy to drift out of sync.
	StalledAfterMinutes = 10
)

// riderStatuses is the ops console's rider vocabulary.
var riderStatuses = []string{"available", "on_delivery", "offline", "suspended"}

func isKnownRiderStatus(s string) bool {
	for _, v := range riderStatuses {
		if v == s {
			return true
		}
	}
	return false
}

// riderStatusSQL is mapRiderStatus expressed as SQL (ADR-PR141).
//
// It has to exist in SQL, not just in Go: the roster now filters, counts and
// pages on status, and a status computed after the rows come back cannot do any
// of those — you would be paging one population and filtering another.
//
// `act.id` is the rider's current non-terminal order (see the LATERAL join).
// TestRiderStatusSQLMatchesGo pins this against mapRiderStatus for every
// combination, so the two cannot drift the way the terminal-status set did.
const riderStatusSQL = `CASE
		WHEN COALESCE(d.verification_status,'approved') IN ('suspended','rejected') THEN 'suspended'
		WHEN act.id IS NOT NULL THEN 'on_delivery'
		WHEN d.status = 'online' THEN 'available'
		WHEN d.status = 'on_trip' THEN 'on_delivery'
		ELSE 'offline'
	END`

// waitingMinutesSQL is how long an order has been waiting on a courier: since the
// kitchen marked it ready, or since it was placed when it has not. Computed in
// SQL because the `stalled` filter and its count need it BEFORE the page is cut.
const waitingMinutesSQL = `GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(o.ready_at, o.created_at))) / 60))::int`

// ── Rider roster ─────────────────────────────────────────────────────────────

// AdminRiderParams filters the roster. The zero value returns the most recently
// seen page of every rider.
type AdminRiderParams struct {
	Status  string // available|on_delivery|offline|suspended; "" = any
	Query   string // name or phone
	Vehicle string // bike|car|foot
	Sort    string // recent (default) | name | rating
	Limit   int
	Offset  int
}

func (p AdminRiderParams) normalized() AdminRiderParams {
	out := p
	out.Status = strings.ToLower(strings.TrimSpace(p.Status))
	out.Query = strings.TrimSpace(p.Query)
	out.Vehicle = strings.ToLower(strings.TrimSpace(p.Vehicle))
	// An unrecognised status is dropped rather than passed to SQL — a stale
	// client asking for a status that does not exist gets the whole roster, not
	// a confidently empty one. ValidateRiderStatus lets the handler 400 instead.
	if !isKnownRiderStatus(out.Status) {
		out.Status = ""
	}
	if out.Limit <= 0 || out.Limit > maxDispatchLimit {
		out.Limit = defaultDispatchLimit
	}
	if out.Offset < 0 {
		out.Offset = 0
	}
	switch out.Sort {
	case "name", "rating", "recent":
	default:
		out.Sort = "recent"
	}
	return out
}

// ValidateRiderStatus reports whether a caller-supplied rider status is real.
func ValidateRiderStatus(s string) bool {
	s = strings.ToLower(strings.TrimSpace(s))
	return s == "" || isKnownRiderStatus(s)
}

// AdminRiderPage is one page of the roster plus counts over the whole filtered
// set, so the board's tiles are not page-scoped.
type AdminRiderPage struct {
	Riders  []AdminRider `json:"riders"`
	Total   int          `json:"total"`
	Limit   int          `json:"limit"`
	Offset  int          `json:"offset"`
	HasMore bool         `json:"has_more"`
	// StatusCounts spans every rider status under the OTHER filters, so the
	// status tabs show what selecting them would yield. Absent statuses are 0.
	StatusCounts map[string]int `json:"status_counts"`
}

// riderRosterFrom is the FROM clause shared by the roster's page and count
// queries. `withCategories` applies the food-delivery service filter; the caller
// retries without it when `service_categories` is missing on old rows.
func riderRosterFrom(withCategories bool) string {
	q := `FROM drivers d
		LEFT JOIN LATERAL (
			SELECT o.id FROM orders o
			WHERE o.rider_id = d.user_id AND o.status NOT IN (` + terminalOrderStatusSQL() + `)
			ORDER BY o.created_at DESC LIMIT 1
		) act ON TRUE`
	if withCategories {
		q += `
		WHERE (ARRAY['ride_hailing','food_delivery','delivery'] && d.service_categories
		    OR d.service_categories IS NULL)`
	} else {
		q += `
		WHERE TRUE`
	}
	return q
}

// buildRiderRosterWhere renders the caller-supplied predicates. PURE (no DB);
// every caller value is a placeholder. includeStatus is false for the count
// query, which must span every status.
func buildRiderRosterWhere(p AdminRiderParams, includeStatus bool, startAt int) (string, []any) {
	var args []any
	ph := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(startAt+len(args)-1)
	}
	var b strings.Builder
	if includeStatus && p.Status != "" {
		b.WriteString(" AND " + riderStatusSQL + " = " + ph(p.Status))
	}
	if p.Vehicle != "" {
		b.WriteString(" AND lower(d.vehicle_type) = lower(" + ph(p.Vehicle) + ")")
	}
	if p.Query != "" {
		like := ph("%" + p.Query + "%")
		b.WriteString(" AND (d.name ILIKE " + like + " OR COALESCE(d.phone,'') ILIKE " + like + ")")
	}
	return b.String(), args
}

func riderRosterOrderBy(sort string) string {
	// Unique tiebreaker on every ordering, or rows tied on the sort column get
	// reshuffled between pages and the roster repeats some riders while hiding
	// others.
	switch sort {
	case "name":
		return " ORDER BY d.name ASC, d.user_id ASC"
	case "rating":
		return " ORDER BY d.rating DESC NULLS LAST, d.user_id ASC"
	default:
		return " ORDER BY d.updated_at DESC NULLS LAST, d.user_id DESC"
	}
}

// AdminListRidersPage returns one page of the rider roster.
func (s *Service) AdminListRidersPage(ctx context.Context, params AdminRiderParams) (*AdminRiderPage, error) {
	p := params.normalized()

	page, err := s.riderRoster(ctx, p, true)
	if err != nil {
		// service_categories may be absent on very old rows; retry without that
		// predicate rather than failing the board. Same builder, so the two paths
		// cannot drift — this used to be a second 30-line copy of the query.
		return s.riderRoster(ctx, p, false)
	}
	return page, nil
}

func (s *Service) riderRoster(ctx context.Context, p AdminRiderParams, withCategories bool) (*AdminRiderPage, error) {
	from := riderRosterFrom(withCategories)

	// Counts across every status, under the other filters.
	countWhere, countArgs := buildRiderRosterWhere(p, false, 1)
	counts := map[string]int{}
	for _, st := range riderStatuses {
		counts[st] = 0
	}
	rows, err := s.db.Query(ctx, `SELECT `+riderStatusSQL+` AS status, COUNT(*) `+from+countWhere+` GROUP BY 1`, countArgs...)
	if err != nil {
		return nil, err
	}
	total := 0
	for rows.Next() {
		var st string
		var n int
		if err := rows.Scan(&st, &n); err != nil {
			rows.Close()
			return nil, err
		}
		counts[st] = n
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if p.Status != "" {
		total = counts[p.Status]
	} else {
		for _, n := range counts {
			total += n
		}
	}

	where, args := buildRiderRosterWhere(p, true, 1)
	full := append([]any{}, args...)
	full = append(full, p.Limit, p.Offset)
	q := `SELECT d.user_id, d.name, d.phone, d.vehicle_type, ` + riderStatusSQL + ` AS status,
	             d.current_lat, d.current_lng, d.rating, d.updated_at, act.id ` +
		from + where + riderRosterOrderBy(p.Sort) +
		" LIMIT $" + strconv.Itoa(len(full)-1) + " OFFSET $" + strconv.Itoa(len(full))

	prows, err := s.db.Query(ctx, q, full...)
	if err != nil {
		return nil, err
	}
	defer prows.Close()
	out := []AdminRider{}
	for prows.Next() {
		var r AdminRider
		var rating *float64
		var updatedAt *time.Time
		if err := prows.Scan(&r.ID, &r.Name, &r.Phone, &r.Vehicle, &r.Status,
			&r.Lat, &r.Lng, &rating, &updatedAt, &r.ActiveOrderID); err != nil {
			return nil, err
		}
		r.Rating = rating
		r.LastSeenAt = updatedAt
		out = append(out, r)
	}
	if err := prows.Err(); err != nil {
		return nil, err
	}
	return &AdminRiderPage{
		Riders: out, Total: total, Limit: p.Limit, Offset: p.Offset,
		HasMore: p.Offset+len(out) < total, StatusCounts: counts,
	}, nil
}

// ── Dispatch queue ───────────────────────────────────────────────────────────

// dispatchStatuses mirrors the orders_dispatch_status_check CHECK constraint.
var dispatchStatuses = []string{"none", "searching", "assigned", "delivered"}

func isKnownDispatchStatus(s string) bool {
	for _, v := range dispatchStatuses {
		if v == s {
			return true
		}
	}
	return false
}

// ValidateDispatchStatus reports whether a caller-supplied dispatch status is real.
func ValidateDispatchStatus(s string) bool {
	s = strings.ToLower(strings.TrimSpace(s))
	return s == "" || isKnownDispatchStatus(s)
}

// AdminDispatchParams filters the queue.
type AdminDispatchParams struct {
	Dispatch     string // dispatch_status; "" = any
	Query        string // order id prefix, restaurant name, delivery address
	RestaurantID string
	StalledOnly  bool   // searching, and waiting past StalledAfterMinutes
	Sort         string // waiting (default) | newest | oldest
	Limit        int
	Offset       int
}

func (p AdminDispatchParams) normalized() AdminDispatchParams {
	out := p
	out.Dispatch = strings.ToLower(strings.TrimSpace(p.Dispatch))
	out.Query = strings.TrimSpace(p.Query)
	out.RestaurantID = strings.TrimSpace(p.RestaurantID)
	if !isKnownDispatchStatus(out.Dispatch) {
		out.Dispatch = ""
	}
	if out.Limit <= 0 || out.Limit > maxDispatchLimit {
		out.Limit = defaultDispatchLimit
	}
	if out.Offset < 0 {
		out.Offset = 0
	}
	switch out.Sort {
	case "newest", "oldest", "waiting":
	default:
		out.Sort = "waiting"
	}
	return out
}

// AdminDispatchPage is one page of the queue plus aggregates over the whole
// filtered set.
type AdminDispatchPage struct {
	Orders  []AdminDispatchOrder `json:"orders"`
	Total   int                  `json:"total"`
	Limit   int                  `json:"limit"`
	Offset  int                  `json:"offset"`
	HasMore bool                 `json:"has_more"`
	// DispatchCounts spans every dispatch_status under the OTHER filters.
	DispatchCounts map[string]int `json:"dispatch_counts"`
	// StalledTotal is the board's headline signal: still searching, past the
	// threshold. Counted over the whole filtered set, never just this page.
	StalledTotal        int `json:"stalled_total"`
	StalledAfterMinutes int `json:"stalled_after_minutes"`
}

// dispatchQueueFrom is the queue's population: OPEN orders that are awaiting or
// undergoing courier dispatch.
//
// The terminal exclusion is the shared set. It used to be a hardcoded
// ('delivered','cancelled') — written before the lifecycle gained rejected,
// dispatch_failed and delivery_failed — so a CLOSED order that had been
// searching or assigned when it died stayed on the board forever: 183 of 345
// rows, burying every order that still needed a courier.
const dispatchQueueFrom = `FROM orders o JOIN restaurants r ON r.id = o.restaurant_id`

func dispatchQueueBaseWhere() string {
	return ` WHERE o.status NOT IN (` + terminalOrderStatusSQL() + `)
		  AND (o.status IN ('ready','picked_up') OR o.dispatch_status IN ('searching','assigned'))`
}

// buildDispatchQueueWhere renders the caller-supplied predicates. PURE (no DB).
// includeDispatch is false for the aggregate query.
func buildDispatchQueueWhere(p AdminDispatchParams, includeDispatch bool, startAt int) (string, []any) {
	var args []any
	ph := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(startAt+len(args)-1)
	}
	var b strings.Builder
	if includeDispatch && p.Dispatch != "" {
		b.WriteString(" AND COALESCE(o.dispatch_status,'none') = " + ph(p.Dispatch))
	}
	if p.RestaurantID != "" {
		b.WriteString(" AND o.restaurant_id = " + ph(p.RestaurantID) + "::uuid")
	}
	if p.StalledOnly {
		// Stalled means auto-dispatch is RUNNING and getting nowhere. An assigned
		// order is not stalled however long it takes, and a closed one is already
		// excluded upstream.
		b.WriteString(" AND o.dispatch_status = 'searching' AND " + waitingMinutesSQL + " >= " + strconv.Itoa(StalledAfterMinutes))
	}
	if p.Query != "" {
		like := ph("%" + p.Query + "%")
		b.WriteString(" AND (o.id::text ILIKE " + like +
			" OR r.name ILIKE " + like +
			" OR o.delivery_address ILIKE " + like + ")")
	}
	return b.String(), args
}

func dispatchQueueOrderBy(sort string) string {
	switch sort {
	case "newest":
		return " ORDER BY o.created_at DESC, o.id DESC"
	case "oldest":
		return " ORDER BY o.created_at ASC, o.id ASC"
	default:
		// Longest-waiting first — a dispatch board is worked worst-first, not
		// newest-first.
		return " ORDER BY COALESCE(o.ready_at, o.created_at) ASC, o.id ASC"
	}
}

// AdminDispatchQueuePage returns one page of the dispatch queue.
func (s *Service) AdminDispatchQueuePage(ctx context.Context, params AdminDispatchParams) (*AdminDispatchPage, error) {
	p := params.normalized()
	base := dispatchQueueBaseWhere()

	// Aggregates across every dispatch_status, under the other filters.
	aggWhere, aggArgs := buildDispatchQueueWhere(p, false, 1)
	counts := map[string]int{}
	for _, st := range dispatchStatuses {
		counts[st] = 0
	}
	rows, err := s.db.Query(ctx,
		`SELECT COALESCE(o.dispatch_status,'none'), COUNT(*),
		        COUNT(*) FILTER (WHERE o.dispatch_status = 'searching' AND `+waitingMinutesSQL+` >= `+strconv.Itoa(StalledAfterMinutes)+`) `+
			dispatchQueueFrom+base+aggWhere+` GROUP BY 1`, aggArgs...)
	if err != nil {
		return nil, err
	}
	total, stalled := 0, 0
	for rows.Next() {
		var st string
		var n, st2 int
		if err := rows.Scan(&st, &n, &st2); err != nil {
			rows.Close()
			return nil, err
		}
		counts[st] = n
		stalled += st2
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if p.Dispatch != "" {
		total = counts[p.Dispatch]
	} else {
		for _, n := range counts {
			total += n
		}
	}

	where, args := buildDispatchQueueWhere(p, true, 1)
	full := append([]any{}, args...)
	full = append(full, p.Limit, p.Offset)
	q := `SELECT o.id, o.restaurant_id, r.name, o.status, o.rider_id,
	             (SELECT d.name FROM drivers d WHERE d.user_id = o.rider_id) AS rider_name,
	             o.delivery_address, o.total_kobo, o.delivery_kobo, o.ready_at, o.created_at,
	             COALESCE(o.dispatch_status,'none'), o.rider_candidate_id, o.dispatch_attempts,
	             o.first_offered_at, ` + waitingMinutesSQL + ` AS waiting_minutes ` +
		dispatchQueueFrom + base + where + dispatchQueueOrderBy(p.Sort) +
		" LIMIT $" + strconv.Itoa(len(full)-1) + " OFFSET $" + strconv.Itoa(len(full))

	prows, err := s.db.Query(ctx, q, full...)
	if err != nil {
		return nil, err
	}
	defer prows.Close()
	out := []AdminDispatchOrder{}
	for prows.Next() {
		var d AdminDispatchOrder
		if err := prows.Scan(&d.ID, &d.RestaurantID, &d.RestaurantName, &d.Status, &d.RiderID,
			&d.RiderName, &d.DeliveryAddr, &d.TotalKobo, &d.DeliveryFeeKobo, &d.ReadyAt, &d.CreatedAt,
			&d.DispatchStatus, &d.RiderCandidateID, &d.DispatchAttempts, &d.FirstOfferedAt,
			&d.WaitingMinutes); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	if err := prows.Err(); err != nil {
		return nil, err
	}
	return &AdminDispatchPage{
		Orders: out, Total: total, Limit: p.Limit, Offset: p.Offset,
		HasMore: p.Offset+len(out) < total, DispatchCounts: counts,
		StalledTotal: stalled, StalledAfterMinutes: StalledAfterMinutes,
	}, nil
}
