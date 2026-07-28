package orchestration

import (
	"context"
	"math/big"
	"testing"
	"time"
)

// TS-1 CU-002 / TS-7 PR-001..PR-005 / TS-17 EC-007: per-currency precision.
// These are P0 money-correctness cases: the platform must respect each
// currency's ISO-4217 minor-unit exponent, not a hardcoded 2dp.

func TestMinorExponentPerCurrency(t *testing.T) {
	cases := map[string]int{
		"USD": 2, "EUR": 2, "GBP": 2, "NGN": 2, "GHS": 2, "KES": 2, "ZAR": 2,
		"XAF": 0, "JPY": 0, // 0-decimal
		"KWD": 3, "BHD": 3, // 3-decimal
		"BTC": 8, "ETH": 8, // 8-decimal crypto
	}
	for cur, want := range cases {
		if got := MinorExponent(cur); got != want {
			t.Errorf("MinorExponent(%s) = %d, want %d", cur, got, want)
		}
	}
	// Unknown currency defaults to 2 (safe fiat default).
	if got := MinorExponent("ZZZ"); got != 2 {
		t.Errorf("MinorExponent(unknown) = %d, want 2", got)
	}
}

// PR-001: converting USD (2dp) -> JPY (0dp) yields whole yen, no fractional unit.
func TestConvertUSDtoJPYZeroDecimal(t *testing.T) {
	// $100.00 = 10000 minor. Rate 157 JPY per USD -> ¥15,700 = 15700 minor (0dp).
	got := convertMinor(100_00, "USD", "JPY", 157.0)
	if got != 15700 {
		t.Fatalf("USD->JPY = %d, want 15700 (¥15,700 whole yen)", got)
	}
	// A rate producing a fractional yen must round to a whole yen (half-even).
	// $1.00 = 100 minor at 157.005 -> 157.005 yen -> 157 (nearest, .005*100=... )
	if got := convertMinor(1_00, "USD", "JPY", 157.4); got != 157 {
		t.Fatalf("USD->JPY fractional = %d, want 157", got)
	}
}

// PR-002: converting into a 3-decimal currency (KWD) keeps exactly 3dp.
func TestConvertUSDtoKWDThreeDecimal(t *testing.T) {
	// $100.00 = 10000 minor (2dp). Rate 0.307 KWD per USD -> 30.700 KWD.
	// KWD 3dp: 30.700 -> 30700 minor.
	got := convertMinor(100_00, "USD", "KWD", 0.307)
	if got != 30700 {
		t.Fatalf("USD->KWD = %d, want 30700 (30.700 KWD)", got)
	}
}

// PR-003: converting into 8-decimal crypto (BTC) keeps 8dp, no float drift.
func TestConvertUSDtoBTCEightDecimal(t *testing.T) {
	// $64,000.00 = 6400000 minor. Rate 1/64000 BTC per USD -> exactly 1.00000000 BTC.
	got := convertMinor(64_000_00, "USD", "BTC", 1.0/64000.0)
	if got != 100_000_000 { // 1 BTC in 8dp minor units
		t.Fatalf("USD->BTC = %d, want 100000000 (1.00000000 BTC)", got)
	}
}

// EC-007: zero-decimal <-> eight-decimal cross-precision round trips exactly at 1:1-ish.
func TestConvertJPYtoBTCCrossPrecision(t *testing.T) {
	// ¥15,700,000 (0dp = 15700000 minor) at 0.00000004 BTC/JPY -> 0.628 BTC.
	// 15700000 * 0.00000004 = 0.628 BTC -> 62800000 minor (8dp).
	got := convertMinor(15_700_000, "JPY", "BTC", 0.00000004)
	if got != 62_800_000 {
		t.Fatalf("JPY->BTC = %d, want 62800000 (0.628 BTC)", got)
	}
}

