package edtechfees_test

// ---------------------------------------------------------------------------
// LIVE-DB integration tests for the EdTech School-Fees FEESVAULT money path
// (SF-5 segregation + derived saved_minor + one-tap apply-to-invoice).
//
// feesvault.NewService(pool, ledgerAdapter, invoiceAdapter) drives:
//   - Contribute: guardian wallet → SEGREGATED edtech_fees_vault standing account
//     (ledger.Service.Debit), then an append-only academy_pot_contributions row.
//     saved_minor is DERIVED = SUM(contributions); a replay on the same
//     idempotency_key funds once and appends one row.
//   - ApplyToInvoice: records an invoice payment (SF-2) + posts ONE balanced
//     ledger transfer out of the segregated vault account into settlement, keyed
//     idempotently so a replay double-transfers nothing.
//
// The ledger + invoice ports are wired here with the SAME thin adapters
// production uses (backend/internal/app/academy_routes.go: feesVaultLedger /
// feesVaultInvoice over the real *ledger.Service). The only enrichment: the
// invoice adapter ALSO records a real academy_invoice_payments row (via the real
// feesinvoice.Service) so this test can assert the invoice-side record, exactly
// as the SF-2 discipline requires. This file skips on TEST_DATABASE_URL /
// DATABASE_URL unset (shared gate in invoice_live_db_test.go).
//
// ── Bring-up note ──────────────────────────────────────────────────────────
// Apply the fees + edupay + ledger migrations (supabase db reset), then:
//   export DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//   cd backend && go test ./tests/edtechfees/... -run LiveDB_Vault -v
// The AccountEdtechFeesVault standing account is auto-created on first
// GetOrCreateStandingAccount — no seed row needed (finance/ledger/model.go).
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	feesinvoice "spotlight/backend/internal/academy/fees/invoice"
	feesvault "spotlight/backend/internal/academy/fees/vault"
	"spotlight/backend/internal/finance/ledger"
)

// newLiveLedger builds the real ledger.Service with a nil Redis client — the
// confirmed nil-safe pattern reused across every live-DB suite in this repo.
func newLiveLedger(pool *pgxpool.Pool) *ledger.Service {
	return ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
}

// seedWallet credits userID's wallet from the settlement standing account so
// Contribute's guardian-wallet Debit has funds to draw down (Debit fails closed
// on insufficient balance). Same helper shape as the crypto/association suites.
func seedWallet(t *testing.T, ctx context.Context, led *ledger.Service, userID string, amountKobo int64) {
	t.Helper()
	settle, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		t.Fatalf("seed wallet: standing account: %v", err)
	}
	if err := led.Credit(ctx, userID, "test-seed:"+uuid.New().String(), "test-seed-idem:"+uuid.New().String(), settle.ID, amountKobo); err != nil {
		t.Fatalf("seed wallet: credit: %v", err)
	}
}

// ── vault ledger port: mirrors feesVaultLedger in academy_routes.go ──────────
type vaultLedgerAdapter struct{ ledger *ledger.Service }

func (a vaultLedgerAdapter) SegregatedAccountID(ctx context.Context, accountType string) (string, error) {
	acct, err := a.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountType(accountType))
	if err != nil {
		return "", err
	}
	return acct.ID, nil
}

func (a vaultLedgerAdapter) DebitToVault(ctx context.Context, userID, reference, idempotencyKey, vaultAccountID string, amountKobo int64) error {
	return a.ledger.Debit(ctx, userID, reference, idempotencyKey, vaultAccountID, amountKobo)
}

func (a vaultLedgerAdapter) TransferVaultToInvoice(ctx context.Context, vaultAccountID, invoiceSettlementAccountID, reference, idempotencyKey string, amountKobo int64) error {
	return a.ledger.PostJournal(ctx, ledger.JournalEntry{
		Reference:       reference,
		IdempotencyKey:  idempotencyKey,
		AmountKobo:      amountKobo,
		DebitAccountID:  vaultAccountID,
		CreditAccountID: invoiceSettlementAccountID,
	})
}

