package connectmonetization

import (
	"testing"
	"time"
)

func TestProratedRefundKobo(t *testing.T) {
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(0, 1, 0) // ~31 day period
	const price int64 = 310000    // 3,100.00 in kobo over 31 days

	cases := []struct {
		name string
		now  time.Time
		want int64 // exact or bound-checked below
	}{
		{"before start refunds full", start.Add(-time.Hour), price},
		{"at start refunds full", start, price},
		{"after expiry refunds nothing", end.Add(time.Hour), 0},
		{"at expiry refunds nothing", end, 0},
	}
	for _, c := range cases {
		if got := proratedRefundKobo(price, start, end, c.now); got != c.want {
			t.Errorf("%s: got %d want %d", c.name, got, c.want)
		}
	}

	// Midpoint (~half the period elapsed) refunds ~half, and never more than price.
	mid := start.Add(end.Sub(start) / 2)
	half := proratedRefundKobo(price, start, end, mid)
	if half <= 0 || half >= price {
		t.Errorf("midpoint refund %d should be strictly between 0 and %d", half, price)
	}
	// Monotonic: later cancellation refunds no more than earlier.
	earlier := proratedRefundKobo(price, start, end, start.Add(24*time.Hour))
	later := proratedRefundKobo(price, start, end, start.Add(20*24*time.Hour))
	if later > earlier {
		t.Errorf("refund not monotonic: later=%d > earlier=%d", later, earlier)
	}
	// Never over-refunds a fractional kobo (floored): full price only when full period remains.
	if proratedRefundKobo(price, start, end, mid) > price/2+1 {
		t.Errorf("midpoint over-refunded")
	}
	// Invalid inputs fail safe to 0.
	if proratedRefundKobo(0, start, end, mid) != 0 || proratedRefundKobo(price, end, start, mid) != 0 {
		t.Errorf("invalid inputs should refund 0")
	}
}
