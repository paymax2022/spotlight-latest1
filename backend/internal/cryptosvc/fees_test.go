package cryptosvc

import (
	"errors"
	"math"
	"testing"
)

func TestDefaultScheduleMatchesTheOwnersPricing(t *testing.T) {
	f := DefaultFeeSchedule()
	for asset, want := range map[string]int{"BTC": 75, "eth": 75, "USDT": 75, " usdc ": 75, "SOL": 100, "DOGE": 100} {
		got, err := f.Bps(asset)
		if err != nil || got != want {
			t.Errorf("%q = %d, %v; want %d", asset, got, err, want)
		}
	}
}

func TestOverrideForHigherVolatilityAssets(t *testing.T) {
	f := DefaultFeeSchedule()
	f.Overrides = map[string]int{"SHIB": 125, "PEPE": 150}
	for a, want := range map[string]int{"SHIB": 125, "PEPE": 150, "BTC": 75} {
		if got, _ := f.Bps(a); got != want {
			t.Errorf("%s = %d, want %d", a, got, want)
		}
	}
}

func TestScheduleFailsClosedAboveTheCeiling(t *testing.T) {
	f := DefaultFeeSchedule()
	f.Overrides = map[string]int{"SHIB": 151}
	if _, err := f.Bps("BTC"); !errors.Is(err, ErrFeeBps) {
		t.Fatalf("an invalid schedule priced a trade: %v", err)
	}
	f = DefaultFeeSchedule()
	f.OtherBps = -1
	if f.Validate() == nil {
		t.Fatal("negative markup accepted")
	}
	if _, err := DefaultFeeSchedule().Bps(""); err == nil {
		t.Fatal("blank asset priced")
	}
}

func TestFeeKoboFloorsAndSplitsExactly(t *testing.T) {
	cases := []struct {
		kobo int64
		bps  int
		want int64
	}{
		{1_000_000, 75, 7_500}, // 10,000 NGN -> 75 NGN
		{1_000_001, 75, 7_500}, // floor, not round
		{133, 75, 0},           // sub-kobo fee floors to zero
		{100, 0, 0},
		{50_000_000, 150, 750_000},
	}
	for _, c := range cases {
		got, err := FeeKobo(c.kobo, c.bps)
		if err != nil || got != c.want {
			t.Errorf("FeeKobo(%d,%d) = %d, %v; want %d", c.kobo, c.bps, got, err, c.want)
		}
		if got+(c.kobo-got) != c.kobo {
			t.Errorf("split not exact for %d", c.kobo)
		}
	}
}

func TestFeeKoboRejectsBadInput(t *testing.T) {
	for _, c := range []struct {
		kobo int64
		bps  int
	}{{0, 75}, {-5, 75}, {100, -1}, {100, 10_001}} {
		if _, err := FeeKobo(c.kobo, c.bps); err == nil {
			t.Errorf("accepted %+v", c)
		}
	}
	// No overflow at the int64 edge: decimal math, never a wrapped product.
	got, err := FeeKobo(math.MaxInt64, 150)
	if err != nil || got <= 0 || got > math.MaxInt64/50 {
		t.Fatalf("edge fee = %d, %v", got, err)
	}
}
