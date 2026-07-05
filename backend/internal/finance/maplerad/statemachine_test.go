package maplerad

import "testing"

// ── Allowed forward transitions produce the correct ledger effect ───────────

func TestDecideTransition_AllowedForward(t *testing.T) {
	cases := []struct {
		from, to OpStatus
		effect   LedgerEffect
	}{
		{StatusInitiated, StatusPending, EffectHold},
		{StatusPending, StatusSuccess, EffectFinalize},
		{StatusPending, StatusFailed, EffectReverseHold},
		// Reversal before settlement undoes the still-held funds.
		{StatusPending, StatusReversed, EffectReverseHold},
		// Provider recall/chargeback AFTER settlement compensates the settled debit.
		{StatusSuccess, StatusReversed, EffectCompensate},
	}
	for _, c := range cases {
		got := DecideTransition(c.from, c.to)
		if !got.Allowed {
			t.Errorf("%s→%s: want Allowed, got rejected", c.from, c.to)
		}
		if got.NoOp {
			t.Errorf("%s→%s: want effectful, got NoOp", c.from, c.to)
		}
		if got.Effect != c.effect {
			t.Errorf("%s→%s: effect=%q want %q", c.from, c.to, got.Effect, c.effect)
		}
	}
}

// ── Disallowed transitions are rejected ─────────────────────────────────────

func TestDecideTransition_RejectInitiatedToTerminal(t *testing.T) {
	// INITIATED must never jump straight to a terminal — terminal is webhook-only.
	for _, to := range []OpStatus{StatusSuccess, StatusFailed, StatusReversed} {
		got := DecideTransition(StatusInitiated, to)
		if got.Allowed {
			t.Errorf("INITIATED→%s must be rejected (skips PENDING/webhook)", to)
		}
	}
}

func TestDecideTransition_RejectBackwards(t *testing.T) {
	got := DecideTransition(StatusPending, StatusInitiated)
	if got.Allowed {
		t.Error("PENDING→INITIATED (backwards) must be rejected")
	}
}

func TestDecideTransition_RejectTerminalToAnything(t *testing.T) {
	terminals := []OpStatus{StatusSuccess, StatusFailed, StatusReversed}
	targets := []OpStatus{StatusInitiated, StatusPending, StatusSuccess, StatusFailed, StatusReversed}
	for _, from := range terminals {
		for _, to := range targets {
			if from == to {
				continue // same-state replay handled separately (NoOp)
			}
			// SUCCESS→REVERSED is the ONE legal post-settlement edge (provider
			// recall/chargeback) — asserted in TestDecideTransition_OutOfOrderCannotFlip.
			if from == StatusSuccess && to == StatusReversed {
				continue
			}
			got := DecideTransition(from, to)
			if got.Allowed {
				t.Errorf("terminal %s→%s must be rejected", from, to)
			}
		}
	}
}

// ── Idempotent terminal replay is a no-op ───────────────────────────────────

func TestDecideTransition_TerminalReplayIsNoOp(t *testing.T) {
	for _, s := range []OpStatus{StatusSuccess, StatusFailed, StatusReversed, StatusPending, StatusInitiated} {
		got := DecideTransition(s, s)
		if !got.Allowed || !got.NoOp {
			t.Errorf("%s→%s: want Allowed+NoOp, got %+v", s, s, got)
		}
		if got.Effect != EffectNone {
			t.Errorf("%s→%s replay must have no ledger effect, got %q", s, s, got.Effect)
		}
	}
}

// ── Out-of-order: success-after-fail / fail-after-success cannot flip outcome ─

func TestDecideTransition_OutOfOrderCannotFlip(t *testing.T) {
	// A late SUCCESS webhook arriving after the transfer already FAILED must not
	// flip the settled outcome — it is rejected (terminal→terminal).
	if DecideTransition(StatusFailed, StatusSuccess).Allowed {
		t.Error("FAILED→SUCCESS (late success webhook) must be rejected")
	}
	// And the reverse: a late FAILED after SUCCESS is also rejected.
	if DecideTransition(StatusSuccess, StatusFailed).Allowed {
		t.Error("SUCCESS→FAILED (late fail webhook) must be rejected")
	}
	// REVERSED after SUCCESS is the ONE legal post-settlement edge (real provider
	// reversals/recalls arrive after the success webhook). It must be allowed and
	// compensate the settled debit.
	rev := DecideTransition(StatusSuccess, StatusReversed)
	if !rev.Allowed || rev.NoOp || rev.Effect != EffectCompensate {
		t.Errorf("SUCCESS→REVERSED must be allowed with EffectCompensate, got %+v", rev)
	}
}

// ── Webhook status normalization ────────────────────────────────────────────

func TestNormalizeWebhookStatus(t *testing.T) {
	cases := map[string]OpStatus{
		"success":    StatusSuccess,
		"successful": StatusSuccess,
		"completed":  StatusSuccess,
		"failed":     StatusFailed,
		"failure":    StatusFailed,
		"declined":   StatusFailed,
		"reversed":   StatusReversed,
		"refunded":   StatusReversed,
		"pending":    StatusPending,
		"processing": StatusPending,
	}
	for in, want := range cases {
		got, known := NormalizeWebhookStatus(in)
		if !known || got != want {
			t.Errorf("NormalizeWebhookStatus(%q)=%q,%v want %q,true", in, got, known, want)
		}
	}
	if _, known := NormalizeWebhookStatus("banana"); known {
		t.Error("unknown status must report known=false")
	}
	if _, known := NormalizeWebhookStatus(""); known {
		t.Error("empty status must report known=false")
	}
}

// ── Per-leg idempotency keys are distinct ───────────────────────────────────

func TestLegKey_DistinctPerLeg(t *testing.T) {
	ref := "mpl-abc"
	keys := map[string]bool{}
	for _, leg := range []string{LegHold, LegSettle, LegFee, LegReversal, LegCompensate} {
		k := LegKey(ref, leg)
		if keys[k] {
			t.Errorf("duplicate leg key %q", k)
		}
		keys[k] = true
		if k == ref {
			t.Errorf("leg key must differ from base ref")
		}
	}
}

func TestIsTerminal(t *testing.T) {
	if StatusInitiated.IsTerminal() || StatusPending.IsTerminal() {
		t.Error("INITIATED/PENDING are not terminal")
	}
	for _, s := range []OpStatus{StatusSuccess, StatusFailed, StatusReversed} {
		if !s.IsTerminal() {
			t.Errorf("%s must be terminal", s)
		}
	}
}