// ── vault invoice port: mirrors feesVaultInvoice, but ALSO records the real
// invoice payment (SF-2) so the test can assert the invoice-side record. Returns
// the settlement standing account the vault transfer must credit. ──────────────
type vaultInvoiceAdapter struct {
	ledger *ledger.Service
	inv    *feesinvoice.Service
	actor  string
}

func (a vaultInvoiceAdapter) RecordPayment(ctx context.Context, invoiceID, guardianUserID, ledgerRef, idempotencyKey string, amountMinor int64) (settlementAccountID string, err error) {
	// SF-2: record an invoice payment (append-only, idempotent) — never write a balance.
	if _, rerr := a.inv.RecordPayment(ctx, a.actor, invoiceID, guardianUserID, amountMinor, "", ledgerRef, idempotencyKey); rerr != nil {
		return "", rerr
	}
	acct, err := a.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		return "", err
	}
	return acct.ID, nil
}

// cleanupVault removes a vault and its contributions after the test.
func cleanupVault(t *testing.T, pool *pgxpool.Pool, vaultID string) {
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = pool.Exec(ctx, `DELETE FROM public.academy_pot_contributions WHERE pot_id=$1`, vaultID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.academy_savings_pots WHERE id=$1`, vaultID)
	})
}

// ---------------------------------------------------------------------------
// Contribute (idempotent, SF-5 segregated) → reach target → ApplyToInvoice.
// ---------------------------------------------------------------------------

// TestLiveDB_Vault_Contribute_Idempotent_SegregatedThenApplyToInvoice proves:
//
//	(a) Contribute moves money guardian wallet → the SEGREGATED edtech_fees_vault
//	    standing account (that account's balance rises by the contribution) and
//	    saved_minor derives from SUM(academy_pot_contributions);
//	(b) a Contribute REPLAY on the same idempotency_key appends NO second
//	    contribution row and leaves the derived balance unchanged;
//	(c) reaching the target auto-advances active → target_reached;
//	(d) ApplyToInvoice posts ONE balanced transfer OUT of the segregated vault
//	    account into settlement AND records an academy_invoice_payments row;
//	(e) a replay of ApplyToInvoice double-transfers nothing (terminal-state guard).
func TestLiveDB_Vault_Contribute_Idempotent_SegregatedThenApplyToInvoice(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	led := newLiveLedger(pool)
	invSvc := feesinvoice.NewService(pool)

	guardianID := seedUser(t, ctx, pool)
	actorID := seedUser(t, ctx, pool)
	schoolID := seedSchool(t, ctx, pool)
	studentID := seedStudent(t, ctx, pool, schoolID, guardianID)

	const target = int64(100_000)
	feeScheduleID := seedFeeSchedule(t, ctx, pool, schoolID, target)

	// Fund the guardian wallet with ample headroom for the contribution.
	seedWallet(t, ctx, led, guardianID, target*4)

	vaultSvc := feesvault.NewService(pool,
		vaultLedgerAdapter{ledger: led},
		vaultInvoiceAdapter{ledger: led, inv: invSvc, actor: actorID},
	)

	// ── Create the vault (active, saved_minor=0, target=100000) ─────────────
	v, err := vaultSvc.CreateVault(ctx, guardianID, feesvault.CreateVaultRequest{
		GoalName: "Term 1 Fees", TargetMinor: target,
	})
	if err != nil {
		t.Fatalf("CreateVault: %v", err)
	}
	cleanupVault(t, pool, v.ID)
	if v.Status != "active" {
		t.Fatalf("new vault status = %s, want active", v.Status)
	}

	// Balance of the segregated vault standing account BEFORE any contribution.
	vaultAcct, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountType(feesvault.AccountEdtechFeesVault))
	if err != nil {
		t.Fatalf("resolve segregated vault account: %v", err)
	}
	segBefore := accountBalance(t, ctx, pool, vaultAcct.ID)
	walletBefore, err := led.GetBalance(ctx, guardianID)
	if err != nil {
		t.Fatalf("GetBalance before contribute: %v", err)
	}

	// ── Contribute the full target (idempotent on contribKey) ───────────────
	contribKey := newIdemKey(t, "vault-contrib")
	afterContrib, err := vaultSvc.Contribute(ctx, guardianID, v.ID, target, contribKey)
	if err != nil {
		t.Fatalf("Contribute: %v", err)
	}
	if afterContrib.SavedMinor != target {
		t.Errorf("derived saved_minor after contribute = %d, want %d", afterContrib.SavedMinor, target)
	}
	// Reaching the target auto-advances active → target_reached.
	if afterContrib.Status != "target_reached" {
		t.Errorf("status after reaching target = %s, want target_reached", afterContrib.Status)
	}

	// SF-5: the money landed in the SEGREGATED vault account (its balance rose by
	// the contribution), and the guardian wallet fell by the same amount.
	if got := accountBalance(t, ctx, pool, vaultAcct.ID) - segBefore; got != target {
		t.Errorf("segregated vault account balance rose by %d, want %d (SF-5)", got, target)
	}
	walletAfter, err := led.GetBalance(ctx, guardianID)
	if err != nil {
		t.Fatalf("GetBalance after contribute: %v", err)
	}
	if walletBefore-walletAfter != target {
		t.Errorf("guardian wallet fell by %d, want %d", walletBefore-walletAfter, target)
	}

	// ── Idempotent Contribute replay: no second contribution, no new money ──
	replayed, err := vaultSvc.Contribute(ctx, guardianID, v.ID, target, contribKey)
	if err != nil {
		t.Fatalf("Contribute (replay): %v", err)
	}
	if replayed.SavedMinor != target {
		t.Errorf("derived saved_minor after replay = %d, want unchanged %d", replayed.SavedMinor, target)
	}
	if n := countContributions(t, ctx, pool, v.ID); n != 1 {
		t.Errorf("academy_pot_contributions rows = %d, want exactly 1 (replay must not append)", n)
	}
	if got := accountBalance(t, ctx, pool, vaultAcct.ID) - segBefore; got != target {
		t.Errorf("segregated account balance after replay rose by %d, want still %d (no double debit)", got, target)
	}

	// ── Issue an invoice to apply the vault against ─────────────────────────
	inv, err := invSvc.Issue(ctx, actorID, feesinvoice.IssueInvoiceRequest{
		StudentID: studentID, FeeScheduleID: feeScheduleID, TotalAmountMinor: target,
	})
	if err != nil {
		t.Fatalf("Issue invoice: %v", err)
	}
	cleanupInvoice(t, pool, inv.ID)

	settlementAcct, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		t.Fatalf("resolve settlement account: %v", err)
	}
	segBeforeApply := accountBalance(t, ctx, pool, vaultAcct.ID)
	settleBeforeApply := accountBalance(t, ctx, pool, settlementAcct.ID)

	// ── ApplyToInvoice: one balanced transfer vault → settlement + payment ──
	applyKey := newIdemKey(t, "vault-apply")
	applied, err := vaultSvc.ApplyToInvoice(ctx, guardianID, v.ID, inv.ID, applyKey)
	if err != nil {
		t.Fatalf("ApplyToInvoice: %v", err)
	}
	if applied.Status != "applied_to_invoice" {
		t.Errorf("status after apply = %s, want applied_to_invoice", applied.Status)
	}

	// Exactly ONE balanced ledger move: segregated vault debited, settlement credited.
	if drop := segBeforeApply - accountBalance(t, ctx, pool, vaultAcct.ID); drop != target {
		t.Errorf("segregated vault account fell by %d on apply, want %d (one clean release)", drop, target)
	}
	if rise := accountBalance(t, ctx, pool, settlementAcct.ID) - settleBeforeApply; rise != target {
		t.Errorf("settlement account rose by %d on apply, want %d", rise, target)
	}
	// The vault→settlement transfer is exactly ONE balanced pair (2 ledger legs).
	if n := ledgerEntriesForKey(t, ctx, pool, applyKey); n != 2 {
		t.Errorf("ledger legs for the apply transfer = %d, want 2 (one balanced pair)", n)
	}
	// SF-2: the invoice payment was RECORDED (append-only) for the applied amount.
	if got := sumSucceededPayments(t, ctx, pool, inv.ID); got != target {
		t.Errorf("recorded invoice payment SUM = %d, want %d", got, target)
	}

	// ── Replay ApplyToInvoice: no double transfer (terminal-state guard) ────
	segAfterApply := accountBalance(t, ctx, pool, vaultAcct.ID)
	settleAfterApply := accountBalance(t, ctx, pool, settlementAcct.ID)
	if _, err := vaultSvc.ApplyToInvoice(ctx, guardianID, v.ID, inv.ID, applyKey); err == nil {
		// A benign no-op error is acceptable and expected (vault already terminal);
		// what MUST hold is that no second transfer occurred. Fall through to assert balances.
		t.Log("second ApplyToInvoice returned nil — asserting balances are unchanged")
	}
	if accountBalance(t, ctx, pool, vaultAcct.ID) != segAfterApply {
		t.Error("segregated vault balance changed on ApplyToInvoice replay — double transfer!")
	}
	if accountBalance(t, ctx, pool, settlementAcct.ID) != settleAfterApply {
		t.Error("settlement balance changed on ApplyToInvoice replay — double transfer!")
	}
	if n := ledgerEntriesForKey(t, ctx, pool, applyKey); n != 2 {
		t.Errorf("ledger legs for the apply key after replay = %d, want still 2 (no double post)", n)
	}
}

// TestLiveDB_Vault_Contribute_RequiresIdempotencyKey proves the fail-closed guard:
// a keyless Contribute is rejected before any money moves or any row is appended.
func TestLiveDB_Vault_Contribute_RequiresIdempotencyKey(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	led := newLiveLedger(pool)

	guardianID := seedUser(t, ctx, pool)
	seedWallet(t, ctx, led, guardianID, 50_000)
	vaultSvc := feesvault.NewService(pool, vaultLedgerAdapter{ledger: led}, vaultInvoiceAdapter{ledger: led})

	v, err := vaultSvc.CreateVault(ctx, guardianID, feesvault.CreateVaultRequest{GoalName: "Books", TargetMinor: 50_000})
	if err != nil {
		t.Fatalf("CreateVault: %v", err)
	}
	cleanupVault(t, pool, v.ID)

	if _, err := vaultSvc.Contribute(ctx, guardianID, v.ID, 10_000, ""); err != feesvault.ErrIdempotencyRequired {
		t.Fatalf("keyless Contribute: err = %v, want ErrIdempotencyRequired", err)
	}
	if n := countContributions(t, ctx, pool, v.ID); n != 0 {
		t.Errorf("keyless Contribute must append no contribution, found %d", n)
	}
}

// ── DB helpers ─────────────────────────────────────────────────────────────

func countContributions(t *testing.T, ctx context.Context, pool *pgxpool.Pool, vaultID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.academy_pot_contributions WHERE pot_id=$1`, vaultID).Scan(&n); err != nil {
		t.Fatalf("count contributions: %v", err)
	}
	return n
}

