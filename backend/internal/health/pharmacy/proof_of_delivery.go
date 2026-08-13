package healthpharmacy

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// ProofType identifies the format of proof-of-delivery (DP-006).
type ProofType string

const (
	// ProofOTP is a numeric one-time password (6 digits). Simple MVP, customer confirms.
	ProofOTP ProofType = "OTP"
	// ProofSignature (future): customer signature capture on mobile.
	ProofSignature ProofType = "SIGNATURE"
	// ProofPhoto (future): photo of delivery location or item.
	ProofPhoto ProofType = "PHOTO"
)

var validProofTypes = map[ProofType]bool{
	ProofOTP:       true,
	ProofSignature: true,
	ProofPhoto:     true,
}

// DeliveryProof captures the proof-of-delivery evidence for a pharmacy order
// (DP-006). Immutable once recorded. ProofType and ProofData are mutually
// required; other fields are optional context.
type DeliveryProof struct {
	ID           string    `json:"id"`
	OrderID      string    `json:"order_id"`
	ProofType    ProofType `json:"proof_type"`   // OTP, SIGNATURE, PHOTO
	ProofData    string    `json:"proof_data"`   // OTP value, signature blob, photo URL
	CapturedBy   string    `json:"captured_by"` // driver/courier user_id
	CapturedAt   time.Time `json:"captured_at"`
	VerifiedAt   *time.Time `json:"verified_at,omitempty"` // null until validated/settled
	Note         string    `json:"note,omitempty"`         // optional delivery notes
	RecipientName *string   `json:"recipient_name,omitempty"` // who signed/received
}

// ─── DP-006 Proof Validation ───────────────────────────────────────────

// ErrProofRequired is returned when attempting delivery completion without proof.
var ErrProofRequired = errors.New("pharmacy: proof-of-delivery required before completing delivery (DP-006)")

// ErrInvalidProofType is returned when the proof type is not recognized.
var ErrInvalidProofType = errors.New("pharmacy: unrecognized proof-of-delivery type (DP-006)")

// ErrInvalidProofData is returned when the proof data fails validation.
var ErrInvalidProofData = errors.New("pharmacy: invalid proof-of-delivery data (DP-006)")

// ValidateProofOfDelivery checks that the provided proof is structurally valid.
// Rules per DP-006:
//   - ProofType must be recognized
//   - ProofData must be non-empty
//   - For OTP: exactly 6 digits
//   - CapturedBy (driver/courier) must be provided
//
// Returns nil if valid, or a descriptive error.
func ValidateProofOfDelivery(proof DeliveryProof) error {
	if proof.ProofType == "" {
		return fmt.Errorf("%w: missing proof_type", ErrInvalidProofData)
	}

	if !validProofTypes[proof.ProofType] {
		return fmt.Errorf("%w: unsupported type '%s'", ErrInvalidProofType, proof.ProofType)
	}

	proof.ProofData = strings.TrimSpace(proof.ProofData)
	if proof.ProofData == "" {
		return fmt.Errorf("%w: missing proof_data", ErrInvalidProofData)
	}

	if proof.CapturedBy == "" {
		return fmt.Errorf("%w: missing captured_by (driver/courier id)", ErrInvalidProofData)
	}

	// Type-specific validation
	switch proof.ProofType {
	case ProofOTP:
		if err := validateOTP(proof.ProofData); err != nil {
			return err
		}
	case ProofSignature, ProofPhoto:
		// Signature/photo blob validation is deferred to the frontend + CDN
		// (asset URL presence + signature schema). We just ensure non-empty here.
		if len(proof.ProofData) < 10 {
			return fmt.Errorf("%w: proof_data too short for %s", ErrInvalidProofData, proof.ProofType)
		}
	}

	return nil
}

// validateOTP checks that the proof data is a valid 6-digit OTP.
func validateOTP(data string) error {
	data = strings.TrimSpace(data)
	if len(data) != 6 {
		return fmt.Errorf("%w: OTP must be exactly 6 digits, got %d chars", ErrInvalidProofData, len(data))
	}
	for _, c := range data {
		if c < '0' || c > '9' {
			return fmt.Errorf("%w: OTP must contain only digits, got '%c'", ErrInvalidProofData, c)
		}
	}
	return nil
}

// ─── DP-006 Future: Seams for proof capture/verification ───────────────

// ProofVerifier is an optional seam for validating or verifying proof-of-delivery
// (e.g., OCR on signatures, liveness on photos, or checking OTP against a sent code).
// Nil-safe: when nil, proof is recorded but not verified (VerifiedAt stays nil).
type ProofVerifier interface {
	// VerifyProof checks whether the proof is authentic (e.g., OTP matches sent code,
	// signature passes OCR, photo passes liveness). Returns true if verified, or an
	// error if verification failed. A false return indicates the proof did not match
	// but no network error occurred (proof is invalid, not a transient failure).
	VerifyProof(proof DeliveryProof) (verified bool, err error)
}
