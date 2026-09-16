package restaurant

import (
	"strconv"
	"strings"
	"testing"
)

// ── Rider roster ─────────────────────────────────────────────────────────────

func TestAdminRiderParamsNormalized(t *testing.T) {
	cases := []struct {
		name string
		in   AdminRiderParams
		want AdminRiderParams
	}{
		{"zero value takes the default page", AdminRiderParams{}, AdminRiderParams{Limit: defaultDispatchLimit, Sort: "recent"}},
		{"limit above the cap falls back to the default", AdminRiderParams{Limit: maxDispatchLimit + 1}, AdminRiderParams{Limit: defaultDispatchLimit, Sort: "recent"}},
		{"the cap itself is honoured", AdminRiderParams{Limit: maxDispatchLimit}, AdminRiderParams{Limit: maxDispatchLimit, Sort: "recent"}},
		{"negative offset floors at 0", AdminRiderParams{Offset: -5}, AdminRiderParams{Limit: defaultDispatchLimit, Sort: "recent"}},
		{"unknown sort falls back to recent", AdminRiderParams{Sort: "zone"}, AdminRiderParams{Limit: defaultDispatchLimit, Sort: "recent"}},
		{"status is lower-cased and trimmed", AdminRiderParams{Status: "  On_Delivery "}, AdminRiderParams{Status: "on_delivery", Limit: defaultDispatchLimit, Sort: "recent"}},
		{"an invented status is dropped, not passed to SQL", AdminRiderParams{Status: "busy"}, AdminRiderParams{Limit: defaultDispatchLimit, Sort: "recent"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.in.normalized(); got != tc.want {
				t.Fatalf("normalized() = %+v, want %+v", got, tc.want)
			}
		})
	}
}

// riderStatusSQL and mapRiderStatus are two spellings of one rule. They MUST
// agree: the roster pages and counts on the SQL answer while mapRiderStatus is
// the documented reference, and a divergence would page one population while
// reporting another. This is the guard the terminal-status set did not have
// before it drifted.
func TestRiderStatusSQLMatchesGo(t *testing.T) {
	// Every combination the CASE branches on.
	verifications := []string{"approved", "", "suspended", "rejected", "pending"}
	transports := []string{"online", "on_trip", "offline", "unknown"}
	for _, v := range verifications {
		for _, ts := range transports {
			for _, onDelivery := range []bool{false, true} {
				// NOTE the argument order: mapRiderStatus takes (transport,
				// verification), not (verification, transport). Getting it
				// backwards here made this test "fail" against correct SQL.
				want := mapRiderStatus(ts, v, onDelivery)
				got := evalRiderStatusSQL(v, ts, onDelivery)
				if got != want {
					t.Errorf("verification=%q transport=%q onDelivery=%v: SQL=%q mapRiderStatus=%q",
						v, ts, onDelivery, got, want)
				}
			}
		}
	}
}

// evalRiderStatusSQL mirrors riderStatusSQL's branch ORDER exactly, so the test
// above compares the SQL's semantics rather than re-deriving mapRiderStatus.
// Kept adjacent to the constant on purpose: if a branch is added to the SQL and
// not here, this helper stops matching and the test fails.
func evalRiderStatusSQL(verification, transport string, onDelivery bool) string {
	if verification == "" {
		verification = "approved" // COALESCE(d.verification_status,'approved')
	}
	switch verification {
	case "suspended", "rejected":
		return "suspended"
	}
	if onDelivery {
		return "on_delivery"
	}
	switch transport {
	case "online":
		return "available"
	case "on_trip":
		return "on_delivery"
	}
	return "offline"
}

// The SQL must actually contain the branches, in order — otherwise the helper
// above could pass while the constant says something else entirely.
func TestRiderStatusSQLShape(t *testing.T) {
	for _, frag := range []string{
		"COALESCE(d.verification_status,'approved') IN ('suspended','rejected')",
		"act.id IS NOT NULL",
		"d.status = 'online'",
		"d.status = 'on_trip'",
		"ELSE 'offline'",
	} {
		if !strings.Contains(riderStatusSQL, frag) {
			t.Errorf("riderStatusSQL missing %q:\n%s", frag, riderStatusSQL)
		}
	}
	// Suspension must be checked BEFORE on-delivery: a suspended rider holding an
	// order is suspended, not merely busy, and dispatch must not treat them as
	// working stock.
	if strings.Index(riderStatusSQL, "'suspended'") > strings.Index(riderStatusSQL, "act.id IS NOT NULL") {
		t.Error("riderStatusSQL checks on_delivery before suspension")
	}
}