// PR-004: deterministic half-even (banker's) rounding at .5 boundaries.
func TestRoundHalfEvenBoundaries(t *testing.T) {
	cases := []struct {
		num, den int64
		want     int64
	}{
		{5, 2, 2},   // 2.5 -> 2 (even)
		{7, 2, 4},   // 3.5 -> 4 (even)
		{1, 2, 0},   // 0.5 -> 0 (even)
		{3, 2, 2},   // 1.5 -> 2 (even)
		{-5, 2, -2}, // -2.5 -> -2 (even)
		{-7, 2, -4}, // -3.5 -> -4 (even)
		{9, 4, 2},   // 2.25 -> 2
		{11, 4, 3},  // 2.75 -> 3
	}
	for _, c := range cases {
		r := new(big.Rat).SetFrac64(c.num, c.den)
		if got := roundRatHalfEven(r); got != c.want {
			t.Errorf("roundRatHalfEven(%d/%d) = %d, want %d", c.num, c.den, got, c.want)
		}
	}
}

// PR-005: money math on integer minor units (no lossy binary float): converting a
// large crypto amount is exact.
func TestConvertLargeAmountNoDrift(t *testing.T) {
	// 21,000,000 BTC (max supply) in 8dp = 2.1e15 minor. At 1.0 -> identical.
	const maxBTC = int64(21_000_000) * 100_000_000
	if got := convertMinor(maxBTC, "BTC", "BTC", 1.0); got != maxBTC {
		t.Fatalf("identity convert drifted: %d != %d", got, maxBTC)
	}
}

// PR-006: rounding residue reconciles across high volume — summed converted amounts
// equal the single bulk conversion within at most 1 minor unit per conversion, with
// no cumulative platform-favoring bias.
func TestRoundingResidueReconciles(t *testing.T) {
	const n = 100_000
	const per = 100_00 // $100 each
	rate := 157.37     // USD->JPY-ish, produces rounding at each step
	var summed int64
	for i := 0; i < n; i++ {
		summed += convertMinor(per, "USD", "JPY", rate)
	}
	bulk := convertMinor(int64(n)*per, "USD", "JPY", rate)
	// Per-conversion rounding cannot drift more than n/2 minor units either way,
	// and must not systematically favor the platform (i.e. |summed-bulk| bounded).
	diff := summed - bulk
	if diff < 0 {
		diff = -diff
	}
	if diff > n/2 {
		t.Fatalf("rounding residue too large: |%d - %d| = %d > %d", summed, bulk, diff, n/2)
	}
}

// PR-007: a round trip A->B->A loses only deterministic rounding (<= 1 minor unit
// per leg at the mid rate) — no unexplained value leak.
func TestRoundTripTolerance(t *testing.T) {
	const start = int64(1_000_00) // $1,000.00
	midUSDtoNGN := MidRate("USD", "NGN")
	midNGNtoUSD := MidRate("NGN", "USD")
	ngn := convertMinor(start, "USD", "NGN", midUSDtoNGN)
	back := convertMinor(ngn, "NGN", "USD", midNGNtoUSD)
	diff := back - start
	if diff < 0 {
		diff = -diff
	}
	// At the mid rate (no spread), the only loss is rounding on each leg.
	if diff > 2 {
		t.Fatalf("round-trip drift %d minor units exceeds rounding tolerance", diff)
	}
}

// EC-007 end-to-end: a quote+conversion into a 0-decimal currency credits whole
// units only and conserves value atomically.
func TestConvertIntoZeroDecimalEndToEnd(t *testing.T) {
	ctx := context.Background()
	clock := time.Now()
	svc, store := newTestService(&clock, false)
	cust := "cus_jpy"
	_ = svc.SeedBalance(ctx, cust, "USD", 1_000_000) // $10,000

	q, e := svc.CreateQuote(ctx, cust, "retail", QuoteRequest{Source: "USD", Destination: "JPY", Amount: 100_00, Intent: IntentConversion, Lock: true})
	if e != nil {
		t.Fatalf("quote: %v", e)
	}
	if q.Destination.Currency != "JPY" {
		t.Fatalf("dest currency = %s", q.Destination.Currency)
	}
	conv, e := svc.ExecuteConversion(ctx, cust, "idem-jpy", ConversionRequest{QuoteID: q.ID})
	if e != nil {
		t.Fatalf("convert: %v", e)
	}
	jpy, _ := store.Balance(ctx, cust, "JPY")
	if jpy != conv.Destination.AmountMinor {
		t.Fatalf("JPY balance %d != credited %d", jpy, conv.Destination.AmountMinor)
	}
	if jpy <= 0 {
		t.Fatalf("expected positive JPY credit, got %d", jpy)
	}
}
