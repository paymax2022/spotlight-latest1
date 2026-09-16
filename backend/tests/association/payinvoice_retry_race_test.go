package association_test

// ---------------------------------------------------------------------------
// LIVE-DB reproduction: does PayInvoice recover from a retry after the ledger
// debit succeeded but the bookkeeping transaction never committed (a crash,
// or any failure between service.go's ledger.Debit call and tx.Commit)?
//
// PayInvoice posts the ledger debit BEFORE opening the bookkeeping tx that
// inserts assoc_payments / flips the invoice to PAID. If the process dies in
// that window, a retry with the SAME Idempotency-Key re-enters PayInvoice
// with the invoice still not PAID (so the early "already PAID" shortcut does
// not fire) and calls ledger.Debit again with the same key. ledger.Debit is
// itself idempotent and returns ledger.ErrDuplicate on a replayed key — but
// PayInvoice's `if err := s.ledger.Debit(...); err != nil { return nil, ... }`
// treats ANY non-nil error, including ErrDuplicate, as a hard failure. If
// that is true, the invoice can never be paid again: every retry fails with
// a duplicate-debit error while the invoice permanently sits at DUE, even
// though the member's money was already, correctly, debited exactly once.
//
// Gated on TEST_DATABASE_URL alone — see live_db_integration_test.go's
// bring-up note for this package.
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/association/... -run LiveDB_PayInvoice_RetryAfterDebitButBeforeCommit -v
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/association"
	"spotlight/backend/internal/finance/ledger"
)

func TestLiveDB_PayInvoice_RetryAfterDebitButBeforeCommit(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ledRepo := ledger.NewRepository(pool)
	led := ledger.NewService(ledRepo, (*goredis.Client)(nil))
	ctx := context.Background()

	orgID := seedOrganisation(t, ctx, pool, "Retry Race Guild "+newIdemKey(t, "org"))
	userID, membershipID := seedActiveMembership(t, ctx, pool, orgID)
	const amount = int64(300_00)
	invoiceID := seedDuesInvoice(t, ctx, pool, membershipID, amount)
	seedWallet(t, ctx, led, userID, amount*2)

	balBefore, err := led.GetBalance(ctx, userID)
	if err != nil {
		t.Fatalf("GetBalance before: %v", err)
	}

	key := newIdemKey(t, "retry-race")

	// Simulate PayInvoice's own ledger debit step running to completion, then
	// the process dying before it reaches tx.Begin() / tx.Commit() — same
	// reference format PayInvoice itself uses ("assoc_dues:" + invoiceID),
	// same account, same key, same amount.
	settle, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		t.Fatalf("resolve settlement account: %v", err)
	}
	if err := led.Debit(ctx, userID, "assoc_dues:"+invoiceID, key, settle.ID, amount); err != nil {
		t.Fatalf("simulate the interrupted first attempt's debit: %v", err)
	}

	// Confirm the crash scenario is real: money moved, but no bookkeeping
	// happened yet — invoice still DUE, no assoc_payments row.
	balAfterSimulatedCrash, err := led.GetBalance(ctx, userID)
	if err != nil {
		t.Fatalf("GetBalance after simulated crash: %v", err)
	}
	if balBefore-balAfterSimulatedCrash != amount {
		t.Fatalf("test setup: balance did not drop by the invoice amount after the simulated debit")
	}
	var preRetryStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM assoc_dues_invoices WHERE id=$1`, invoiceID).Scan(&preRetryStatus); err != nil {
		t.Fatalf("read invoice status before retry: %v", err)
	}
	if preRetryStatus == "PAID" {
		t.Fatalf("test setup: invoice is already PAID before the retry — scenario not reproduced")
	}
	var prePaymentCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_payments WHERE invoice_id=$1`, invoiceID).Scan(&prePaymentCount); err != nil {
		t.Fatalf("count payments before retry: %v", err)
	}
	if prePaymentCount != 0 {
		t.Fatalf("test setup: an assoc_payments row already exists before the retry — scenario not reproduced")
	}

	// The client, having never received a response, retries with the SAME
	// Idempotency-Key — exactly what a well-behaved client is supposed to do.
	result, err := svc.PayInvoice(ctx, userID, invoiceID, association.PayInvoiceRequest{
		Method: "WALLET", IdempotencyKey: key,
	})

	if err != nil {
		// This is the bug this test exists to prove or disprove: a retry
		// after a partial failure is stuck forever, even though the member's
		// money was already correctly (and only once) debited.
		t.Errorf("PayInvoice retry with the same Idempotency-Key as an already-posted debit FAILED instead of recovering: %v — "+
			"the invoice can never be marked PAID from this state; the member paid but has no receipt and an eternally-DUE invoice", err)

		var stuckStatus string
		pool.QueryRow(ctx, `SELECT status FROM assoc_dues_invoices WHERE id=$1`, invoiceID).Scan(&stuckStatus)
		t.Logf("invoice status after the failed retry: %q (money already left the wallet)", stuckStatus)
		return
	}

	if result.Status != "SUCCESS" {
		t.Errorf("retry result status = %q, want SUCCESS", result.Status)
	}

	var finalStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM assoc_dues_invoices WHERE id=$1`, invoiceID).Scan(&finalStatus); err != nil {
		t.Fatalf("read final invoice status: %v", err)
	}
	if finalStatus != "PAID" {
		t.Errorf("invoice status after successful retry = %q, want PAID", finalStatus)
	}

	// Money must not have moved a second time — the ORIGINAL simulated debit
	// is the only real debit that should exist.
	balAfterRetry, err := led.GetBalance(ctx, userID)
	if err != nil {
		t.Fatalf("GetBalance after retry: %v", err)
	}
	if balAfterRetry != balAfterSimulatedCrash {
		t.Errorf("balance changed AGAIN on retry (from %d to %d) — the debit was posted twice", balAfterSimulatedCrash, balAfterRetry)
	}
}
