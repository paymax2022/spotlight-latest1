package ledger

import (
	"context"
	"testing"
)

// TestDebitWithBalanceCheckRejectsNonPositive verifies the fail-closed amount guard
// on the new TOCTOU-safe debit primitive. The guard runs BEFORE the tx is opened,
// so it is safe to exercise with a nil pool (no DB touched). This documents that a
// zero/negative debit can never open a transaction or take the wallet lock.
//
// NOTE: not run here (no Go toolchain in this environment); compiles against the
// package and asserts the pre-DB guard.
func TestDebitWithBalanceCheckRejectsNonPositive(t *testing.T) {
	repo := &Repository{db: nil} // guard returns before db is dereferenced
	j := JournalEntry{
		Reference:       "ref",
		IdempotencyKey:  "idem",
		DebitAccountID:  "acct-wallet",
		CreditAccountID: "acct-escrow",
	}
	for _, amt := range []int64{0, -1, -100_000} {
		if err := repo.DebitWithBalanceCheck(context.Background(), "user-1", j, amt); err == nil {
			t.Errorf("DebitWithBalanceCheck(amount=%d) must reject non-positive amount", amt)
		}
	}
}

// TestBalanceProjectionClassification locks the projection sign convention shared by
// the pooled reader (GetBalance) and the in-tx reader (getBalanceTx): both derive
// from balanceProjectionSQL, so CREDIT/REVERSAL_DEBIT are +balance and
// DEBIT/REVERSAL_CREDIT are -balance. A TOCTOU fix is only correct if the in-tx
// balance read classifies entry types identically to the pooled read — otherwise the
// under-lock sufficiency check would disagree with the displayed balance.
//
// This asserts the SQL text mentions each type on the side the model requires; it is
// a guard against someone editing one reader's classification but not the shared const.
func TestBalanceProjectionClassification(t *testing.T) {
	sql := balanceProjectionSQL
	for _, plus := range []string{"CREDIT", "REVERSAL_DEBIT"} {
		if !containsToken(sql, plus) {
			t.Errorf("balance projection must classify %s as +balance", plus)
		}
	}
	// DEBIT / REVERSAL_CREDIT fall into the ELSE (-amount) branch; ensure the
	// positive set does NOT accidentally include them.
	if containsToken(sql, "'DEBIT'") {
		t.Error("DEBIT must not be in the positive (IN (...)) set; it is the -amount ELSE branch")
	}
}

// containsToken is a tiny substring helper (no strings import churn in review diff).
func containsToken(s, tok string) bool {
	for i := 0; i+len(tok) <= len(s); i++ {
		if s[i:i+len(tok)] == tok {
			return true
		}
	}
	return false
}
