package restaurant

import (
	"strings"
	"testing"
)

func TestAdminRestaurantParamsNormalized(t *testing.T) {
	cases := []struct {
		name string
		in   AdminRestaurantParams
		want AdminRestaurantParams
	}{
		{"zero value shows every restaurant", AdminRestaurantParams{}, AdminRestaurantParams{Status: "all", Limit: defaultAdminRestaurantLimit, Sort: "newest"}},
		{"unknown status widens to all", AdminRestaurantParams{Status: "suspended"}, AdminRestaurantParams{Status: "all", Limit: defaultAdminRestaurantLimit, Sort: "newest"}},
		{"status is case-insensitive", AdminRestaurantParams{Status: "Closed"}, AdminRestaurantParams{Status: "closed", Limit: defaultAdminRestaurantLimit, Sort: "newest"}},
		{"review status is upper-cased", AdminRestaurantParams{Review: "pending_review"}, AdminRestaurantParams{Status: "all", Review: "PENDING_REVIEW", Limit: defaultAdminRestaurantLimit, Sort: "newest"}},
		{"limit is capped", AdminRestaurantParams{Limit: 100000}, AdminRestaurantParams{Status: "all", Limit: defaultAdminRestaurantLimit, Sort: "newest"}},
		{"a valid page is preserved", AdminRestaurantParams{Status: "open", Sort: "name", Limit: 100, Offset: 200}, AdminRestaurantParams{Status: "open", Sort: "name", Limit: 100, Offset: 200}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.in.normalized(); got != tc.want {
				t.Fatalf("normalized() = %+v, want %+v", got, tc.want)
			}
		})
	}
}

// The register is the console's only view of restaurants that are NOT live. An
// is_open predicate leaking into the default would re-create the bug it exists
// to fix: 211 closed / unreviewed shops invisible to ops.
func TestBuildAdminRestaurantWhereDefaultHidesNothing(t *testing.T) {
	where, args := buildAdminRestaurantWhere(AdminRestaurantParams{}.normalized())
	if strings.Contains(where, "is_open") {
		t.Fatalf("default register filters on availability: %s", where)
	}
	if strings.Contains(where, "listing_review_status") {
		t.Fatalf("default register applies the moderation gate: %s", where)
	}
	if len(args) != 0 {
		t.Fatalf("unfiltered register should bind no args, got %v", args)
	}
}

func TestBuildAdminRestaurantWhereStatusFilter(t *testing.T) {
	open, _ := buildAdminRestaurantWhere(AdminRestaurantParams{Status: "open"}.normalized())
	if !strings.Contains(open, "r.is_open = TRUE") {
		t.Fatalf("status=open predicate = %s", open)
	}
	closed, _ := buildAdminRestaurantWhere(AdminRestaurantParams{Status: "closed"}.normalized())
	if !strings.Contains(closed, "r.is_open = FALSE") {
		t.Fatalf("status=closed predicate = %s", closed)
	}
}

func TestBuildAdminRestaurantWhereIsParameterized(t *testing.T) {
	p := AdminRestaurantParams{Query: "o'brien", Review: "pending_review"}.normalized()
	where, args := buildAdminRestaurantWhere(p)
	if strings.Contains(where, "o'brien") {
		t.Fatalf("search text was interpolated into SQL: %s", where)
	}
	if len(args) != 2 || args[0] != "PENDING_REVIEW" || args[1] != "%o'brien%" {
		t.Fatalf("args = %v, want [PENDING_REVIEW %%o'brien%%]", args)
	}
}

func TestAdminRestaurantOrderByAlwaysBreaksTies(t *testing.T) {
	for _, sort := range []string{"", "newest", "name", "rating", "updated", "nonsense"} {
		got := adminRestaurantOrderBy(sort)
		if !strings.HasSuffix(got, "r.id DESC") && !strings.HasSuffix(got, "r.id ASC") {
			t.Errorf("adminRestaurantOrderBy(%q) = %q, want an id tiebreaker", sort, got)
		}
	}
}
