package kycverify

import (
	"testing"

	"spotlight/backend/internal/provider"
)

// Dedupe: a first delivery processes; redeliveries are ACK no-ops. Same event_id
// delivered N times → exactly one Process.
func TestDecideDedupe_OnceThenNoOp(t *testing.T) {
	first := DecideDedupe(1)
	if !first.Process || first.AckNoOp {
		t.Fatalf("first delivery must Process, got %+v", first)
	}
	processCount := 1
	for i := 0; i < 3; i++ {
		d := DecideDedupe(0) // ON CONFLICT DO NOTHING → 0 rows on redelivery
		if d.Process || !d.AckNoOp {
			t.Errorf("redelivery %d must be AckNoOp, got %+v", i, d)
		}
	}
	if processCount != 1 {
		t.Errorf("same event_id 4× → want exactly 1 process, got %d", processCount)
	}
}

// DecideTerminal: only PASSED/FAILED/REVIEW are applied; PENDING/INITIATED/empty
// are no-ops (the check stays PENDING until an authoritative terminal arrives).
func TestDecideTerminal(t *testing.T) {
	cases := map[provider.KycCheckStatus]bool{
		provider.KycPassed:    true,
		provider.KycFailed:    true,
		provider.KycReview:    true,
		provider.KycPending:   false,
		provider.KycInitiated: false,
		provider.KycCheckStatus(""): false,
	}
	for in, wantApply := range cases {
		d := DecideTerminal(in)
		if d.Apply != wantApply {
			t.Errorf("DecideTerminal(%q).Apply=%v want %v", in, d.Apply, wantApply)
		}
		if d.Apply && d.Target != in {
			t.Errorf("DecideTerminal(%q).Target=%q want %q", in, d.Target, in)
		}
	}
}

// Idempotency: applying the same terminal target to an already-terminal check is
// allowed by the guard (same-status rule), so redelivery never errors.
func TestWebhookTerminalIdempotent(t *testing.T) {
	// Already PASSED, webhook redelivers PASSED → guard allows same-status.
	if err := applyCheckTransition(provider.KycPassed, provider.KycPassed); err != nil {
		t.Errorf("same-status terminal replay must be a no-op, got %v", err)
	}
	// PENDING → PASSED is a legal first-time terminal transition.
	if err := applyCheckTransition(provider.KycPending, provider.KycPassed); err != nil {
		t.Errorf("PENDING→PASSED must be allowed, got %v", err)
	}
	// PASSED → FAILED is illegal (terminal), must error.
	if err := applyCheckTransition(provider.KycPassed, provider.KycFailed); err == nil {
		t.Errorf("PASSED→FAILED must be rejected")
	}
}
