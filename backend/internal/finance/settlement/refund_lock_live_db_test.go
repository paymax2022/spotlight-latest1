package settlement_test

// LIVE-DB tests for M3 (third ledger audit): Refund / RefundExternal must hold the
// settlement ROW LOCK across the status check, the ledger post and the status flip,
// so a Settle racing a refund cannot double-debit escrow (settle legs AND a refund
// journal both posted for one escrow).
// SKIPPED whenever TEST_DATABASE_URL is unset.

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/testsupport"
)

func lockRig(t *testing.T) (context.Context, *settlement.Service, *ledger.Service, string, func(string) int) {
	t.Helper()
	ctx := context.Background()
	pool := mustStandingPool(t)
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := settlement.NewService(pool, ledgerSvc)
	payer := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, payer, payer+"@seed.test"); err != nil {
		t.Fatal(err)
	}
	testsupport.CleanupUser(t, pool, payer)
	entries := func(refPrefix string) int {
		var n int
		_ = pool.QueryRow(ctx, `SELECT count(*) FROM ledger_entries WHERE reference LIKE $1`, refPrefix+"%").Scan(&n)
		return n
	}
	return ctx, svc, ledgerSvc, payer, entries
}

// holdAsSettle takes the settlement row lock in a tx and flips it to 'settled' WITHOUT
// committing — exactly the state of a Settle mid-flight.
func holdAsSettle(t *testing.T, ctx context.Context, id string) (commit func()) {
	t.Helper()
	pool := mustStandingPool(t)
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var st string
	if err := tx.QueryRow(ctx, `SELECT status FROM settlements WHERE id=$1 FOR UPDATE`, id).Scan(&st); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `UPDATE settlements SET status='settled' WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	return func() {
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
	}
}

func TestLiveDB_RefundExternal_BlocksBehindASettleInFlight_PostsNoRefund(t *testing.T) {
	ctx, svc, _, payer, entries := lockRig(t)
	ref := "carhire:lock-" + uuid.NewString()[:12]
	sett, err := svc.EscrowExternal(ctx, payer, ref, "lock-"+uuid.NewString(), "transport", 5_000)
	if err != nil {
		t.Fatal(err)
	}
	commit := holdAsSettle(t, ctx, sett.ID)
	done := make(chan error, 1)
	go func() { done <- svc.RefundExternal(ctx, sett.ID, "race") }()
	select {
	case err := <-done:
		commit()
		t.Fatalf("RefundExternal returned (%v) while a Settle held the row lock: it must wait, not post a refund journal over a settling escrow", err)
	case <-time.After(400 * time.Millisecond):
	}
	commit()
	if err := <-done; err != nil {
		t.Fatalf("after the settle committed, refunding a settled row is a no-op: %v", err)
	}
	if n := entries("refund:" + ref); n != 0 {
		t.Errorf("%d refund ledger entries posted for an escrow that settled", n)
	}
	if got := statusOf(t, svc, sett.ID); got != settlement.StatusSettled {
		t.Errorf("status %s, want settled", got)
	}
}

func TestLiveDB_RefundWallet_BlocksBehindASettleInFlight_PostsNoRefund(t *testing.T) {
	ctx, svc, ledgerSvc, payer, entries := lockRig(t)
	rev, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatal(err)
	}
	if err := ledgerSvc.Credit(ctx, payer, "seed-fund", "lock-fund-"+payer, rev.ID, 10_000); err != nil {
		t.Fatal(err)
	}
	ref := "carhire:lockw-" + uuid.NewString()[:12]
	sett, err := svc.Escrow(ctx, payer, ref, "lockw-"+uuid.NewString(), "transport", 5_000)
	if err != nil {
		t.Fatal(err)
	}
	commit := holdAsSettle(t, ctx, sett.ID)
	done := make(chan error, 1)
	go func() { done <- svc.Refund(ctx, sett.ID, "race") }()
	select {
	case err := <-done:
		commit()
		t.Fatalf("Refund returned (%v) while a Settle held the row lock", err)
	case <-time.After(400 * time.Millisecond):
	}
	commit()
	if err := <-done; err == nil {
		t.Error("refunding a settled escrow must be an error")
	}
	if n := entries("refund:" + ref); n != 0 {
		t.Errorf("%d refund ledger entries posted for an escrow that settled", n)
	}
}

func TestLiveDB_SettleVersusRefundExternal_Stress_EscrowDebitedExactlyOnce(t *testing.T) {
	ctx, svc, _, payer, _ := lockRig(t)
	pool := mustStandingPool(t)
	provider := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, provider, provider+"@seed.test"); err != nil {
		t.Fatal(err)
	}
	testsupport.CleanupUser(t, pool, provider)
	for i := 0; i < 25; i++ {
		ref := "carhire:stress-" + uuid.NewString()[:12]
		sett, err := svc.EscrowExternal(ctx, payer, ref, "stress-"+uuid.NewString(), "transport", 7_000)
		if err != nil {
			t.Fatal(err)
		}
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			_ = svc.Settle(ctx, sett.ID, settlement.Split{ProviderID: provider, ProviderPct: 1.0})
		}()
		go func() { defer wg.Done(); _ = svc.RefundExternal(ctx, sett.ID, "race") }()
		wg.Wait()
		var escrowOut int64
		if err := pool.QueryRow(ctx, `
			SELECT COALESCE(SUM(le.amount_kobo),0) FROM ledger_entries le
			  JOIN ledger_accounts la ON la.id=le.account_id
			 WHERE la.type='escrow' AND le.type='DEBIT'
			   AND (le.reference LIKE $1 OR le.reference LIKE $2)`, "settle:"+ref+"%", "refund:"+ref+"%").Scan(&escrowOut); err != nil {
			t.Fatal(err)
		}
		if escrowOut != 7_000 {
			t.Fatalf("iter %d: escrow debited %d for a 7000 escrow (status %s) — a Settle racing a refund double-spent it", i, escrowOut, statusOf(t, svc, sett.ID))
		}
	}
}
