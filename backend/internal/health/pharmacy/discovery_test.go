package healthpharmacy

// Unit tests for the pure discovery/rating logic that DiscoverPharmacies,
// SubmitReview, and UpsertPharmacyProfile depend on. The DB-backed query paths
// themselves need a live Postgres (none is wired into this sandbox — see
// CLAUDE.md "Test runner (backend): None configured"); these tests instead
// pin down every branch that does NOT require a database, so a regression in
// the routing/validation logic still fails fast in CI.

import (
	"strings"
	"testing"
)

func TestResolveSort(t *testing.T) {
	cases := []struct {
		name      string
		hasGeo    bool
		requested string
		want      PharmacySort
	}{
		{"distance requested with geo", true, "distance", SortDistance},
		{"distance requested without geo falls back to rating", false, "distance", SortRating},
		{"rating requested", true, "rating", SortRating},
		{"rating requested without geo", false, "rating", SortRating},
		{"name requested", true, "name", SortName},
		{"empty with geo defaults to distance", true, "", SortDistance},
		{"empty without geo defaults to rating", false, "", SortRating},
		{"unrecognised value without geo defaults to rating", false, "closest", SortRating},
		{"unrecognised value with geo defaults to distance", true, "bogus", SortDistance},
		{"case-insensitive and trims whitespace", true, "  RATING  ", SortRating},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := resolveSort(tc.hasGeo, tc.requested); got != tc.want {
				t.Fatalf("resolveSort(%v, %q) = %q, want %q", tc.hasGeo, tc.requested, got, tc.want)
			}
		})
	}
}

func TestDiscoveryRadius(t *testing.T) {
	cases := []struct {
		in   float64
		want float64
	}{
		{0, defaultDiscoveryRadiusM},
		{-5, defaultDiscoveryRadiusM},
		{1000, 1000},
		{50000, 50000},
	}
	for _, tc := range cases {
		if got := discoveryRadius(tc.in); got != tc.want {
			t.Fatalf("discoveryRadius(%v) = %v, want %v", tc.in, got, tc.want)
		}
	}
}

func TestValidRating(t *testing.T) {
	for r := -2; r <= 8; r++ {
		want := r >= 1 && r <= 5
		if got := validRating(r); got != want {
			t.Fatalf("validRating(%d) = %v, want %v", r, got, want)
		}
	}
}

func TestIsReviewable(t *testing.T) {
	cases := []struct {
		state OrderState
		want  bool
	}{
		{StateCreated, false},
		{StateRxPending, false},
		{StateConfirmed, false},
		{StateDispensed, false},
		{StateInDelivery, false},
		{StateReadyForPickup, false},
		{StateDelivered, true},
		{StateCollected, true},
		{StateClosed, true},
		{StateCancelled, false},
		{StateRefunded, false},
	}
	for _, tc := range cases {
		if got := isReviewable(tc.state); got != tc.want {
			t.Fatalf("isReviewable(%s) = %v, want %v", tc.state, got, tc.want)
		}
	}
}

func TestNormalizeReviewBody(t *testing.T) {
	cases := []struct {
		name     string
		in       string
		wantBody string
		wantOK   bool
	}{
		{"empty is fine", "", "", true},
		{"trims surrounding whitespace", "  great service  ", "great service", true},
		{"at the limit is accepted", strings.Repeat("a", maxReviewBodyLen), strings.Repeat("a", maxReviewBodyLen), true},
		{"one over the limit is rejected", strings.Repeat("a", maxReviewBodyLen+1), strings.Repeat("a", maxReviewBodyLen+1), false},
		{"limit is by rune not byte (multibyte within limit)", strings.Repeat("é", maxReviewBodyLen), strings.Repeat("é", maxReviewBodyLen), true},
		{"multibyte over the rune limit is rejected", strings.Repeat("é", maxReviewBodyLen+1), strings.Repeat("é", maxReviewBodyLen+1), false},
		{"whitespace-padded content counts only the trimmed runes", "  " + strings.Repeat("a", maxReviewBodyLen) + "  ", strings.Repeat("a", maxReviewBodyLen), true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotBody, gotOK := normalizeReviewBody(tc.in)
			if gotOK != tc.wantOK {
				t.Fatalf("normalizeReviewBody(len=%d) ok = %v, want %v", len(tc.in), gotOK, tc.wantOK)
			}
			if gotBody != tc.wantBody {
				t.Fatalf("normalizeReviewBody trimmed body mismatch (len got=%d want=%d)", len(gotBody), len(tc.wantBody))
			}
		})
	}
}
