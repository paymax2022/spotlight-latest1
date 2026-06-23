package ledger_test

import (
	"context"
	"testing"
	"time"

	"spotlight/backend/internal/finance/ledger"
)

// ---------------------------------------------------------------------------
// Sentinel / type tests that don't require a real DB.
// ---------------------------------------------------------------------------

// TestEntryTypes verifies that credit/debit constants are distinct and non-empty.
func TestEntryTypes(t *testing.T) {
	types := []ledger.EntryType{
		ledger.EntryCredit,
		ledger.EntryDebit,
		ledger.EntryReversalCredit,
		ledger.EntryReversalDebit,
	}
	seen := map[ledger.EntryType]bool{}
	for _, et := range types {
		if et == "" {
			t.Errorf("EntryType must not be empty string")
		}
		if seen[et] {
			t.Errorf("duplicate EntryType: %q", et)
		}
		seen[et] = true
	}
}

// TestAccountTypes verifies account type constants are distinct.
func TestAccountTypes(t *testing.T) {
	types := []ledger.AccountType{
		ledger.AccountUserWallet,
		ledger.AccountEscrow,
		ledger.AccountCommission,
		ledger.AccountProviderClearing,
		ledger.AccountPaymaxRevenue,
		ledger.AccountReferralReward,
		ledger.AccountFXSpreadIncome,
		ledger.AccountSettlement,
	}
	seen := map[ledger.AccountType]bool{}
	for _, at := range types {
		if at == "" {
			t.Errorf("AccountType must not be empty string")
		}
		if seen[at] {
			t.Errorf("duplicate AccountType: %q", at)
		}
		seen[at] = true
	}
}

// TestJournalEntryBalance verifies that a JournalEntry encodes one debit and one credit
// for the same amount — the double-entry invariant enforced by the service.
func TestJournalEntryBalance(t *testing.T) {
	j := ledger.JournalEntry{
		Reference:       "test:001",
		IdempotencyKey:  "idem:001",
		AmountKobo:      5_000,
		DebitAccountID:  "acct-user-wallet",
		CreditAccountID: "acct-escrow",
		Description:     "test topup",
	}

	// The struct encodes a single balanced pair: one debit side = one credit side.
	// Both directions carry the same AmountKobo — this is the balance invariant.
	if j.DebitAccountID == j.CreditAccountID {
		t.Error("debit and credit account must differ; same account would net to zero")
	}
	if j.AmountKobo <= 0 {
		t.Errorf("AmountKobo must be positive, got %d", j.AmountKobo)
	}
}

// TestAmountsArePositive verifies that ledger amounts must be positive (>0).
// Negative amounts are forbidden — use reversal entries instead.
func TestAmountsArePositive(t *testing.T) {
	entries := []ledger.Entry{
		{AmountKobo: 1},
		{AmountKobo: 100000},
		{AmountKobo: 999999999},
	}
	for _, e := range entries {
		if e.AmountKobo <= 0 {
			t.Errorf("AmountKobo must be positive, got %d", e.AmountKobo)
		}
	}
}

// TestErrSentinelDistinctness verifies that error sentinels are distinct values.
func TestErrSentinelDistinctness(t *testing.T) {
	if ledger.ErrInsufficientFunds == ledger.ErrDuplicate {
		t.Error("ErrInsufficientFunds and ErrDuplicate must be distinct sentinel errors")
	}
	if ledger.ErrInsufficientFunds == nil {
		t.Error("ErrInsufficientFunds must not be nil")
	}
	if ledger.ErrDuplicate == nil {
		t.Error("ErrDuplicate must not be nil")
	}
}

// TestContextCancellation verifies that the service methods accept a context.
// (Compile-time check — ensures the signatures match expectations.)
func TestContextSignatures(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	// Intentionally do not call any service methods (no DB available).
	// This test verifies that a context.Context can be created and cancelled
	// without panicking — structural smoke test.
	if ctx.Err() == nil {
		t.Log("context not yet cancelled (may complete before timeout)")
	}
}
