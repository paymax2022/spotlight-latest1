package utilitybills

import (
	"encoding/json"
	"testing"
	"time"
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

// Owner rule (ADR-PR701): a card-paid bill that was paid for but not delivered
// opens a vend-retry window — a cron retries the vend and refunds the wallet 30
// minutes after it first failed — never an immediate credit.
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
		{"collect + spend, no vend: open the vend-retry window", moneyLegs{collectPosted: true, debitPosted: true}, true, actionStartVendRetry},
		{"collect + spend, flag since turned off: evidence still wins", moneyLegs{collectPosted: true, debitPosted: true}, false, actionStartVendRetry},
		{"flag on, writer died before the collect: open the vend-retry window", moneyLegs{}, true, actionStartVendRetry},
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

func TestVendRetryPatchMetadata(t *testing.T) {
	before := time.Now().UTC().Add(-time.Second)
	raw := vendRetryMetadata("stuck_recovery", "no provider fulfilment")
	var got struct {
		VendRetry struct {
			State         string `json:"state"`
			Basis         string `json:"basis"`
			Attempts      int    `json:"attempts"`
			FirstFailedAt string `json:"first_failed_at"`
			LastAttemptAt string `json:"last_attempt_at"`
			LastError     string `json:"last_error"`
		} `json:"vend_retry"`
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	v := got.VendRetry
	if v.State != "retrying" || v.Basis != "stuck_recovery" || v.Attempts != 0 || v.LastError != "no provider fulfilment" {
		t.Fatalf("metadata = %+v", got)
	}
	// The 30-minute clock starts here, so it must be a real, current RFC3339 time
	// — the TS worker fails closed (manual review) on an unreadable one.
	ts, err := time.Parse(time.RFC3339, v.FirstFailedAt)
	if err != nil || ts.Before(before) {
		t.Fatalf("first_failed_at = %q (%v) must be a current RFC3339 time", v.FirstFailedAt, err)
	}
	// A sweeper-opened window waits one gap before its first retry (a writer that
	// merely stalled can wake and vend first), so last_attempt_at starts at the same
	// instant — exactly as the TS buildVendRetryMeta does.
	if v.LastAttemptAt != v.FirstFailedAt {
		t.Fatalf("last_attempt_at = %q, want %q", v.LastAttemptAt, v.FirstFailedAt)
	}
}
