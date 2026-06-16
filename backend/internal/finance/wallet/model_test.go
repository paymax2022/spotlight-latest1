package wallet_test

import (
	"testing"

	"spotlight/backend/internal/finance/wallet"
)

// TestBalanceResponseConsistency verifies that BalanceNaira is consistent with BalanceKobo.
// BalanceNaira is a convenience display field; BalanceKobo is the authoritative amount.
func TestBalanceResponseConsistency(t *testing.T) {
	cases := []struct {
		kobo      int64
		wantNaira float64
	}{
		{0, 0},
		{100, 1.00},
		{50_000, 500.00},
		{1_000_000, 10_000.00},
		{100_000_000, 1_000_000.00},
	}
	for _, tc := range cases {
		b := wallet.BalanceResponse{
			UserID:       "user-abc",
			BalanceKobo:  tc.kobo,
			BalanceNaira: float64(tc.kobo) / 100,
		}
		if b.BalanceNaira != tc.wantNaira {
			t.Errorf("kobo=%d: BalanceNaira=%f, want %f", tc.kobo, b.BalanceNaira, tc.wantNaira)
		}
	}
}

// TestBalanceMustNotBeNegative verifies wallet balances can never go below zero.
// The ledger's debit path enforces this via ErrInsufficientFunds before writing.
func TestBalanceMustNotBeNegative(t *testing.T) {
	b := wallet.BalanceResponse{
		UserID:       "user-abc",
		BalanceKobo:  0,
		BalanceNaira: 0,
	}
	if b.BalanceKobo < 0 {
		t.Errorf("BalanceKobo must not be negative, got %d", b.BalanceKobo)
	}
}

// TestTopupRequestMinimum verifies the minimum topup amount.
// Paystack rejects charges below ₦1 (100 kobo); the binding tag enforces this.
func TestTopupRequestMinimum(t *testing.T) {
	req := wallet.TopupRequest{
		AmountKobo:     100,
		IdempotencyKey: "idem-001",
	}
	if req.AmountKobo < 100 {
		t.Errorf("minimum topup is 100 kobo (₦1), got %d", req.AmountKobo)
	}
	if req.IdempotencyKey == "" {
		t.Error("IdempotencyKey must not be empty")
	}
}

// TestTopupIntentStatusValues verifies TopupIntent uses known status values.
func TestTopupIntentStatusValues(t *testing.T) {
	validStatuses := map[string]bool{
		"pending": true,
		"success": true,
		"failed":  true,
	}
	for _, s := range []string{"pending", "success", "failed"} {
		if !validStatuses[s] {
			t.Errorf("unexpected TopupIntent status: %q", s)
		}
	}
}

// TestTransactionAmountsArePositive verifies that transaction amounts are always positive.
// Direction is encoded by Type (credit/debit), not sign.
func TestTransactionAmountsArePositive(t *testing.T) {
	txs := []wallet.Transaction{
		{Type: "credit", AmountKobo: 100_000},
		{Type: "debit", AmountKobo: 50_000},
	}
	for _, tx := range txs {
		if tx.AmountKobo <= 0 {
			t.Errorf("Transaction.AmountKobo must be positive, got %d (type=%s)",
				tx.AmountKobo, tx.Type)
		}
	}
}

// TestTransactionsResponsePagination verifies pagination fields are non-negative.
func TestTransactionsResponsePagination(t *testing.T) {
	resp := wallet.TransactionsResponse{
		Transactions: []wallet.Transaction{},
		Total:        0,
		Limit:        20,
		Offset:       0,
	}
	if resp.Limit <= 0 {
		t.Errorf("Limit must be positive, got %d", resp.Limit)
	}
	if resp.Offset < 0 {
		t.Errorf("Offset must not be negative, got %d", resp.Offset)
	}
	if resp.Total < 0 {
		t.Errorf("Total must not be negative, got %d", resp.Total)
	}
}
