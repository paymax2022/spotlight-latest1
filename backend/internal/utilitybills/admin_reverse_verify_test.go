package utilitybills

// Live-DB regression for the admin-reversal ErrDuplicate swallow
// (verified-adopt parity with autoReverse).
//
// ReverseTransaction used to treat ANY ledger.ErrDuplicate from PostReversal as
// "the reversal already posted" and flip the row to 'reversed'. ErrDuplicate
// proves only that the idempotency key family is claimed — a Redis-lock TTL
// dup, or a unique violation on a SIBLING leg (":rev_credit" — which the
// money-leg probe does not inspect) — none of which prove a durable
// REVERSAL_DEBIT exists on the member's wallet. Converging to 'reversed' in
// that state reports money returned that never was, and 'reversed' is terminal
// so nothing retries. The fix mirrors autoReverse's verified-adopt: on
// ErrDuplicate, probe the ledger of record for the member-side rev_debit leg —
// adopt only when it is provably there, otherwise fail closed and leave the
// row 'failed' for a retry.
//
// These tests run only with TEST_DATABASE_URL set (same gating as
// admin_category_conflict_test.go). Ledger rows written here cannot be deleted
// (the ledger_entries_no_update_delete trigger), so every key carries a fresh
// uuid and cleanup removes only the utility/auth rows that CAN be removed.
// The seeded auth.users + ledger_accounts rows are intentionally left behind —
// uuid-scoped and inert, matching how other live tests in this suite tolerate
// residue they cannot delete.

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/finance/ledger"
)

func TestLiveDB_ReverseTransaction_DuplicateKeyWithoutMemberLegFailsClosed(t *testing.T) {
	ctx := context.Background()
	pool := livePoolUtilitybills(t)
	repo := NewRepository(pool)
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := NewService(Deps{Repo: repo, Ledger: ledgerSvc})

	userID := uuid.NewString()
	billerID := uuid.NewString()
	key := "ub-rev-" + uuid.NewString()

	if _, err := pool.Exec(ctx, `
		INSERT INTO auth.users (id, email, aud, role)
		VALUES ($1, $2, 'authenticated', 'authenticated')
		ON CONFLICT (id) DO NOTHING`, userID, "ub-rev-"+userID+"@test.local"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.utility_billers (id, category, name, code)
		VALUES ($1, 'airtime', 'Reverse Test Biller', $2)`, billerID, "ub-rev-"+billerID[:8]); err != nil {
		t.Fatalf("seed biller: %v", err)
	}

	walletAcc, err := ledgerSvc.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		t.Fatalf("user wallet: %v", err)
	}
	clearing, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("clearing account: %v", err)
	}

	receipt := "UTL-REV-" + uuid.NewString()[:8]
	tx, dup, err := repo.InsertTransaction(ctx, &TransactionRow{
		UserID:            userID,
		Category:          "airtime",
		BillerID:          billerID,
		CustomerReference: "08030000000",
		AmountKobo:        100_000,
		RetailAmountKobo:  100_000,
		ProviderCostKobo:  95_000,
		Status:            "initiated",
		ReceiptNumber:     &receipt,
		IdempotencyKey:    key,
		PaymentSource:     "wallet",
	})
	if err != nil || dup {
		t.Fatalf("seed transaction: dup=%v err=%v", dup, err)
	}
	// Age the row past adminSettleWindow and park it 'failed' so the admin
	// claim can take it.
	if _, err := pool.Exec(ctx, `
		UPDATE public.utility_transactions
		SET status = 'failed', updated_at = now() - interval '2 minutes'
		WHERE id = $1`, tx.ID); err != nil {
		t.Fatalf("age transaction: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM public.utility_transaction_events WHERE transaction_id = $1`, tx.ID)
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM public.utility_transactions WHERE id = $1`, tx.ID)
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM public.utility_billers WHERE id = $1`, billerID)
		// auth.users + the ledger rows stay: ledger_entries is immutable and
		// cascades from the account delete would violate that trigger.
	})

	// The member-side debit leg the probe requires, paired with its clearing
	// credit so the shared ledger still conserves (ADR-040).
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.ledger_entries (account_id, type, amount_kobo, reference, idempotency_key)
		VALUES ($1, 'DEBIT', $2, $3, $4), ($5, 'CREDIT', $2, $3, $6)`,
		walletAcc.ID, 100_000, "utility:debit:"+tx.ID, "utility:"+tx.ID+":DEBIT",
		clearing.ID, "utility:"+tx.ID+":DEBIT:credit"); err != nil {
		t.Fatalf("seed debit leg: %v", err)
	}
	// A FOREIGN sibling leg claiming the admin-reversal family's :rev_credit
	// half on a DIFFERENT account. The money-leg probe only inspects the
	// :rev_debit half (the member restore), so compensationPosted stays false
	// and PostReversal runs — its own :rev_debit insert then rolls back on the
	// rev_credit unique violation → ErrDuplicate with NO durable legs.
	// The foreign family gets its own :rev_debit half (key-scoped elsewhere, so
	// the probe still reads the family as unposted) to keep the pair balanced.
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.ledger_entries (account_id, type, amount_kobo, reference, idempotency_key)
		VALUES ($1, 'REVERSAL_DEBIT', $2, $3, $4), ($5, 'REVERSAL_CREDIT', $2, $3, $6)`,
		walletAcc.ID, 100_000, "utility:foreign:"+tx.ID, "utility:foreign:"+tx.ID+":rev_debit",
		clearing.ID, "utility:"+tx.ID+":ADMIN_REVERSAL_DEBIT:rev_credit"); err != nil {
		t.Fatalf("seed foreign sibling legs: %v", err)
	}

	got, err := svc.ReverseTransaction(ctx, "admin-1", tx.ID, "test reversal")
	if err == nil {
		t.Fatalf("a duplicate key WITHOUT a durable member-side reversal leg must fail closed, got row=%v", got)
	}
	row, rerr := repo.GetTransaction(ctx, tx.ID)
	if rerr != nil {
		t.Fatalf("re-read transaction: %v", rerr)
	}
	if row.Status != "failed" {
		t.Fatalf("status = %q, want failed — 'reversed' without a durable reversal leg is a phantom refund", row.Status)
	}
}

