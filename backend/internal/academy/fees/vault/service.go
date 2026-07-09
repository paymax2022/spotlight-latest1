package feesvault

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	feesstatemachine "spotlight/backend/internal/academy/fees/statemachine"
)

// LedgerService is the SMALL surface of finance/ledger this package depends on. Declaring
// it as an in-package interface (rather than importing *ledger.Service concretely) lets
// vault_test.go inject a fake ledger and ASSERT the SF-5 segregation — that vault money
// flows into the dedicated segregated account, distinct from the general wallet float —
// without a live DB or Redis.
//
// The real *ledger.Service satisfies these methods:
//   - Debit(ctx, userID, reference, idempotencyKey, creditAccountID string, amountKobo int64) error
//     moves money OUT of the guardian wallet INTO creditAccountID (the vault segregated
//     account) under a TOCTOU-safe advisory lock + idempotency guard.
//   - PostJournal(ctx, ledger.JournalEntry) error posts a balanced transfer between two
//     account IDs (used for apply-to-invoice: vault segregated → invoice settlement).
//   - GetOrCreateStandingAccount returns a system standing account by type; here it is
//     abstracted to take a plain account-type STRING so the vault package needs no
//     compile-time dependency on the (integration-owned) ledger.AccountType const.
//
// The integration task wires the concrete *ledger.Service via a thin shim (it already
// exposes Debit/PostJournal; only GetOrCreateStandingAccount's typed arg needs the
// AccountEdtechFeesVault const added to ledger/model.go — see model.go).
type LedgerService interface {
	// SegregatedAccountID returns the ID of the standing account holding all FeesVault
	// funds for accountType (SF-5). The concrete impl calls
	// GetOrCreateStandingAccount(ledger.AccountType(accountType)).
	SegregatedAccountID(ctx context.Context, accountType string) (string, error)
	// DebitToVault moves amountKobo OUT of the guardian wallet INTO the segregated vault
	// account (creditAccountID). Idempotent on idempotencyKey; fail-closed on funds.
	DebitToVault(ctx context.Context, userID, reference, idempotencyKey, vaultAccountID string, amountKobo int64) error
	// TransferVaultToInvoice posts a single balanced transfer from the segregated vault
	// account to the invoice settlement account. Idempotent on idempotencyKey.
	TransferVaultToInvoice(ctx context.Context, vaultAccountID, invoiceSettlementAccountID, reference, idempotencyKey string, amountKobo int64) error
}

// InvoiceService is the E2 invoice hook. apply-to-invoice records the vault→invoice
// payment intent against E2's invoice service (SF-2: the invoice balance is DERIVED from
// its payment events, so we RECORD a payment rather than mutate a balance). Declared as an
// interface so the vault package does not compile-time depend on the (separately-built)
// invoice package and tests can fake it.
type InvoiceService interface {
	// RecordPayment records an idempotent payment against the invoice. settlementAccountID
	// is the ledger account the vault transfer credits; ledgerRef is the transfer reference.
	// Returns the invoice settlement ledger account ID to credit (so the money leg and the
	// invoice-payment record agree). Idempotent on idempotencyKey.
	RecordPayment(ctx context.Context, invoiceID, guardianUserID, ledgerRef, idempotencyKey string, amountMinor int64) (settlementAccountID string, err error)
}

// Service owns the FeesVault lifecycle. It NEVER mutates status directly (all changes go
// through feesstatemachine.VaultTransition + the guarded Store.SetStatus) and NEVER writes
// saved_minor (always derived from SUM(contributions)). Money moves ONLY through the
// injected LedgerService into/out of the SF-5 segregated account.
type Service struct {
	store   Store
	ledger  LedgerService
	invoice InvoiceService
}

// NewService wires the pgx-backed store with the ledger + invoice collaborators.
func NewService(db *pgxpool.Pool, ledger LedgerService, invoice InvoiceService) *Service {
	return &Service{store: NewRepository(db), ledger: ledger, invoice: invoice}
}

// NewServiceWithStore injects a custom Store + collaborators (tests).
func NewServiceWithStore(store Store, ledger LedgerService, invoice InvoiceService) *Service {
	return &Service{store: store, ledger: ledger, invoice: invoice}
}

// ── Create ────────────────────────────────────────────────────────────────────────

// CreateVault opens a FeesVault in 'active' toward a goal (optionally a fee schedule).
func (s *Service) CreateVault(ctx context.Context, userID string, req CreateVaultRequest) (*Vault, error) {
	if userID == "" {
		return nil, ErrUnauthenticated
	}
	if strings.TrimSpace(req.GoalName) == "" {
		return nil, ErrMissingGoal
	}
	if req.TargetMinor < 0 {
		return nil, ErrInvalidAmount
	}
	v, err := s.store.InsertVault(ctx, userID, req.GoalName, req.TargetMinor, req.FeeScheduleID)
	if err != nil {
		return nil, err
	}
	_ = s.store.WriteAudit(ctx, userID, "vault_created", v.ID, "", string(feesstatemachine.VaultActive), "",
		map[string]any{"goalName": req.GoalName, "targetMinor": req.TargetMinor})
	return v, nil
}

