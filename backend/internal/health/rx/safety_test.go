package healthrx

import (
	"errors"
	"testing"

	"spotlight/backend/internal/health/clinicalsafety"
)

// Pure, DB-free tests of the pre-issue safety gate (the decision screenRx makes
// before any prescription is written). RX-002/011, VT-003, EC-003.

func TestScreenRxAllergyBlocks(t *testing.T) {
	pc := clinicalsafety.PatientContext{Species: "human", Allergies: []string{"penicillin"}}
	items := []Item{{DrugName: "Amoxicillin", Quantity: 10}}
	_, err := screenRx(pc, items, "")
	var sb *SafetyBlockError
	if !errors.As(err, &sb) {
		t.Fatalf("expected SafetyBlockError for penicillin allergy, got %v", err)
	}
	if len(sb.Findings) == 0 {
		t.Fatal("block error must carry the hard-stop findings")
	}
}

// RX-011: a documented override reason lets a licensed prescriber proceed past a
// hard stop; the override is surfaced in the audit metadata.
func TestScreenRxOverrideBypassesWithReason(t *testing.T) {
	pc := clinicalsafety.PatientContext{Species: "human", Allergies: []string{"penicillin"}}
	items := []Item{{DrugName: "Amoxicillin", Quantity: 10}}
	res, err := screenRx(pc, items, "patient tolerated amoxicillin previously; benefit outweighs risk")
	if err != nil {
		t.Fatalf("documented override should bypass the hard stop, got %v", err)
	}
	meta := safetyAudit(res, "patient tolerated amoxicillin previously; benefit outweighs risk")
	if meta["safety_override_reason"] == nil || meta["safety_blocked"] != true {
		t.Fatalf("override must be recorded in audit metadata: %+v", meta)
	}
}

// A clean prescription passes with no error and no block recorded.
func TestScreenRxCleanPasses(t *testing.T) {
	pc := clinicalsafety.PatientContext{Species: "human", WeightKg: 70}
	res, err := screenRx(pc, []Item{{DrugName: "Azithromycin", Quantity: 6}}, "")
	if err != nil {
		t.Fatalf("clean rx should pass, got %v", err)
	}
	if res.Blocked {
		t.Fatalf("clean rx should not be blocked: %+v", res)
	}
}

// VT-003: a species-toxic drug is blocked at the gate when the caller supplies the
// pet's species context (the vet path).
func TestScreenRxVetSpeciesToxicBlocks(t *testing.T) {
	pc := clinicalsafety.PatientContext{Species: "cat", WeightKg: 4}
	_, err := screenRx(pc, []Item{{DrugName: "Paracetamol", Quantity: 1}}, "")
	var sb *SafetyBlockError
	if !errors.As(err, &sb) {
		t.Fatalf("paracetamol for a cat must be blocked, got %v", err)
	}
}