// TestLiveDB_ReverseTransaction_PostsBalancedReversal is the positive control:
// an unclaimed key posts the full pair and converges the row to 'reversed',
// and a retry of the SAME reversal replays idempotently via verified-adopt.
func TestLiveDB_ReverseTransaction_PostsBalancedReversal(t *testing.T) {
	ctx := context.Background()
	pool := livePoolUtilitybills(t)
	repo := NewRepository(pool)
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := NewService(Deps{Repo: repo, Ledger: ledgerSvc})

	userID := uuid.NewString()
	billerID := uuid.NewString()
	key := "ub-revok-" + uuid.NewString()

	if _, err := pool.Exec(ctx, `
		INSERT INTO auth.users (id, email, aud, role)
		VALUES ($1, $2, 'authenticated', 'authenticated')
		ON CONFLICT (id) DO NOTHING`, userID, "ub-revok-"+userID+"@test.local"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.utility_billers (id, category, name, code)
		VALUES ($1, 'airtime', 'Reverse OK Biller', $2)`, billerID, "ub-revok-"+billerID[:8]); err != nil {
		t.Fatalf("seed biller: %v", err)
	}

	walletAcc, err := ledgerSvc.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		t.Fatalf("user wallet: %v", err)
	}
	clearing, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("clearing account: %v", err)
	}

	receipt := "UTL-REVOK-" + uuid.NewString()[:8]
	tx, dup, err := repo.InsertTransaction(ctx, &TransactionRow{
		UserID:            userID,
		Category:          "airtime",
		BillerID:          billerID,
		CustomerReference: "08030000000",
		AmountKobo:        100_000,
		RetailAmountKobo:  100_000,
		ProviderCostKobo:  95_000,
		Status:            "initiated",
		ReceiptNumber:     &receipt,
		IdempotencyKey:    key,
		PaymentSource:     "wallet",
	})
	if err != nil || dup {
		t.Fatalf("seed transaction: dup=%v err=%v", dup, err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE public.utility_transactions
		SET status = 'failed', updated_at = now() - interval '2 minutes'
		WHERE id = $1`, tx.ID); err != nil {
		t.Fatalf("age transaction: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM public.utility_transaction_events WHERE transaction_id = $1`, tx.ID)
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM public.utility_transactions WHERE id = $1`, tx.ID)
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM public.utility_billers WHERE id = $1`, billerID)
	})

	if _, err := pool.Exec(ctx, `
		INSERT INTO public.ledger_entries (account_id, type, amount_kobo, reference, idempotency_key)
		VALUES ($1, 'DEBIT', $2, $3, $4), ($5, 'CREDIT', $2, $3, $6)`,
		walletAcc.ID, 100_000, "utility:debit:"+tx.ID, "utility:"+tx.ID+":DEBIT",
		clearing.ID, "utility:"+tx.ID+":DEBIT:credit"); err != nil {
		t.Fatalf("seed debit leg: %v", err)
	}

	got, err := svc.ReverseTransaction(ctx, "admin-1", tx.ID, "admin refund")
	if err != nil {
		t.Fatalf("reverse: %v", err)
	}
	if got.Status != string(StatusReversed) {
		t.Fatalf("status = %q, want reversed", got.Status)
	}
	// The reversal must be a balanced pair: member wallet restored
	// (REVERSAL_DEBIT) AND the clearing hold drained (REVERSAL_CREDIT).
	if amt, posted, err := ledgerSvc.EntryAmount(ctx, walletAcc.ID, "utility:"+tx.ID+":ADMIN_REVERSAL_DEBIT:rev_debit"); err != nil || !posted || amt != 100_000 {
		t.Fatalf("member rev_debit leg: posted=%v amount=%d err=%v", posted, amt, err)
	}
	if amt, posted, err := ledgerSvc.EntryAmount(ctx, clearing.ID, "utility:"+tx.ID+":ADMIN_REVERSAL_DEBIT:rev_credit"); err != nil || !posted || amt != 100_000 {
		t.Fatalf("clearing rev_credit leg: posted=%v amount=%d err=%v", posted, amt, err)
	}
}