func (s *Service) GetVault(ctx context.Context, userID, id string) (*Vault, error) {
	return s.store.GetVault(ctx, userID, id)
}

func (s *Service) ListVaults(ctx context.Context, userID string) ([]Vault, error) {
	return s.store.ListVaults(ctx, userID)
}

// ── Contribute (guardian wallet → SF-5 segregated vault account) ────────────────────

// Contribute funds the vault. Money flow (SF-5): DEBIT the guardian wallet and CREDIT the
// dedicated segregated FeesVault standing account (AccountEdtechFeesVault) — never the
// general wallet-float / escrow account — then APPEND an immutable contribution row.
// saved_minor is DERIVED (SUM of contributions), never set here.
//
// Idempotent (money path, required): the SAME idempotency_key funds the wallet at most
// once (ledger idempotency guard) AND appends at most one contribution row (contribution
// idempotency_key is globally UNIQUE). A replay returns the vault with an unchanged
// derived balance — one contribution, same result.
func (s *Service) Contribute(ctx context.Context, userID, vaultID string, amountMinor int64, idemKey string) (*Vault, error) {
	if userID == "" {
		return nil, ErrUnauthenticated
	}
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	if amountMinor <= 0 {
		return nil, ErrInvalidAmount
	}
	v, err := s.store.GetVault(ctx, userID, vaultID)
	if err != nil {
		return nil, err
	}
	// Only an active vault accepts contributions (locked/terminal reject).
	if v.Status != feesstatemachine.VaultActive && v.Status != feesstatemachine.VaultTargetReached {
		return nil, ErrIllegalTransition
	}

	// SF-5: resolve the dedicated segregated account. Contributions land HERE, not in the
	// general float — this is what lets the vault reconcile separately from general float.
	vaultAccountID, err := s.ledger.SegregatedAccountID(ctx, AccountEdtechFeesVault)
	if err != nil {
		return nil, err
	}

	// Move money guardian wallet → segregated vault account (idempotent, fail-closed).
	ref := "feesvault:contribute:" + vaultID
	if err := s.ledger.DebitToVault(ctx, userID, ref, idemKey, vaultAccountID, amountMinor); err != nil {
		return nil, err
	}

	// Append the immutable contribution (idempotent on idemKey; replay ⇒ inserted=false).
	inserted, err := s.store.AppendContribution(ctx, vaultID, userID, amountMinor, ref, idemKey)
	if err != nil {
		return nil, err
	}
	_ = s.store.WriteAudit(ctx, userID, "vault_contributed", vaultID, "", "", idemKey,
		map[string]any{"amountMinor": amountMinor, "segregatedAccountId": vaultAccountID, "inserted": inserted})

	// Auto-advance active → target_reached when the DERIVED balance meets the target.
	fresh, err := s.store.GetVault(ctx, userID, vaultID)
	if err != nil {
		return nil, err
	}
	if fresh.Status == feesstatemachine.VaultActive && fresh.TargetMinor > 0 && fresh.SavedMinor >= fresh.TargetMinor {
		if err := s.fire(ctx, userID, fresh, feesstatemachine.EvVaultReachTarget); err != nil {
			return nil, err
		}
		return s.store.GetVault(ctx, userID, vaultID)
	}
	return fresh, nil
}

// ── State transitions (all via feesstatemachine — never a direct status write) ─────

// fire drives ONE guarded vault transition: it computes the target via the pure
// feesstatemachine.VaultTransition, then applies the guarded Store.SetStatus. Any status
// change in this package MUST go through here (no direct status mutation anywhere).
func (s *Service) fire(ctx context.Context, actorID string, v *Vault, event feesstatemachine.Event) error {
	to, err := feesstatemachine.VaultTransition(v.Status, event)
	if err != nil {
		if err == feesstatemachine.ErrAlreadyInState {
			return nil // idempotent no-op
		}
		return err
	}
	if to == v.Status {
		return nil
	}
	if err := s.store.SetStatus(ctx, v.ID, v.Status, to); err != nil {
		return err
	}
	_ = s.store.WriteAudit(ctx, actorID, "vault_"+string(event), v.ID, string(v.Status), string(to), "", map[string]any{})
	v.Status = to
	return nil
}