// accountBalance sums the signed ledger entries for a ledger account (CREDIT +,
// DEBIT −, and their reversal counterparts), matching the ledger's own balance
// semantics — used to prove the segregated-account movements directly.
func accountBalance(t *testing.T, ctx context.Context, pool *pgxpool.Pool, accountID string) int64 {
	t.Helper()
	var bal int64
	const q = `
		SELECT COALESCE(SUM(
		  CASE
		    WHEN type IN ('CREDIT','REVERSAL_DEBIT') THEN amount_kobo
		    WHEN type IN ('DEBIT','REVERSAL_CREDIT') THEN -amount_kobo
		    ELSE 0
		  END), 0)
		FROM ledger_entries WHERE account_id=$1`
	if err := pool.QueryRow(ctx, q, accountID).Scan(&bal); err != nil {
		t.Fatalf("account balance %s: %v", accountID, err)
	}
	return bal
}

// ledgerEntriesForKey counts the ledger legs a PostJournal wrote for baseKey. The
// ledger suffixes each leg's idempotency_key with ":debit"/":credit" internally
// (see finance/ledger/repository.go PostJournal), so a single balanced transfer
// posted under baseKey stores exactly two rows keyed baseKey:debit and
// baseKey:credit — matched here by prefix.
func ledgerEntriesForKey(t *testing.T, ctx context.Context, pool *pgxpool.Pool, baseKey string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM ledger_entries WHERE idempotency_key LIKE $1`, baseKey+":%").Scan(&n); err != nil {
		t.Fatalf("count ledger entries for key: %v", err)
	}
	return n
}
