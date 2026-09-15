package utilitybills

// This file ports the exact transition/predicate logic from
// frontend-web/src/server/utility/status.ts (25 lines) — every function
// below has a 1:1 TS counterpart, kept in the same order as the source.

// IsTerminalStatus reports whether status is a terminal state that will
// never transition again. Mirrors status.ts's isTerminalUtilityStatus.
func IsTerminalStatus(status Status) bool {
	switch status {
	case StatusSuccessful, StatusFailed, StatusReversed:
		return true
	default:
		return false
	}
}

// CanRequeryStatus reports whether a transaction in this status is eligible
// for a provider requery. Mirrors status.ts's canRequeryUtilityStatus.
func CanRequeryStatus(status Status) bool {
	return status == StatusProviderPending || status == StatusWalletDebited || status == StatusInitiated
}

// CanReverseTransaction reports whether a transaction in this status may be
// reversed (wallet auto-refund). Mirrors status.ts's
// canReverseUtilityTransaction.
func CanReverseTransaction(status Status) bool {
	return status == StatusFailed || status == StatusProviderPending || status == StatusWalletDebited
}

// ProviderOutcome is the raw purchase outcome a BillsProvider adapter
// reports, prior to being folded into the Status vocabulary above. Mirrors
// status.ts's inline union type `'successful' | 'pending' | 'failed'`.
type ProviderOutcome string

const (
	ProviderOutcomeSuccessful ProviderOutcome = "successful"
	ProviderOutcomePending    ProviderOutcome = "pending"
	ProviderOutcomeFailed     ProviderOutcome = "failed"
)

// NextStatusFromProvider maps a provider outcome to the transaction Status
// it produces. Mirrors status.ts's nextStatusFromProvider exactly, including
// its "anything else falls through to failed" shape (the third `if` has no
// condition in the TS source — only 'successful' and 'pending' are checked
// explicitly, everything else — including any outcome value outside this
// package's three named constants — becomes failed).
func NextStatusFromProvider(outcome ProviderOutcome) Status {
	if outcome == ProviderOutcomeSuccessful {
		return StatusSuccessful
	}
	if outcome == ProviderOutcomePending {
		return StatusProviderPending
	}
	return StatusFailed
}

// ClassifyProviderOutcome folds a provider TIMEOUT into the ProviderOutcome
// vocabulary NextStatusFromProvider expects, so a timed-out purchase attempt
// is never misclassified as failed.
//
// This is not a port of anything in status.ts — status.ts has no concept of
// a timeout. The rule lives in service.ts's attemptProviderPurchase: when
// withUtilityProviderTimeout rejects with UtilityProviderTimeoutError, the
// caught branch returns `{ status: 'pending', ... }` (never 'failed'),
// specifically because a request that timed out on OUR side may have
// actually succeeded upstream — VTpass keeps processing after our socket
// gives up, so treating a timeout as failure risks reporting "failed" on a
// purchase that later succeeds at the provider, or worse, driving a
// double-purchase on retry. Only a requery (Phase 1, against the actual
// provider) can resolve it, so it must land in provider_pending, exactly
// like an explicit "pending" response — never failed.
//
// Judgment call (flagged per the task instructions): this only classifies
// OUTCOME → OUTCOME as a pure function, which is genuinely decision logic
// adjacent to the state machine. Recording the attempt row itself (whose
// status value is the distinct string "timeout", preserved verbatim in
// utility_provider_attempts for observability — NOT the same vocabulary as
// ProviderOutcome) is I/O and stays Phase 1's job in service.go; this
// function does not attempt to model that.
func ClassifyProviderOutcome(timedOut bool, outcome ProviderOutcome) ProviderOutcome {
	if timedOut {
		return ProviderOutcomePending
	}
	return outcome
}
