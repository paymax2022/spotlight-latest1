package healthpharmacy

import (
	"errors"
	"testing"
)

// TS-8 DP-002 (dispensed item matches Rx — drug/strength/qty) + DP-003 (right
// medication → right patient, no mix-up). Pure, deterministic — no I/O.

func TestDispenseMatch_ExactMatchPasses(t *testing.T) {
	prescribed := []PrescribedItem{{NAFDACRef: "A4-1234", Quantity: 30, DrugName: "Amoxil 500mg"}}
	dispensed := []DispensedLine{{NAFDACRef: "A4-1234", Quantity: 30, Label: "Amoxil 500mg"}}
	if err := VerifyDispenseMatch(dispensed, prescribed); err != nil {
		t.Fatalf("an exact drug+quantity match must pass, got %v", err)
	}
}

func TestDispenseMatch_PartialFillAllowed(t *testing.T) {
	prescribed := []PrescribedItem{{NAFDACRef: "A4-1234", Quantity: 30}}
	// Dispensing fewer than prescribed is a legitimate partial fill.
	if err := VerifyDispenseMatch([]DispensedLine{{NAFDACRef: "A4-1234", Quantity: 10}}, prescribed); err != nil {
		t.Fatalf("a partial fill (qty below prescribed) must pass, got %v", err)
	}
}

func TestDispenseMatch_WrongDrugBlocked(t *testing.T) {
	prescribed := []PrescribedItem{{NAFDACRef: "A4-1234", Quantity: 30, DrugName: "Amoxil"}}
	// A drug that is not on the prescription (wrong drug / another patient's med).
	dispensed := []DispensedLine{{NAFDACRef: "B9-9999", Quantity: 30, Label: "Tramadol"}}
	err := VerifyDispenseMatch(dispensed, prescribed)
	if !errors.Is(err, ErrDrugNotPrescribed) {
		t.Fatalf("dispensing a drug not on the prescription must be blocked, got %v", err)
	}
}

func TestDispenseMatch_OverQuantityBlocked(t *testing.T) {
	prescribed := []PrescribedItem{{NAFDACRef: "A4-1234", Quantity: 30}}
	if err := VerifyDispenseMatch([]DispensedLine{{NAFDACRef: "A4-1234", Quantity: 31}}, prescribed); !errors.Is(err, ErrOverDispense) {
		t.Fatalf("dispensing more than prescribed must be blocked, got %v", err)
	}
	// Split across lines of the same drug — the SUM must not exceed prescribed.
	dispensed := []DispensedLine{
		{NAFDACRef: "A4-1234", Quantity: 20},
		{NAFDACRef: "A4-1234", Quantity: 20},
	}
	if err := VerifyDispenseMatch(dispensed, prescribed); !errors.Is(err, ErrOverDispense) {
		t.Fatalf("cumulative over-dispense across lines must be blocked, got %v", err)
	}
}

func TestDispenseMatch_RefIsCaseAndSpaceInsensitive(t *testing.T) {
	prescribed := []PrescribedItem{{NAFDACRef: "a4-1234", Quantity: 30}}
	dispensed := []DispensedLine{{NAFDACRef: "  A4-1234 ", Quantity: 30}}
	if err := VerifyDispenseMatch(dispensed, prescribed); err != nil {
		t.Fatalf("NAFDAC ref match must be case/space-insensitive, got %v", err)
	}
}

func TestDispenseMatch_UnidentifiedDrugBlocked(t *testing.T) {
	prescribed := []PrescribedItem{{NAFDACRef: "A4-1234", Quantity: 30}}
	// A dispensed line with no NAFDAC ref cannot be verified → fail-closed.
	if err := VerifyDispenseMatch([]DispensedLine{{NAFDACRef: "  ", Quantity: 30, Label: "mystery"}}, prescribed); !errors.Is(err, ErrUnidentifiedDrug) {
		t.Fatalf("a dispensed line with no NAFDAC ref must be rejected, got %v", err)
	}
}

func TestDispenseMatch_MultiDrugAggregation(t *testing.T) {
	prescribed := []PrescribedItem{
		{NAFDACRef: "A4-1234", Quantity: 30},
		{NAFDACRef: "C7-5555", Quantity: 14},
	}
	// Two prescribed drugs, each dispensed within its own allowance.
	dispensed := []DispensedLine{
		{NAFDACRef: "A4-1234", Quantity: 30},
		{NAFDACRef: "C7-5555", Quantity: 7},
	}
	if err := VerifyDispenseMatch(dispensed, prescribed); err != nil {
		t.Fatalf("independent per-drug allowances must each pass, got %v", err)
	}
	// Over-dispensing the second drug is still caught even when the first is fine.
	over := []DispensedLine{
		{NAFDACRef: "A4-1234", Quantity: 30},
		{NAFDACRef: "C7-5555", Quantity: 15},
	}
	if err := VerifyDispenseMatch(over, prescribed); !errors.Is(err, ErrOverDispense) {
		t.Fatalf("over-dispense of one drug in a multi-drug order must be blocked, got %v", err)
	}
}

func TestDispenseMatch_InvalidQtyBlocked(t *testing.T) {
	prescribed := []PrescribedItem{{NAFDACRef: "A4-1234", Quantity: 30}}
	if err := VerifyDispenseMatch([]DispensedLine{{NAFDACRef: "A4-1234", Quantity: 0}}, prescribed); !errors.Is(err, ErrInvalidDispenseQty) {
		t.Fatalf("a non-positive dispensed quantity must be rejected, got %v", err)
	}
}
