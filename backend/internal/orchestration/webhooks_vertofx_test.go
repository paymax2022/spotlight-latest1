package orchestration

import (
	"context"
	"testing"
	"time"
)

func TestVertoFXEventMapping_AllVocabularies(t *testing.T) {
	cases := []struct {
		event, status, want string
	}{
		// Vocabulary 1: iban_to_wallet / remittance_complete / wallet_to_account
		{"iban_to_wallet", "", "collection.completed"},
		{"remittance_complete", "", "payout.completed"},
		{"wallet_to_account", "", "payout.requested"},
		// Vocabulary 2: funds.received / payment.* / fx.*
		{"funds.received", "", "collection.requested"},
		{"payment.requested", "", "payout.requested"},
		{"payment.processing", "", "payout.processing"},
		{"payment.completed", "", "payout.completed"},
		{"payment.failed", "", "payout.failed"},
		{"payment.cancelled", "", "payout.cancelled"},
		{"fx.executed", "", "fx.executed"},
		{"fx.failed", "", "fx.failed"},
		// Vocabulary 3: sub_account_approved / transaction_state_change / inbound_payment
		{"sub_account_approved", "", "account.approved"},
		{"transaction_state_change", "inward_remittance_pending", "payout.requested"},
		{"transaction_state_change", "confirmed", "payout.processing"},
		{"transaction_state_change", "inwardSettlementDone", "payout.processing"},
		{"transaction_state_change", "outwardSettlementDone", "payout.completed"},
		{"transaction_state_change", "outward_remittance_complete", "payout.completed"},
		{"transaction_state_change", "archived", "payout.failed"},
		{"transaction_state_change", "refunded", "payout.failed"},
		{"transaction_state_change", "held for review", "compliance.hold"},
		{"transaction_state_change", "weird_new_status", ""},
		{"inbound_payment", "requested", "collection.requested"},
		{"inbound_payment", "completed", "collection.completed"},
		{"inbound_payment", "returned", "collection.returned"},
		// already-normalized names pass through
		{"account.rejected", "", "account.rejected"},
		{"account.suspended", "", "account.suspended"},
		{"compliance.hold", "", "compliance.hold"},
		{"refund.completed", "", "refund.completed"},
		// unknown
		{"totally.unknown", "", ""},
		{"", "", ""},
	}
	for _, c := range cases {
		if got := NormalizeVertoEvent(c.event, c.status); got != c.want {
			t.Errorf("NormalizeVertoEvent(%q,%q) = %q, want %q", c.event, c.status, got, c.want)
		}
	}
}

func TestVertoFXWebhook_MonotonicTransferStates(t *testing.T) {
	ctx := context.Background()
	store := NewMemStore()
	svc := NewService([]Provider{stubProvider{name: "vertofx"}}, store, Options{Now: time.Now})
	_ = svc.SeedBalance(ctx, "cus_1", "USD", 100_00)
	mk := func(ref, pref string) {
		tr := &Transfer{ID: "t_" + ref, Reference: ref, CustomerID: "cus_1", Status: TransferQueued,
			Source: NewMoney(10_00, "USD"), ProviderRef: pref}
		if err := store.ApplyTransfer(ctx, tr, 10_00); err != nil {
			t.Fatal(err)
		}
	}
	mk("PMX-TR1", "verto-1")
	mk("PMX-TR2", "verto-2")
	send := func(body string) {
		t.Helper()
		if err := svc.HandleProviderEvent(ctx, "vertofx", []byte(body)); err != nil {
			t.Fatalf("handle: %v", err)
		}
	}
	status := func(ref string) TransferStatus {
		all, _ := store.AllTransfers(ctx)
		for _, tr := range all {
			if tr.Reference == ref {
				return tr.Status
			}
		}
		return ""
	}

	send(`{"id":"e1","event":"payment.processing","paymentId":"verto-1"}`)
	if got := status("PMX-TR1"); got != TransferProcessing {
		t.Fatalf("after processing = %s", got)
	}
	send(`{"id":"e2","event":"payment.completed","paymentId":"verto-1"}`)
	if got := status("PMX-TR1"); got != TransferPaid {
		t.Fatalf("after completed = %s", got)
	}
	// Out-of-order regressions and unknown names must not move a terminal state.
	send(`{"id":"e3","event":"payment.processing","paymentId":"verto-1"}`)
	send(`{"id":"e4","event":"payment.failed","paymentId":"verto-1"}`)
	send(`{"id":"e5","event":"some.unknown.event","paymentId":"verto-1"}`)
	if got := status("PMX-TR1"); got != TransferPaid {
		t.Fatalf("terminal state regressed to %s", got)
	}
	if bal, _ := store.Balance(ctx, "cus_1", "USD"); bal != 80_00 {
		t.Fatalf("paid transfer must not refund; balance = %d", bal)
	}

	// Unknown on a fresh transfer: no change.
	send(`{"id":"e6","event":"mystery","paymentId":"verto-2"}`)
	if got := status("PMX-TR2"); got != TransferQueued {
		t.Fatalf("unknown event changed state to %s", got)
	}
	// Compliance hold: no state change.
	send(`{"id":"e7","event":"compliance.hold","paymentId":"verto-2"}`)
	if got := status("PMX-TR2"); got != TransferQueued {
		t.Fatalf("compliance.hold changed state to %s", got)
	}
	// Failure refunds exactly once, even on redelivery.
	send(`{"id":"e8","event":"payment.failed","paymentId":"verto-2"}`)
	send(`{"id":"e8","event":"payment.failed","paymentId":"verto-2"}`)
	if got := status("PMX-TR2"); got != TransferFailed {
		t.Fatalf("after failed = %s", got)
	}
	if bal, _ := store.Balance(ctx, "cus_1", "USD"); bal != 90_00 {
		t.Fatalf("balance after refund = %d, want 9000", bal)
	}
}
