package utilitybills

import "testing"

// ADR-PR697: the TS plane may collect a card charge into the wallet
// (utility:<tx>:CARD_COLLECT) before the spend posts. A paystack row stuck in
// that collect-only state already has its money in the wallet; the stuck
// sweeper must converge it WITHOUT posting a PAYSTACK_REFUND (2x payout).
func TestRetainCollectedFunds(t *testing.T) {
	cases := []struct {
		name   string
		source string
		legs   moneyLegs
		want   bool
	}{
		{"paystack collect-only retains", paymentSourcePaystack, moneyLegs{collectPosted: true}, true},
		{"paystack collect+debit refunds normally", paymentSourcePaystack, moneyLegs{collectPosted: true, debitPosted: true}, false},
		{"paystack with no collect (legacy row) refunds as before", paymentSourcePaystack, moneyLegs{}, false},
		{"wallet source is never retained", paymentSourceWallet, moneyLegs{collectPosted: true}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := retainCollectedFunds(c.source, &c.legs); got != c.want {
				t.Fatalf("retainCollectedFunds(%q, %+v) = %v, want %v", c.source, c.legs, got, c.want)
			}
		})
	}
}