func TestBuildRiderRosterWhereIsParameterized(t *testing.T) {
	p := AdminRiderParams{Query: "o'brien", Vehicle: "BIKE", Status: "available"}.normalized()
	where, args := buildRiderRosterWhere(p, true, 1)
	if strings.Contains(where, "o'brien") {
		t.Fatalf("search text interpolated into SQL: %s", where)
	}
	if len(args) != 3 || args[0] != "available" || args[1] != "bike" || args[2] != "%o'brien%" {
		t.Fatalf("args = %v, want [available bike %%o'brien%%]", args)
	}
}

// The count query spans every status, so the status tabs report what selecting
// them would yield rather than collapsing to the one already in effect.
func TestBuildRiderRosterWhereCountSpansEveryStatus(t *testing.T) {
	p := AdminRiderParams{Status: "available", Vehicle: "bike"}.normalized()
	where, args := buildRiderRosterWhere(p, false, 1)
	if strings.Contains(where, "'available'") || len(args) != 1 || args[0] != "bike" {
		t.Fatalf("count query still filters on status: %s / %v", where, args)
	}
	// Placeholders must renumber from the start index, or the surviving filter
	// binds to a parameter that is not there.
	if !strings.Contains(where, "$1") {
		t.Fatalf("count placeholders do not start at $1: %s", where)
	}
}

// startAt lets these predicates be appended after placeholders the caller has
// already bound. Off-by-one here binds a filter to the wrong value.
func TestBuildRiderRosterWhereRespectsStartAt(t *testing.T) {
	p := AdminRiderParams{Vehicle: "car"}.normalized()
	where, args := buildRiderRosterWhere(p, true, 5)
	if !strings.Contains(where, "$5") {
		t.Fatalf("startAt ignored: %s", where)
	}
	if len(args) != 1 {
		t.Fatalf("args = %v, want one", args)
	}
}

func TestRiderRosterOrderByAlwaysBreaksTies(t *testing.T) {
	for _, sort := range []string{"", "recent", "name", "rating", "nonsense"} {
		got := riderRosterOrderBy(sort)
		if !strings.HasSuffix(got, "d.user_id ASC") && !strings.HasSuffix(got, "d.user_id DESC") {
			t.Errorf("riderRosterOrderBy(%q) = %q, want a user_id tiebreaker", sort, got)
		}
	}
}

func TestRiderRosterFromAppliesTheCategoryFilterOnlyWhenAsked(t *testing.T) {
	with := riderRosterFrom(true)
	if !strings.Contains(with, "service_categories") {
		t.Fatalf("category filter missing: %s", with)
	}
	// The fallback path exists because service_categories may be absent on old
	// rows; it must widen the population, not narrow it differently.
	without := riderRosterFrom(false)
	if strings.Contains(without, "service_categories") {
		t.Fatalf("fallback still references service_categories: %s", without)
	}
	// Both must use the SHARED terminal set for "is this rider still carrying
	// something", or a rider whose last job failed is pinned on_delivery forever.
	for _, q := range []string{with, without} {
		if !strings.Contains(q, terminalOrderStatusSQL()) {
			t.Errorf("roster does not use the shared terminal set: %s", q)
		}
	}
}

// ── Dispatch queue ───────────────────────────────────────────────────────────

func TestAdminDispatchParamsNormalized(t *testing.T) {
	cases := []struct {
		name string
		in   AdminDispatchParams
		want AdminDispatchParams
	}{
		{"zero value sorts longest-waiting first", AdminDispatchParams{}, AdminDispatchParams{Limit: defaultDispatchLimit, Sort: "waiting"}},
		{"limit is capped", AdminDispatchParams{Limit: 10_000}, AdminDispatchParams{Limit: defaultDispatchLimit, Sort: "waiting"}},
		{"negative offset floors at 0", AdminDispatchParams{Offset: -1}, AdminDispatchParams{Limit: defaultDispatchLimit, Sort: "waiting"}},
		{"an invented dispatch status is dropped", AdminDispatchParams{Dispatch: "no_rider"}, AdminDispatchParams{Limit: defaultDispatchLimit, Sort: "waiting"}},
		{"dispatch status is lower-cased", AdminDispatchParams{Dispatch: "SEARCHING"}, AdminDispatchParams{Dispatch: "searching", Limit: defaultDispatchLimit, Sort: "waiting"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.in.normalized(); got != tc.want {
				t.Fatalf("normalized() = %+v, want %+v", got, tc.want)
			}
		})
	}
}

