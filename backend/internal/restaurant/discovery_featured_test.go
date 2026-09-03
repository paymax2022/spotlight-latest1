package restaurant

import (
	"strings"
	"testing"
)

// A restaurant owner who buys a RESTAURANT_TOP placement is paying to sit above
// other restaurants in food discovery. That promise has to hold on EVERY sort —
// an owner does not know, and cannot control, which tab a customer is looking
// at. If featured-first only applied to the default sort, the thing they paid
// for would silently not happen for most of the audience.
func TestDiscoveryOrderByPutsFeaturedFirstOnEverySort(t *testing.T) {
	lat, lng := 6.5244, 3.3792
	sorts := []struct {
		name     string
		lat, lng *float64
	}{
		{"rating", nil, nil},
		{"name", nil, nil},
		{"eta", nil, nil},
		{"likes", nil, nil},
		{"distance", &lat, &lng},
		{"unknown-sort", nil, nil}, // default branch
		{"", nil, nil},             // default
		{"nonsense", nil, nil},     // default
	}

	for _, tc := range sorts {
		got, _ := discoveryOrderBy(tc.name, tc.lat, tc.lng, 1)

		if !strings.Contains(got, "RESTAURANT_TOP") {
			t.Errorf("sort %q does not consider featured placement: %q", tc.name, got)
			continue
		}
		// Featured has to be the FIRST ordering term, otherwise rating or
		// distance decides the page and the paid slot is merely a tiebreak.
		after := strings.TrimPrefix(got, " ORDER BY ")
		first := strings.SplitN(after, ", ", 2)[0]
		if !strings.Contains(first, "RESTAURANT_TOP") {
			t.Errorf("sort %q ranks featured after another term; first term = %q", tc.name, first)
		}
		if !strings.Contains(first, "DESC") {
			t.Errorf("sort %q must order featured DESC (true first), got %q", tc.name, first)
		}
	}
}

// The ordering must only honour campaigns that are live RIGHT NOW. A paused,
// expired, cancelled or unpaid campaign must not buy position — that would be
// giving away the placement, and an expired one would never stop.
func TestDiscoveryOrderByFeaturedOnlyCountsLiveCampaigns(t *testing.T) {
	got, _ := discoveryOrderBy("rating", nil, nil, 1)

	// Mirrors placement.Repository.ServingCandidates, which is the authoritative
	// definition of "serving now". If that changes, this must change with it.
	for _, need := range []string{
		"'ACTIVE'",       // not DRAFT/PENDING_PAYMENT/PAUSED/CANCELLED
		"window_start",   // started
		"window_end",     // not finished
		"'restaurant'",   // subject type, so a promoted product cannot lift a restaurant
		"RESTAURANT_TOP", // this zone only, not a landing-page purchase
	} {
		if !strings.Contains(got, need) {
			t.Errorf("featured ordering is missing %s — it would serve campaigns it should not: %q", need, got)
		}
	}
}

// The featured term must not consume bound parameters: discoveryOrderBy's
// contract is that only a distance sort returns args, and the caller indexes
// LIMIT/OFFSET off len(whereArgs)+len(orderArgs). A stray placeholder here
// would shift those and corrupt every paged query.
func TestDiscoveryOrderByFeaturedAddsNoBoundParams(t *testing.T) {
	for _, s := range []string{"rating", "name", "eta", "likes", ""} {
		got, args := discoveryOrderBy(s, nil, nil, 7)
		if len(args) != 0 {
			t.Errorf("sort %q returned %d args, want 0", s, len(args))
		}
		if strings.Contains(got, "$7") || strings.Contains(got, "$8") {
			t.Errorf("sort %q consumed a bound param in the featured term: %q", s, got)
		}
	}

	// Distance still returns exactly its two coordinates, unshifted.
	lat, lng := 6.5244, 3.3792
	got, args := discoveryOrderBy("distance", &lat, &lng, 3)
	if len(args) != 2 || args[0] != lat || args[1] != lng {
		t.Fatalf("distance args = %v, want [%v %v]", args, lat, lng)
	}
	if !strings.Contains(got, "$3") || !strings.Contains(got, "$4") {
		t.Fatalf("distance params should still start at nextParam=3: %q", got)
	}
}

// Ties still break deterministically. Adding a leading term must not cost the
// id tiebreaker that stops a restaurant appearing on two pages while another
// never appears at all.
func TestDiscoveryOrderByStillBreaksTiesWithFeatured(t *testing.T) {
	for _, s := range []string{"rating", "name", "eta", "likes", ""} {
		got, _ := discoveryOrderBy(s, nil, nil, 1)
		if !strings.HasSuffix(got, "r.id DESC") && !strings.HasSuffix(got, "r.id ASC") {
			t.Errorf("sort %q lost its id tiebreaker: %q", s, got)
		}
	}
}
