package healthpharmacy

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
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
	ID            string     `json:"id"`
	OrderID       string     `json:"order_id"`
	ProofType     ProofType  `json:"proof_type"`  // OTP, SIGNATURE, PHOTO
	ProofData     string     `json:"proof_data"`  // OTP value, signature blob, photo URL
	CapturedBy    string     `json:"captured_by"` // driver/courier user_id
	CapturedAt    time.Time  `json:"captured_at"`
	VerifiedAt    *time.Time `json:"verified_at,omitempty"`    // null until validated/settled
	Note          string     `json:"note,omitempty"`           // optional delivery notes
	RecipientName *string    `json:"recipient_name,omitempty"` // who signed/received
}

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

// ProofRepo is the DP-006 thin repository over pharmacy_delivery_proofs — the
// default ProofRecorder wired by NewService. Rows are immutable: RecordProof only
// inserts (idempotent per order via the partial unique index), never updates.

type ProofRepo struct {
	db *pgxpool.Pool
}

func NewProofRepo(db *pgxpool.Pool) *ProofRepo { return &ProofRepo{db: db} }

func (r *ProofRepo) RecordProof(ctx context.Context, proof DeliveryProof) (*DeliveryProof, error) {
	const q = `
		INSERT INTO pharmacy_delivery_proofs (order_id, proof_type, proof_data, captured_by, note, recipient_name)
		VALUES ($1, $2, $3, $4, NULLIF($5,''), $6)
		RETURNING id, captured_at`
	stored := proof
	if err := r.db.QueryRow(ctx, q, proof.OrderID, string(proof.ProofType), proof.ProofData,
		proof.CapturedBy, proof.Note, proof.RecipientName).Scan(&stored.ID, &stored.CapturedAt); err != nil {
		// A proof already recorded for this order (unique per order) is returned
		// as-is rather than erroring — completion retries must stay idempotent.
		if existing, gerr := r.GetProofForOrder(ctx, proof.OrderID); gerr == nil && existing != nil {
			return existing, nil
		}
		return nil, fmt.Errorf("pharmacy: record delivery proof: %w", err)
	}
	return &stored, nil
}

func (r *ProofRepo) GetProofForOrder(ctx context.Context, orderID string) (*DeliveryProof, error) {
	const q = `
		SELECT id, order_id, proof_type, proof_data, captured_by, captured_at, verified_at,
		       COALESCE(note,''), recipient_name
		FROM pharmacy_delivery_proofs WHERE order_id = $1
		ORDER BY captured_at ASC LIMIT 1`
	var p DeliveryProof
	if err := r.db.QueryRow(ctx, q, orderID).Scan(
		&p.ID, &p.OrderID, &p.ProofType, &p.ProofData, &p.CapturedBy, &p.CapturedAt,
		&p.VerifiedAt, &p.Note, &p.RecipientName); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("pharmacy: load delivery proof: %w", err)
	}
	return &p, nil
}

// DP-002 / DP-003 — dispensed item must match the prescription.
// A pharmacist filling an Rx-required order chooses catalog products to dispense.
// Nothing structurally forces those products to be the drugs the clinician actually
// prescribed, nor the prescribed quantity. VerifyDispenseMatch is the pure,
// deterministic safety gate that blocks a dispense whose Rx-required lines do not
// correspond to the verified prescription: a drug that was never prescribed
// (wrong-drug / wrong-patient mix-up) or a quantity exceeding what was prescribed
// (over-dispense). Drugs are matched on their NAFDAC registration reference — the
// authoritative identity — not on free-text names.
// Partial fills are allowed: not every prescribed item must be dispensed, and a
// dispensed quantity below the prescribed amount is fine. Only dispensing something
// NOT on the prescription, or MORE than prescribed, is blocked. The check is
// fail-closed: a dispensed line with no NAFDAC reference cannot be verified and is
// rejected.

var (
	// ErrUnidentifiedDrug — a dispensed line carries no NAFDAC reference, so its
	// identity cannot be checked against the prescription. Fail-closed.
	ErrUnidentifiedDrug = errors.New("pharmacy: dispensed item has no NAFDAC reference — cannot verify it matches the prescription (DP-002)")
	// ErrDrugNotPrescribed — (wrong drug / wrong patient's medication). Hard block.
	ErrDrugNotPrescribed = errors.New("pharmacy: dispensed drug is not on the prescription (DP-002/DP-003)")
	// ErrOverDispense — the dispensed quantity of a drug exceeds the prescribed
	// quantity. Hard block.
	ErrOverDispense = errors.New("pharmacy: dispensed quantity exceeds the prescribed quantity (DP-002/DP-004)")
	// ErrInvalidDispenseQty — a dispensed line has a non-positive quantity.
	ErrInvalidDispenseQty = errors.New("pharmacy: dispensed quantity must be positive")
)

// DispensedLine is one Rx-required drug being dispensed: its registered NAFDAC
// reference, the quantity, and a human label for error messages.
type DispensedLine struct {
	NAFDACRef string
	Quantity  int
	Label     string
}

// PrescribedItem is one line on the verified prescription — the identity + quantity
// the dispensed lines are checked against.
type PrescribedItem struct {
	NAFDACRef string
	Quantity  int
	DrugName  string
}

// normalizeRef canonicalizes a NAFDAC reference for identity matching:
// case-insensitive, surrounding whitespace ignored.
func normalizeRef(ref string) string {
	return strings.ToUpper(strings.TrimSpace(ref))
}

// VerifyDispenseMatch checks that every dispensed line corresponds to a prescribed
// item (matched by NAFDAC reference) and that the cumulative dispensed quantity per
// drug does not exceed the prescribed quantity (DP-002). Prescribed quantities are
// summed across items sharing a reference. Returns the first violation wrapped with
// the offending drug's label; nil if every dispensed line is prescribed and within
// quantity.
func VerifyDispenseMatch(dispensed []DispensedLine, prescribed []PrescribedItem) error {
	// Prescribed quantity available per drug identity.
	allowed := make(map[string]int, len(prescribed))
	for _, p := range prescribed {
		ref := normalizeRef(p.NAFDACRef)
		if ref == "" {
			continue // a prescription line with no ref can't be a match target
		}
		allowed[ref] += p.Quantity
	}

	// Accumulate dispensed quantity per drug so multiple lines of the same drug are
	// checked against the single prescribed allowance (not each line in isolation).
	seen := make(map[string]int, len(dispensed))
	for _, d := range dispensed {
		label := d.Label
		if label == "" {
			label = d.NAFDACRef
		}
		if d.Quantity <= 0 {
			return fmt.Errorf("%w: %q", ErrInvalidDispenseQty, label)
		}
		ref := normalizeRef(d.NAFDACRef)
		if ref == "" {
			return fmt.Errorf("%w: %q", ErrUnidentifiedDrug, label)
		}
		presQty, ok := allowed[ref]
		if !ok {
			return fmt.Errorf("%w: %q (ref %s)", ErrDrugNotPrescribed, label, d.NAFDACRef)
		}
		seen[ref] += d.Quantity
		if seen[ref] > presQty {
			return fmt.Errorf("%w: %q dispensed %d, prescribed %d", ErrOverDispense, label, seen[ref], presQty)
		}
	}
	return nil
}