// Lock puts an active vault on a compliance/dispute hold (active → locked).
func (s *Service) Lock(ctx context.Context, userID, vaultID string) (*Vault, error) {
	v, err := s.store.GetVault(ctx, userID, vaultID)
	if err != nil {
		return nil, err
	}
	if err := s.fire(ctx, userID, v, feesstatemachine.EvVaultLock); err != nil {
		return nil, err
	}
	return s.store.GetVault(ctx, userID, vaultID)
}

// Unlock releases a hold (locked → active).
func (s *Service) Unlock(ctx context.Context, userID, vaultID string) (*Vault, error) {
	v, err := s.store.GetVault(ctx, userID, vaultID)
	if err != nil {
		return nil, err
	}
	if err := s.fire(ctx, userID, v, feesstatemachine.EvVaultUnlock); err != nil {
		return nil, err
	}
	return s.store.GetVault(ctx, userID, vaultID)
}

// Withdraw exits the vault with NO penalty by default (active/target_reached → withdrawn).
// The withdrawal money leg (segregated account → guardian wallet) is the concern of the
// payout job/integration; this method flips the guarded status. Illegal from locked/terminal.
func (s *Service) Withdraw(ctx context.Context, userID, vaultID string) (*Vault, error) {
	v, err := s.store.GetVault(ctx, userID, vaultID)
	if err != nil {
		return nil, err
	}
	if err := s.fire(ctx, userID, v, feesstatemachine.EvVaultWithdraw); err != nil {
		return nil, err
	}
	return s.store.GetVault(ctx, userID, vaultID)
}

// ── Apply to invoice (single guarded one-tap transfer; SF-2 + SF-5) ────────────────

// ApplyToInvoice applies a target-reached vault to an invoice in a SINGLE guarded ledger
// transfer (target_reached → applied_to_invoice, per statemachine/vault.go). Steps:
//  1. Guard: vault must be in target_reached (the SM legal source for apply_to_invoice)
//     and have a positive derived balance.
//  2. Record the payment intent against E2's invoice service (SF-2: invoice balance is
//     derived from payment events — we RECORD a payment, we never mutate an invoice
//     balance). RecordPayment returns the invoice settlement ledger account to credit.
//  3. Post ONE balanced ledger transfer: segregated vault account → invoice settlement
//     account (SF-5 funds leave the segregated sub-account cleanly).
//  4. Flip the guarded status target_reached → applied_to_invoice.
//
// Idempotent: idemKey guards both the invoice RecordPayment and the ledger transfer, and
// the terminal state guard makes a replay after completion a benign ErrTerminal/no-op.
func (s *Service) ApplyToInvoice(ctx context.Context, userID, vaultID, invoiceID, idemKey string) (*Vault, error) {
	if userID == "" {
		return nil, ErrUnauthenticated
	}
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	if invoiceID == "" {
		return nil, ErrNotFound
	}
	v, err := s.store.GetVault(ctx, userID, vaultID)
	if err != nil {
		return nil, err
	}
	// The state machine only permits apply_to_invoice from target_reached (vault.go).
	if v.Status != feesstatemachine.VaultTargetReached {
		return nil, ErrTargetNotReached
	}
	// Derived balance must be positive (nothing to transfer otherwise).
	amount := v.SavedMinor
	if amount <= 0 {
		return nil, ErrVaultEmpty
	}

	vaultAccountID, err := s.ledger.SegregatedAccountID(ctx, AccountEdtechFeesVault)
	if err != nil {
		return nil, err
	}

	ref := "feesvault:apply:" + vaultID + ":" + invoiceID

	// Record the payment against E2's invoice service (SF-2 derived-balance discipline).
	settlementAccountID, err := s.invoice.RecordPayment(ctx, invoiceID, userID, ref, idemKey, amount)
	if err != nil {
		return nil, err
	}

	// Single balanced transfer: segregated vault → invoice settlement (idempotent).
	if err := s.ledger.TransferVaultToInvoice(ctx, vaultAccountID, settlementAccountID, ref, idemKey, amount); err != nil {
		return nil, err
	}

	// Flip the guarded status target_reached → applied_to_invoice (terminal).
	if err := s.fire(ctx, userID, v, feesstatemachine.EvVaultApplyToInvoice); err != nil {
		return nil, err
	}
	_ = s.store.SetInvoiceRef(ctx, vaultID, invoiceID)
	_ = s.store.WriteAudit(ctx, userID, "vault_applied_to_invoice", vaultID,
		string(feesstatemachine.VaultTargetReached), string(feesstatemachine.VaultAppliedToInvoice), idemKey,
		map[string]any{"invoiceId": invoiceID, "amountMinor": amount, "segregatedAccountId": vaultAccountID, "settlementAccountId": settlementAccountID})

	out, err := s.store.GetVault(ctx, userID, vaultID)
	if err != nil {
		return nil, err
	}
	out.InvoiceID = &invoiceID
	return out, nil
}
