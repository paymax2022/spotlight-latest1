package maplerad

// Pure webhook-pipeline + reconciliation decision logic (no DB, no network).
// The handler/service apply these decisions; keeping them pure makes the
// dedupe rule, dispatch routing, and drift policy independently unit-testable.

// EventKind classifies a parsed Maplerad webhook into the v1 dispatch buckets.
type EventKind string

const (
	EventVACredit        EventKind = "va_credit"         // inbound collection → ledger CREDIT
	EventTransferSuccess EventKind = "transfer_success"  // → state machine SUCCESS
	EventTransferFailed  EventKind = "transfer_failed"   // → state machine FAILED
	EventTransferReverse EventKind = "transfer_reversed" // → state machine REVERSED
	EventBillResult      EventKind = "bill_result"       // → bill resolution
	EventUnknown         EventKind = "unknown"           // stored + logged, never dropped
)

// ClassifyEvent maps a raw provider event-type string to an EventKind. Unknown
// types resolve to EventUnknown (the handler stores + logs them, never crashes).
func ClassifyEvent(eventType string) EventKind {
	switch eventType {
	case "collection.successful", "collection.success", "virtual_account.credit", "transfer.received":
		return EventVACredit
	case "transfer.successful", "transfer.success", "payout.successful":
		return EventTransferSuccess
	case "transfer.failed", "payout.failed":
		return EventTransferFailed
	case "transfer.reversed", "payout.reversed", "transfer.refunded":
		return EventTransferReverse
	case "bill.successful", "bill.failed", "bill.result", "bill.completed":
		return EventBillResult
	default:
		return EventUnknown
	}
}

// DedupeDecision is the pure outcome of the dedupe step. The handler INSERTs
// into webhook_event ON CONFLICT DO NOTHING; rowsInserted reports whether this
// delivery was new (1) or a redelivery (0).
type DedupeDecision struct {
	// Process is true only for a first-seen event (rowsInserted == 1).
	Process bool
	// AckNoOp is true for a redelivery — ACK 200 with no ledger effect.
	AckNoOp bool
}

// DecideDedupe turns the INSERT … ON CONFLICT row count into a process/ack
// decision. Exactly one delivery of a given (provider,event_id) processes;
// every redelivery is a benign ACK no-op.
func DecideDedupe(rowsInserted int64) DedupeDecision {
	if rowsInserted >= 1 {
		return DedupeDecision{Process: true}
	}
	return DedupeDecision{AckNoOp: true}
}

// ── Reconciliation drift policy ─────────────────────────────────────────────

// DriftDecision is the pure outcome of comparing an internal derived balance to
// the provider custody balance for one wallet.
type DriftDecision struct {
	// InSync is true when the two balances match (no drift, no alert).
	InSync bool
	// DiffKobo is provider − internal (signed). Quarantined as-is; never used to
	// auto-correct — resolution is always a human-reviewed compensating entry.
	DiffKobo int64
	// Quarantine is true when drift is detected and must be recorded + alerted.
	Quarantine bool
}

// DetectDrift compares internal (ledger-derived) vs provider (custody) balances.
// Equal → in sync, no alert. Any difference → quarantine + alert, NEVER an
// automatic correction. Pure + unit-tested.
func DetectDrift(internalKobo, providerKobo int64) DriftDecision {
	diff := providerKobo - internalKobo
	if diff == 0 {
		return DriftDecision{InSync: true}
	}
	return DriftDecision{DiffKobo: diff, Quarantine: true}
}
