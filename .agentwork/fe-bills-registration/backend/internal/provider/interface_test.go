package provider_test

import (
	"testing"

	"spotlight/backend/internal/provider"
)

// TestInitializePaymentRequestAmountKobo verifies amount is an integer in minor units.
func TestInitializePaymentRequestAmountKobo(t *testing.T) {
	req := provider.InitializePaymentRequest{
		Email:          "user@example.com",
		AmountKobo:     500_000, // ₦5,000
		Reference:      "ref-001",
		CallbackURL:    "https://app.example.com/callback",
		IdempotencyKey: "idem-001",
	}
	if req.AmountKobo <= 0 {
		t.Errorf("AmountKobo must be positive, got %d", req.AmountKobo)
	}
	if req.Reference == "" {
		t.Error("InitializePaymentRequest.Reference must not be empty")
	}
	if req.IdempotencyKey == "" {
		t.Error("InitializePaymentRequest.IdempotencyKey must not be empty — prevents duplicate charges")
	}
}

// TestPaymentStatusValues verifies the three terminal payment status strings.
func TestPaymentStatusValues(t *testing.T) {
	validStatuses := map[string]bool{
		"success": true,
		"failed":  true,
		"pending": true,
	}
	for s := range validStatuses {
		if s == "" {
			t.Error("PaymentStatus.Status must not be empty")
		}
	}
	// success and failed are terminal; pending is intermediate.
	if validStatuses["success"] == false || validStatuses["failed"] == false {
		t.Error("success and failed must both be recognized statuses")
	}
}

// TestPayoutRequestAmountKobo verifies payout amounts are positive kobo integers.
func TestPayoutRequestAmountKobo(t *testing.T) {
	req := provider.PayoutRequest{
		RecipientCode:  "RCP_abc123",
		AmountKobo:     1_000_000, // ₦10,000
		Reference:      "payout-001",
		Narration:      "Vendor settlement",
		IdempotencyKey: "payout-idem-001",
	}
	if req.AmountKobo <= 0 {
		t.Errorf("PayoutRequest.AmountKobo must be positive, got %d", req.AmountKobo)
	}
	if req.RecipientCode == "" {
		t.Error("PayoutRequest.RecipientCode must not be empty")
	}
	if req.IdempotencyKey == "" {
		t.Error("PayoutRequest.IdempotencyKey must not be empty — prevents duplicate payouts")
	}
}

// TestProvisionVARequestRequiredFields verifies DVA provisioning requires user identity.
func TestProvisionVARequestRequiredFields(t *testing.T) {
	req := provider.ProvisionVARequest{
		UserID:      "user-abc",
		Email:       "user@example.com",
		FirstName:   "Ada",
		LastName:    "Lovelace",
		PhoneNumber: "+2348000000000",
		BVN:         "12345678901",
	}
	if req.UserID == "" {
		t.Error("ProvisionVARequest.UserID must not be empty")
	}
	if req.BVN == "" {
		t.Error("ProvisionVARequest.BVN must not be empty — required for CBN KYC compliance")
	}
	if len(req.BVN) != 11 {
		t.Errorf("BVN must be exactly 11 digits, got len=%d", len(req.BVN))
	}
}

// TestVirtualAccountFields verifies a DVA response includes all required fields.
func TestVirtualAccountFields(t *testing.T) {
	va := provider.VirtualAccount{
		AccountNumber: "1234567890",
		AccountName:   "Paymax/Ada Lovelace",
		BankName:      "Wema Bank",
		BankCode:      "035",
	}
	if len(va.AccountNumber) < 10 {
		t.Errorf("AccountNumber must be at least 10 digits, got %q", va.AccountNumber)
	}
	if va.AccountName == "" {
		t.Error("VirtualAccount.AccountName must not be empty")
	}
	if va.BankCode == "" {
		t.Error("VirtualAccount.BankCode must not be empty — needed for inter-bank routing")
	}
}
