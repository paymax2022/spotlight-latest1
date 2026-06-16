package transfers_test

import (
	"testing"

	"spotlight/backend/internal/finance/transfers"
)

// TestWalletTransferFeeSchedule verifies the fee schedule from the PRD.
// ₦0–₦5,000 = free; ₦5,001–₦50,000 = ₦10; > ₦50,000 = ₦25.
func TestWalletTransferFeeSchedule(t *testing.T) {
	tests := []struct {
		amountKobo int64
		wantFee    int64
		label      string
	}{
		{50_000, 0, "₦500 — free tier"},
		{500_000, 0, "₦5,000 — boundary (free)"},
		{500_001, 1_000, "₦5,000.01 — first paid tier (₦10)"},
		{5_000_000, 1_000, "₦50,000 — still ₦10"},
		{5_000_001, 2_500, "₦50,000.01 — premium tier (₦25)"},
		{100_000_000, 2_500, "₦1,000,000 — premium tier (₦25)"},
	}
	for _, tc := range tests {
		got := transfers.WalletTransferFee(tc.amountKobo)
		if got != tc.wantFee {
			t.Errorf("%s: WalletTransferFee(%d) = %d, want %d", tc.label, tc.amountKobo, got, tc.wantFee)
		}
	}
}

// TestBankTransferFeeSchedule verifies the bank transfer fee schedule from the PRD.
// ₦0–₦5,000 = ₦10; ₦5,001–₦50,000 = ₦25; > ₦50,000 = ₦50.
func TestBankTransferFeeSchedule(t *testing.T) {
	tests := []struct {
		amountKobo int64
		wantFee    int64
		label      string
	}{
		{50_000, 1_000, "₦500 — ₦10 fee"},
		{500_000, 1_000, "₦5,000 — ₦10 fee (boundary)"},
		{500_001, 2_500, "₦5,000.01 — ₦25 fee"},
		{5_000_000, 2_500, "₦50,000 — ₦25 fee"},
		{5_000_001, 5_000, "₦50,000.01 — ₦50 fee"},
		{100_000_000, 5_000, "₦1,000,000 — ₦50 fee"},
	}
	for _, tc := range tests {
		got := transfers.BankTransferFee(tc.amountKobo)
		if got != tc.wantFee {
			t.Errorf("%s: BankTransferFee(%d) = %d, want %d", tc.label, tc.amountKobo, got, tc.wantFee)
		}
	}
}

// TestFeeAmountsAreKobo verifies fee values are integers (not floats).
// This is a property test — fees must always be whole kobo amounts.
func TestFeeAmountsAreKobo(t *testing.T) {
	amounts := []int64{1, 100, 10_000, 500_001, 5_000_001, 100_000_000}
	for _, a := range amounts {
		walletFee := transfers.WalletTransferFee(a)
		bankFee := transfers.BankTransferFee(a)
		if walletFee < 0 {
			t.Errorf("WalletTransferFee(%d) = %d: fees cannot be negative", a, walletFee)
		}
		if bankFee < 0 {
			t.Errorf("BankTransferFee(%d) = %d: fees cannot be negative", a, bankFee)
		}
		if walletFee%1 != 0 || bankFee%1 != 0 {
			// int64 is always whole, this check is belt-and-suspenders for type safety
			t.Errorf("fee is not a whole number")
		}
	}
}
