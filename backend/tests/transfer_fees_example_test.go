package tests

import (
	"testing"

	"spotlight/backend/internal/finance/transfers"
)

// transfer_fees_example_test.go is the CANONICAL table-driven test for the
// backend/tests harness. It demonstrates the house style:
//   - one struct slice describing inputs + expected outputs,
//   - t.Run sub-tests for isolation and readable failure names,
//   - boundary values explicitly enumerated (fees are tiered, so test the edges).
//
// It also pins the real money behavior of the transfer fee schedule
// (internal/finance/transfers/model.go), which is a pure function and therefore
// belongs at the fast unit level of the pyramid.

func TestWalletTransferFeeSchedule(t *testing.T) {
	// Tiers (kobo): <=₦5,000 -> 0 | <=₦50,000 -> ₦10 | else -> ₦25.
	cases := []struct {
		name    string
		amount  int64
		wantFee int64
	}{
		{"free tier lower bound", 1_00, 0},
		{"free tier upper boundary", 500_000, 0},
		{"mid tier just above free", 500_001, 1_000},
		{"mid tier upper boundary", 5_000_000, 1_000},
		{"top tier just above mid", 5_000_001, 2_500},
		{"top tier large", 100_000_000, 2_500},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := transfers.WalletTransferFee(tc.amount); got != tc.wantFee {
				t.Errorf("WalletTransferFee(%d) = %d, want %d", tc.amount, got, tc.wantFee)
			}
		})
	}
}

func TestBankTransferFeeSchedule(t *testing.T) {
	cases := []struct {
		name    string
		amount  int64
		wantFee int64
	}{
		{"small bank transfer", 100_00, 1_000},
		{"boundary 5k naira", 500_000, 1_000},
		{"mid bank transfer", 500_001, 2_500},
		{"boundary 50k naira", 5_000_000, 2_500},
		{"large bank transfer", 5_000_001, 5_000},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := transfers.BankTransferFee(tc.amount); got != tc.wantFee {
				t.Errorf("BankTransferFee(%d) = %d, want %d", tc.amount, got, tc.wantFee)
			}
		})
	}
}

// Invariant: the bank transfer fee is never lower than the wallet transfer fee
// for the same amount (bank rails cost more than internal book transfers).
func TestBankFeeNeverCheaperThanWalletFee(t *testing.T) {
	for _, amt := range []int64{1_00, 500_000, 1_000_000, 5_000_000, 10_000_000} {
		w := transfers.WalletTransferFee(amt)
		b := transfers.BankTransferFee(amt)
		if b < w {
			t.Errorf("amount %d: bank fee %d < wallet fee %d (rails-cost invariant broken)", amt, b, w)
		}
	}
}
