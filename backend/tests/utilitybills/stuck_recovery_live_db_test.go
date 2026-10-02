package utilitybills_test

// LIVE-DB suite for AUD-BILL-005 — stuck-fulfilment recovery. Reuses newFixture
// from live_db_test.go.
//
// A crash between the transaction insert, the wallet debit, and the provider
// call used to leave rows at initiated/wallet_debited forever: replays answered
// alreadyProcessed, and SweepPending could mark them failed WITHOUT returning
// the money. What each test proves:
//  1. wallet_debited + real debit + zero attempts -> auto-reversed, net zero.
//  2. initiated + NO debit leg -> failed, and NO reversal is minted.
//  3. wallet_debited + only 'failed' attempts -> reversed.
//  4. wallet_debited + a 'timeout' attempt -> failed + held for manual
//     reconciliation; the money is NOT auto-reversed (a vend may exist).
//  5. A FRESH stuck row is left alone — an in-flight writer may own it.
//  6. Posted compensation (either plane's keys) converges status, no double pay.
//  7. A paystack-source stuck row refunds the captured charge to the wallet.
//  8. ClaimStuckTransaction: exactly one of two CAS claims wins.
//  9. Admin reversal skips the money leg when compensation already posted, and
//     refuses to mint a reversal against a row with no debit at all.

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/utilitybills"
)

// stuckAmount is the fixture purchase size — every test uses the same value so
// the wallet-delta assertions stay exact.
const stuckAmount = int64(500_000)

// insertStuckTransaction creates a real utility_transactions row (via the same
// INSERT PayUtility uses), then forces its status and updated_at so the
// recovery path sees it as stale — or leaves it fresh when stale=false.
func (f *fixture) insertStuckTransaction(t *testing.T, status, source, key string, stale bool) *utilitybills.TransactionRow {
	t.Helper()
	ctx := context.Background()
	receipt := "UTL-STUCK-" + uuid.New().String()[:8]
	productID := f.productID
	row, dup, err := utilitybills.NewRepository(f.pool).InsertTransaction(ctx, &utilitybills.TransactionRow{
		UserID:            f.userID,
		Category:          "electricity",
		BillerID:          f.billerID,
		ProductID:         &productID,
		CustomerReference: meterSuccessPrepaid,
		AmountKobo:        stuckAmount,
		RetailAmountKobo:  stuckAmount,
		ProviderCostKobo:  stuckAmount,
		Status:            "initiated",
		ReceiptNumber:     &receipt,
		IdempotencyKey:    key,
		PaymentSource:     source,
	})
	if err != nil || dup {
		t.Fatalf("insert stuck transaction: err=%v dup=%v", err, dup)
	}
	age := "0"
	if stale {
		age = "15"
	}
	if _, err := f.pool.Exec(ctx, `
		UPDATE public.utility_transactions
		SET status = $2, updated_at = now() - ($3 || ' minutes')::interval
		WHERE id = $1`, row.ID, status, age); err != nil {
		t.Fatalf("age transaction: %v", err)
	}
	reloaded, err := f.svc.GetTransaction(ctx, row.ID)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	return reloaded
}

// postGoDebit writes the wallet debit exactly as PayUtility does — journal legs
// under the Go convention "<key>:debit:debit" / "<key>:debit:credit".
func (f *fixture) postGoDebit(t *testing.T, key, receipt string) {
	t.Helper()
	walletSvc := wallet.NewService(f.ledger, tiers.NewService(f.pool))
	if err := walletSvc.Debit(context.Background(), f.userID, receipt, key+":debit", f.clearingID, stuckAmount); err != nil {
		t.Fatalf("post debit: %v", err)
	}
}

// terminalize forces a test row out of the pending set at test end. Tests that
// deliberately leave a row initiated/wallet_debited would otherwise leak it
// into the shared suite DB, where a later run's ListPending(oldest-first)
// picks it before the rows that run created.
func (f *fixture) terminalize(t *testing.T, txID string) {
	t.Helper()
	t.Cleanup(func() {
		if _, err := f.pool.Exec(context.Background(), `
			UPDATE public.utility_transactions SET status = 'failed'
			WHERE id = $1 AND status IN ('initiated','wallet_debited','provider_pending')`, txID); err != nil {
			t.Logf("cleanup terminalize %s: %v", txID, err)
		}
	})
}

