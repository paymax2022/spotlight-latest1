package kycverify

import "spotlight/backend/internal/provider"

// Pure webhook-pipeline decision logic (no DB, no network). The webhook handler
// applies these decisions; keeping them pure makes the dedupe rule + terminal
// mapping independently unit-testable (mirrors maplerad/webhook_logic.go).

// DedupeDecision is the pure outcome of the dedupe step. The handler INSERTs into
// webhook_event ON CONFLICT (provider,event_id) DO NOTHING; rowsInserted reports
// whether this delivery was new (1) or a redelivery (0).
type DedupeDecision struct {
	// Process is true only for a first-seen event (rowsInserted == 1).
	Process bool
	// AckNoOp is true for a redelivery — ACK 200 with no domain effect.
	AckNoOp bool
}

// DecideDedupe turns the INSERT … ON CONFLICT row count into a process/ack
// decision. Exactly one delivery of a given (provider,event_id) processes; every
// redelivery is a benign ACK no-op (idempotent).
func DecideDedupe(rowsInserted int64) DedupeDecision {
	if rowsInserted >= 1 {
		return DedupeDecision{Process: true}
	}
	return DedupeDecision{AckNoOp: true}
}

// TerminalDecision is the pure outcome of mapping a normalized webhook status to
// a check transition target.
type TerminalDecision struct {
	// Apply is true when the webhook carries a terminal status to persist.
	Apply bool
	// Target is the terminal check status to transition to (valid iff Apply).
	Target provider.KycCheckStatus
}

// DecideTerminal maps a normalized webhook status onto a terminal transition. A
// still-pending status (PENDING/INITIATED/empty) is a no-op (Apply=false) — the
// check stays PENDING until an authoritative terminal event arrives. PASSED,
// FAILED and REVIEW are terminal-ish targets applied through the guard.
func DecideTerminal(status provider.KycCheckStatus) TerminalDecision {
	switch status {
	case provider.KycPassed, provider.KycFailed, provider.KycReview:
		return TerminalDecision{Apply: true, Target: status}
	default:
		return TerminalDecision{Apply: false}
	}
}
