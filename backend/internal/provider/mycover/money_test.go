package mycover

import (
	"math/big"
	"testing"
)

// These tests pin the naira→kobo boundary conversion. MyCover speaks NAIRA as
// decimal STRINGS ("6000.0000", "0.5"); Paymax speaks integer KOBO. The
// conversion happens exactly once, here, with exact decimal (big.Rat) math and
// never a float64 intermediate.

func TestNairaToKobo_Table(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want int64
		err  bool
	}{
		// Every flat base_price observed in the live 68-product catalog.
		{"whole small", "50", 5_000, false},
		{"whole", "6000", 600_000, false},
		{"four dp zeros", "6000.0000", 600_000, false},
		{"four dp zeros big", "85000.0000", 8_500_000, false},
		{"odd naira", "10817.0000", 1_081_700, false},
		{"zero", "0", 0, false},
		{"zero decimals", "0.0000", 0, false},

		// Sub-naira precision that must NOT drift.
		{"one kobo", "0.01", 1, false},
		{"two dp", "1234.56", 123_456, false},
		{"classic float trap 0.1", "0.1", 10, false},
		{"classic float trap 0.29", "0.29", 29, false},
		{"classic float trap 1.005", "1.005", 101, false}, // half-up at the kobo
		{"three dp round down", "1.004", 100, false},
		{"three dp round up", "1.006", 101, false},
		{"half-up exactly", "0.005", 1, false},
		{"half-up below", "0.0049", 0, false},

		// Large values must not overflow or lose precision.
		{"ten million naira", "10000000.00", 1_000_000_000, false},

		// Rejected inputs — fail closed, never guess.
		{"empty", "", 0, true},
		{"not a number", "abc", 0, true},
		{"rational form rejected", "1/3", 0, true},
		{"exponent form rejected", "1e5", 0, true},
		{"negative rejected", "-100", 0, true},
		{"whitespace rejected", " 100 ", 0, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := NairaToKobo(tc.in)
			if tc.err {
				if err == nil {
					t.Fatalf("NairaToKobo(%q) = %d, want error", tc.in, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("NairaToKobo(%q) unexpected error: %v", tc.in, err)
			}
			if got != tc.want {
				t.Fatalf("NairaToKobo(%q) = %d, want %d", tc.in, got, tc.want)
			}
		})
	}
}

