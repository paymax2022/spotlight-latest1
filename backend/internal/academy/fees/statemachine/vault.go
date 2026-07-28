package feesstatemachine

// ── FeesVault state machine (build-spec §3.2, entity table §2) ────────────────
//
// The FeesVault is the guardian's goal-based savings pot for school fees. In the
// real repo this is backed by academy_savings_pots (+ append-only
// academy_pot_contributions); this machine governs the pot's STATUS only, never
// its balance (balance is the projected SavedMinor, computed elsewhere — same
// SF-2 discipline as invoices).
//
//	active → target_reached
//	target_reached → applied_to_invoice   (single ledger transfer event, one-tap)
//	active → withdrawn                     (early exit, no penalty by default)
//	target_reached → withdrawn            (exit after hitting target, pre-apply)
//	active → locked                        (compliance / dispute hold)
//	locked → active                        (hold released)
//	Terminal: applied_to_invoice, withdrawn
//
// Legacy tolerance: some existing pot rows use the status value `closed` as a
// terminal state. We accept `closed` as a known state and treat it as terminal
// (an alias for a spent/exited pot) so this machine can be pointed at legacy
// data without choking, but no forward transition ever PRODUCES `closed`.

// VaultState mirrors the FeesVault.status set (build-spec §3.2) and the
// academy_savings_pots status values.
type VaultState string

const (
	VaultActive           VaultState = "active"
	VaultTargetReached    VaultState = "target_reached"
	VaultAppliedToInvoice VaultState = "applied_to_invoice"
	VaultWithdrawn        VaultState = "withdrawn"
	VaultLocked           VaultState = "locked"
	// VaultClosed is a legacy terminal alias tolerated on read (see file header).
	VaultClosed VaultState = "closed"
)

// FeesVault events.
const (
	EvVaultReachTarget    Event = "reach_target"     // active → target_reached
	EvVaultApplyToInvoice Event = "apply_to_invoice" // target_reached → applied_to_invoice
	EvVaultWithdraw       Event = "withdraw"         // active/target_reached → withdrawn
	EvVaultLock           Event = "lock"             // active → locked
	EvVaultUnlock         Event = "unlock"           // locked → active
)

// vaultTerminal is the terminal set: no outgoing transitions. `closed` is
// included as the tolerated legacy terminal alias.
var vaultTerminal = map[VaultState]bool{
	VaultAppliedToInvoice: true,
	VaultWithdrawn:        true,
	VaultClosed:           true,
}

// vaultTransitions is the legal adjacency for the vault SM.
var vaultTransitions = map[VaultState]map[VaultState]bool{
	VaultActive:           {VaultTargetReached: true, VaultWithdrawn: true, VaultLocked: true},
	VaultTargetReached:    {VaultAppliedToInvoice: true, VaultWithdrawn: true},
	VaultLocked:           {VaultActive: true},
	VaultAppliedToInvoice: {}, // terminal
	VaultWithdrawn:        {}, // terminal
	VaultClosed:           {}, // terminal (legacy alias)
}

// validVaultState reports whether s is a known vault state.
func validVaultState(s VaultState) bool {
	switch s {
	case VaultActive, VaultTargetReached, VaultAppliedToInvoice,
		VaultWithdrawn, VaultLocked, VaultClosed:
		return true
	default:
		return false
	}
}

// vaultTarget resolves the target state for an event, or "" if inapplicable.
func vaultTarget(event Event) VaultState {
	switch event {
	case EvVaultReachTarget:
		return VaultTargetReached
	case EvVaultApplyToInvoice:
		return VaultAppliedToInvoice
	case EvVaultWithdraw:
		return VaultWithdrawn
	case EvVaultLock:
		return VaultLocked
	case EvVaultUnlock:
		return VaultActive
	default:
		return ""
	}
}

// VaultCanTransition reports whether from→to is a legal vault transition. Pure.
func VaultCanTransition(from, to VaultState) bool {
	targets, ok := vaultTransitions[from]
	if !ok {
		return false
	}
	return targets[to]
}

// VaultTransition applies an event to the vault machine and returns the
// resulting state or a typed error. Firing an event whose target equals the
// current state is reported as the idempotent no-op ErrAlreadyInState.
func VaultTransition(from VaultState, event Event) (VaultState, error) {
	if !validVaultState(from) {
		return from, ErrIllegalTransition
	}
	to := vaultTarget(event)
	if to == "" {
		return from, ErrIllegalTransition
	}
	if vaultTerminal[from] {
		return from, ErrTerminal
	}
	if VaultCanTransition(from, to) {
		return to, nil
	}
	if to == from {
		return from, ErrAlreadyInState
	}
	return from, ErrIllegalTransition
}
