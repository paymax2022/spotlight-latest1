package feesvault

import (
	"context"
	"errors"
	"testing"
	"time"

	feesstatemachine "spotlight/backend/internal/academy/fees/statemachine"
)

// PURE tests — no live DB, no Redis. The pgx Repository, the ledger and the invoice
// service are all replaced by in-memory fakes so the SF-5 segregation, money-path
// idempotency and vault state machine are exercised in isolation (mirrors
// feeschedule_test.go). Tests ACTIVELY attempt the violations they claim to guard.

// ── fakeStore: in-memory academy_savings_pots + append-only contributions ──────────

type fakeContribution struct {
	amount int64
	idem   string
}

type fakeVaultStore struct {
	vaults  map[string]*Vault
	contrib map[string][]fakeContribution // vaultID → append-only rows
	idemSet map[string]bool               // globally-unique contribution idempotency_key
	seq     int
	audits  []string
}

func newFakeVaultStore() *fakeVaultStore {
	return &fakeVaultStore{
		vaults:  map[string]*Vault{},
		contrib: map[string][]fakeContribution{},
		idemSet: map[string]bool{},
	}
}

func (f *fakeVaultStore) InsertVault(_ context.Context, userID, goalName string, targetMinor int64, feeScheduleID string) (*Vault, error) {
	f.seq++
	id := "vault-" + itoa(f.seq)
	v := &Vault{
		ID: id, UserID: userID, GoalName: goalName, TargetMinor: targetMinor,
		SavedMinor: 0, Status: feesstatemachine.VaultActive, CreatedAt: time.Now(),
	}
	if feeScheduleID != "" {
		fs := feeScheduleID
		v.FeeScheduleID = &fs
	}
	f.vaults[id] = v
	return f.copyDerived(id, userID)
}

// copyDerived returns a copy of the vault with saved_minor DERIVED from contributions —
// exactly like the real SQL projection. The stored struct's SavedMinor is NEVER trusted.
func (f *fakeVaultStore) copyDerived(id, userID string) (*Vault, error) {
	v, ok := f.vaults[id]
	if !ok || (userID != "" && v.UserID != userID) {
		return nil, ErrNotFound
	}
	out := *v
	out.SavedMinor = f.sum(id) // derived
	return &out, nil
}

func (f *fakeVaultStore) sum(id string) int64 {
	var s int64
	for _, c := range f.contrib[id] {
		s += c.amount
	}
	return s
}

func (f *fakeVaultStore) GetVault(_ context.Context, userID, id string) (*Vault, error) {
	return f.copyDerived(id, userID)
}

func (f *fakeVaultStore) ListVaults(_ context.Context, userID string) ([]Vault, error) {
	out := []Vault{}
	for id, v := range f.vaults {
		if v.UserID == userID {
			d, _ := f.copyDerived(id, userID)
			out = append(out, *d)
		}
	}
	return out, nil
}

func (f *fakeVaultStore) AppendContribution(_ context.Context, vaultID, _ string, amountMinor int64, _, idemKey string) (bool, error) {
	if f.idemSet[idemKey] {
		return false, nil // replay: no new row (ON CONFLICT DO NOTHING)
	}
	f.idemSet[idemKey] = true
	f.contrib[vaultID] = append(f.contrib[vaultID], fakeContribution{amount: amountMinor, idem: idemKey})
	return true, nil
}

func (f *fakeVaultStore) SumContributions(_ context.Context, vaultID string) (int64, error) {
	return f.sum(vaultID), nil
}

func (f *fakeVaultStore) SetStatus(_ context.Context, vaultID string, from, to feesstatemachine.VaultState) error {
	if !feesstatemachine.VaultCanTransition(from, to) {
		return ErrIllegalTransition
	}
	v, ok := f.vaults[vaultID]
	if !ok {
		return ErrNotFound
	}
	if v.Status != from {
		return ErrIllegalTransition
	}
	v.Status = to
	return nil
}

func (f *fakeVaultStore) SetInvoiceRef(_ context.Context, vaultID, invoiceID string) error {
	if v, ok := f.vaults[vaultID]; ok && v.FeeScheduleID == nil {
		iv := invoiceID
		v.FeeScheduleID = &iv
	}
	return nil
}

func (f *fakeVaultStore) WriteAudit(_ context.Context, _, action, _, _, _, _ string, _ any) error {
	f.audits = append(f.audits, action)
	return nil
}

