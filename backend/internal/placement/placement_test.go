package placement

import (
	"testing"
	"time"
)

// ─────────────────────────────────────────────────────────────────────────────
// State machine
// ─────────────────────────────────────────────────────────────────────────────

func TestCanTransition(t *testing.T) {
	cases := []struct {
		from, to State
		want     bool
	}{
		// Legal forward edges.
		{StateDraft, StateSubmitted, true},
		{StateSubmitted, StateUnderReview, true},
		{StateUnderReview, StateNeedsMoreInfo, true},
		{StateUnderReview, StateRejected, true},
		{StateUnderReview, StateScheduled, true},
		{StateUnderReview, StatePendingPayment, true},
		{StateNeedsMoreInfo, StateUnderReview, true},
		{StatePendingPayment, StateScheduled, true},
		{StatePendingPayment, StateCancelled, true},
		{StateScheduled, StateActive, true},
		{StateScheduled, StateCancelled, true},
		{StateActive, StatePaused, true},
		{StateActive, StateSuspended, true},
		{StateActive, StateCancelledEarly, true},
		{StateActive, StateCompleted, true},
		{StatePaused, StateActive, true},
		{StatePaused, StateSuspended, true},
		{StatePaused, StateCancelledEarly, true},

		// Illegal edges (fail-closed).
		{StateDraft, StateUnderReview, false},     // must go through SUBMITTED
		{StateDraft, StateActive, false},          // can't jump live
		{StateSubmitted, StateScheduled, false},   // must go through UNDER_REVIEW
		{StateUnderReview, StateActive, false},    // approval lands SCHEDULED/PENDING, not ACTIVE
		{StateScheduled, StateCompleted, false},   // must run first
		{StateScheduled, StatePaused, false},      // can't pause before active
		{StateActive, StateScheduled, false},      // no going back
		{StateCompleted, StateActive, false},      // terminal
		{StateRejected, StateUnderReview, false},  // terminal
		{StateCancelled, StateScheduled, false},   // terminal
		{StateCancelledEarly, StateActive, false}, // terminal
		{StateSuspended, StateActive, false},      // terminal
		{StatePaused, StateCompleted, false},      // completion is scheduler ACTIVE→COMPLETED only via expiry path
		{State("BOGUS"), StateActive, false},      // unknown from-state
	}
	for _, tc := range cases {
		if got := canTransition(tc.from, tc.to); got != tc.want {
			t.Errorf("canTransition(%s,%s)=%v want %v", tc.from, tc.to, got, tc.want)
		}
	}
}

