package maplerad

import (
	"testing"

	"spotlight/backend/internal/provider"
)

// classifyWebhook is the service-level routing decision on a normalized
// provider.WebhookEvent. It must map the adapter's Type/Status onto the same
// EventKind buckets the pure ClassifyEvent vocabulary uses — kept DB/network free.
func TestClassifyWebhook(t *testing.T) {
	cases := []struct {
		name string
		ev   provider.WebhookEvent
		want EventKind
	}{
		{"collection credit", provider.WebhookEvent{Type: "collection", Status: "successful"}, EventVACredit},
		{"transfer success", provider.WebhookEvent{Type: "transfer", Status: "successful"}, EventTransferSuccess},
		{"transfer failed", provider.WebhookEvent{Type: "transfer", Status: "failed"}, EventTransferFailed},
		{"transfer reversed", provider.WebhookEvent{Type: "transfer", Status: "reversed"}, EventTransferReverse},
		{"bill result", provider.WebhookEvent{Type: "bill", Status: "successful"}, EventBillResult},
		{"transfer pending → no terminal route", provider.WebhookEvent{Type: "transfer", Status: "pending"}, EventUnknown},
		{"unknown type", provider.WebhookEvent{Type: "card", Status: "created"}, EventUnknown},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := classifyWebhook(&tc.ev); got != tc.want {
				t.Errorf("classifyWebhook(%+v)=%q want %q", tc.ev, got, tc.want)
			}
		})
	}
}

// boolToRows bridges the repo's "inserted?" bool to the row-count the pure
// DecideDedupe consumes: first delivery (true→1) processes, redelivery (false→0)
// is an ACK no-op. Exactly one process across N deliveries.
func TestBoolToRows_DedupeBridge(t *testing.T) {
	if got := boolToRows(true); got != 1 {
		t.Fatalf("boolToRows(true)=%d want 1", got)
	}
	if got := boolToRows(false); got != 0 {
		t.Fatalf("boolToRows(false)=%d want 0", got)
	}
	// First delivery processes; three redeliveries are no-ops → 1 process total.
	process := 0
	if DecideDedupe(boolToRows(true)).Process {
		process++
	}
	for i := 0; i < 3; i++ {
		if DecideDedupe(boolToRows(false)).Process {
			process++
		}
	}
	if process != 1 {
		t.Errorf("want exactly 1 process across 4 deliveries, got %d", process)
	}
}

// The hold→finalize ledger plan must net the user wallet by exactly -total on
// success (money left the building): hold debits -total, finalize touches only
// standing accounts. This guards the transfer state-machine → ledger legs that
// the service applies in applyTransition.
func TestTransferStateMachineLedgerNetEffect(t *testing.T) {
	const ref = "txr_1"
	const amount = 1_000_000
	fee := TransferFee(amount)
	total := amount + fee

	// INITIATED→PENDING posts the hold.
	holdNet := NetEffectKobo(PlanHold(ref, total))
	if holdNet != -total {
		t.Fatalf("hold net = %d, want %d", holdNet, -total)
	}
	// PENDING→SUCCESS finalizes (no further wallet movement).
	if n := NetEffectKobo(PlanFinalize(ref, amount, fee)); n != 0 {
		t.Fatalf("finalize wallet net = %d, want 0", n)
	}
	// Hold + finalize net = -total (debit settled out).
	if holdNet+NetEffectKobo(PlanFinalize(ref, amount, fee)) != -total {
		t.Fatalf("hold+finalize net != -total")
	}
	// PENDING→FAILED reverses the hold (restores +total) → overall net 0.
	if holdNet+NetEffectKobo(PlanReverseHold(ref, total)) != 0 {
		t.Fatalf("hold+reverse net != 0 (funds must return to wallet)")
	}
	// PENDING→REVERSED compensates a settled debit (restores +total).
	if NetEffectKobo(PlanCompensate(ref, total)) != total {
		t.Fatalf("compensate must restore +total to wallet")
	}
}

// Each transfer leg must carry a distinct idempotency key so a duplicate webhook
// is a benign ledger-unique-constraint no-op (orphan-sweep replay safety).
func TestTransferLegKeysDistinct(t *testing.T) {
	const ref = "txr_2"
	total := int64(200000)
	keys := map[string]bool{}
	add := func(legs []PlannedLeg) {
		for _, l := range legs {
			if keys[l.IdempotencyKey] {
				t.Fatalf("duplicate leg key %q", l.IdempotencyKey)
			}
			keys[l.IdempotencyKey] = true
		}
	}
	add(PlanHold(ref, total))
	add(PlanFinalize(ref, 195000, 5000))
	add(PlanReverseHold(ref, total))
	add(PlanCompensate(ref, total))
}
