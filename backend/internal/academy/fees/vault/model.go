// Package feesvault owns the FeesVault entity of the EdTech School-Fees module.
//
// The FeesVault is the guardian's goal-based savings pot for school fees. It is a
// BROWNFIELD EXTENSION of academy/edupay: it reuses the existing
// public.academy_savings_pots table (+ append-only public.academy_pot_contributions)
// — the same rows edupay.SavingsPot already reads — rather than introducing a
// second savings/vault store. Migration 20260918000000_academy_fees_edtech.sql
// widened academy_savings_pots.status to the FeesVault state set
// (active / target_reached / applied_to_invoice / withdrawn / locked) and reused
// the append-only contributions table.
//
// Golden-rule discipline mirrored from edupay:
//   - saved_minor is a DERIVED PROJECTION = SUM(academy_pot_contributions.amount_minor).
//     It is NEVER written directly as a shadow balance. InsertVault seeds it 0 and it
//     is always recomputed from contributions on read.
//   - Contributions are APPEND-ONLY and idempotent on a globally-UNIQUE idempotency_key
//     (uq_academy_pot_contrib_idem). A replayed contribution is a no-op (money path).
//   - Status changes go THROUGH the pure feesstatemachine.VaultTransition guard
//     (statemachine/vault.go) — the status column is never mutated directly to an
//     arbitrary value.
//
// SF-5 (segregation): every contribution moves the guardian wallet → a SEGREGATED,
// purpose-tagged ledger sub-account distinct from the general wallet-float / escrow
// accounts. Segregation is by a DEDICATED ledger AccountType (the ledger has no
// free-form purpose column — verified in finance/ledger/model.go), so vault funds
// reconcile separately from general float. See ledgerSvc + AccountEdtechFeesVault.
//
// Money is int64 minor units (kobo). Never floats, never strings for math.
package feesvault

import (
	"errors"
	"time"

	feesstatemachine "spotlight/backend/internal/academy/fees/statemachine"
)

// AccountEdtechFeesVault is the SF-5 segregated ledger AccountType that holds all
// FeesVault balances. It is DELIBERATELY defined here as a local string constant
// rather than by editing finance/ledger/model.go: ledger.AccountType is a shared
// primitive owned by a separate integration change-task, and this task's file scope
// forbids modifying existing files. The integration task MUST add the one-line
// additive constant
//
//	AccountEdtechFeesVault AccountType = "edtech_fees_vault"
//
// to finance/ledger/model.go so GetOrCreateStandingAccount(AccountEdtechFeesVault)
// resolves to a real standing account. Until then callers pass this literal through
// the LedgerService interface (which takes a plain string account type) so the vault
// package compiles and tests run without touching the ledger package.
const AccountEdtechFeesVault = "edtech_fees_vault"

// Vault mirrors public.academy_savings_pots viewed through the FeesVault lens. It is
// the SAME row shape as edupay.SavingsPot (goal_name, target_minor, saved_minor,
// fee_schedule_id, status) — we do not duplicate the table, only project the fees
// state machine over its status column.
type Vault struct {
	ID            string                      `json:"id"`
	UserID        string                      `json:"userId"`
	GoalName      string                      `json:"goalName"`
	TargetMinor   int64                       `json:"targetMinor"`
	SavedMinor    int64                       `json:"savedMinor"` // DERIVED = SUM(contributions); never set directly
	FeeScheduleID *string                     `json:"feeScheduleId,omitempty"`
	InvoiceID     *string                     `json:"invoiceId,omitempty"`
	Status        feesstatemachine.VaultState `json:"status"`
	CreatedAt     time.Time                   `json:"createdAt"`
}

// Contribution mirrors public.academy_pot_contributions. Rows are APPEND-ONLY (no
// UPDATE / DELETE in app code); idempotency_key is globally UNIQUE so a replayed
// funding is a no-op.
type Contribution struct {
	ID             string    `json:"id"`
	VaultID        string    `json:"vaultId"`
	UserID         string    `json:"userId"`
	AmountMinor    int64     `json:"amountMinor"`
	LedgerRef      *string   `json:"ledgerRef,omitempty"`
	IdempotencyKey string    `json:"-"`
	CreatedAt      time.Time `json:"createdAt"`
}

// ── Request DTOs ────────────────────────────────────────────────────────────────

// CreateVaultRequest opens a FeesVault toward a fee goal (optionally a fee schedule).
type CreateVaultRequest struct {
	GoalName      string `json:"goalName" binding:"required"`
	TargetMinor   int64  `json:"targetMinor"`
	FeeScheduleID string `json:"feeScheduleId"`
}

// ContributeRequest funds the vault. AmountMinor is collected from the guardian wallet
// into the SF-5 segregated vault sub-account and appended as an immutable contribution.
type ContributeRequest struct {
	AmountMinor int64 `json:"amountMinor" binding:"required"`
}

// ApplyToInvoiceRequest applies a target-reached vault to an invoice in a single
// one-tap ledger transfer (vault → invoice settlement).
type ApplyToInvoiceRequest struct {
	InvoiceID string `json:"invoiceId" binding:"required"`
}

// ── Sentinel errors ─────────────────────────────────────────────────────────────

var (
	ErrNotFound             = errors.New("not_found")
	ErrUnauthenticated      = errors.New("unauthenticated")
	ErrMissingGoal          = errors.New("missing_goal")
	ErrInvalidAmount        = errors.New("invalid_amount")
	ErrIdempotencyRequired  = errors.New("idempotency_key_required")
	ErrIdempotencyKeyReused = errors.New("idempotency_key_reused")
	// ErrIllegalTransition wraps the pure state-machine rejection so the handler can
	// map it to 409. Identity is aliased to the statemachine sentinel.
	ErrIllegalTransition = feesstatemachine.ErrIllegalTransition
	// ErrTerminal is returned when a transition is attempted out of a terminal state.
	ErrTerminal = feesstatemachine.ErrTerminal
	// ErrTargetNotReached guards apply-to-invoice: the vault has not hit its target.
	ErrTargetNotReached = errors.New("target_not_reached")
	// ErrVaultEmpty guards apply-to-invoice: nothing to transfer.
	ErrVaultEmpty = errors.New("vault_empty")
)
