package ledger

import (
	"context"
	"sync"
)

// MockLedger is an in-memory double-entry ledger used as the offline/dev default.
// It mirrors the money-core invariants so a later swap to the HTTP client changes
// nothing observable:
//
//   - balances are DERIVED by summing immutable entries (never stored);
//   - every post writes a balanced pair (debit −amount, credit +amount);
//   - a replayed idempotency key is a no-op success (recorded once);
//   - a balance-checked debit fails closed when it would overdraw.
//
// Safe for concurrent use.
type MockLedger struct {
	mu      sync.Mutex
	entries map[string]int64 // "<userID>\x00<account>" → signed balance (kobo)
	seen    map[string]bool  // idempotency keys already applied
}

// NewMock builds an empty in-memory ledger.
func NewMock() *MockLedger {
	return &MockLedger{
		entries: map[string]int64{},
		seen:    map[string]bool{},
	}
}

var _ Client = (*MockLedger)(nil)

func key(userID, account string) string { return userID + "\x00" + account }

// PostJournal applies a balanced pair under lock. Idempotent by j.IdempotencyKey.
func (m *MockLedger) PostJournal(ctx context.Context, j Journal) error {
	if err := j.valid(); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.seen[j.IdempotencyKey] {
		return nil // replay → no-op success
	}
	if j.BalanceChecked {
		if m.entries[key(j.UserID, j.DebitAccount)] < j.AmountKobo {
			return ErrInsufficientFunds
		}
	}
	// Balanced double-entry: debit decreases, credit increases.
	m.entries[key(j.UserID, j.DebitAccount)] -= j.AmountKobo
	m.entries[key(j.UserID, j.CreditAccount)] += j.AmountKobo
	m.seen[j.IdempotencyKey] = true
	return nil
}

// Balance returns the derived balance of a user's account.
func (m *MockLedger) Balance(ctx context.Context, userID, account string) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.entries[key(userID, account)], nil
}

// Credit is a convenience for seeding funds in tests/dev (e.g. a mock on-ramp):
// it credits the user's account from an external source with no balance check.
func (m *MockLedger) Credit(ctx context.Context, userID, account, idemKey string, amountKobo int64) error {
	return m.PostJournal(ctx, Journal{
		UserID:         userID,
		DebitAccount:   "external_funding",
		CreditAccount:  account,
		AmountKobo:     amountKobo,
		Reference:      "mock_credit",
		IdempotencyKey: idemKey,
	})
}
