package ledger

import (
	"context"
	"errors"
	"testing"
)

func bal(t *testing.T, m *MockLedger, user, acct string) int64 {
	t.Helper()
	v, err := m.Balance(context.Background(), user, acct)
	if err != nil {
		t.Fatalf("Balance(%s,%s): %v", user, acct, err)
	}
	return v
}

// A post moves exactly the amount from debit to credit — balances are derived and
// the pair nets to zero across the two accounts.
func TestPostJournal_BalancedPair(t *testing.T) {
	m := NewMock()
	_ = m.Credit(context.Background(), "u1", "user_wallet", "seed-1", 100_000)

	err := m.PostJournal(context.Background(), Journal{
		UserID: "u1", DebitAccount: "user_wallet", CreditAccount: "settlement",
		AmountKobo: 40_000, Reference: "buy:1", IdempotencyKey: "j-1", BalanceChecked: true,
	})
	if err != nil {
		t.Fatalf("PostJournal: %v", err)
	}
	if got := bal(t, m, "u1", "user_wallet"); got != 60_000 {
		t.Errorf("wallet = %d, want 60000", got)
	}
	if got := bal(t, m, "u1", "settlement"); got != 40_000 {
		t.Errorf("settlement = %d, want 40000", got)
	}
}

// A replayed idempotency key must apply the post exactly once.
func TestPostJournal_IdempotentReplay(t *testing.T) {
	m := NewMock()
	_ = m.Credit(context.Background(), "u1", "user_wallet", "seed-1", 100_000)
	j := Journal{UserID: "u1", DebitAccount: "user_wallet", CreditAccount: "settlement",
		AmountKobo: 30_000, Reference: "buy:1", IdempotencyKey: "same-key", BalanceChecked: true}

	for i := 0; i < 3; i++ {
		if err := m.PostJournal(context.Background(), j); err != nil {
			t.Fatalf("replay %d: %v", i, err)
		}
	}
	if got := bal(t, m, "u1", "user_wallet"); got != 70_000 {
		t.Errorf("wallet after 3 replays = %d, want 70000 (applied once)", got)
	}
}

// A balance-checked debit must fail closed when it would overdraw, leaving balances
// untouched.
func TestPostJournal_InsufficientFundsFailsClosed(t *testing.T) {
	m := NewMock()
	_ = m.Credit(context.Background(), "u1", "user_wallet", "seed-1", 10_000)

	err := m.PostJournal(context.Background(), Journal{
		UserID: "u1", DebitAccount: "user_wallet", CreditAccount: "settlement",
		AmountKobo: 25_000, Reference: "buy:big", IdempotencyKey: "j-big", BalanceChecked: true,
	})
	if !errors.Is(err, ErrInsufficientFunds) {
		t.Fatalf("err = %v, want ErrInsufficientFunds", err)
	}
	if got := bal(t, m, "u1", "user_wallet"); got != 10_000 {
		t.Errorf("wallet mutated on failed debit = %d, want 10000", got)
	}
	if got := bal(t, m, "u1", "settlement"); got != 0 {
		t.Errorf("settlement mutated on failed debit = %d, want 0", got)
	}
}

// An un-checked debit is allowed to go negative (standing accounts / sells that
// credit the wallet do not check), proving BalanceChecked is the only guard.
func TestPostJournal_UncheckedDebitAllowed(t *testing.T) {
	m := NewMock()
	err := m.PostJournal(context.Background(), Journal{
		UserID: "u1", DebitAccount: "settlement", CreditAccount: "user_wallet",
		AmountKobo: 50_000, Reference: "sell:1", IdempotencyKey: "j-sell", BalanceChecked: false,
	})
	if err != nil {
		t.Fatalf("PostJournal: %v", err)
	}
	if got := bal(t, m, "u1", "user_wallet"); got != 50_000 {
		t.Errorf("wallet = %d, want 50000", got)
	}
}

// Validation: missing idempotency key and malformed journals are rejected.
func TestPostJournal_Validation(t *testing.T) {
	m := NewMock()
	if err := m.PostJournal(context.Background(), Journal{
		UserID: "u1", DebitAccount: "user_wallet", CreditAccount: "settlement", AmountKobo: 1,
	}); !errors.Is(err, ErrMissingIdem) {
		t.Errorf("missing idem: err = %v, want ErrMissingIdem", err)
	}
	if err := m.PostJournal(context.Background(), Journal{
		UserID: "u1", CreditAccount: "settlement", AmountKobo: 1, IdempotencyKey: "k",
	}); !errors.Is(err, ErrUnbalanced) {
		t.Errorf("missing debit account: err = %v, want ErrUnbalanced", err)
	}
	if err := m.PostJournal(context.Background(), Journal{
		UserID: "u1", DebitAccount: "user_wallet", CreditAccount: "settlement", AmountKobo: 0, IdempotencyKey: "k2",
	}); !errors.Is(err, ErrUnbalanced) {
		t.Errorf("zero amount: err = %v, want ErrUnbalanced", err)
	}
}

// MockLedger satisfies the Client interface (compile-time + behavioral).
func TestMockLedger_ImplementsClient(t *testing.T) {
	var c Client = NewMock()
	if err := c.PostJournal(context.Background(), Journal{
		UserID: "u1", DebitAccount: "settlement", CreditAccount: "user_wallet",
		AmountKobo: 1_000, Reference: "r", IdempotencyKey: "iface-1",
	}); err != nil {
		t.Fatalf("via interface: %v", err)
	}
	if got, _ := c.Balance(context.Background(), "u1", "user_wallet"); got != 1_000 {
		t.Errorf("balance via interface = %d, want 1000", got)
	}
}
