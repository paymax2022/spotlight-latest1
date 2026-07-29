package healthrx

import (
	"context"
	"strings"

	"spotlight/backend/internal/health/clinicalsafety"
)

// ClinicalContextProvider supplies the patient's clinical context (allergies,
// current meds, weight) for the pre-issue safety screen. It is the seam a real
// EHR/health-profile source implements; when nil the human safety screen has no
// data to check against (vet callers pass context explicitly). Injected via
// WithClinicalContext so existing constructors are unchanged.
type ClinicalContextProvider interface {
	ClinicalContext(ctx context.Context, patientID string) (clinicalsafety.PatientContext, bool, error)
}

// WithClinicalContext wires the human clinical-context source. Returns the
// service for chaining.
func (s *Service) WithClinicalContext(p ClinicalContextProvider) *Service {
	s.clinical = p
	return s
}

// SafetyBlockError is returned when a prescription hits one or more hard-stop
// safety findings and no documented override reason was supplied (RX-002/011).
type SafetyBlockError struct {
	Findings []clinicalsafety.Finding
}

func (e *SafetyBlockError) Error() string {
	parts := make([]string, 0, len(e.Findings))
	for _, f := range e.Findings {
		parts = append(parts, string(f.Kind)+": "+f.Message)
	}
	return "rx: blocked by clinical safety check (" + strings.Join(parts, "; ") + ")"
}

// toSafetyItems maps prescription items to the engine's item shape. Dose is not
// structured on Item (free-text dosage), so mg-based dose checks are skipped here;
// the name-based allergy/interaction/duplicate/species hard-stops still apply.
func toSafetyItems(items []Item) []clinicalsafety.RxItem {
	out := make([]clinicalsafety.RxItem, 0, len(items))
	for _, it := range items {
		out = append(out, clinicalsafety.RxItem{DrugName: it.DrugName, Quantity: it.Quantity})
	}
	return out
}

// screenRx runs the clinical safety engine and enforces the hard-stop/override
// policy. It is pure (no I/O) and deterministic: it returns the engine result and,
// when the prescription is blocked and no override reason is given, a
// *SafetyBlockError. A non-empty overrideReason lets a licensed prescriber proceed
// past hard stops (the caller MUST audit the reason — RX-011).
func screenRx(pc clinicalsafety.PatientContext, items []Item, overrideReason string) (clinicalsafety.Result, error) {
	res := clinicalsafety.Check(pc, toSafetyItems(items))
	if res.Blocked && strings.TrimSpace(overrideReason) == "" {
		return res, &SafetyBlockError{Findings: res.HardStops()}
	}
	return res, nil
}

// safetyAudit builds the audit metadata for an issued Rx, recording the safety
// outcome so every override is attributable (RX-011 / §4.8).
func safetyAudit(res clinicalsafety.Result, overrideReason string) map[string]any {
	m := map[string]any{"safety_findings": len(res.Findings), "safety_blocked": res.Blocked}
	if res.Blocked && strings.TrimSpace(overrideReason) != "" {
		m["safety_override_reason"] = overrideReason
		m["safety_override_count"] = len(res.HardStops())
	}
	return m
}
