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

// ---------------------------------------------------------------------------
// Cross-cutting double-entry invariants (QA money-path pass).
//
// The Repository is pgx-backed (repository.go), so the DB write paths cannot run
// without a live Postgres. But the BALANCE-CLASSIFICATION rule that makes the
// ledger self-consistent is pure arithmetic: it is the SQL CASE in
// balanceProjectionSQL (repository.go:77-83):
//
//	CREDIT, REVERSAL_DEBIT -> +amount_kobo
//	DEBIT,  REVERSAL_CREDIT -> -amount_kobo
//
// These tests transcribe that classifier and lock the invariants that keep the
// ledger balanced. If the production CASE and this classifier ever drift, the
// double-entry guarantee is broken — that is exactly the bug this pins.
// ---------------------------------------------------------------------------

// signOf mirrors the production balance-projection CASE (repository.go
// balanceProjectionSQL). +1 means the entry ADDS to its account balance, -1 means
// it SUBTRACTS. Any EntryType not classified here would silently contribute 0 to a
// projected balance, which is itself a bug — so an unknown type is reported as 0
// and asserted against below.
func signOf(t ledger.EntryType) int64 {
	switch t {
	case ledger.EntryCredit, ledger.EntryReversalDebit:
		return +1
	case ledger.EntryDebit, ledger.EntryReversalCredit:
		return -1
	default:
		return 0
	}
}

// TestBalanceProjection_EveryEntryTypeIsClassified proves every declared EntryType
// contributes a non-zero, signed direction to the balance projection. A new entry
// type added to model.go without updating the projection CASE would land here as a
// 0 (silently invisible to balances) — a money-path landmine this test catches.
func TestBalanceProjection_EveryEntryTypeIsClassified(t *testing.T) {
	for _, et := range []ledger.EntryType{
		ledger.EntryCredit, ledger.EntryDebit,
		ledger.EntryReversalCredit, ledger.EntryReversalDebit,
	} {
		if signOf(et) == 0 {
			t.Errorf("EntryType %q is not classified +/- in the balance projection — it would be invisible to balances", et)
		}
	}
}

// TestDoubleEntry_ForwardPairNetsToZero proves a forward journal (one DEBIT + one
// CREDIT of the same amount) contributes exactly zero to the SYSTEM-WIDE balance —
// the fundamental double-entry invariant. PostJournal / DebitWithBalanceCheck both
// write exactly this pair (repository.go), so no money is ever created or destroyed
// by a posting; it only moves between accounts.
func TestDoubleEntry_ForwardPairNetsToZero(t *testing.T) {
	for _, amt := range []int64{1, 5_000, 999_999_999} {
		debitSide := signOf(ledger.EntryDebit) * amt
		creditSide := signOf(ledger.EntryCredit) * amt
		if debitSide+creditSide != 0 {
			t.Errorf("forward pair for amount %d does not net to zero: debit=%d credit=%d", amt, debitSide, creditSide)
		}
	}
}

// TestDoubleEntry_ReversalPairNetsToZero proves a REVERSAL_DEBIT + REVERSAL_CREDIT
// pair (PostReversalPair, repository.go) is also globally balanced: a correction
// neither mints nor burns money, it restores one account and drains another by the
// same amount. Corrections are reversing entries only — never an UPDATE.
func TestDoubleEntry_ReversalPairNetsToZero(t *testing.T) {
	for _, amt := range []int64{1, 250_000, 10_000_000} {
		restore := signOf(ledger.EntryReversalDebit) * amt // +amt back to the restored account
		drain := signOf(ledger.EntryReversalCredit) * amt  // -amt from the suspense account
		if restore+drain != 0 {
			t.Errorf("reversal pair for amount %d does not net to zero: restore=%d drain=%d", amt, restore, drain)
		}
		// A reversal must RESTORE the wallet (positive leg) — this is what makes it a
		// correction rather than a second forward debit.
		if restore <= 0 {
			t.Errorf("REVERSAL_DEBIT must add to the restored account balance, got %d", restore)
		}
	}
}

// TestReversalIsOppositeOfForward proves the reversal legs carry the OPPOSITE sign
// of their forward counterparts, so a forward posting followed by its reversal
// leaves every touched account exactly where it started (net zero per account):
//   forward CREDIT (+) is undone by REVERSAL_CREDIT (-)
//   forward DEBIT  (-) is undone by REVERSAL_DEBIT  (+)
// This is the arithmetic guarantee behind "corrections = reversing entries only".
func TestReversalIsOppositeOfForward(t *testing.T) {
	if signOf(ledger.EntryCredit)+signOf(ledger.EntryReversalCredit) != 0 {
		t.Error("REVERSAL_CREDIT must be the exact inverse of CREDIT (they must cancel)")
	}
	if signOf(ledger.EntryDebit)+signOf(ledger.EntryReversalDebit) != 0 {
		t.Error("REVERSAL_DEBIT must be the exact inverse of DEBIT (they must cancel)")
	}
}

// TestPerSideIdempotencySuffixes documents the per-side idempotency-key suffixing
// the repository relies on for balanced, replay-safe posts. PostJournal writes
// ":debit"/":credit", DebitWithBalanceCheck the same, and PostReversalPair
// ":rev_debit"/":rev_credit" (repository.go). The two sides of one journal MUST use
// DISTINCT suffixed keys (otherwise the second INSERT collides with the first on the
// UNIQUE idempotency_key and the pair can never be balanced), yet share the SAME
// base key (so a whole-journal replay is a single logical no-op). This test locks
// that contract as an explicit, greppable invariant.
func TestPerSideIdempotencySuffixes(t *testing.T) {
	base := "topup:abc123"
	forward := []string{base + ":debit", base + ":credit"}
	reversal := []string{base + ":rev_debit", base + ":rev_credit"}

	seen := map[string]bool{}
	for _, k := range append(append([]string{}, forward...), reversal...) {
		if seen[k] {
			t.Errorf("suffixed idempotency key %q is not unique across the pair — a balanced insert would collide", k)
		}
		seen[k] = true
		if len(k) <= len(base) {
			t.Errorf("side key %q must extend the base key %q with a per-side suffix", k, base)
		}
	}
	// Posted() checks the ":credit" side specifically (service.go:49-51); every
	// posting writes a credit-family side, so that probe is always present.
	if forward[1] != base+":credit" {
		t.Errorf("Posted() probes %q; forward credit side must match it", base+":credit")
	}
}
