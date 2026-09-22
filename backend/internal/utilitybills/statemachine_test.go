package utilitybills

import "testing"

// ── IsTerminalStatus ─────────────────────────────────────────────────────

func TestIsTerminalStatus_TrueForSuccessfulFailedReversed(t *testing.T) {
	for _, s := range []Status{StatusSuccessful, StatusFailed, StatusReversed} {
		if !IsTerminalStatus(s) {
			t.Errorf("IsTerminalStatus(%s) = false, want true", s)
		}
	}
}

func TestIsTerminalStatus_FalseForNonTerminal(t *testing.T) {
	for _, s := range []Status{StatusInitiated, StatusWalletDebited, StatusProviderPending, StatusDisputed} {
		if IsTerminalStatus(s) {
			t.Errorf("IsTerminalStatus(%s) = true, want false", s)
		}
	}
}

// ── CanRequeryStatus ─────────────────────────────────────────────────────

func TestCanRequeryStatus_TrueForProviderPendingWalletDebitedInitiated(t *testing.T) {
	for _, s := range []Status{StatusProviderPending, StatusWalletDebited, StatusInitiated} {
		if !CanRequeryStatus(s) {
			t.Errorf("CanRequeryStatus(%s) = false, want true", s)
		}
	}
}

func TestCanRequeryStatus_FalseForTerminalAndDisputed(t *testing.T) {
	for _, s := range []Status{StatusSuccessful, StatusFailed, StatusReversed, StatusDisputed} {
		if CanRequeryStatus(s) {
			t.Errorf("CanRequeryStatus(%s) = true, want false", s)
		}
	}
}

// ── CanReverseTransaction ────────────────────────────────────────────────

func TestCanReverseTransaction_AllowedForFailedPendingWalletDebited(t *testing.T) {
	for _, s := range []Status{StatusFailed, StatusProviderPending, StatusWalletDebited} {
		if !CanReverseTransaction(s) {
			t.Errorf("CanReverseTransaction(%s) = false, want true", s)
		}
	}
}

func TestCanReverseTransaction_DeniedForSuccessfulOrReversed(t *testing.T) {
	for _, s := range []Status{StatusSuccessful, StatusReversed, StatusInitiated, StatusDisputed} {
		if CanReverseTransaction(s) {
			t.Errorf("CanReverseTransaction(%s) = true, want false", s)
		}
	}
}

// ── NextStatusFromProvider ───────────────────────────────────────────────

func TestNextStatusFromProvider_MapsEachOutcome(t *testing.T) {
	cases := []struct {
		outcome ProviderOutcome
		want    Status
	}{
		{ProviderOutcomeSuccessful, StatusSuccessful},
		{ProviderOutcomePending, StatusProviderPending},
		{ProviderOutcomeFailed, StatusFailed},
	}
	for _, c := range cases {
		if got := NextStatusFromProvider(c.outcome); got != c.want {
			t.Errorf("NextStatusFromProvider(%s) = %s, want %s", c.outcome, got, c.want)
		}
	}
}

func TestNextStatusFromProvider_UnknownOutcomeFallsThroughToFailed(t *testing.T) {
	// status.ts's nextStatusFromProvider only checks 'successful' and
	// 'pending' explicitly; everything else falls to the unconditional
	// `return 'failed'`. Assert Go preserves that fallthrough shape for any
	// outcome value outside the three named constants.
	if got := NextStatusFromProvider(ProviderOutcome("something-else")); got != StatusFailed {
		t.Errorf("NextStatusFromProvider(unknown) = %s, want %s", got, StatusFailed)
	}
}

// ── ClassifyProviderOutcome ──────────────────────────────────────────────

func TestClassifyProviderOutcome_TimeoutAlwaysClassifiesAsPending(t *testing.T) {
	// A timeout must never be reported as failed, regardless of what the
	// (never-received) provider outcome would otherwise have been — mirrors
	// service.ts's attemptProviderPurchase catch branch always returning
	// `{ status: 'pending', ... }` on UtilityProviderTimeoutError.
	for _, outcome := range []ProviderOutcome{ProviderOutcomeSuccessful, ProviderOutcomePending, ProviderOutcomeFailed, ProviderOutcome("")} {
		if got := ClassifyProviderOutcome(true, outcome); got != ProviderOutcomePending {
			t.Errorf("ClassifyProviderOutcome(timedOut=true, %q) = %s, want %s", outcome, got, ProviderOutcomePending)
		}
	}
}

func TestClassifyProviderOutcome_PassesThroughNonTimeoutOutcomes(t *testing.T) {
	for _, outcome := range []ProviderOutcome{ProviderOutcomeSuccessful, ProviderOutcomePending, ProviderOutcomeFailed} {
		if got := ClassifyProviderOutcome(false, outcome); got != outcome {
			t.Errorf("ClassifyProviderOutcome(timedOut=false, %s) = %s, want %s (passthrough)", outcome, got, outcome)
		}
	}
}
