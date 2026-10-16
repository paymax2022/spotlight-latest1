package ledger_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/finance/ledger"
)

// LIVE-DB (TEST_DATABASE_URL): the read-only positive-balance listing returns a
// fees_unswept account while credits exceed debits, and drops it once drained.
func TestLiveDB_ListPositiveBalancesByTypePrefix(t *testing.T) {
	pool := mustLiveTxPool(t)
	ctx := context.Background()
	svc := ledger.NewService(ledger.NewRepository(pool), nil)

	typ, err := ledger.FeesUnsweptAccount(uuid.NewString(), "NGN")
	if err != nil {
		t.Fatal(err)
	}
	un, err := svc.GetOrCreateStandingAccount(ctx, typ)
	if err != nil {
		t.Skipf("fees_unswept account type not accepted by this DB (migration not applied?): %v", err)
	}
	clearing, err := svc.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatal(err)
	}
	k := uuid.NewString()
	if err := svc.PostJournal(ctx, ledger.JournalEntry{Reference: "t:accrue", IdempotencyKey: "bal-" + k,
		AmountKobo: 700, DebitAccountID: clearing.ID, CreditAccountID: un.ID}); err != nil {
		t.Fatal(err)
	}
	find := func() (int64, bool) {
		bs, err := svc.ListPositiveBalancesByTypePrefix(ctx, "fees_unswept:")
		if err != nil {
			t.Fatal(err)
		}
		for _, b := range bs {
			if b.AccountID == un.ID {
				return b.BalanceKobo, true
			}
		}
		return 0, false
	}
	if bal, ok := find(); !ok || bal != 700 {
		t.Fatalf("want 700 listed, got %d ok=%v", bal, ok)
	}
	if err := svc.PostJournal(ctx, ledger.JournalEntry{Reference: "t:settle", IdempotencyKey: "bal-s-" + k,
		AmountKobo: 700, DebitAccountID: un.ID, CreditAccountID: clearing.ID}); err != nil {
		t.Fatal(err)
	}
	if _, ok := find(); ok {
		t.Fatal("drained account must not be listed")
	}
}
