package restaurant

import (
	"strings"
	"testing"
)

func TestAdminOrderParamsNormalized(t *testing.T) {
	cases := []struct {
		name string
		in   AdminOrderParams
		want AdminOrderParams
	}{
		{"zero value takes the newest default page", AdminOrderParams{}, AdminOrderParams{Limit: defaultAdminOrderLimit, Sort: "newest"}},
		{"limit above the cap falls back to the default", AdminOrderParams{Limit: 5000}, AdminOrderParams{Limit: defaultAdminOrderLimit, Sort: "newest"}},
		{"the cap itself is honoured", AdminOrderParams{Limit: maxAdminOrderLimit}, AdminOrderParams{Limit: maxAdminOrderLimit, Sort: "newest"}},
		{"one past the cap is not", AdminOrderParams{Limit: maxAdminOrderLimit + 1}, AdminOrderParams{Limit: defaultAdminOrderLimit, Sort: "newest"}},
		{"negative offset floors at 0", AdminOrderParams{Offset: -10}, AdminOrderParams{Limit: defaultAdminOrderLimit, Sort: "newest"}},
		{"unknown sort falls back to newest", AdminOrderParams{Sort: "cheapest"}, AdminOrderParams{Limit: defaultAdminOrderLimit, Sort: "newest"}},
		{"status is lower-cased and trimmed", AdminOrderParams{Status: "  Picked_Up "}, AdminOrderParams{Status: "picked_up", Limit: defaultAdminOrderLimit, Sort: "newest"}},
		{"dispatch is lower-cased and trimmed", AdminOrderParams{Dispatch: " Searching "}, AdminOrderParams{Dispatch: "searching", Limit: defaultAdminOrderLimit, Sort: "newest"}},
		{"free-text and ids are trimmed but keep their case", AdminOrderParams{Query: "  Mama Put ", RestaurantID: " abc ", RiderID: " def "}, AdminOrderParams{Query: "Mama Put", RestaurantID: "abc", RiderID: "def", Limit: defaultAdminOrderLimit, Sort: "newest"}},
		{"a valid page is preserved verbatim", AdminOrderParams{Status: "delivered", Dispatch: "assigned", Sort: "total", Limit: 100, Offset: 200, Unassigned: true}, AdminOrderParams{Status: "delivered", Dispatch: "assigned", Sort: "total", Limit: 100, Offset: 200, Unassigned: true}},

		// The console shipped five statuses this column cannot hold. Dropping an
		// unknown one means a stale client gets the UNFILTERED feed — a visibly
		// wrong answer an operator will question — instead of a confidently empty
		// page that looks like "the platform has no orders".
		{"an invented status is dropped, not passed to SQL", AdminOrderParams{Status: "no_rider"}, AdminOrderParams{Limit: defaultAdminOrderLimit, Sort: "newest"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.in.normalized(); got != tc.want {
				t.Fatalf("normalized() = %+v, want %+v", got, tc.want)
			}
		})
	}
}

// AdminOrderStatuses is a mirror of the `orders_status_check` CHECK constraint.
// If the two drift, the console offers a filter chip the database can never
// satisfy (or hides a state orders really reach) — which is exactly the bug this
// constant exists to end. Assert the list literally so a drive-by edit here has
// to be a deliberate one.
func TestAdminOrderStatusesMatchTheCheckConstraint(t *testing.T) {
	want := []string{
		"pending", "confirmed", "preparing", "ready", "picked_up",
		"delivered", "cancelled", "rejected", "dispatch_failed", "delivery_failed",
	}
	if len(AdminOrderStatuses) != len(want) {
		t.Fatalf("AdminOrderStatuses = %v, want %v", AdminOrderStatuses, want)
	}
	for i := range want {
		if AdminOrderStatuses[i] != want[i] {
			t.Fatalf("AdminOrderStatuses = %v, want %v", AdminOrderStatuses, want)
		}
	}
}

