package utilitybills

import (
	"encoding/json"
	"testing"
)

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

// Owner rule (ADR-PR697 follow-up): a card-paid bill that was paid for but not
// delivered gets a refund REQUEST an admin approves — never an automatic credit.
// stuckPaystackAction is the sweeper's decision for a paystack row, keyed on the
// ledger evidence plus the card-ledger flag, so the Go plane agrees with the TS
// plane on every shape.
func TestStuckPaystackAction(t *testing.T) {
	cases := []struct {
		name   string
		legs   moneyLegs
		cardOn bool
		want   stuckPaystackAction
	}{
		{"collect only: funds already in the wallet", moneyLegs{collectPosted: true}, true, actionRetainFunds},
		{"collect only, flag off afterwards: still retained", moneyLegs{collectPosted: true}, false, actionRetainFunds},
		{"collect + spend, no vend: request a refund", moneyLegs{collectPosted: true, debitPosted: true}, true, actionRequestRefund},
		{"collect + spend, flag since turned off: evidence still wins", moneyLegs{collectPosted: true, debitPosted: true}, false, actionRequestRefund},
		{"flag on, writer died before the collect: request a refund", moneyLegs{}, true, actionRequestRefund},
		{"flag off, legacy row with no collect: automatic refund as before", moneyLegs{}, false, actionAutoRefund},
		{"flag off, legacy row, compensation not posted: automatic refund as before", moneyLegs{debitPosted: false}, false, actionAutoRefund},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := decideStuckPaystack(&c.legs, c.cardOn); got != c.want {
				t.Fatalf("decideStuckPaystack(%+v, cardOn=%v) = %v, want %v", c.legs, c.cardOn, got, c.want)
			}
		})
	}
}

func TestCardLedgerEnabledReadsTheSharedFlag(t *testing.T) {
	for _, v := range []string{"1", "true", "TRUE", " true "} {
		t.Setenv("FEATURE_UTILITY_CARD_LEDGER", v)
		if !cardLedgerEnabled() {
			t.Errorf("FEATURE_UTILITY_CARD_LEDGER=%q should enable", v)
		}
	}
	for _, v := range []string{"", "0", "false", "off", "yes"} {
		t.Setenv("FEATURE_UTILITY_CARD_LEDGER", v)
		if cardLedgerEnabled() {
			t.Errorf("FEATURE_UTILITY_CARD_LEDGER=%q should NOT enable", v)
		}
	}
}

func TestRefundRequestPatchMetadata(t *testing.T) {
	raw := refundRequestMetadata(500_000, "stuck_recovery")
	var got struct {
		RefundRequest struct {
			State      string `json:"state"`
			Basis      string `json:"basis"`
			AmountKobo int64  `json:"amount_kobo"`
		} `json:"refund_request"`
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if got.RefundRequest.State != "pending_admin" || got.RefundRequest.Basis != "stuck_recovery" || got.RefundRequest.AmountKobo != 500_000 {
		t.Fatalf("metadata = %+v", got)
	}
}
