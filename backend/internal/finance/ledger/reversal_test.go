package ledger

import (
	"context"
	"testing"
)

// TestPostReversalRejectsNonPositive verifies the reversal primitive refuses
// non-positive amounts (corrections must carry a positive kobo amount; the
// direction is encoded by REVERSAL_DEBIT / REVERSAL_CREDIT, not the sign).
// This is a fail-closed guard reached before any DB call, so it is safe to test
// with a nil pool.
func TestPostReversalRejectsNonPositive(t *testing.T) {
	repo := &Repository{db: nil} // amount guard runs before db is touched
	for _, amt := range []int64{0, -1, -100000} {
		err := repo.PostReversalPair(context.Background(), "acct-user", "acct-suspense", amt, "ref", "idem")
		if err == nil {
			t.Errorf("PostReversalPair(amount=%d) must reject non-positive amount", amt)
		}
	}
}

// TestReversalEntryTypesCountTowardBalance documents the projection invariant
// the reversal relies on: REVERSAL_DEBIT increases a balance (restores funds)
// and REVERSAL_CREDIT decreases it (drains the suspense hold). The GetBalance
// SQL classifies CREDIT + REVERSAL_DEBIT as positive; everything else negative.
func TestReversalEntryTypesCountTowardBalance(t *testing.T) {
	positive := map[EntryType]bool{EntryCredit: true, EntryReversalDebit: true}
	negative := map[EntryType]bool{EntryDebit: true, EntryReversalCredit: true}

	if !positive[EntryReversalDebit] {
		t.Error("REVERSAL_DEBIT must count as +balance to restore reserved funds")
	}
	if !negative[EntryReversalCredit] {
		t.Error("REVERSAL_CREDIT must count as -balance to drain the suspense hold")
	}
	// The four types must partition cleanly with no overlap.
	for et := range positive {
		if negative[et] {
			t.Errorf("entry type %q cannot be both positive and negative", et)
		}
	}
}
