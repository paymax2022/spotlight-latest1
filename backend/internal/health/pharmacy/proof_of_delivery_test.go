package healthpharmacy

import (
	"testing"
	"time"
)

// DP-006: Proof-of-Delivery validation tests (pure logic, no DB).

func TestValidateProofOfDelivery_OTP_Valid(t *testing.T) {
	proof := DeliveryProof{
		ID:        "proof123",
		OrderID:   "order123",
		ProofType: ProofOTP,
		ProofData: "123456",
		CapturedBy: "driver_user_id",
	}

	if err := ValidateProofOfDelivery(proof); err != nil {
		t.Errorf("expected valid OTP proof, got error: %v", err)
	}
}

func TestValidateProofOfDelivery_OTP_ValidWithWhitespace(t *testing.T) {
	proof := DeliveryProof{
		ID:        "proof123",
		OrderID:   "order123",
		ProofType: ProofOTP,
		ProofData: "  123456  ",
		CapturedBy: "driver_user_id",
	}

	if err := ValidateProofOfDelivery(proof); err != nil {
		t.Errorf("expected OTP with whitespace to be valid, got error: %v", err)
	}
}

func TestValidateProofOfDelivery_OTP_InvalidLength(t *testing.T) {
	tests := []string{
		"12345",    // 5 digits
		"1234567",  // 7 digits
		"",         // empty
		"1a3456",   // non-digit
	}

	for _, data := range tests {
		proof := DeliveryProof{
			ID:        "proof123",
			OrderID:   "order123",
			ProofType: ProofOTP,
			ProofData: data,
			CapturedBy: "driver_user_id",
		}

		if err := ValidateProofOfDelivery(proof); err == nil {
			t.Errorf("expected error for OTP '%s', got nil", data)
		}
	}
}

func TestValidateProofOfDelivery_MissingProofType(t *testing.T) {
	proof := DeliveryProof{
		ID:        "proof123",
		OrderID:   "order123",
		ProofType: "", // missing
		ProofData: "123456",
		CapturedBy: "driver_user_id",
	}

	if err := ValidateProofOfDelivery(proof); err == nil {
		t.Error("expected error for missing proof_type, got nil")
	}
}

func TestValidateProofOfDelivery_MissingProofData(t *testing.T) {
	proof := DeliveryProof{
		ID:        "proof123",
		OrderID:   "order123",
		ProofType: ProofOTP,
		ProofData: "", // missing
		CapturedBy: "driver_user_id",
	}

	if err := ValidateProofOfDelivery(proof); err == nil {
		t.Error("expected error for missing proof_data, got nil")
	}
}

func TestValidateProofOfDelivery_MissingCapturedBy(t *testing.T) {
	proof := DeliveryProof{
		ID:        "proof123",
		OrderID:   "order123",
		ProofType: ProofOTP,
		ProofData: "123456",
		CapturedBy: "", // missing
	}

	if err := ValidateProofOfDelivery(proof); err == nil {
		t.Error("expected error for missing captured_by, got nil")
	}
}

func TestValidateProofOfDelivery_UnrecognizedType(t *testing.T) {
	proof := DeliveryProof{
		ID:        "proof123",
		OrderID:   "order123",
		ProofType: ProofType("INVALID"),
		ProofData: "123456",
		CapturedBy: "driver_user_id",
	}

	if err := ValidateProofOfDelivery(proof); err == nil {
		t.Error("expected error for unrecognized proof type, got nil")
	}
}

func TestValidateProofOfDelivery_PhotoValid(t *testing.T) {
	proof := DeliveryProof{
		ID:        "proof123",
		OrderID:   "order123",
		ProofType: ProofPhoto,
		ProofData: "https://cdn.example.com/delivery/proof123.jpg?token=abc",
		CapturedBy: "driver_user_id",
	}

	if err := ValidateProofOfDelivery(proof); err != nil {
		t.Errorf("expected valid photo proof, got error: %v", err)
	}
}

func TestValidateProofOfDelivery_PhotoTooShort(t *testing.T) {
	proof := DeliveryProof{
		ID:        "proof123",
		OrderID:   "order123",
		ProofType: ProofPhoto,
		ProofData: "short",
		CapturedBy: "driver_user_id",
	}

	if err := ValidateProofOfDelivery(proof); err == nil {
		t.Error("expected error for short photo data, got nil")
	}
}

func TestDeliveryProof_Complete(t *testing.T) {
	proof := DeliveryProof{
		ID:            "proof123",
		OrderID:       "order123",
		ProofType:     ProofOTP,
		ProofData:     "654321",
		CapturedBy:    "driver_user_id",
		CapturedAt:    time.Now(),
		RecipientName: stringPtr("John Doe"),
		Note:          "Delivered to main gate",
	}

	if err := ValidateProofOfDelivery(proof); err != nil {
		t.Errorf("expected complete proof to be valid, got error: %v", err)
	}

	if proof.RecipientName == nil || *proof.RecipientName != "John Doe" {
		t.Error("expected recipient_name to be preserved")
	}
}

// Helper
func stringPtr(s string) *string { return &s }
