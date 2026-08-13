package fx

import "testing"

// The markup is charged to real customers and recorded as realized revenue, so
// these pin the arithmetic and the production rule table rather than trusting
// them to stay right by inspection.

func TestMarkup_FeeMinor(t *testing.T) {
	cases := []struct {
		name           string
		markup         *Markup
		source, target string
		amountMinor    int64
		want           int64
	}{
		{"flat default", NewMarkup(105), "NGN", "USD", 100_000, 1_050},
		{"corridor override wins", DefaultMarkup(), "USD", "NGN", 100_000, 1_200},
		{"corridor match is case-insensitive", DefaultMarkup(), "usd", "ngn", 100_000, 1_200},
		{"unlisted corridor falls back to default", DefaultMarkup(), "GBP", "KES", 100_000, 1_050},
		{"zero bps means no fee", NewMarkup(0), "NGN", "USD", 100_000, 0},
		{"zero amount means no fee", DefaultMarkup(), "USD", "NGN", 0, 0},
		{"negative amount means no fee", DefaultMarkup(), "USD", "NGN", -5_000, 0},
		{"nil markup is safe", nil, "USD", "NGN", 100_000, 0},
		// 10 bps of 500,000 = 500 — the pinning used by the live-DB convert test.
		{"live-db test pinning", NewMarkup(10), "NGN", "USD", 500_000, 500},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.markup.FeeMinor(tc.source, tc.target, tc.amountMinor); got != tc.want {
				t.Errorf("FeeMinor(%s,%s,%d) = %d, want %d", tc.source, tc.target, tc.amountMinor, got, tc.want)
			}
		})
	}
}

// A fee is money, so fractional kobo must resolve deterministically and must not
// drift in Paymax's favour across a run of conversions. 105 bps of 5 is 0.0525
// (rounds down); the .5 ties below must go to even, not always up.
func TestMarkup_FeeMinorRoundsHalfEven(t *testing.T) {
	cases := []struct {
		bps         int
		amountMinor int64
		want        int64
	}{
		{105, 5, 0},        // 0.0525 -> 0
		{105, 100, 1},      // 1.05   -> 1
		{5000, 1, 0},       // 0.5    -> tie, 0 is even
		{5000, 3, 2},       // 1.5    -> tie, 2 is even
		{5000, 5, 2},       // 2.5    -> tie, 2 is even
		{5000, 7, 4},       // 3.5    -> tie, 4 is even
		{10_000, 250, 250}, // 100% passes through exactly
	}
	for _, tc := range cases {
		got := NewMarkup(tc.bps).FeeMinor("NGN", "USD", tc.amountMinor)
		if got != tc.want {
			t.Errorf("%d bps of %d = %d, want %d", tc.bps, tc.amountMinor, got, tc.want)
		}
	}
}

// A negative markup would pay the customer to convert, so it must never survive
// construction — neither as the default nor as a corridor override.
func TestMarkup_NegativeBPSRejected(t *testing.T) {
	if got := NewMarkup(-50).BPS("NGN", "USD"); got != 0 {
		t.Errorf("negative default BPS = %d, want clamped to 0", got)
	}
	m := NewMarkup(105, MarkupRule{Corridor: "USD-NGN", BPS: -10})
	if got := m.BPS("USD", "NGN"); got != 105 {
		t.Errorf("negative override BPS = %d, want the rule ignored (105)", got)
	}
}

// Guards the corridor table against a silent edit: these are the rates customers
// are charged.
func TestDefaultMarkup_ProductionTable(t *testing.T) {
	m := DefaultMarkup()
	cases := []struct {
		source, target string
		want           int
	}{
		{"USD", "NGN", 120},
		{"USD", "XAF", 150},
		{"NGN", "USD", defaultMarkupBPS},
		{"EUR", "GBP", defaultMarkupBPS},
	}
	for _, tc := range cases {
		if got := m.BPS(tc.source, tc.target); got != tc.want {
			t.Errorf("BPS(%s-%s) = %d, want %d", tc.source, tc.target, got, tc.want)
		}
	}
	if defaultMarkupBPS != 105 {
		t.Errorf("default markup drifted to %d bps; orchestration's SpreadEngine default is 105", defaultMarkupBPS)
	}
}
