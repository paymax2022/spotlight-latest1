// Package ledger defines the trading module's port to the AUTHORITATIVE money
// ledger (Stage 1.5 of docs/audit/PHASE-2-CONSOLIDATION-DESIGN.md). The trading
// module posts balanced cash legs through this interface instead of keeping its
// own balances, so spotlight/backend's finance/ledger stays the single source of
// truth.
//
//   - MockLedger (this package): an in-memory, dependency-free double-entry ledger
//     for offline/dev builds. Balances are DERIVED from immutable entries, posts are
//     balanced pairs, replays are idempotent, balance-checked debits fail closed.
//   - httpLedger (later): calls the money-core internal API; selected by
//     LEDGER_BACKEND=http. Behaviour-compatible with MockLedger by construction.
//
// Money is always integer minor units (kobo). Business logic depends only on Client.
package ledger

import (
	"context"
	"errors"
)

// Sentinel errors (distinct so callers/tests can assert on cause).
var (
	// ErrInsufficientFunds is returned when a balance-checked debit would overdraw.
	ErrInsufficientFunds = errors.New("ledger: insufficient funds")
	// ErrUnbalanced is returned when a journal is missing an account or amount.
	ErrUnbalanced = errors.New("ledger: journal must name a debit and credit account with a positive amount")
	// ErrMissingIdem is returned when a post has no idempotency key.
	ErrMissingIdem = errors.New("ledger: idempotency key required")
)

// Journal is ONE balanced double-entry pair. AmountKobo is always positive; the
// direction is carried by the debit/credit account names. DEBIT decreases the
// debited account's balance, CREDIT increases the credited account's balance
// (matching the money-core convention).
type Journal struct {
	UserID         string // the user whose accounts are affected
	DebitAccount   string // e.g. "user_wallet"
	CreditAccount  string // e.g. "settlement"
	AmountKobo     int64  // > 0
	Reference      string // human-readable purpose, e.g. "stock_buy:PMX-ST-…"
	IdempotencyKey string // required; a replay is a no-op success
	BalanceChecked bool   // true → fail closed (ErrInsufficientFunds) on overdraw
}

func (j Journal) valid() error {
	if j.IdempotencyKey == "" {
		return ErrMissingIdem
	}
	if j.DebitAccount == "" || j.CreditAccount == "" || j.AmountKobo <= 0 {
		return ErrUnbalanced
	}
	return nil
}

// Client posts balanced money legs to the authoritative ledger and reads derived
// balances. The trading module's money path depends only on this interface.
type Client interface {
	// PostJournal posts one balanced pair, idempotently. A replayed IdempotencyKey
	// is a no-op success; a balance-checked overdraw returns ErrInsufficientFunds.
	PostJournal(ctx context.Context, j Journal) error
	// Balance returns the derived balance (minor units) of a user's account.
	Balance(ctx context.Context, userID, account string) (int64, error)
}