// The console spent two revisions filtering on statuses this column cannot hold.
func TestDispatchStatusVocabularyIsClosed(t *testing.T) {
	want := []string{"none", "searching", "assigned", "delivered"}
	if len(dispatchStatuses) != len(want) {
		t.Fatalf("dispatchStatuses = %v, want %v", dispatchStatuses, want)
	}
	for i, v := range want {
		if dispatchStatuses[i] != v {
			t.Fatalf("dispatchStatuses = %v, want %v", dispatchStatuses, want)
		}
	}
	for _, invented := range []string{"no_rider", "dispatch_failed", "stalled", "pending"} {
		if ValidateDispatchStatus(invented) {
			t.Errorf("%q accepted as a dispatch status", invented)
		}
	}
	if !ValidateDispatchStatus("") {
		t.Error("empty dispatch filter should be allowed (means: any)")
	}
}

// The queue's population must never include closed orders, whatever the caller
// filters on — an order whose sourcing already gave up needs a refund or a
// dispute, not a rider.
func TestDispatchQueueBaseWhereExcludesClosedOrders(t *testing.T) {
	base := dispatchQueueBaseWhere()
	if !strings.Contains(base, "o.status NOT IN ("+terminalOrderStatusSQL()+")") {
		t.Fatalf("queue does not use the shared terminal set: %s", base)
	}
	for _, st := range terminalOrderStatuses {
		if !strings.Contains(base, "'"+st+"'") {
			t.Errorf("terminal status %q missing from the queue predicate: %s", st, base)
		}
	}
}

func TestBuildDispatchQueueWhereIsParameterized(t *testing.T) {
	p := AdminDispatchParams{Query: "'; DROP TABLE orders;--", Dispatch: "searching"}.normalized()
	where, args := buildDispatchQueueWhere(p, true, 1)
	if strings.Contains(where, "DROP TABLE") {
		t.Fatalf("caller input interpolated into SQL: %s", where)
	}
	if len(args) != 2 || args[0] != "searching" {
		t.Fatalf("args = %v", args)
	}
}

func TestBuildDispatchQueueWhereAggregateSpansEveryStatus(t *testing.T) {
	p := AdminDispatchParams{Dispatch: "assigned", RestaurantID: "11111111-1111-4111-8111-111111111111"}.normalized()
	agg, args := buildDispatchQueueWhere(p, false, 1)
	if strings.Contains(agg, "dispatch_status') = ") || strings.Contains(agg, "'assigned'") {
		t.Fatalf("aggregate still filters on dispatch_status: %s", agg)
	}
	if len(args) != 1 {
		t.Fatalf("aggregate args = %v, want just the restaurant id", args)
	}
	if !strings.Contains(agg, "$1") {
		t.Fatalf("aggregate placeholders do not start at $1: %s", agg)
	}
}

// "Stalled" is auto-dispatch running and getting nowhere. An ASSIGNED order is
// not stalled however long it takes — a rider is already carrying it — so
// restricting to `searching` is what makes the tile actionable rather than noisy.
func TestBuildDispatchQueueWhereStalledOnlyMeansStillSearching(t *testing.T) {
	p := AdminDispatchParams{StalledOnly: true}.normalized()
	where, _ := buildDispatchQueueWhere(p, true, 1)
	if !strings.Contains(where, "o.dispatch_status = 'searching'") {
		t.Fatalf("stalled filter is not restricted to searching: %s", where)
	}
	if !strings.Contains(where, strconv.Itoa(StalledAfterMinutes)) {
		t.Fatalf("stalled filter does not use the shared threshold: %s", where)
	}
	if !strings.Contains(where, waitingMinutesSQL) {
		t.Fatalf("stalled filter does not use the shared waiting expression: %s", where)
	}
	off, _ := buildDispatchQueueWhere(AdminDispatchParams{}.normalized(), true, 1)
	if strings.Contains(off, "searching") {
		t.Fatalf("stalled predicate applied without the flag: %s", off)
	}
}

func TestDispatchQueueOrderByAlwaysBreaksTies(t *testing.T) {
	for _, sort := range []string{"", "waiting", "newest", "oldest", "nonsense"} {
		got := dispatchQueueOrderBy(sort)
		if !strings.HasSuffix(got, "o.id ASC") && !strings.HasSuffix(got, "o.id DESC") {
			t.Errorf("dispatchQueueOrderBy(%q) = %q, want an id tiebreaker", sort, got)
		}
	}
	// The default is worst-first: a dispatch board is worked by who has waited
	// longest, not by who ordered most recently.
	if !strings.Contains(dispatchQueueOrderBy(""), "ASC") {
		t.Errorf("default dispatch order is not longest-waiting-first: %s", dispatchQueueOrderBy(""))
	}
}
