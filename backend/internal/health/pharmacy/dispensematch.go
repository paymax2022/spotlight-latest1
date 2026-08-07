package healthpharmacy

import (
	"errors"
	"fmt"
	"strings"
)

// DP-002 / DP-003 — dispensed item must match the prescription.
//
// A pharmacist filling an Rx-required order chooses catalog products to dispense.
// Nothing structurally forces those products to be the drugs the clinician actually
// prescribed, nor the prescribed quantity. VerifyDispenseMatch is the pure,
// deterministic safety gate that blocks a dispense whose Rx-required lines do not
// correspond to the verified prescription: a drug that was never prescribed
// (wrong-drug / wrong-patient mix-up) or a quantity exceeding what was prescribed
// (over-dispense). Drugs are matched on their NAFDAC registration reference — the
// authoritative identity — not on free-text names.
//
// Partial fills are allowed: not every prescribed item must be dispensed, and a
// dispensed quantity below the prescribed amount is fine. Only dispensing something
// NOT on the prescription, or MORE than prescribed, is blocked. The check is
// fail-closed: a dispensed line with no NAFDAC reference cannot be verified and is
// rejected.

var (
	// ErrUnidentifiedDrug — a dispensed line carries no NAFDAC reference, so its
	// identity cannot be checked against the prescription. Fail-closed.
	ErrUnidentifiedDrug = errors.New("pharmacy: dispensed item has no NAFDAC reference — cannot verify it matches the prescription (DP-002)")
	// ErrDrugNotPrescribed — a dispensed drug is not on the verified prescription
	// (wrong drug / wrong patient's medication). Hard block.
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
