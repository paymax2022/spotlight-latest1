package preconsult

import (
	"testing"

	healthintake "spotlight/backend/internal/health/intake"
)

// validate against the PRE_CONSULT field set using the SHARED intake validator
// (the same contract Submit enforces). We exercise it through a tiny no-DB service
// holding only the field set, mirroring what GetActiveSchemaBySlug would return.

func validateFields(answers map[string]any) error {
	// Reuse the exported validator on a zero-value intake service (ValidateAnswers
	// is pure — it touches no DB).
	var s healthintake.Service
	return s.ValidateAnswers(PreConsultFields(), answers)
}

func validBaseAnswers() map[string]any {
	return map[string]any{
		"reason_for_visit": "headache",
		"symptom_onset":    "few_days",
		"symptom_severity": float64(5), // JSON numbers decode as float64
	}
}

func TestValidate_RequiredPresent(t *testing.T) {
	if err := validateFields(validBaseAnswers()); err != nil {
		t.Fatalf("valid required set should pass, got %v", err)
	}
}

func TestValidate_MissingRequiredReason(t *testing.T) {
	a := validBaseAnswers()
	delete(a, "reason_for_visit")
	if err := validateFields(a); err == nil {
		t.Fatal("missing required reason_for_visit must fail")
	}
}

func TestValidate_MissingRequiredOnset(t *testing.T) {
	a := validBaseAnswers()
	delete(a, "symptom_onset")
	if err := validateFields(a); err == nil {
		t.Fatal("missing required symptom_onset must fail")
	}
}

func TestValidate_BadOnsetOption(t *testing.T) {
	a := validBaseAnswers()
	a["symptom_onset"] = "yesterday" // not in the select options
	if err := validateFields(a); err == nil {
		t.Fatal("invalid select option must fail")
	}
}

func TestValidate_UnknownFieldRejected(t *testing.T) {
	a := validBaseAnswers()
	a["totally_unknown"] = "x"
	if err := validateFields(a); err == nil {
		t.Fatal("unknown field must be rejected")
	}
}

func TestValidate_SeverityMustBeNumber(t *testing.T) {
	a := validBaseAnswers()
	a["symptom_severity"] = "high"
	if err := validateFields(a); err == nil {
		t.Fatal("non-numeric severity must fail")
	}
}

func TestValidate_OptionalVitalsOK(t *testing.T) {
	a := validBaseAnswers()
	a["temp_c"] = float64(37)
	a["meds_none"] = true
	a["pregnancy_status"] = "not_applicable"
	if err := validateFields(a); err != nil {
		t.Fatalf("optional vitals/booleans/selects should pass, got %v", err)
	}
}