// The five states the admin console invented. Every one of them was a filter
// chip that could never match a row, so an operator clicking it saw an empty
// board and concluded the platform was idle.
func TestInventedOrderStatusesAreNotValid(t *testing.T) {
	for _, s := range []string{"placed", "accepted", "assigned", "refunded", "no_rider"} {
		if isKnownOrderStatus(s) {
			t.Errorf("isKnownOrderStatus(%q) = true, but the orders.status column cannot hold it", s)
		}
		if ValidateStatus(s) {
			t.Errorf("ValidateStatus(%q) = true, want a 400 rather than a silently empty feed", s)
		}
	}
}

func TestValidateStatusForAdminOrders(t *testing.T) {
	// "" is the unfiltered feed and must stay valid — an operator who clears the
	// filter is not making a bad request.
	if !ValidateStatus("") {
		t.Fatal(`ValidateStatus("") = false, want the unfiltered feed to be allowed`)
	}
	for _, s := range AdminOrderStatuses {
		if !ValidateStatus(s) {
			t.Errorf("ValidateStatus(%q) = false, but it is a real order state", s)
		}
		// The handler validates the RAW query value, so it has to tolerate the
		// same casing/padding normalized() does; otherwise `?status=Delivered`
		// 400s on a filter the feed would have honoured.
		if !ValidateStatus(" " + strings.ToUpper(s) + " ") {
			t.Errorf("ValidateStatus(%q) rejected a padded/upper-cased real status", s)
		}
	}
}

// Every status must be classified as either still-in-flight or terminal.
// An unclassified state would silently accrue age forever (it is not terminal)
// while never counting toward "active" — a row that looks stuck on the board and
// is missing from the KPI tile at the same time.
func TestEveryOrderStatusIsEitherActiveOrTerminal(t *testing.T) {
	active := map[string]bool{}
	for _, s := range adminOrderActive {
		active[s] = true
		if terminalOrderStatus(s) {
			t.Errorf("%q is listed as active but also reports terminal", s)
		}
	}
	for _, s := range AdminOrderStatuses {
		if !active[s] && !terminalOrderStatus(s) {
			t.Errorf("status %q is neither active nor terminal — age and the active tile disagree about it", s)
		}
	}
	for _, s := range []string{"delivered", "cancelled", "rejected", "dispatch_failed", "delivery_failed"} {
		if !terminalOrderStatus(s) {
			t.Errorf("terminalOrderStatus(%q) = false, so a closed order keeps accruing age", s)
		}
	}
}

// The zero value is the whole platform: no predicate, no args. A stray filter
// here is how an admin feed silently becomes owner-scoped again.
func TestBuildAdminOrderWhereDefaultFiltersNothing(t *testing.T) {
	where, args := buildAdminOrderWhere(AdminOrderParams{}.normalized(), true)
	if where != "WHERE TRUE" {
		t.Fatalf("default predicate = %q, want the unfiltered feed", where)
	}
	if len(args) != 0 {
		t.Fatalf("unfiltered feed should bind no args, got %v", args)
	}
}

func TestBuildAdminOrderWhereIsParameterized(t *testing.T) {
	// Caller text must land in the args, never in the statement. The search box
	// is operator-typed and the feed reads every order on the platform, so an
	// interpolated query here is an injection against the whole orders table.
	p := AdminOrderParams{
		Query:        "'; DROP TABLE orders;--",
		Status:       "delivered",
		Dispatch:     "assigned",
		RestaurantID: "11111111-1111-1111-1111-111111111111",
		RiderID:      "22222222-2222-2222-2222-222222222222",
	}.normalized()
	where, args := buildAdminOrderWhere(p, true)

	if strings.Contains(where, "DROP TABLE") {
		t.Fatalf("caller input was interpolated into SQL: %s", where)
	}
	for _, v := range []string{"delivered", "assigned", p.RestaurantID, p.RiderID} {
		if strings.Contains(where, v) {
			t.Fatalf("value %q appears in the statement text instead of the args: %s", v, where)
		}
	}
	want := []any{
		"delivered",
		"assigned",
		"11111111-1111-1111-1111-111111111111",
		"22222222-2222-2222-2222-222222222222",
		"%'; DROP TABLE orders;--%",
	}
	if len(args) != len(want) {
		t.Fatalf("args = %v, want %v", args, want)
	}
	for i := range want {
		if args[i] != want[i] {
			t.Fatalf("args[%d] = %v, want %v", i, args[i], want[i])
		}
	}
	// The three search columns share ONE placeholder, so the numbering must not
	// run past the args actually appended.
	if strings.Contains(where, "$6") {
		t.Fatalf("placeholder numbering exceeds the bound args: %s", where)
	}
	// A partial order id has to match, so the uuid is cast before ILIKE.
	if !strings.Contains(where, "o.id::text ILIKE") {
		t.Fatalf("order-id search is not cast to text: %s", where)
	}
}

