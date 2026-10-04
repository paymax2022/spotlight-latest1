package association

import "testing"

// TestRevenueSplit pins the dues revenue split (National 50 / State 30 /
// Local 15 / Platform 5). The lines must always sum EXACTLY to the invoice
// amount — a rounding leak would silently create or destroy kobo between the
// member's ledger debit and the settlement credit.
func TestRevenueSplit(t *testing.T) {
	cases := []int64{1, 33, 100, 150_000, 999_999, 1_000_001, 7}
	for _, amount := range cases {
		lines := RevenueSplit(amount)
		var sum int64
		for _, l := range lines {
			if l.AmountKobo < 0 {
				t.Errorf("RevenueSplit(%d) line %q is negative (%d)", amount, l.Label, l.AmountKobo)
			}
			sum += l.AmountKobo
		}
		if sum != amount {
			t.Errorf("RevenueSplit(%d) sums to %d", amount, sum)
		}
	}
	// Exact percentages on a round number.
	lines := RevenueSplit(1_000_000)
	want := map[string]int64{
		"National body": 500_000,
		"State chapter": 300_000,
		"Local chapter": 150_000,
		"Platform fee":  50_000,
	}
	for _, l := range lines {
		if want[l.Label] != l.AmountKobo {
			t.Errorf("RevenueSplit(1000000) %q = %d; want %d", l.Label, l.AmountKobo, want[l.Label])
		}
	}
}
