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
	lat, lng := 6.5244, 3.3792
	for _, tc := range []struct {
		sort     string
		lat, lng *float64
	}{
		{sort: ""}, {sort: "newest"}, {sort: "rating"}, {sort: "name"},
		{sort: "eta"}, {sort: "nonsense"},
		{sort: "distance"}, // no coords — falls back to eta
		{sort: "distance", lat: &lat, lng: &lng},
	} {
		got, _ := discoveryOrderBy(tc.sort, tc.lat, tc.lng, 1)
		if !strings.HasSuffix(got, "r.id DESC") && !strings.HasSuffix(got, "r.id ASC") {
			t.Errorf("discoveryOrderBy(%q, %v, %v) = %q, want an id tiebreaker", tc.sort, tc.lat, tc.lng, got)
		}
	}
}

func TestDiscoveryOrderByDistanceUsesRealCoordinates(t *testing.T) {
	lat, lng := 6.5244, 3.3792
	got, args := discoveryOrderBy("distance", &lat, &lng, 3)
	if !strings.Contains(got, "ST_Distance") {
		t.Fatalf("distance sort should compute a real distance, got %q", got)
	}
	if !strings.Contains(got, "$3") || !strings.Contains(got, "$4") {
		t.Fatalf("distance sort should place its params starting at nextParam=3, got %q", got)
	}
	if len(args) != 2 || args[0] != lat || args[1] != lng {
		t.Fatalf("distance sort args = %v, want [%v %v]", args, lat, lng)
	}

	// Without coordinates it must degrade to the eta proxy, not error or panic.
	fallback, fallbackArgs := discoveryOrderBy("distance", nil, nil, 1)
	if len(fallbackArgs) != 0 {
		t.Fatalf("distance sort with no coords should bind no extra args, got %v", fallbackArgs)
	}
	if !strings.Contains(fallback, "prep_time_minutes") {
		t.Fatalf("distance sort with no coords should fall back to the eta proxy, got %q", fallback)
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

// The Featured section and the badge/ranking must agree by construction, same
// reasoning as PromoOnly above: a "Featured" section filtered on a different
// predicate than the one that decides featuredFirstOrder and is_featured could
// show a restaurant the badge/ranking disagree is featured.
func TestBuildDiscoveryWhereFeaturedOnlyReusesTheProjection(t *testing.T) {
	none, _ := buildDiscoveryWhere(DiscoveryParams{}.normalized(), false)
	if strings.Contains(none, "featured_campaign") {
		t.Fatalf("featured filter applied without FeaturedOnly: %s", none)
	}
	on, _ := buildDiscoveryWhere(DiscoveryParams{FeaturedOnly: true}.normalized(), false)
	if !strings.Contains(on, restaurantIsFeatured) {
		t.Fatalf("FeaturedOnly filter does not reuse restaurantIsFeatured: %s", on)
	}
	if !strings.Contains(discoveryColumns, restaurantIsFeatured) {
		t.Fatal("is_featured projection does not reuse restaurantIsFeatured")
	}
	if !strings.Contains(featuredFirstOrder, restaurantIsFeatured) {
		t.Fatal("featuredFirstOrder does not reuse restaurantIsFeatured")
	}
}

// Price-range bounds must be parameterized (never interpolated) and must be
// independently optional — a caller who only sets a minimum must not also get
// an accidental upper bound, and vice versa.
func TestBuildDiscoveryWherePriceRangeIsParameterizedAndIndependent(t *testing.T) {
	none, args := buildDiscoveryWhere(DiscoveryParams{}.normalized(), false)
	if strings.Contains(none, "min_order_kobo") {
		t.Fatalf("price filter applied with neither bound set: %s", none)
	}
	if len(args) != 0 {
		t.Fatalf("no args expected with neither bound set, got %v", args)
	}

	min := int64(200000)
	minOnly, args := buildDiscoveryWhere(DiscoveryParams{MinPriceKobo: &min}.normalized(), false)
	if !strings.Contains(minOnly, "r.min_order_kobo >= $1") {
		t.Fatalf("min-only filter missing/malformed: %s", minOnly)
	}
	if strings.Contains(minOnly, "<=") {
		t.Fatalf("min-only filter should not also bound the max: %s", minOnly)
	}
	if len(args) != 1 || args[0] != min {
		t.Fatalf("args = %v, want [%v]", args, min)
	}

	max := int64(500000)
	both, args := buildDiscoveryWhere(DiscoveryParams{MinPriceKobo: &min, MaxPriceKobo: &max}.normalized(), false)
	if !strings.Contains(both, "r.min_order_kobo >= $1") || !strings.Contains(both, "r.min_order_kobo <= $2") {
		t.Fatalf("both-bounds filter missing/malformed: %s", both)
	}
	if len(args) != 2 || args[0] != min || args[1] != max {
		t.Fatalf("args = %v, want [%v %v]", args, min, max)
	}
}

// "likes" must order by the discoveryColumns like_count alias (a live
// COUNT(*), never a stored/denormalized counter) and must not itself consume
// a bound parameter — same contract distance/featured are held to.
func TestDiscoveryOrderByLikesUsesTheProjectedAliasAndNoBoundParams(t *testing.T) {
	got, args := discoverySortTail("likes", nil, nil, 7)
	if !strings.Contains(got, "like_count DESC") {
		t.Fatalf("likes sort does not order by the like_count alias: %q", got)
	}
	if len(args) != 0 {
		t.Fatalf("likes sort should bind no args, got %v", args)
	}
	if strings.Contains(got, "$7") {
		t.Fatalf("likes sort should not consume a bound param: %q", got)
	}
	if !strings.Contains(discoveryColumns, "AS like_count") {
		t.Fatal("discoveryColumns does not project like_count under that alias")
	}
}