// includeStatus=false is the aggregate query. It must drop ONLY the status
// predicate: that is what lets every status tab show the count selecting it
// would yield, instead of every tab collapsing to the status already in effect.
// Losing the other filters instead would make the tabs count the whole platform.
func TestBuildAdminOrderWhereAggregateSpansEveryStatus(t *testing.T) {
	p := AdminOrderParams{
		Status:       "delivered",
		Dispatch:     "assigned",
		RestaurantID: "11111111-1111-1111-1111-111111111111",
		Query:        "jollof",
	}.normalized()

	withStatus, withArgs := buildAdminOrderWhere(p, true)
	if !strings.Contains(withStatus, "o.status = $") {
		t.Fatalf("page query lost its status predicate: %s", withStatus)
	}

	agg, aggArgs := buildAdminOrderWhere(p, false)
	if strings.Contains(agg, "o.status = $") {
		t.Fatalf("aggregate query still filters on status, so the tabs cannot show other counts: %s", agg)
	}
	if !strings.Contains(agg, "o.dispatch_status = $") || !strings.Contains(agg, "o.restaurant_id = $") || !strings.Contains(agg, "ILIKE") {
		t.Fatalf("aggregate query dropped the NON-status filters too: %s", agg)
	}
	if len(aggArgs) != len(withArgs)-1 {
		t.Fatalf("aggregate args = %v, want exactly the page args minus the status", aggArgs)
	}
	for _, a := range aggArgs {
		if a == "delivered" {
			t.Fatalf("status still bound to the aggregate query: %v", aggArgs)
		}
	}
	// Placeholders must be renumbered from $1 after the status is dropped —
	// carrying the page's numbering would bind dispatch to a missing $1.
	if !strings.Contains(agg, "$1") {
		t.Fatalf("aggregate placeholders do not start at $1: %s", agg)
	}
}

// "Unassigned" is a dispatch worklist, not a history query. A delivered order
// with a NULL rider_id (self-pickup, backfilled row) is nobody's problem; if it
// showed up here the queue would never drain and real stuck orders would be
// buried under closed ones.
func TestBuildAdminOrderWhereUnassignedExcludesTerminalOrders(t *testing.T) {
	where, args := buildAdminOrderWhere(AdminOrderParams{Unassigned: true}.normalized(), true)
	if !strings.Contains(where, "o.rider_id IS NULL") {
		t.Fatalf("unassigned filter missing the rider predicate: %s", where)
	}
	// Asserted against the SHARED definition, never a hardcoded copy: a second
	// spelling of "which statuses are closed" is precisely how the dispatch
	// board ended up with a stale two-value list.
	if !strings.Contains(where, "o.status NOT IN ("+terminalOrderStatusSQL()+")") {
		t.Fatalf("unassigned filter does not use the shared terminal set: %s", where)
	}
	for _, st := range terminalOrderStatuses {
		if !strings.Contains(where, "'"+st+"'") {
			t.Errorf("terminal status %q missing from the unassigned filter: %s", st, where)
		}
	}
	// The status list is a literal, not caller input — it must bind nothing.
	if len(args) != 0 {
		t.Fatalf("unassigned filter should bind no args, got %v", args)
	}

	off, _ := buildAdminOrderWhere(AdminOrderParams{}.normalized(), true)
	if strings.Contains(off, "rider_id IS NULL") {
		t.Fatalf("unassigned predicate applied without the flag: %s", off)
	}
}

