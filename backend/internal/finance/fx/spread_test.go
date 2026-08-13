package fx

import (
	"context"
	"errors"
	"testing"
)

// The markup is charged to real customers and recorded as realized revenue, so
// these pin the arithmetic, the percent<->bps conversion, and the guards rather
// than trusting them to stay right by inspection.

func TestMarkup_FeeMinor(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name           string
		markup         *Markup
		source, target string
		amountMinor    int64
		want           int64
	}{
		{"default is 1%", DefaultMarkup(), "NGN", "USD", 100_000, 1_000},
		{"flat rate", NewMarkup(105), "NGN", "USD", 100_000, 1_050},
		{"corridor override wins", NewMarkup(100, MarkupRule{Corridor: "USD-NGN", BPS: 250}), "USD", "NGN", 100_000, 2_500},
		{"corridor match is case-insensitive", NewMarkup(100, MarkupRule{Corridor: "usd-ngn", BPS: 250}), "USD", "ngn", 100_000, 2_500},
		{"unlisted corridor falls back", NewMarkup(100, MarkupRule{Corridor: "USD-NGN", BPS: 250}), "GBP", "KES", 100_000, 1_000},
		{"zero bps means no fee", NewMarkup(0), "NGN", "USD", 100_000, 0},
		{"zero amount means no fee", DefaultMarkup(), "USD", "NGN", 0, 0},
		{"negative amount means no fee", DefaultMarkup(), "USD", "NGN", -5_000, 0},
		{"nil markup is safe", nil, "USD", "NGN", 100_000, 0},
		// 10 bps of 500,000 = 500 — the pinning used by the live-DB convert test.
		{"live-db test pinning", NewMarkup(10), "NGN", "USD", 500_000, 500},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := tc.markup.FeeMinor(ctx, tc.source, tc.target, tc.amountMinor)
			if err != nil {
				t.Fatalf("FeeMinor: unexpected error %v", err)
			}
			if got != tc.want {
				t.Errorf("FeeMinor(%s,%s,%d) = %d, want %d", tc.source, tc.target, tc.amountMinor, got, tc.want)
			}
		})
	}
}

// A fee is money, so fractional kobo must resolve deterministically and must not
// drift in Paymax's favour across a run of conversions.
func TestFeeFromBPS_RoundsHalfEven(t *testing.T) {
	cases := []struct {
		bps         int
		amountMinor int64
		want        int64
	}{
		{100, 5, 0},        // 0.05 -> 0
		{100, 100, 1},      // 1.00 -> 1
		{5000, 1, 0},       // 0.5  -> tie, 0 is even
		{5000, 3, 2},       // 1.5  -> tie, 2 is even
		{5000, 5, 2},       // 2.5  -> tie, 2 is even
		{5000, 7, 4},       // 3.5  -> tie, 4 is even
		{10_000, 250, 250}, // 100% passes through exactly
		{0, 100_000, 0},    // no rate, no fee
		{-10, 100_000, 0},  // negative rate can never charge
	}
	for _, tc := range cases {
		if got := FeeFromBPS(tc.bps, tc.amountMinor); got != tc.want {
			t.Errorf("FeeFromBPS(%d, %d) = %d, want %d", tc.bps, tc.amountMinor, got, tc.want)
		}
	}
}

