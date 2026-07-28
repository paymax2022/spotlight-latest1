package association

import (
	"context"
	"testing"
)

// RevenueSplit must always sum exactly to the input (no kobo lost to rounding)
// and must place the rounding remainder on the National line.
func TestRevenueSplitSumsExactly(t *testing.T) {
	cases := []int64{0, 1, 99, 100, 2_000_00, 1_500_001, 333_333, 20_000_00}
	for _, amount := range cases {
		split := RevenueSplit(amount)
		var total int64
		for _, l := range split {
			if l.AmountKobo < 0 {
				t.Fatalf("amount %d: negative split line %s = %d", amount, l.Label, l.AmountKobo)
			}
			total += l.AmountKobo
		}
		if total != amount {
			t.Fatalf("amount %d: split sums to %d, want %d", amount, total, amount)
		}
	}
}

func TestRevenueSplitProportions(t *testing.T) {
	// On a clean ₦20,000 (2,000,000 kobo): 50/30/15/5.
	split := RevenueSplit(2_000_000)
	want := map[string]int64{
		"National body": 1_000_000,
		"State chapter": 600_000,
		"Local chapter": 300_000,
		"Platform fee":  100_000,
	}
	for _, l := range split {
		if want[l.Label] != l.AmountKobo {
			t.Fatalf("%s = %d, want %d", l.Label, l.AmountKobo, want[l.Label])
		}
	}
}

// PayInvoice must fail closed when no Idempotency-Key is supplied (money rule).
func TestPayInvoiceRequiresIdempotencyKey(t *testing.T) {
	s := &Service{} // no DB needed: the guard returns before any DB access
	_, err := s.PayInvoice(context.Background(), "user-1", "inv-1", PayInvoiceRequest{Method: "WALLET"})
	if err != ErrIdempotencyRequired {
		t.Fatalf("expected ErrIdempotencyRequired, got %v", err)
	}
}
