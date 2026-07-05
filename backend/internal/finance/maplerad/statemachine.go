package maplerad

// State machine for the Maplerad money-op state row (provider_reference.status).
//
// This file is PURE LOGIC — no DB, no network, no provider types. It is the
// locked, unit-tested core that every transition (sync initiate, webhook,
// orphan sweep) must pass through. The ledger effect of each transition is
// described declaratively here; the service applies it (statemachine never
// touches the ledger itself).

// OpStatus mirrors provider_reference.status (the migration CHECK constraint).
type OpStatus string

const (
	StatusInitiated OpStatus = "INITIATED"
	StatusPending   OpStatus = "PENDING"
	StatusSuccess   OpStatus = "SUCCESS"
	StatusFailed    OpStatus = "FAILED"
	StatusReversed  OpStatus = "REVERSED"
)

// IsTerminal reports whether a status is final (no further transition allowed).
func (s OpStatus) IsTerminal() bool {
	return s == StatusSuccess || s == StatusFailed || s == StatusReversed
}

// LedgerEffect names the ledger action a transition implies. The service maps
// each to concrete postings; the state machine only decides which one applies.
type LedgerEffect string

const (
	// EffectNone — no ledger movement (e.g. INITIATED→PENDING is the hold, but
	// the hold posting is driven by EffectHold; a no-op replay is EffectNone).
	EffectNone LedgerEffect = ""
	// EffectHold — INITIATED→PENDING: DR user_wallet → CR failed_transfer_suspense.
	EffectHold LedgerEffect = "hold"
	// EffectFinalize — PENDING→SUCCESS: DR suspense → CR settlement (+fee → revenue).
	EffectFinalize LedgerEffect = "finalize"
	// EffectReverseHold — PENDING→FAILED (and PENDING→REVERSED): the funds are
	// still held in suspense, so PostReversal restores user_wallet and drains suspense.
	EffectReverseHold LedgerEffect = "reverse_hold"
	// EffectCompensate — SUCCESS→REVERSED: a transfer that already SETTLED is
	// recalled/charged-back by the provider AFTER success; compensate the settled
	// debit (restore user_wallet, drain settlement).
	EffectCompensate LedgerEffect = "compensate"
)

// TransitionResult is the pure decision for one attempted transition.
type TransitionResult struct {
	// Allowed is true when the (from→to) edge is a legal forward transition.
	Allowed bool
	// NoOp is true when the transition is a benign idempotent replay (from==to,
	// or replaying a terminal that already matches the requested terminal). The
	// service must treat NoOp as success-with-no-ledger-effect.
	NoOp bool
	// Effect is the ledger action to apply (only meaningful when Allowed && !NoOp).
	Effect LedgerEffect
}

// DecideTransition is the single guard for the transfer/bill state machine.
// Legal forward edges:
//
//	INITIATED → PENDING                       (post the hold)
//	PENDING   → SUCCESS | FAILED | REVERSED   (finalize / reverse-hold / reverse-hold)
//	SUCCESS   → REVERSED                       (provider recall/chargeback after settle)
//
// Everything else is rejected:
//   - INITIATED → SUCCESS/FAILED/REVERSED (skipping the webhook/PENDING) — REJECTED
//   - SUCCESS → PENDING/FAILED/INITIATED                                  — REJECTED
//   - FAILED/REVERSED → anything                                         — REJECTED (truly terminal)
//   - PENDING → INITIATED (backwards)                                    — REJECTED
//
// REVERSED effect depends on the prior state: from PENDING the funds are still
// held in suspense (EffectReverseHold); from SUCCESS the debit already settled
// and must be compensated (EffectCompensate). Real provider reversals arrive
// AFTER success, so SUCCESS→REVERSED is a first-class edge — not a rejection.
//
// Idempotent replays (from == to, including terminal == same terminal) return
// NoOp=true, Allowed=true so the caller short-circuits without a second effect.
func DecideTransition(from, to OpStatus) TransitionResult {
	// Idempotent replay of the same state is always a benign no-op.
	if from == to {
		return TransitionResult{Allowed: true, NoOp: true, Effect: EffectNone}
	}

	switch from {
	case StatusInitiated:
		// Only INITIATED→PENDING is legal; INITIATED→<terminal> is rejected
		// (terminal MUST be reached via the PENDING webhook path).
		if to == StatusPending {
			return TransitionResult{Allowed: true, Effect: EffectHold}
		}
		return TransitionResult{Allowed: false}
	case StatusPending:
		switch to {
		case StatusSuccess:
			return TransitionResult{Allowed: true, Effect: EffectFinalize}
		case StatusFailed:
			return TransitionResult{Allowed: true, Effect: EffectReverseHold}
		case StatusReversed:
			// Reversal before settlement: funds are still in suspense → undo the
			// hold (restore wallet, drain suspense), NOT a settled-debit compensation.
			return TransitionResult{Allowed: true, Effect: EffectReverseHold}
		default:
			return TransitionResult{Allowed: false}
		}
	case StatusSuccess:
		// A SETTLED transfer can still be reversed by the provider (recall/
		// chargeback); that webhook arrives after success. Compensate the settled
		// debit. Every other move out of SUCCESS is rejected.
		if to == StatusReversed {
			return TransitionResult{Allowed: true, Effect: EffectCompensate}
		}
		return TransitionResult{Allowed: false}
	default:
		// FAILED and REVERSED are truly terminal — nothing moves out of them.
		return TransitionResult{Allowed: false}
	}
}

// NormalizeWebhookStatus maps a provider webhook status string to our OpStatus
// terminal, reporting whether it is recognized. Pure + unit-tested so an
// unexpected status never silently drives a transition.
func NormalizeWebhookStatus(providerStatus string) (status OpStatus, known bool) {
	switch providerStatus {
	case "success", "successful", "completed", "SUCCESS":
		return StatusSuccess, true
	case "failed", "failure", "declined", "FAILED":
		return StatusFailed, true
	case "reversed", "reversal", "refunded", "REVERSED":
		return StatusReversed, true
	case "pending", "processing", "PENDING":
		return StatusPending, true
	default:
		return "", false
	}
}

// LegKey derives a per-leg idempotency key from the base ref + leg name so each
// ledger posting (hold / finalize / fee / reversal) is uniquely keyed and a
// duplicate webhook is a benign ledger-unique-constraint no-op. Pure.
func LegKey(ref, leg string) string {
	return ref + ":" + leg
}

// Leg names for the Maplerad transfer money path.
const (
	LegHold     = "hold"     // INITIATED→PENDING: DR wallet → CR suspense
	LegSettle   = "settle"   // SUCCESS: DR suspense(amount) → CR settlement
	LegFee      = "fee"      // SUCCESS: DR suspense(fee) → CR paymax_revenue
	LegReversal = "reversal" // FAILED: restore wallet from suspense
	LegCompensate = "compensate" // REVERSED: compensating reversal of a settled debit
)
