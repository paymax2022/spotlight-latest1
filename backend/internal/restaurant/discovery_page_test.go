package restaurant

import (
	"strings"
	"testing"
)

func TestDiscoveryParamsNormalized(t *testing.T) {
	cases := []struct {
		name string
		in   DiscoveryParams
		want DiscoveryParams
	}{
		{"zero value takes the default page", DiscoveryParams{}, DiscoveryParams{Limit: defaultDiscoveryLimit, Sort: "newest"}},
		{"limit is capped", DiscoveryParams{Limit: 5000}, DiscoveryParams{Limit: defaultDiscoveryLimit, Sort: "newest"}},
		{"negative offset floors at 0", DiscoveryParams{Offset: -10}, DiscoveryParams{Limit: defaultDiscoveryLimit, Sort: "newest"}},
		{"unknown sort falls back to newest", DiscoveryParams{Sort: "price"}, DiscoveryParams{Limit: defaultDiscoveryLimit, Sort: "newest"}},
		{"cuisine 'all' means no filter", DiscoveryParams{Cuisine: "All"}, DiscoveryParams{Limit: defaultDiscoveryLimit, Sort: "newest"}},
		{"values are trimmed", DiscoveryParams{Query: "  jollof ", Cuisine: " local "}, DiscoveryParams{Query: "jollof", Cuisine: "local", Limit: defaultDiscoveryLimit, Sort: "newest"}},
		{"a valid page is preserved", DiscoveryParams{Limit: 40, Offset: 80, Sort: "rating"}, DiscoveryParams{Limit: 40, Offset: 80, Sort: "rating"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.in.normalized(); got != tc.want {
				t.Fatalf("normalized() = %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestBuildDiscoveryWhereFiltersAreParameterized(t *testing.T) {
	// A query carrying SQL must land in the args, never in the statement text.
	p := DiscoveryParams{Query: "'; DROP TABLE restaurants;--", Cuisine: "local"}.normalized()
	where, args := buildDiscoveryWhere(p, false)

	if strings.Contains(where, "DROP TABLE") {
		t.Fatalf("caller input was interpolated into SQL: %s", where)
	}
	if len(args) != 2 {
		t.Fatalf("args = %v, want cuisine + one shared LIKE placeholder", args)
	}
	if args[0] != "local" {
		t.Fatalf("args[0] = %v, want the cuisine", args[0])
	}
	if got, want := args[1], "%'; DROP TABLE restaurants;--%"; got != want {
		t.Fatalf("args[1] = %q, want %q", got, want)
	}
	if !strings.Contains(where, "lower(r.cuisine) = lower($1)") {
		t.Fatalf("cuisine filter missing/not case-insensitive: %s", where)
	}
}

func TestBuildDiscoveryWhereModerationGate(t *testing.T) {
	// With moderation OFF the predicate must stay byte-identical to the legacy
	// discovery query — the gate is felt by new shops, not by the estate.
	off, args := buildDiscoveryWhere(DiscoveryParams{}, false)
	if off != "WHERE r.is_open = TRUE" {
		t.Fatalf("moderation-off predicate = %q, want the legacy one", off)
	}
	if len(args) != 0 {
		t.Fatalf("unfiltered query should bind no args, got %v", args)
	}

	on, _ := buildDiscoveryWhere(DiscoveryParams{}, true)
	if !strings.Contains(on, "listing_review_status = 'APPROVED'") {
		t.Fatalf("moderation-on predicate missing the listing gate: %s", on)
	}
}

func TestDiscoveryOrderByAlwaysBreaksTies(t *testing.T) {
	// Every ordering must end in a UNIQUE column. Without one, rows tied on the
	// sort key can be returned in a different order per query, so paging repeats
	// some restaurants and never returns others.
	for _, sort := range []string{"", "newest", "rating", "name", "eta", "nonsense"} {
		got := discoveryOrderBy(sort)
		if !strings.HasSuffix(got, "r.id DESC") && !strings.HasSuffix(got, "r.id ASC") {
			t.Errorf("discoveryOrderBy(%q) = %q, want an id tiebreaker", sort, got)
		}
	}
}

// The Offers tile and the badge must agree by construction: filtering on a
// different predicate than the one projected is how a list of "restaurants with
// offers" ends up full of cards showing no offer.
func TestBuildDiscoveryWherePromoOnlyReusesTheProjection(t *testing.T) {
	none, _ := buildDiscoveryWhere(DiscoveryParams{}.normalized(), false)
	if strings.Contains(none, "restaurant_promos") {
		t.Fatalf("promo filter applied without PromoOnly: %s", none)
	}
	on, _ := buildDiscoveryWhere(DiscoveryParams{PromoOnly: true}.normalized(), false)
	if !strings.Contains(on, livePromoExists) {
		t.Fatalf("PromoOnly filter does not reuse livePromoExists: %s", on)
	}
	if !strings.Contains(discoveryColumns, livePromoExists) {
		t.Fatal("has_promo projection does not reuse livePromoExists")
	}
}
