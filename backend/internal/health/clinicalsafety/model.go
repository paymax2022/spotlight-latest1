// Package clinicalsafety is a pure, deterministic clinical drug-safety engine:
// drug-allergy, drug-drug interaction, dose-range/weight, duplicate-therapy, and
// (veterinary) species-toxicity / human-only-drug checks that run BEFORE a
// prescription is issued or dispensed (test plan §4.2, §4.11; RX-002/003/004/005,
// VT-002/003/004).
//
// It has no I/O: callers pass an explicit PatientContext + prescribed items and
// receive structured findings. The knowledge base here is a curated golden
// ruleset (deterministic, test-anchored) — NOT a substitute for a licensed
// clinical drug database. `knowledge.go` is the seam a real drug-interaction
// vendor (First Databank, Multum, BNF, etc.) would replace without touching the
// engine or its callers.
package clinicalsafety

// Severity ranks a finding. Contraindicated and Major are hard stops (must block
// unless a licensed clinician records a documented override reason, RX-011);
// Moderate/Minor are surfaced but do not block.
type Severity string

const (
	SeverityContraindicated Severity = "contraindicated"
	SeverityMajor           Severity = "major"
	SeverityModerate        Severity = "moderate"
	SeverityMinor           Severity = "minor"
)

// FindingKind classifies a safety finding.
type FindingKind string

const (
	KindAllergy      FindingKind = "allergy"
	KindInteraction  FindingKind = "drug_interaction"
	KindDose         FindingKind = "dose_range"
	KindDuplicate    FindingKind = "duplicate_therapy"
	KindSpeciesToxic FindingKind = "species_toxic"
	KindHumanOnly    FindingKind = "human_only_drug"
)

// Finding is one safety result for one prescribed item.
type Finding struct {
	Kind     FindingKind `json:"kind"`
	Severity Severity    `json:"severity"`
	Drug     string      `json:"drug"`
	Against  string      `json:"against,omitempty"` // the allergy/med/species it fired against
	Message  string      `json:"message"`
	HardStop bool        `json:"hardStop"` // must block unless overridden with a documented reason
}

// PatientContext is the clinical context a prescription is checked against.
// Species "" or "human" selects human rules; any other value (e.g. "cat", "dog")
// selects veterinary rules (species-toxicity + human-only-drug blocks).
type PatientContext struct {
	Species     string   `json:"species"`
	Allergies   []string `json:"allergies"`   // free-text allergy terms (drug or class)
	CurrentMeds []string `json:"currentMeds"` // active drug names
	WeightKg    float64  `json:"weightKg"`    // 0 = unknown (weight-based checks skipped)
	AgeYears    float64  `json:"ageYears"`    // 0 = unknown
}

// RxItem is one prescribed line the engine evaluates.
type RxItem struct {
	DrugName string  `json:"drugName"`
	DoseMg   float64 `json:"doseMg"` // single-dose amount in mg; 0 = not provided (dose check skipped)
	Quantity int     `json:"quantity"`
}

// Result aggregates findings for a whole prescription.
type Result struct {
	Findings []Finding `json:"findings"`
	Blocked  bool      `json:"blocked"` // true if any finding is a hard stop
}

// HardStops returns only the blocking findings (used by the service override path).
func (r Result) HardStops() []Finding {
	var out []Finding
	for _, f := range r.Findings {
		if f.HardStop {
			out = append(out, f)
		}
	}
	return out
}
