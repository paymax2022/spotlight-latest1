package settlement_test

// LIVE-DB tests for RefundExternalByKeyPrefix (ADR-PR522-mobility-card-direct,
// "Partial refunds (car hire)"): a card-direct booking funded by ONE charge may
// hold SEVERAL external settlements whose idempotency keys are
// "<reference>", "<reference>:fare", "<reference>:deposit". The order_failed
// ledger unwind must reverse all of them and nothing else.
// SKIPPED whenever TEST_DATABASE_URL is unset.

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/testsupport"
)

func statusOf(t *testing.T, svc *settlement.Service, id string) settlement.Status {
	t.Helper()
	s, err := svc.GetByID(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return s.Status
}

func TestRefundExternalByKeyPrefix_ReversesFareAndDeposit_NotOtherKeys(t *testing.T) {
	ctx := context.Background()
	pool := mustStandingPool(t)
	svc := settlement.NewService(pool, ledger.NewService(ledger.NewRepository(pool), nil))

	payer := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, payer, payer+"@seed.test"); err != nil {
		t.Fatal(err)
	}
	testsupport.CleanupUser(t, pool, payer)

	ref := "carhireorder:pfx" + uuid.NewString()[:10]
	tag := uuid.NewString()[:12] // unique settlement references: ledger_entries persist across runs
	fareRef, depRef := "carhire:a"+tag, "carhire:a"+tag+":deposit"
	other := ref + "9" // shares the string prefix but is a DIFFERENT reference
	fare, err := svc.EscrowExternal(ctx, payer, fareRef, ref+":fare", "transport", 700)
	if err != nil {
		t.Fatal(err)
	}
	dep, err := svc.EscrowExternal(ctx, payer, depRef, ref+":deposit", "transport", 300)
	if err != nil {
		t.Fatal(err)
	}
	foreign, err := svc.EscrowExternal(ctx, payer, "carhire:b"+tag, other+":fare", "transport", 111)
	if err != nil {
		t.Fatal(err)
	}

	if err := svc.RefundExternalByKeyPrefix(ctx, ref, "unit"); err != nil {
		t.Fatalf("prefix refund: %v", err)
	}
	if statusOf(t, svc, fare.ID) != settlement.StatusRefunded || statusOf(t, svc, dep.ID) != settlement.StatusRefunded {
		t.Error("fare and deposit settlements must both be reversed")
	}
	if statusOf(t, svc, foreign.ID) != settlement.StatusEscrowed {
		t.Error("a settlement of ANOTHER reference sharing a string prefix was reversed")
	}
	// Balanced: each reversal posts one journal (DR escrow / CR clearing) for its own total.
	got := legsForRef(t, pool, "refund:"+fareRef)
	if got["escrow:DEBIT"] != 700 || got["provider_clearing:CREDIT"] != 700 {
		t.Errorf("fare reversal legs = %v", got)
	}
	got = legsForRef(t, pool, "refund:"+depRef)
	if got["escrow:DEBIT"] != 300 || got["provider_clearing:CREDIT"] != 300 {
		t.Errorf("deposit reversal legs = %v", got)
	}
	// Idempotent: a second call is a no-op and posts nothing new.
	if err := svc.RefundExternalByKeyPrefix(ctx, ref, "again"); err != nil {
		t.Fatalf("replay: %v", err)
	}
	var n int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM ledger_entries WHERE reference=$1`, "refund:"+fareRef).Scan(&n)
	if n != 2 {
		t.Errorf("replay posted extra ledger rows: %d entries for the fare reversal, want 2", n)
	}
	// Nothing escrowed under a prefix is a no-op, not an error.
	if err := svc.RefundExternalByKeyPrefix(ctx, "carhireorder:never"+uuid.NewString()[:8], "x"); err != nil {
		t.Errorf("empty prefix: %v", err)
	}
}

func TestRefundExternalByKeyPrefix_UnderscoreIsNotAWildcard(t *testing.T) {
	ctx := context.Background()
	pool := mustStandingPool(t)
	svc := settlement.NewService(pool, ledger.NewService(ledger.NewRepository(pool), nil))
	payer := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, payer, payer+"@seed.test"); err != nil {
		t.Fatal(err)
	}
	testsupport.CleanupUser(t, pool, payer)

	tag := uuid.NewString()[:8]
	// "ab_c" as a LIKE pattern would also match "abXc:fare".
	victim, err := svc.EscrowExternal(ctx, payer, "carhire:v", "carhireorder:"+tag+"abXc:fare", "transport", 50)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.RefundExternalByKeyPrefix(ctx, "carhireorder:"+tag+"ab_c", "unit"); err != nil {
		t.Fatal(err)
	}
	if statusOf(t, svc, victim.ID) != settlement.StatusEscrowed {
		t.Fatal("'_' behaved as a LIKE wildcard: an unrelated settlement was reversed")
	}
}

func TestRefundExternalByKeyPrefix_WalletFundedUnderPrefixIsRefused(t *testing.T) {
	ctx := context.Background()
	pool := mustStandingPool(t)
	svc := settlement.NewService(pool, ledger.NewService(ledger.NewRepository(pool), nil))
	payer := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, payer, payer+"@seed.test"); err != nil {
		t.Fatal(err)
	}
	testsupport.CleanupUser(t, pool, payer)
	ref := "carhireorder:w" + uuid.NewString()[:10]
	id := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO settlements (id, reference, module_type, payer_id, total_kobo, status, escrowed_at, idempotency_key, funding_source)
		VALUES ($1,'carhire:w','transport',$2,10,'escrowed',now(),$3,'wallet')`, id, payer, ref+":fare"); err != nil {
		t.Fatal(err)
	}
	if err := svc.RefundExternalByKeyPrefix(ctx, ref, "unit"); err == nil {
		t.Fatal("a wallet-funded settlement under the prefix must be refused (ErrWrongRefundMethod), never reversed")
	}
	if statusOf(t, svc, id) != settlement.StatusEscrowed {
		t.Error("wallet settlement was altered")
	}
}