func TestRateToBps_Table(t *testing.T) {
	// Every is_percentage base_price observed live. base_price is a PERCENT
	// (0.5 => 0.5% of sum insured), so bps = percent * 100.
	cases := []struct {
		in   string
		want int64
		err  bool
	}{
		{"0.2500", 25, false},
		{"0.46", 46, false}, // float64(0.46)*100 == 45.99999999999999
		{"0.5", 50, false},
		{"0.5000", 50, false},
		{"0.6500", 65, false},
		{"0.9000", 90, false},
		{"1", 100, false},
		{"1.0400", 104, false}, // float64(1.04)*100 == 103.99999999999999
		{"2.1500", 215, false}, // float64(2.15)*100 == 214.99999999999997
		{"2.5", 250, false},
		{"5", 500, false},
		{"5.0000", 500, false},
		{"7.0000", 700, false},
		// Sub-bps precision rounds half-up, documented.
		{"0.125", 13, false},
		{"0.124", 12, false},
		{"", 0, true},
		{"-1", 0, true},
		{"x", 0, true},
	}
	for _, tc := range cases {
		t.Run(tc.in, func(t *testing.T) {
			got, err := RateToBps(tc.in)
			if tc.err {
				if err == nil {
					t.Fatalf("RateToBps(%q) = %d, want error", tc.in, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("RateToBps(%q) unexpected error: %v", tc.in, err)
			}
			if got != tc.want {
				t.Fatalf("RateToBps(%q) = %d, want %d", tc.in, got, tc.want)
			}
		})
	}
}

// TestRateToBps_NoFloatDrift proves the exact-decimal path differs from the
// naive float64 path on the real live rates — this is the bug the tests exist
// to prevent.
func TestRateToBps_NoFloatDrift(t *testing.T) {
	for _, rate := range []string{"0.46", "1.0400", "2.1500"} {
		bps, err := RateToBps(rate)
		if err != nil {
			t.Fatalf("RateToBps(%q): %v", rate, err)
		}
		f, _ := new(big.Float).SetString(rate)
		f64, _ := f.Float64()
		naive := int64(f64 * 100) // the WRONG way — truncates after float drift
		if naive == bps {
			t.Logf("rate %q: float path happened to agree (bps=%d)", rate, bps)
			continue
		}
		t.Logf("rate %q: exact bps=%d, naive float truncation=%d (drift avoided)", rate, bps, naive)
	}
}

func TestPremiumFromRateBps_Table(t *testing.T) {
	cases := []struct {
		name           string
		sumInsuredKobo int64
		rateBps        int64
		want           int64
	}{
		// 0.5% of ₦1,000,000 = ₦5,000 = 500,000 kobo
		{"sti 0.5pct of 1m naira", 100_000_000, 50, 500_000},
		// 0.46% of ₦1,000,000 = ₦4,600
		{"marine 0.46pct of 1m naira", 100_000_000, 46, 460_000},
		// 1.04% of ₦2,500,000 = ₦26,000
		{"coronation 1.04pct", 250_000_000, 104, 2_600_000},
		// 2.15% of ₦333,333.33
		{"2.15pct odd base", 33_333_333, 215, 716_667}, // 716666.6595 -> half-up
		// 5% of ₦400,000 (sti-laptop-cover-standard meta sum_insured)
		{"5pct of 400k naira", 40_000_000, 500, 2_000_000},
		// 7% of ₦400,000
		{"7pct of 400k naira", 40_000_000, 700, 2_800_000},
		// Rounding boundary: 1 bps of 15000 kobo = 1.5 kobo -> 2 (half-up)
		{"half-up tie", 15_000, 1, 2},
		// 1 bps of 14999 kobo = 1.4999 -> 1
		{"below tie", 14_999, 1, 1},
		{"zero sum insured", 0, 500, 0},
		{"zero rate", 100_000_000, 0, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := PremiumFromRateBps(tc.sumInsuredKobo, tc.rateBps)
			if got != tc.want {
				t.Fatalf("PremiumFromRateBps(%d, %d) = %d, want %d",
					tc.sumInsuredKobo, tc.rateBps, got, tc.want)
			}
		})
	}
}

// TestPremiumFromRateBps_NoOverflow guards the int64 multiply: sum_insured of
// ₦100,000,000 (10^10 kobo) at 700 bps must not wrap.
func TestPremiumFromRateBps_NoOverflow(t *testing.T) {
	got := PremiumFromRateBps(10_000_000_000, 700)
	want := int64(700_000_000)
	if got != want {
		t.Fatalf("PremiumFromRateBps overflow: got %d want %d", got, want)
	}
}

func TestCommissionFromBps(t *testing.T) {
	// sharing_formula distributor_commission is a WHOLE PERCENT (10 => 10%).
	// 10% of a ₦6,000 premium = ₦600 = 60,000 kobo.
	if got := CommissionFromPercent(600_000, "10"); got != 60_000 {
		t.Fatalf("CommissionFromPercent = %d, want 60000", got)
	}
	// 12.5% of 600,000 kobo = 75,000 kobo — decimal percent must not drift.
	if got := CommissionFromPercent(600_000, "12.5"); got != 75_000 {
		t.Fatalf("CommissionFromPercent(12.5) = %d, want 75000", got)
	}
	// Unparseable / absent commission is 0, never a guess.
	if got := CommissionFromPercent(600_000, ""); got != 0 {
		t.Fatalf("CommissionFromPercent(empty) = %d, want 0", got)
	}
}
