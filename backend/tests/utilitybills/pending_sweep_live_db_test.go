package utilitybills_test

// ---------------------------------------------------------------------------
// LIVE-DB suite for the Phase 3 scheduled requery sweep (SweepPending / the
// StartPendingSweep job it feeds). Reuses newFixture from live_db_test.go.
//
// What it proves:
//  1. A transaction genuinely stuck in provider_pending gets picked up and
//     resolved by the sweep (VTpass's sandbox GetBill always answers
//     successful on requery, regardless of the meter used at purchase time —
//     see provider/vtpass/vtpass.go's GetBill).
//  2. A transaction already in a terminal status (successful) is excluded —
//     the sweep must not touch settled rows.
//  3. limit is respected and rows are processed oldest-first, matching the
//     TS source's requeryPendingUtilityTransactions ordering.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"spotlight/backend/internal/utilitybills"
)

func TestLiveDB_SweepPending_ResolvesStuckPurchase(t *testing.T) {
	f := newFixture(t, 2, 2_000_000, false /* no validation: the timeout meter must reach the purchase call */)
	ctx := context.Background()

	key := "test-util-sweep-pending-" + uuid.New().String()
	res, err := f.pay(t, meterTimeout, 500_000, key)
	if err != nil {
		t.Fatalf("pay: %v", err)
	}
	txn := res.Transaction
	if txn.Status != string(utilitybills.StatusProviderPending) {
		t.Fatalf("setup: status = %s, want provider_pending", txn.Status)
	}

	sweep, err := f.svc.SweepPending(ctx, 25)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}

	var row *utilitybills.SweepRowResult
	for i := range sweep.Results {
		if sweep.Results[i].ID == txn.ID {
			row = &sweep.Results[i]
		}
	}
	if row == nil {
		t.Fatalf("sweep did not pick up the pending transaction %s (processed %d rows)", txn.ID, sweep.Processed)
	}
	if !row.OK {
		t.Fatalf("sweep row for %s reported an error: %s", txn.ID, row.Error)
	}
	if row.Status != string(utilitybills.StatusSuccessful) {
		t.Fatalf("sweep row status = %s, want successful (sandbox GetBill always answers successful on requery)", row.Status)
	}

	updated, err := f.svc.GetTransaction(ctx, txn.ID)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if updated.Status != string(utilitybills.StatusSuccessful) {
		t.Fatalf("persisted status = %s, want successful", updated.Status)
	}
}

func TestLiveDB_SweepPending_ExcludesTerminalTransactions(t *testing.T) {
	f := newFixture(t, 2, 4_000_000, false)
	ctx := context.Background()

	pendingKey := "test-util-sweep-excl-pending-" + uuid.New().String()
	pendingRes, err := f.pay(t, meterTimeout, 300_000, pendingKey)
	if err != nil {
		t.Fatalf("pay (pending): %v", err)
	}

	successKey := "test-util-sweep-excl-success-" + uuid.New().String()
	successRes, err := f.pay(t, meterSuccessPrepaid, 300_000, successKey)
	if err != nil {
		t.Fatalf("pay (success): %v", err)
	}
	if successRes.Transaction.Status != string(utilitybills.StatusSuccessful) {
		t.Fatalf("setup: status = %s, want successful", successRes.Transaction.Status)
	}

	sweep, err := f.svc.SweepPending(ctx, 25)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}

	var sawPending, sawSuccess bool
	for _, row := range sweep.Results {
		if row.ID == pendingRes.Transaction.ID {
			sawPending = true
		}
		if row.ID == successRes.Transaction.ID {
			sawSuccess = true
		}
	}
	if !sawPending {
		t.Fatalf("sweep skipped the genuinely pending transaction %s", pendingRes.Transaction.ID)
	}
	if sawSuccess {
		t.Fatalf("sweep touched an already-terminal (successful) transaction %s — it must be excluded", successRes.Transaction.ID)
	}
}

func TestLiveDB_SweepPending_RespectsLimitOldestFirst(t *testing.T) {
	f := newFixture(t, 2, 4_000_000, false)
	ctx := context.Background()

	olderKey := "test-util-sweep-limit-older-" + uuid.New().String()
	olderRes, err := f.pay(t, meterTimeout, 200_000, olderKey)
	if err != nil {
		t.Fatalf("pay (older): %v", err)
	}

	// created_at has microsecond resolution; force a visible gap so ORDER BY
	// created_at ASC is unambiguous rather than relying on clock granularity.
	time.Sleep(10 * time.Millisecond)

	newerKey := "test-util-sweep-limit-newer-" + uuid.New().String()
	newerRes, err := f.pay(t, meterTimeout, 200_000, newerKey)
	if err != nil {
		t.Fatalf("pay (newer): %v", err)
	}

	sweep, err := f.svc.SweepPending(ctx, 1)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if sweep.Processed != 1 {
		t.Fatalf("processed = %d, want 1 (limit=1)", sweep.Processed)
	}
	if got := sweep.Results[0].ID; got != olderRes.Transaction.ID {
		t.Fatalf("sweep processed %s first, want the older transaction %s", got, olderRes.Transaction.ID)
	}
	if got := sweep.Results[0].ID; got == newerRes.Transaction.ID {
		t.Fatalf("sweep processed the newer transaction instead of the older one under limit=1")
	}
}