func TestAdminOrderOrderByAlwaysBreaksTies(t *testing.T) {
	// Every ordering must end in a UNIQUE column. Without one, rows tied on the
	// sort key can be returned in a different order per query, so paging repeats
	// some orders and never returns others. Orders tie constantly — a busy
	// restaurant stamps many rows in the same second, and total_kobo repeats
	// across identical carts.
	for _, sort := range []string{"", "newest", "oldest", "total", "updated", "nonsense"} {
		got := adminOrderOrderBy(sort)
		if !strings.HasSuffix(got, "o.id DESC") && !strings.HasSuffix(got, "o.id ASC") {
			t.Errorf("adminOrderOrderBy(%q) = %q, want an id tiebreaker", sort, got)
		}
	}
}

func TestAdminOrderOrderByDirections(t *testing.T) {
	cases := map[string]string{
		"":        " ORDER BY o.created_at DESC, o.id DESC",
		"newest":  " ORDER BY o.created_at DESC, o.id DESC",
		"oldest":  " ORDER BY o.created_at ASC, o.id ASC",
		"total":   " ORDER BY o.total_kobo DESC, o.created_at DESC, o.id DESC",
		"updated": " ORDER BY o.updated_at DESC, o.id DESC",
		// An unknown sort must behave as the default rather than emit nothing:
		// an ORDER BY-less page is unstable even before ties are considered.
		"nonsense": " ORDER BY o.created_at DESC, o.id DESC",
	}
	for sort, want := range cases {
		if got := adminOrderOrderBy(sort); got != want {
			t.Errorf("adminOrderOrderBy(%q) = %q, want %q", sort, got, want)
		}
	}
	// "oldest" ascends on BOTH columns; a DESC tiebreaker on an ASC scan walks
	// the tied block backwards and can skip rows across a page boundary.
	if got := adminOrderOrderBy("oldest"); !strings.HasSuffix(got, "o.id ASC") {
		t.Fatalf("oldest tiebreaker disagrees with its sort direction: %q", got)
	}
}

// The sort vocabulary normalized() accepts and the one adminOrderOrderBy knows
// must be the same set, or a documented sort silently renders as "newest".
func TestAdminOrderSortVocabularyIsClosed(t *testing.T) {
	for _, sort := range []string{"newest", "oldest", "total", "updated"} {
		if got := (AdminOrderParams{Sort: sort}).normalized().Sort; got != sort {
			t.Errorf("normalized() rejected the documented sort %q (got %q)", sort, got)
		}
		if adminOrderOrderBy(sort) == adminOrderOrderBy("newest") && sort != "newest" {
			t.Errorf("sort %q is accepted but orders identically to newest", sort)
		}
	}
}

// The SQL and Go answers to "is this order finished?" must never disagree. They
// are used in different layers — the IN-list prunes rows, terminalOrderStatus()
// decides whether age_minutes keeps accruing — so a drift between them shows up
// as a row that is filtered out of one view while still ageing in another.
func TestTerminalStatusSQLAndGoAgree(t *testing.T) {
	sql := terminalOrderStatusSQL()
	for _, st := range AdminOrderStatuses {
		inSQL := strings.Contains(sql, "'"+st+"'")
		inGo := terminalOrderStatus(st)
		if inSQL != inGo {
			t.Errorf("status %q: in SQL list=%v, terminalOrderStatus=%v", st, inSQL, inGo)
		}
	}
	// And the set itself must be a subset of the real vocabulary — a typo here
	// would silently exclude nothing at all.
	for _, st := range terminalOrderStatuses {
		if !isKnownOrderStatus(st) {
			t.Errorf("terminal status %q is not a real order status", st)
		}
	}
}