// ── fakeLedger: records which account contributions and transfers hit (SF-5) ────────

const fakeGeneralFloatAccount = "acct-general-float"        // the general wallet-float account
const fakeSegregatedVaultAccount = "acct-edtech-fees-vault" // the SF-5 dedicated sub-account

type ledgerCall struct {
	kind    string // "debit" | "transfer"
	dstAcct string
	srcAcct string
	amount  int64
	idem    string
}

type fakeLedger struct {
	calls    []ledgerCall
	idemSeen map[string]bool // ledger idempotency guard
}

func newFakeLedger() *fakeLedger { return &fakeLedger{idemSeen: map[string]bool{}} }

// SegregatedAccountID resolves the dedicated account type to the segregated account,
// asserting the vault package asks for AccountEdtechFeesVault (not the general float).
func (l *fakeLedger) SegregatedAccountID(_ context.Context, accountType string) (string, error) {
	if accountType != AccountEdtechFeesVault {
		// The vault must NEVER route funds to any other account type.
		return fakeGeneralFloatAccount, errors.New("unexpected account type: " + accountType)
	}
	return fakeSegregatedVaultAccount, nil
}

func (l *fakeLedger) DebitToVault(_ context.Context, _, _, idempotencyKey, vaultAccountID string, amountKobo int64) error {
	if l.idemSeen[idempotencyKey] {
		return nil // idempotent replay: no second money movement
	}
	l.idemSeen[idempotencyKey] = true
	l.calls = append(l.calls, ledgerCall{kind: "debit", dstAcct: vaultAccountID, amount: amountKobo, idem: idempotencyKey})
	return nil
}

func (l *fakeLedger) TransferVaultToInvoice(_ context.Context, vaultAccountID, invoiceSettlementAccountID, _, idempotencyKey string, amountKobo int64) error {
	if l.idemSeen[idempotencyKey] {
		return nil
	}
	l.idemSeen[idempotencyKey] = true
	l.calls = append(l.calls, ledgerCall{kind: "transfer", srcAcct: vaultAccountID, dstAcct: invoiceSettlementAccountID, amount: amountKobo, idem: idempotencyKey})
	return nil
}

// ── fakeInvoice: E2 invoice hook ───────────────────────────────────────────────────

const fakeInvoiceSettlementAccount = "acct-invoice-settlement"

type fakeInvoice struct {
	recorded []int64
}

func (i *fakeInvoice) RecordPayment(_ context.Context, _, _, _, _ string, amountMinor int64) (string, error) {
	i.recorded = append(i.recorded, amountMinor)
	return fakeInvoiceSettlementAccount, nil
}

// ── helpers ────────────────────────────────────────────────────────────────────────

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}

func newTestService() (*Service, *fakeVaultStore, *fakeLedger, *fakeInvoice) {
	store := newFakeVaultStore()
	led := newFakeLedger()
	inv := &fakeInvoice{}
	return NewServiceWithStore(store, led, inv), store, led, inv
}

// ═══════════════════════════════════════════════════════════════════════════════════
// SF-5: contributions post to the SEGREGATED account, distinct from the general float,
//        and saved_minor is DERIVED from contributions (never set directly).
// ═══════════════════════════════════════════════════════════════════════════════════

func TestSF5_ContributionsHitSegregatedAccount(t *testing.T) {
	svc, store, led, _ := newTestService()
	ctx := context.Background()

	v, err := svc.CreateVault(ctx, "guardian-1", CreateVaultRequest{GoalName: "Term 1", TargetMinor: 100000})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := svc.Contribute(ctx, "guardian-1", v.ID, 40000, "idem-c1"); err != nil {
		t.Fatalf("contribute: %v", err)
	}

	if len(led.calls) != 1 {
		t.Fatalf("expected exactly 1 ledger debit, got %d", len(led.calls))
	}
	call := led.calls[0]
	// SF-5: funds land in the dedicated segregated vault account...
	if call.dstAcct != fakeSegregatedVaultAccount {
		t.Fatalf("SF-5: contribution must credit the segregated account %q, got %q", fakeSegregatedVaultAccount, call.dstAcct)
	}
	// ...and NEVER in the general wallet-float account.
	if call.dstAcct == fakeGeneralFloatAccount {
		t.Fatal("SF-5 VIOLATED: contribution credited the general float account")
	}

	// saved_minor must be DERIVED from the appended contribution (SUM), not a stored field.
	got, _ := svc.GetVault(ctx, "guardian-1", v.ID)
	if got.SavedMinor != 40000 {
		t.Fatalf("saved_minor must be derived = 40000, got %d", got.SavedMinor)
	}
	// The stored struct's SavedMinor was never written to 40000 directly (it stays 0);
	// the derived projection is the only source of truth.
	if store.vaults[v.ID].SavedMinor != 0 {
		t.Fatal("saved_minor must never be set directly on the row (shadow-balance violation)")
	}
}

