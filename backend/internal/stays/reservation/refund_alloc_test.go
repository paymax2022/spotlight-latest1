package reservation

// Unit pins for allocateCancelRefund — the source-of-funds split for a guest
// cancel refund. Money invariant under test: the refund draws the parked legs
// (provider_clearing + commission) PROPORTIONALLY so the commission share is
// reversed too, falls to still-escrowed money only for what never settled, and
// fails closed past everything the booking captured.

import "testing"

func TestAllocateCancelRefund(t *testing.T) {
	parked := parkedMoney{providerKobo: 950_000, feeKobo: 150_000, heldKobo: 0}
	cases := []struct {
		name              string
		refund            int64
		parked            parkedMoney
		wantProv, wantFee int64
		wantHeld          int64
		wantErr           bool
	}{
		{"full refund drains both settled legs exactly", 1_100_000, parked, 950_000, 150_000, 0, false},
		{"partial refund splits proportionally (commission share reversed)", 550_000, parked, 475_000, 75_000, 0, false},
		{"tiny refund still touches commission", 110_000, parked, 95_000, 15_000, 0, false},
		{"1-kobo refund goes to commission (floor on provider share)", 1, parked, 0, 1, 0, false},
		{"nothing settled → all from escrow", 1_100_000, parkedMoney{heldKobo: 1_100_000}, 0, 0, 1_100_000, false},
		{"mixed: settled legs cover part, escrow the rest",
			1_500_000, parkedMoney{providerKobo: 950_000, feeKobo: 150_000, heldKobo: 440_000},
			950_000, 150_000, 400_000, false},
		{"refund exceeds everything captured → refuse", 1_200_000, parked, 0, 0, 0, true},
		{"provider leg empty → all from commission", 150_000, parkedMoney{feeKobo: 150_000}, 0, 150_000, 0, false},
		{"zero refund", 0, parked, 0, 0, 0, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p, f, h, err := allocateCancelRefund(c.refund, c.parked)
			if c.wantErr {
				if err == nil {
					t.Fatalf("expected refusal, got provider=%d fee=%d held=%d", p, f, h)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if p != c.wantProv || f != c.wantFee || h != c.wantHeld {
				t.Fatalf("allocateCancelRefund(%d) = (%d,%d,%d), want (%d,%d,%d)",
					c.refund, p, f, h, c.wantProv, c.wantFee, c.wantHeld)
			}
			if p+f+h != c.refund {
				t.Fatalf("legs %d+%d+%d != refund %d — conservation broken", p, f, h, c.refund)
			}
			if p > c.parked.providerKobo || f > c.parked.feeKobo || h > c.parked.heldKobo {
				t.Fatalf("draw (%d,%d,%d) exceeds parked (%d,%d,%d) — pooled account overdrawn",
					p, f, h, c.parked.providerKobo, c.parked.feeKobo, c.parked.heldKobo)
			}
		})
	}
}
