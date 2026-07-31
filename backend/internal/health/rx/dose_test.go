package healthrx

import (
	"errors"
	"testing"

	"spotlight/backend/internal/health/clinicalsafety"
)

// RX-004 / defect T-001: the dose-range safety check must be ENFORCED at the Issue
// boundary. The clinicalsafety engine has always had the dose check, but the rx
// item's structured single-dose (mg) was dropped when building the safety items, so
// the check silently no-oped. These pure tests exercise the real rx→engine path via
// screenRx (no I/O).

func doseFinding(err error) bool {
	var sb *SafetyBlockError
	if !errors.As(err, &sb) {
		return false
	}
	for _, f := range sb.Findings {
		if f.Kind == clinicalsafety.KindDose {
			return true
		}
	}
	return false
}

// An over-limit single dose is blocked at Issue (paracetamol cap is 1000mg).
func TestScreenRx_BlocksOverDose(t *testing.T) {
	items := []Item{{DrugName: "paracetamol", DoseMg: 2000, Quantity: 1}}
	_, err := screenRx(clinicalsafety.PatientContext{}, items, "")
	if !doseFinding(err) {
		t.Fatalf("an over-limit dose must block issuance with a dose hard-stop, got %v", err)
	}
}

// A licensed prescriber can override the hard stop with a documented reason (RX-011).
func TestScreenRx_OverDoseOverridable(t *testing.T) {
	items := []Item{{DrugName: "paracetamol", DoseMg: 2000, Quantity: 1}}
	res, err := screenRx(clinicalsafety.PatientContext{}, items, "senior clinician: supervised titration")
	if err != nil {
		t.Fatalf("a documented override must let issuance proceed, got %v", err)
	}
	if !res.Blocked {
		t.Fatal("the result should still record that a hard stop was overridden")
	}
}

// A within-limit dose passes cleanly.
func TestScreenRx_WithinDosePasses(t *testing.T) {
	items := []Item{{DrugName: "paracetamol", DoseMg: 500, Quantity: 1}}
	if _, err := screenRx(clinicalsafety.PatientContext{}, items, ""); err != nil {
		t.Fatalf("a within-limit dose must pass, got %v", err)
	}
}

// Weight-based cap: a dose safe in the absolute but over the mg/kg cap is caught
// once the patient weight is known.
func TestScreenRx_WeightBasedDose(t *testing.T) {
	// paracetamol MaxMgPerKg = 15; a 10kg child → cap 150mg. 900mg is under the 1000mg
	// absolute cap but over the weight cap.
	items := []Item{{DrugName: "paracetamol", DoseMg: 900, Quantity: 1}}
	_, err := screenRx(clinicalsafety.PatientContext{WeightKg: 10}, items, "")
	if !doseFinding(err) {
		t.Fatalf("a dose over the weight-based cap must block, got %v", err)
	}
}

// Regression guard for the exact defect: toSafetyItems must carry the structured
// dose through — if it is dropped the dose check silently no-ops.
func TestToSafetyItems_CarriesDose(t *testing.T) {
	out := toSafetyItems([]Item{{DrugName: "paracetamol", DoseMg: 750, Quantity: 2}})
	if len(out) != 1 || out[0].DoseMg != 750 {
		t.Fatalf("structured dose must reach the safety engine, got %+v", out)
	}
}