// The vault must reference AccountEdtechFeesVault explicitly (guards against a future
// refactor pointing it at escrow/float).
func TestSF5_AccountTypeIsEdtechFeesVault(t *testing.T) {
	if AccountEdtechFeesVault != "edtech_fees_vault" {
		t.Fatalf("SF-5 segregated account type must be 'edtech_fees_vault', got %q", AccountEdtechFeesVault)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════════
// Idempotency (money path, required): same idempotency_key twice = one contribution.
// ═══════════════════════════════════════════════════════════════════════════════════

func TestIdempotency_DuplicateContributionIsNoOp(t *testing.T) {
	svc, store, led, _ := newTestService()
	ctx := context.Background()

	v, _ := svc.CreateVault(ctx, "guardian-1", CreateVaultRequest{GoalName: "Term 1", TargetMinor: 100000})

	first, err := svc.Contribute(ctx, "guardian-1", v.ID, 30000, "idem-dup")
	if err != nil {
		t.Fatalf("first contribute: %v", err)
	}
	second, err := svc.Contribute(ctx, "guardian-1", v.ID, 30000, "idem-dup") // SAME key
	if err != nil {
		t.Fatalf("replayed contribute must succeed as a no-op, got %v", err)
	}

	// Exactly ONE contribution row, ONE ledger debit, and the same derived balance.
	if n := len(store.contrib[v.ID]); n != 1 {
		t.Fatalf("idempotency: expected 1 contribution row, got %d", n)
	}
	if n := len(led.calls); n != 1 {
		t.Fatalf("idempotency: expected 1 ledger debit, got %d", n)
	}
	if first.SavedMinor != 30000 || second.SavedMinor != 30000 {
		t.Fatalf("idempotency: balance must be 30000 both times, got %d then %d", first.SavedMinor, second.SavedMinor)
	}
}

func TestContribute_RequiresIdempotencyKey(t *testing.T) {
	svc, _, _, _ := newTestService()
	ctx := context.Background()
	v, _ := svc.CreateVault(ctx, "guardian-1", CreateVaultRequest{GoalName: "T", TargetMinor: 1000})
	if _, err := svc.Contribute(ctx, "guardian-1", v.ID, 100, ""); !errors.Is(err, ErrIdempotencyRequired) {
		t.Fatalf("money path must require Idempotency-Key, got %v", err)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════════
// State machine: legal transitions succeed; illegal ones rejected.
// ═══════════════════════════════════════════════════════════════════════════════════

// active → target_reached auto-fires when the derived balance meets the target.
func TestStateMachine_AutoReachTarget(t *testing.T) {
	svc, _, _, _ := newTestService()
	ctx := context.Background()
	v, _ := svc.CreateVault(ctx, "g", CreateVaultRequest{GoalName: "T", TargetMinor: 50000})

	got, err := svc.Contribute(ctx, "g", v.ID, 50000, "idem-full")
	if err != nil {
		t.Fatalf("contribute: %v", err)
	}
	if got.Status != feesstatemachine.VaultTargetReached {
		t.Fatalf("reaching target must move active → target_reached, got %q", got.Status)
	}
}

// active → locked → active is legal; illegal withdrawn → active is rejected.
func TestStateMachine_LockUnlockLegal_WithdrawnToActiveIllegal(t *testing.T) {
	svc, store, _, _ := newTestService()
	ctx := context.Background()
	v, _ := svc.CreateVault(ctx, "g", CreateVaultRequest{GoalName: "T", TargetMinor: 50000})

	if _, err := svc.Lock(ctx, "g", v.ID); err != nil {
		t.Fatalf("active → locked must be legal, got %v", err)
	}
	if _, err := svc.Unlock(ctx, "g", v.ID); err != nil {
		t.Fatalf("locked → active must be legal, got %v", err)
	}

	// Withdraw (active → withdrawn) is legal and terminal.
	if _, err := svc.Withdraw(ctx, "g", v.ID); err != nil {
		t.Fatalf("active → withdrawn must be legal, got %v", err)
	}
	// ILLEGAL: withdrawn → active (unlock out of a terminal state) must be rejected.
	if _, err := svc.Unlock(ctx, "g", v.ID); err == nil {
		t.Fatal("withdrawn → active must be rejected (terminal), got nil error")
	}
	// The status must remain withdrawn.
	if store.vaults[v.ID].Status != feesstatemachine.VaultWithdrawn {
		t.Fatalf("status must remain withdrawn, got %q", store.vaults[v.ID].Status)
	}
}

// apply-to-invoice is only legal from target_reached (per vault.go).
func TestStateMachine_ApplyOnlyFromTargetReached(t *testing.T) {
	svc, _, led, inv := newTestService()
	ctx := context.Background()

	// Vault in 'active' (below target) — apply must be REJECTED.
	v, _ := svc.CreateVault(ctx, "g", CreateVaultRequest{GoalName: "T", TargetMinor: 50000})
	if _, err := svc.Contribute(ctx, "g", v.ID, 20000, "idem-a"); err != nil {
		t.Fatalf("contribute: %v", err)
	}
	if _, err := svc.ApplyToInvoice(ctx, "g", v.ID, "inv-1", "idem-apply-early"); !errors.Is(err, ErrTargetNotReached) {
		t.Fatalf("apply from active must be rejected with ErrTargetNotReached, got %v", err)
	}
	if len(inv.recorded) != 0 {
		t.Fatal("no invoice payment must be recorded when apply is rejected")
	}

	// Fund to target → target_reached, then apply succeeds with a single transfer.
	if _, err := svc.Contribute(ctx, "g", v.ID, 30000, "idem-b"); err != nil {
		t.Fatalf("contribute: %v", err)
	}
	out, err := svc.ApplyToInvoice(ctx, "g", v.ID, "inv-1", "idem-apply")
	if err != nil {
		t.Fatalf("apply from target_reached must succeed, got %v", err)
	}
	if out.Status != feesstatemachine.VaultAppliedToInvoice {
		t.Fatalf("apply must move target_reached → applied_to_invoice, got %q", out.Status)
	}
	// Exactly one invoice payment recorded for the full derived balance...
	if len(inv.recorded) != 1 || inv.recorded[0] != 50000 {
		t.Fatalf("apply must record one invoice payment of 50000, got %v", inv.recorded)
	}
	// ...and exactly one vault→invoice transfer, from the segregated account.
	var transfers int
	for _, c := range led.calls {
		if c.kind == "transfer" {
			transfers++
			if c.srcAcct != fakeSegregatedVaultAccount {
				t.Fatalf("SF-5: apply transfer must debit the segregated account, got src %q", c.srcAcct)
			}
			if c.dstAcct != fakeInvoiceSettlementAccount {
				t.Fatalf("apply transfer must credit invoice settlement, got dst %q", c.dstAcct)
			}
		}
	}
	if transfers != 1 {
		t.Fatalf("apply must post exactly one ledger transfer, got %d", transfers)
	}

	// Replay after applied (terminal) must not double-transfer.
	if _, err := svc.ApplyToInvoice(ctx, "g", v.ID, "inv-1", "idem-apply"); err == nil {
		t.Fatal("re-applying a terminal vault must be rejected, got nil")
	}
}

// Contribution into a terminal (withdrawn) vault is rejected.
func TestContribute_RejectedOnTerminalVault(t *testing.T) {
	svc, _, _, _ := newTestService()
	ctx := context.Background()
	v, _ := svc.CreateVault(ctx, "g", CreateVaultRequest{GoalName: "T", TargetMinor: 50000})
	if _, err := svc.Withdraw(ctx, "g", v.ID); err != nil {
		t.Fatalf("withdraw: %v", err)
	}
	if _, err := svc.Contribute(ctx, "g", v.ID, 100, "idem-term"); !errors.Is(err, ErrIllegalTransition) {
		t.Fatalf("contributing to a withdrawn vault must be rejected, got %v", err)
	}
}