func TestIsTerminal(t *testing.T) {
	terminal := []State{StateCompleted, StateRejected, StateCancelled, StateCancelledEarly, StateSuspended}
	for _, s := range terminal {
		if !s.IsTerminal() {
			t.Errorf("%s should be terminal", s)
		}
		if len(transitions[s]) != 0 {
			t.Errorf("terminal %s should have no outbound edges, got %v", s, transitions[s])
		}
	}
	nonTerminal := []State{StateDraft, StateSubmitted, StateUnderReview, StateNeedsMoreInfo, StatePendingPayment, StateScheduled, StateActive, StatePaused}
	for _, s := range nonTerminal {
		if s.IsTerminal() {
			t.Errorf("%s should not be terminal", s)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Duration discount mapping
// ─────────────────────────────────────────────────────────────────────────────

func TestDurationDiscountBps(t *testing.T) {
	cases := []struct {
		days int
		want int64
	}{
		{1, 0},
		{2, 0},
		{3, 500},
		{6, 500},
		{7, 1000},
		{13, 1000},
		{14, 1500},
		{29, 1500},
		{30, 2000},
		{45, 2000}, // anything ≥30 caps at 20%
	}
	for _, tc := range cases {
		if got := durationDiscountBps(tc.days); got != tc.want {
			t.Errorf("durationDiscountBps(%d)=%d want %d", tc.days, got, tc.want)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Pricing (integer kobo only)
// ─────────────────────────────────────────────────────────────────────────────

func TestQuotePriceKobo(t *testing.T) {
	const hero = 5000000 // ₦50,000/day in kobo (zone seed)

	cases := []struct {
		name string
		base int64
		days int
		mult float64
		want int64
	}{
		// 1 day, no discount, mult 1.0 → exactly base.
		{"1d_no_discount", hero, 1, 1.0, 5000000},
		// 3 days, 5% off, mult 1.0 → 15,000,000 * 0.95 = 14,250,000.
		{"3d_5pct", hero, 3, 1.0, 14250000},
		// 7 days, 10% off → 35,000,000 * 0.90 = 31,500,000.
		{"7d_10pct", hero, 7, 1.0, 31500000},
		// 14 days, 15% off → 70,000,000 * 0.85 = 59,500,000.
		{"14d_15pct", hero, 14, 1.0, 59500000},
		// 30 days, 20% off → 150,000,000 * 0.80 = 120,000,000.
		{"30d_20pct", hero, 30, 1.0, 120000000},
		// tier multiplier 1.5 on 1 day → 7,500,000.
		{"1d_mult_1.5", hero, 1, 1.5, 7500000},
		// rounding check: a base that does not divide evenly under discount.
		// base=333, 3 days → gross 999, *0.95 = 949.05 → half-up 949.
		{"rounding_half_up", 333, 3, 1.0, 949},
		// tier multiplier thousandths rounding: 100 * 1 day * 1.005 = 100.5 → 101 (half-up).
		{"mult_thousandths_round", 100, 1, 1.005, 101},
		// zero/negative guards.
		{"zero_days", hero, 0, 1.0, 0},
		{"zero_base", 0, 5, 1.0, 0},
	}
	for _, tc := range cases {
		got := quotePriceKobo(tc.base, tc.days, tc.mult)
		if got != tc.want {
			t.Errorf("%s: quotePriceKobo(%d,%d,%v)=%d want %d", tc.name, tc.base, tc.days, tc.mult, got, tc.want)
		}
	}
}

func TestHalfUpDiv(t *testing.T) {
	cases := []struct{ n, d, want int64 }{
		{10, 4, 3}, // 2.5 → 3 (half-up)
		{9, 4, 2},  // 2.25 → 2
		{11, 4, 3}, // 2.75 → 3
		{100, 1, 100},
		{5, 0, 0}, // divide-by-zero guard
	}
	for _, tc := range cases {
		if got := halfUpDiv(tc.n, tc.d); got != tc.want {
			t.Errorf("halfUpDiv(%d,%d)=%d want %d", tc.n, tc.d, got, tc.want)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Pro-rata earned / refund split
// ─────────────────────────────────────────────────────────────────────────────

func TestProRataSplit(t *testing.T) {
	cases := []struct {
		name                   string
		quoted                 int64
		elapsed, duration      int
		wantEarned, wantRefund int64
	}{
		// 0 elapsed → nothing earned, full refund.
		{"zero_elapsed", 100000, 0, 10, 0, 100000},
		// full elapsed → fully earned, nothing refunded.
		{"full_elapsed", 100000, 10, 10, 100000, 0},
		// mid: 4/10 of 100000 = 40000 earned, 60000 refund.
		{"mid", 100000, 4, 10, 40000, 60000},
		// over-elapsed clamps to duration (fully earned).
		{"over_elapsed_clamp", 100000, 99, 10, 100000, 0},
		// negative elapsed clamps to 0.
		{"negative_elapsed", 100000, -5, 10, 0, 100000},
		// integer truncation: 7/3 of 100 = 233 earned (700/3=233.33→233), 67 refund. Always sums to quoted.
		{"truncation_sums", 100, 1, 3, 33, 67},
		// zero duration guard → no earn, full refund.
		{"zero_duration", 100000, 5, 0, 0, 100000},
	}
	for _, tc := range cases {
		earned, refund := proRataSplit(tc.quoted, tc.elapsed, tc.duration)
		if earned != tc.wantEarned || refund != tc.wantRefund {
			t.Errorf("%s: proRataSplit(%d,%d,%d)=(%d,%d) want (%d,%d)", tc.name, tc.quoted, tc.elapsed, tc.duration, earned, refund, tc.wantEarned, tc.wantRefund)
		}
		// Invariant: earned + refund == quoted (no money created/destroyed by rounding).
		if tc.quoted > 0 && earned+refund != tc.quoted {
			t.Errorf("%s: earned+refund=%d != quoted=%d", tc.name, earned+refund, tc.quoted)
		}
	}
}

func TestElapsedDaysUTC(t *testing.T) {
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		name     string
		now      time.Time
		duration int
		want     int
	}{
		{"before_start", start.Add(-time.Hour), 10, 0},
		{"same_instant", start, 10, 0},
		{"half_day", start.Add(12 * time.Hour), 10, 0},
		{"one_full_day", start.Add(24 * time.Hour), 10, 1},
		{"three_and_half_days", start.Add(84 * time.Hour), 10, 3},
		{"past_duration_clamps", start.Add(100 * 24 * time.Hour), 10, 10},
	}
	for _, tc := range cases {
		if got := elapsedDaysUTC(start, tc.now, tc.duration); got != tc.want {
			t.Errorf("%s: elapsedDaysUTC=%d want %d", tc.name, got, tc.want)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Rotation determinism (resolver)
// ─────────────────────────────────────────────────────────────────────────────

func mkCampaigns(ids ...string) []Campaign {
	out := make([]Campaign, 0, len(ids))
	for _, id := range ids {
		out = append(out, Campaign{ID: id, SubjectID: id})
	}
	return out
}

func ids(items []ServedItem) []string {
	out := make([]string, len(items))
	for i, it := range items {
		out[i] = it.CampaignID
	}
	return out
}

func TestRotationDeterminismBySession(t *testing.T) {
	zone := &Zone{Code: "SPOTLIGHT_CAROUSEL", LayoutType: LayoutPooled, Capacity: 8, TierMultiplier: 1.0}
	camps := mkCampaigns("a", "b", "c", "d")

	// Same session id → identical ordering across calls.
	first := ids(resolveZoneItems(zone, camps, "session-1"))
	second := ids(resolveZoneItems(zone, camps, "session-1"))
	if len(first) != len(camps) {
		t.Fatalf("expected %d items, got %d", len(camps), len(first))
	}
	for i := range first {
		if first[i] != second[i] {
			t.Fatalf("same session must be deterministic: %v vs %v", first, second)
		}
	}

	// Different sessions can rotate the leader (at least one of several differs).
	rotated := false
	for _, sess := range []string{"session-2", "session-3", "session-4", "session-5"} {
		other := ids(resolveZoneItems(zone, camps, sess))
		if other[0] != first[0] {
			rotated = true
			break
		}
	}
	if !rotated {
		t.Errorf("expected rotation to change the leader for some session; always led with %s", first[0])
	}

	// The rotated set is always a permutation of the same campaigns (no drops/dupes).
	seen := map[string]int{}
	for _, id := range first {
		seen[id]++
	}
	for _, c := range camps {
		if seen[c.ID] != 1 {
			t.Errorf("campaign %s appeared %d times, want exactly 1", c.ID, seen[c.ID])
		}
	}
}

func TestPooledCapacityCap(t *testing.T) {
	zone := &Zone{Code: "FEATURED_GRID", LayoutType: LayoutPooled, Capacity: 2, TierMultiplier: 1.0}
	camps := mkCampaigns("a", "b", "c", "d", "e")
	items := resolveZoneItems(zone, camps, "sess")
	if len(items) != 2 {
		t.Fatalf("pooled cap should limit to capacity=2, got %d", len(items))
	}
	for _, it := range items {
		if it.Label != "Featured" {
			t.Errorf("served item must be labeled Featured, got %q", it.Label)
		}
	}
}

func TestHeroFallbackNeverEmpty(t *testing.T) {
	zone := &Zone{Code: "HERO", Label: "Landing Hero", LayoutType: LayoutExclusive, Capacity: 1, TierMultiplier: 1.0}

	// No candidates → house fallback (single, marked house, never empty).
	empty := resolveZoneItems(zone, nil, "sess")
	if len(empty) != 1 || !empty[0].House {
		t.Fatalf("HERO with no candidates must return one house fallback, got %+v", empty)
	}
	if empty[0].Label != "Featured" {
		t.Errorf("house fallback must still be labeled Featured")
	}

	// One candidate → single served item (exclusive).
	one := resolveZoneItems(zone, mkCampaigns("hero1"), "sess")
	if len(one) != 1 || one[0].House {
		t.Fatalf("HERO with a candidate must return one real served item, got %+v", one)
	}
	if one[0].CampaignID != "hero1" {
		t.Errorf("HERO served wrong campaign: %s", one[0].CampaignID)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Creative validation
// ─────────────────────────────────────────────────────────────────────────────

func testZone() *Zone {
	return &Zone{
		Code: "HERO",
		CreativeSpec: map[string]any{
			"image_ratio":  "16:9",
			"headline_max": float64(48), // JSON numbers decode to float64
			"cta_options":  []any{"Shop now", "Learn more", "Book now", "View"},
		},
	}
}

func TestValidateCreative(t *testing.T) {
	banned := []string{"scam", "free money"}

	good := map[string]any{"image_ref": "r2://img/1.png", "headline": "Great deals today", "cta": "Shop now"}
	if err := validateCreative(testZone(), good, banned); err != nil {
		t.Errorf("valid creative rejected: %v", err)
	}

	cases := []struct {
		name     string
		creative map[string]any
	}{
		{"nil_creative", nil},
		{"missing_image", map[string]any{"headline": "Hi", "cta": "View"}},
		{"empty_image", map[string]any{"image_ref": "  ", "headline": "Hi", "cta": "View"}},
		{"missing_headline", map[string]any{"image_ref": "r2://x", "cta": "View"}},
		{"headline_too_long", map[string]any{"image_ref": "r2://x", "headline": longString(49), "cta": "View"}},
		{"banned_word", map[string]any{"image_ref": "r2://x", "headline": "Total scam offer", "cta": "View"}},
		{"banned_phrase_case_insensitive", map[string]any{"image_ref": "r2://x", "headline": "FREE MONEY now", "cta": "View"}},
		{"missing_cta", map[string]any{"image_ref": "r2://x", "headline": "Hi"}},
		{"cta_not_allowed", map[string]any{"image_ref": "r2://x", "headline": "Hi", "cta": "Click here"}},
	}
	for _, tc := range cases {
		if err := validateCreative(testZone(), tc.creative, banned); err == nil {
			t.Errorf("%s: expected validation error, got nil", tc.name)
		}
	}

	// Boundary: headline exactly at max is allowed.
	exact := map[string]any{"image_ref": "r2://x", "headline": longString(48), "cta": "View"}
	if err := validateCreative(testZone(), exact, banned); err != nil {
		t.Errorf("headline at exactly max should pass: %v", err)
	}
}

func longString(n int) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = 'x'
	}
	return string(b)
}
