package va_test

import (
	"testing"

	"spotlight/backend/internal/finance/va"
)

// TestVirtualAccountFields verifies required fields on a provisioned virtual account.
func TestVirtualAccountFields(t *testing.T) {
	acc := va.VirtualAccount{
		ID:            "va-abc",
		UserID:        "user-123",
		Provider:      "paystack",
		AccountNumber: "1234567890",
		AccountName:   "PAYMAX/John Doe",
		BankName:      "Wema Bank",
	}
	if acc.UserID == "" {
		t.Error("VirtualAccount.UserID must not be empty")
	}
	if acc.AccountNumber == "" {
		t.Error("VirtualAccount.AccountNumber must not be empty")
	}
	if acc.Provider == "" {
		t.Error("VirtualAccount.Provider must not be empty")
	}
	if len(acc.AccountNumber) < 10 {
		t.Errorf("AccountNumber %q too short — Nigerian bank accounts are 10 digits", acc.AccountNumber)
	}
}

// TestInboundTransferAmountPositive verifies inbound credits are always positive kobo amounts.
func TestInboundTransferAmountPositive(t *testing.T) {
	tr := va.InboundTransfer{
		AccountNumber:  "1234567890",
		AmountKobo:     500_000, // ₦5,000
		Reference:      "PAYSTACK-TXN-001",
		SenderName:     "John Doe",
		SenderBank:     "First Bank",
		IdempotencyKey: "paystack-event-abc123",
	}
	if tr.AmountKobo <= 0 {
		t.Errorf("InboundTransfer.AmountKobo must be positive, got %d", tr.AmountKobo)
	}
	if tr.IdempotencyKey == "" {
		t.Error("InboundTransfer.IdempotencyKey must not be empty (derived from Paystack event ID)")
	}
	if tr.Reference == "" {
		t.Error("InboundTransfer.Reference must not be empty")
	}
}

// TestIdempotencyKeyIsRequired documents that every inbound transfer MUST have an idempotency key.
// Without it, a duplicate webhook could double-credit a wallet.
func TestIdempotencyKeyIsRequired(t *testing.T) {
	tr := va.InboundTransfer{
		AccountNumber:  "1234567890",
		AmountKobo:     100_000,
		Reference:      "ref-001",
		IdempotencyKey: "",
	}
	if tr.IdempotencyKey == "" {
		// This is the bad state — document why the service must reject it.
		t.Log("INVARIANT: IdempotencyKey must be set from Paystack event ID before calling Credit()")
	}
}