// Operators enter a percentage; the store keeps basis points. A float64
// round-trip of "1.15" yields 114.999…, so this must be exact.
func TestPercentToBPS(t *testing.T) {
	ok := []struct {
		percent string
		want    int
	}{
		{"1", 100}, // the seeded default
		{"1.0", 100},
		{"1%", 100},    // a trailing % is tolerated
		{" 1.5 ", 150}, // and surrounding space
		{"1.15", 115},  // the float-trap case
		{"0", 0},       // zero markup is legal
		{"0.01", 1},    // one basis point, the finest representable step
		{"10", 1000},   // the ceiling
		{"2.25", 225},
	}
	for _, tc := range ok {
		got, err := PercentToBPS(tc.percent)
		if err != nil {
			t.Errorf("PercentToBPS(%q): unexpected error %v", tc.percent, err)
			continue
		}
		if got != tc.want {
			t.Errorf("PercentToBPS(%q) = %d bps, want %d", tc.percent, got, tc.want)
		}
	}

	bad := []struct {
		percent string
		wantErr error
	}{
		{"0.001", ErrMarkupTooPrecise}, // finer than a basis point
		{"1.234", ErrMarkupTooPrecise},
		{"10.01", ErrMarkupOutOfRange}, // above the fat-finger ceiling
		{"100", ErrMarkupOutOfRange},   // the mistyped-1% case this guard exists for
		{"-1", ErrMarkupOutOfRange},    // would pay the customer to convert
		{"abc", nil},                   // unparseable
		{"", nil},                      // missing
	}
	for _, tc := range bad {
		got, err := PercentToBPS(tc.percent)
		if err == nil {
			t.Errorf("PercentToBPS(%q) = %d, want an error", tc.percent, got)
			continue
		}
		if tc.wantErr != nil && !errors.Is(err, tc.wantErr) {
			t.Errorf("PercentToBPS(%q) error = %v, want %v", tc.percent, err, tc.wantErr)
		}
	}
}

// Percent rendering is what an operator reads back after saving, so a wrong
// round-trip would show a rate different from the one being charged.
func TestBPSToPercent(t *testing.T) {
	cases := []struct {
		bps  int
		want string
	}{
		{100, "1"},
		{0, "0"},
		{150, "1.5"},
		{115, "1.15"},
		{1, "0.01"},
		{25, "0.25"},
		{1000, "10"},
	}
	for _, tc := range cases {
		if got := BPSToPercent(tc.bps); got != tc.want {
			t.Errorf("BPSToPercent(%d) = %q, want %q", tc.bps, got, tc.want)
		}
	}
}

// Round-trip: whatever an operator types must come back identically, or the
// console will show a different rate than the one saved.
func TestPercentBPSRoundTrip(t *testing.T) {
	for _, percent := range []string{"0", "0.01", "0.25", "1", "1.5", "1.15", "2.5", "10"} {
		bps, err := PercentToBPS(percent)
		if err != nil {
			t.Fatalf("PercentToBPS(%q): %v", percent, err)
		}
		if got := BPSToPercent(bps); got != percent {
			t.Errorf("round-trip %q -> %d bps -> %q", percent, bps, got)
		}
	}
}

// A negative markup would pay the customer to convert, so it must never survive
// construction — neither as the default nor as a corridor override.
func TestMarkup_NegativeBPSRejected(t *testing.T) {
	if got := NewMarkup(-50).BPS("NGN", "USD"); got != 0 {
		t.Errorf("negative default BPS = %d, want clamped to 0", got)
	}
	m := NewMarkup(100, MarkupRule{Corridor: "USD-NGN", BPS: -10})
	if got := m.BPS("USD", "NGN"); got != 100 {
		t.Errorf("negative override BPS = %d, want the rule ignored (100)", got)
	}
}

// Guards the shipped default and the ceiling: these are what customers are
// charged, and what the seed migration writes.
func TestMarkupConstants(t *testing.T) {
	if DefaultMarkupBPS != 100 {
		t.Errorf("default markup = %d bps, want 100 (1%%) — must match the fx_markup_rates seed", DefaultMarkupBPS)
	}
	if BPSToPercent(DefaultMarkupBPS) != "1" {
		t.Errorf("default markup renders as %q, want \"1\"", BPSToPercent(DefaultMarkupBPS))
	}
	if MaxMarkupBPS != 1000 {
		t.Errorf("markup ceiling = %d bps, want 1000 (10%%) — must match the fx_markup_rates CHECK", MaxMarkupBPS)
	}
}