func (f *fixture) eventCount(t *testing.T, txID, eventType string) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM public.utility_transaction_events WHERE transaction_id=$1 AND event_type=$2`,
		txID, eventType).Scan(&n); err != nil {
		t.Fatalf("count events: %v", err)
	}
	return n
}

func TestLiveDB_StuckRecovery_WalletDebitedNoAttemptsReverses(t *testing.T) {
	f := newFixture(t, 2, 2_000_000, false)
	ctx := context.Background()

	key := "test-stuck-debited-" + uuid.New().String()
	txn := f.insertStuckTransaction(t, "wallet_debited", "wallet", key, true)
	before := f.walletNet(t)
	f.postGoDebit(t, key, *txn.ReceiptNumber)
	updated, err := f.svc.RequeryTransaction(ctx, txn.ID)
	if err != nil {
		t.Fatalf("requery: %v", err)
	}
	if updated.Status != string(utilitybills.StatusReversed) {
		t.Fatalf("status = %s, want reversed — the debit was provably never fulfilled", updated.Status)
	}
	if got := f.walletNet(t) - before; got != 0 {
		t.Fatalf("net wallet effect = %d, want 0 — the member must get the debit back", got)
	}
	if n := f.entriesForReference(t, "utility:reversal:"+txn.ID); n != 2 {
		t.Fatalf("reversal posted %d entries, want a balanced pair", n)
	}
}

func TestLiveDB_StuckRecovery_InitiatedWithoutDebitFailsCleanly(t *testing.T) {
	f := newFixture(t, 2, 2_000_000, false)
	ctx := context.Background()

	key := "test-stuck-initiated-" + uuid.New().String()
	txn := f.insertStuckTransaction(t, "initiated", "wallet", key, true)

	before := f.walletNet(t)
	updated, err := f.svc.RequeryTransaction(ctx, txn.ID)
	if err != nil {
		t.Fatalf("requery: %v", err)
	}
	if updated.Status != string(utilitybills.StatusFailed) {
		t.Fatalf("status = %s, want failed — no debit posted, nothing to reverse", updated.Status)
	}
	if got := f.walletNet(t) - before; got != 0 {
		t.Fatalf("net wallet effect = %d, want 0 — no reversal may be minted on a debit that never posted", got)
	}
}

func TestLiveDB_StuckRecovery_FailedAttemptsStillReverse(t *testing.T) {
	f := newFixture(t, 2, 2_000_000, false)
	ctx := context.Background()
	repo := utilitybills.NewRepository(f.pool)

	key := "test-stuck-failed-" + uuid.New().String()
	txn := f.insertStuckTransaction(t, "wallet_debited", "wallet", key, true)
	before := f.walletNet(t)
	f.postGoDebit(t, key, *txn.ReceiptNumber)

	attempt, err := repo.StartAttempt(ctx, txn.ID, f.providerID, "", 1, key+":provider:test:attempt:1")
	if err != nil {
		t.Fatalf("start attempt: %v", err)
	}
	if err := repo.FinishAttempt(ctx, attempt.ID, utilitybills.AttemptOutcome{Status: "failed", Message: "provider declined"}); err != nil {
		t.Fatalf("finish attempt: %v", err)
	}

	updated, err := f.svc.RequeryTransaction(ctx, txn.ID)
	if err != nil {
		t.Fatalf("requery: %v", err)
	}
	if updated.Status != string(utilitybills.StatusReversed) {
		t.Fatalf("status = %s, want reversed — a definitive provider failure is safe to compensate", updated.Status)
	}
	if got := f.walletNet(t) - before; got != 0 {
		t.Fatalf("net wallet effect = %d, want 0", got)
	}
}

func TestLiveDB_StuckRecovery_AmbiguousAttemptNeverAutoRefunds(t *testing.T) {
	f := newFixture(t, 2, 2_000_000, false)
	ctx := context.Background()
	repo := utilitybills.NewRepository(f.pool)

	key := "test-stuck-ambig-" + uuid.New().String()
	txn := f.insertStuckTransaction(t, "wallet_debited", "wallet", key, true)
	f.postGoDebit(t, key, *txn.ReceiptNumber)

	// A 'timeout' attempt means the provider may have received and vended the
	// request — the request_id is timestamp-embedded and cannot be reconstructed,
	// so nothing can prove it did NOT vend. The money must be held for a human.
	attempt, err := repo.StartAttempt(ctx, txn.ID, f.providerID, "", 1, key+":provider:test:attempt:1")
	if err != nil {
		t.Fatalf("start attempt: %v", err)
	}
	if err := repo.FinishAttempt(ctx, attempt.ID, utilitybills.AttemptOutcome{Status: "timeout", Message: "deadline exceeded"}); err != nil {
		t.Fatalf("finish attempt: %v", err)
	}

	before := f.walletNet(t)
	updated, err := f.svc.RequeryTransaction(ctx, txn.ID)
	if err != nil {
		t.Fatalf("requery: %v", err)
	}
	if updated.Status != string(utilitybills.StatusFailed) {
		t.Fatalf("status = %s, want failed — ambiguous evidence must not settle money", updated.Status)
	}
	if got := f.walletNet(t) - before; got != 0 {
		t.Fatalf("net wallet effect = %d, want 0 — refunding a vend that may exist pays out twice", got)
	}
	if n := f.eventCount(t, txn.ID, "stuck_needs_manual_reconciliation"); n != 1 {
		t.Fatalf("manual-reconciliation events = %d, want 1", n)
	}
	if n := f.entriesForReference(t, "utility:reversal:"+txn.ID); n != 0 {
		t.Fatalf("a reversal was posted for an ambiguous transaction (%d entries)", n)
	}
}

func TestLiveDB_StuckRecovery_FreshRowLeftAlone(t *testing.T) {
	f := newFixture(t, 2, 2_000_000, false)
	ctx := context.Background()

	key := "test-stuck-fresh-" + uuid.New().String()
	txn := f.insertStuckTransaction(t, "wallet_debited", "wallet", key, false /* fresh */)
	f.terminalize(t, txn.ID)
	f.postGoDebit(t, key, *txn.ReceiptNumber)

	updated, err := f.svc.RequeryTransaction(ctx, txn.ID)
	if err != nil {
		t.Fatalf("requery: %v", err)
	}
	if updated.Status != "wallet_debited" {
		t.Fatalf("status = %s, want wallet_debited — an in-flight writer may still own a fresh row", updated.Status)
	}
}

func TestLiveDB_StuckRecovery_ExistingCompensationConverges(t *testing.T) {
	f := newFixture(t, 2, 2_000_000, false)
	ctx := context.Background()

	key := "test-stuck-comp-" + uuid.New().String()
	txn := f.insertStuckTransaction(t, "wallet_debited", "wallet", key, true)
	f.postGoDebit(t, key, *txn.ReceiptNumber)

	// Simulate a reversal the in-flight writer posted before dying between the
	// reversal and the status update — under the Go "<key>:reversal" base.
	if err := f.ledger.PostReversal(ctx, f.walletID, f.clearingID, stuckAmount,
		"utility:reversal:"+txn.ID, key+":reversal"); err != nil {
		t.Fatalf("post reversal: %v", err)
	}

	before := f.walletNet(t)
	updated, err := f.svc.RequeryTransaction(ctx, txn.ID)
	if err != nil {
		t.Fatalf("requery: %v", err)
	}
	if updated.Status != string(utilitybills.StatusReversed) {
		t.Fatalf("status = %s, want reversed — status converges to the money truth", updated.Status)
	}
	if got := f.walletNet(t) - before; got != 0 {
		t.Fatalf("net wallet effect = %d, want 0 — compensation must never post twice", got)
	}
}

func TestLiveDB_StuckRecovery_PaystackRefundsWallet(t *testing.T) {
	f := newFixture(t, 2, 2_000_000, false)
	ctx := context.Background()

	key := "test-stuck-paystack-" + uuid.New().String()
	// A paystack-source row exists only because the charge already verified —
	// the money was captured, so recovery is a wallet CREDIT, never a reversal
	// of a debit that never happened. The captured payment_reference is the
	// proof of capture the refund requires.
	txn := f.insertStuckTransaction(t, "initiated", "paystack", key, true)
	if _, err := f.pool.Exec(ctx, `
		UPDATE public.utility_transactions
		SET metadata = metadata || $2::jsonb
		WHERE id = $1`, txn.ID, `{"payment_reference":"UTIL_LIVE_REF_`+key+`"}`); err != nil {
		t.Fatalf("set payment_reference: %v", err)
	}
	reloaded, rerr := f.svc.GetTransaction(ctx, txn.ID)
	if rerr != nil {
		t.Fatalf("reload with reference: %v", rerr)
	}
	txn = reloaded

	before := f.walletNet(t)
	updated, err := f.svc.RequeryTransaction(ctx, txn.ID)
	if err != nil {
		t.Fatalf("requery: %v", err)
	}
	if updated.Status != string(utilitybills.StatusReversed) {
		t.Fatalf("status = %s, want reversed — the captured charge must be refunded", updated.Status)
	}
	if got := f.walletNet(t) - before; got != stuckAmount {
		t.Fatalf("wallet gained %d, want %d — the captured charge must land in the wallet", got, stuckAmount)
	}
	// Idempotent: if the row were stranded at 'initiated' again (e.g. the status
	// update lost its own race), a second recovery pass must detect the posted
	// refund leg and converge WITHOUT crediting twice.
	if _, err := f.pool.Exec(ctx, `
		UPDATE public.utility_transactions
		SET status = 'initiated', updated_at = now() - interval '15 minutes'
		WHERE id = $1`, txn.ID); err != nil {
		t.Fatalf("re-age transaction: %v", err)
	}
	if _, err := f.svc.RequeryTransaction(ctx, txn.ID); err != nil {
		t.Fatalf("second requery: %v", err)
	}
	if got := f.walletNet(t) - before; got != stuckAmount {
		t.Fatalf("wallet gained %d after second pass, want exactly %d — double refund", got, stuckAmount)
	}
}

func TestLiveDB_ClaimForSettlement_OnlyOneWin(t *testing.T) {
	f := newFixture(t, 2, 2_000_000, false)
	ctx := context.Background()
	repo := utilitybills.NewRepository(f.pool)

	key := "test-stuck-claim-" + uuid.New().String()
	txn := f.insertStuckTransaction(t, "wallet_debited", "wallet", key, true)

	first, err := repo.ClaimForSettlement(ctx, txn.ID, txn.UpdatedAt, "test claim")
	if err != nil || first == nil {
		t.Fatalf("first claim = %+v, err = %v; want the claimed row", first, err)
	}
	if first.Status != string(utilitybills.StatusFailed) {
		t.Fatalf("claimed status = %s, want failed — the claim must move the row out of every other claim set", first.Status)
	}
	// A second claim on the same observed version must lose (updated_at moved).
	second, err := repo.ClaimForSettlement(ctx, txn.ID, txn.UpdatedAt, "second claim")
	if err != nil {
		t.Fatalf("second claim: %v", err)
	}
	if second != nil {
		t.Fatal("a second claim on the same observed version succeeded — two compensators could settle the same row")
	}
	// And a fresh read of the now-'failed' row cannot be claimed either while it
	// is inside the admin settle window — the first compensator still owns it.
	fresh, err := f.svc.GetTransaction(ctx, txn.ID)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	third, err := repo.ClaimForSettlement(ctx, txn.ID, fresh.UpdatedAt, "third claim")
	if err != nil {
		t.Fatalf("third claim: %v", err)
	}
	if third != nil {
		t.Fatal("a claim on a just-failed row inside the settle window succeeded — compensation is not serialised")
	}
}

func TestLiveDB_AdminReversal_SkipsAlreadyCompensated(t *testing.T) {
	f := newFixture(t, 2, 2_000_000, false)
	ctx := context.Background()

	key := "test-admin-rev-comp-" + uuid.New().String()
	// stale=true: the admin claim on a 'failed' row waits out the 60s settle
	// window so it cannot collide with a compensator still inside its window.
	txn := f.insertStuckTransaction(t, "failed", "wallet", key, true)
	f.postGoDebit(t, key, *txn.ReceiptNumber)
	// Compensation already posted under the GO convention — the admin key
	// (utility:<tx>:ADMIN_REVERSAL_DEBIT) cannot dedupe this on its own.
	if err := f.ledger.PostReversal(ctx, f.walletID, f.clearingID, stuckAmount,
		"utility:reversal:"+txn.ID, key+":reversal"); err != nil {
		t.Fatalf("post reversal: %v", err)
	}

	before := f.walletNet(t)
	updated, err := f.svc.ReverseTransaction(ctx, "admin-test", txn.ID, "manual support reversal")
	if err != nil {
		t.Fatalf("admin reversal: %v", err)
	}
	if updated.Status != string(utilitybills.StatusReversed) {
		t.Fatalf("status = %s, want reversed", updated.Status)
	}
	if got := f.walletNet(t) - before; got != 0 {
		t.Fatalf("admin reversal moved %d kobo, want 0 — a second refund was paid", got)
	}
}

func TestLiveDB_AdminReversal_RefusesUnbackedReversal(t *testing.T) {
	f := newFixture(t, 2, 2_000_000, false)
	ctx := context.Background()

	key := "test-admin-rev-nodebit-" + uuid.New().String()
	txn := f.insertStuckTransaction(t, "failed", "wallet", key, true)

	before := f.walletNet(t)
	_, err := f.svc.ReverseTransaction(ctx, "admin-test", txn.ID, "manual support reversal")
	if err == nil {
		t.Fatal("admin reversal succeeded on a row with no debit — it just minted a refund out of nothing")
	}
	if got := f.walletNet(t) - before; got != 0 {
		t.Fatalf("wallet moved %d on a refused reversal", got)
	}
	// And the row must NOT have been flipped to reversed on a refused refund.
	reloaded, rerr := f.svc.GetTransaction(ctx, txn.ID)
	if rerr != nil {
		t.Fatalf("reload: %v", rerr)
	}
	if reloaded.Status != string(utilitybills.StatusFailed) {
		t.Fatalf("status = %s, want failed — a refused reversal must not fake a refund", reloaded.Status)
	}
}

// 'disputed' is outside every claim/requery/reversal set — opening one on a
// NON-terminal row would strand its debit forever. Disputes are for delivered
// charges only.
func TestLiveDB_CreateDispute_RejectsNonTerminalTransaction(t *testing.T) {
	f := newFixture(t, 2, 2_000_000, false)
	ctx := context.Background()

	key := "test-stuck-dispute-" + uuid.New().String()
	txn := f.insertStuckTransaction(t, "wallet_debited", "wallet", key, true)
	f.terminalize(t, txn.ID)
	f.postGoDebit(t, key, *txn.ReceiptNumber)

	_, err := f.svc.CreateDispute(ctx, f.userID, txn.ID, "where is my vend")
	if err == nil {
		t.Fatal("dispute opened on an in-flight transaction — the row would be frozen out of every recovery path")
	}
	reloaded, rerr := f.svc.GetTransaction(ctx, txn.ID)
	if rerr != nil {
		t.Fatalf("reload: %v", rerr)
	}
	if reloaded.Status != "wallet_debited" {
		t.Fatalf("status = %s, want wallet_debited — a refused dispute must not move the row", reloaded.Status)
	}
}

// Sanity on the age gate boundary: the sweep's pending list still picks up
// rows regardless of age (ListPending has no TTL), and recovery is what applies
// the stuck threshold — so a fresh provider_pending row with a real provider
// reference is still requeried normally.
func TestLiveDB_StuckRecovery_PendingWithReferenceStillRequeries(t *testing.T) {
	f := newFixture(t, 2, 2_000_000, false)
	ctx := context.Background()

	key := "test-stuck-pending-" + uuid.New().String()
	res, err := f.pay(t, meterTimeout, 500_000, key)
	if err != nil {
		t.Fatalf("pay: %v", err)
	}
	txn := res.Transaction
	if txn.Status != string(utilitybills.StatusProviderPending) || txn.ProviderReference == nil {
		t.Fatalf("setup: status=%s ref=%v — the sandbox pending purchase must carry a provider reference",
			txn.Status, txn.ProviderReference)
	}

	updated, err := f.svc.RequeryTransaction(ctx, txn.ID)
	if err != nil {
		t.Fatalf("requery: %v", err)
	}
	if updated.Status != string(utilitybills.StatusSuccessful) {
		t.Fatalf("status = %s, want successful — the sandbox GetBill answers on the real reference", updated.Status)
	}
}
