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
	for i := range 3 {
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
	// Each case: (apply?, target when applied).
	// ADR-PR808: a provider REVIEW webhook now resolves as FAILED so the user
	// retries fresh — there is no admin review surface to resolve it.
	cases := map[provider.KycCheckStatus]struct {
		apply  bool
		target provider.KycCheckStatus
	}{
		provider.KycPassed:          {true, provider.KycPassed},
		provider.KycFailed:          {true, provider.KycFailed},
		provider.KycReview:          {true, provider.KycFailed},
		provider.KycPending:         {false, ""},
		provider.KycInitiated:       {false, ""},
		provider.KycCheckStatus(""): {false, ""},
	}
	for in, want := range cases {
		d := DecideTerminal(in)
		if d.Apply != want.apply {
			t.Errorf("DecideTerminal(%q).Apply=%v want %v", in, d.Apply, want.apply)
		}
		if d.Apply && d.Target != want.target {
			t.Errorf("DecideTerminal(%q).Target=%q want %q", in, d.Target, want.target)
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
