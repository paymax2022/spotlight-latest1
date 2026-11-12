package healthintake

import (
	"encoding/json"
	"strings"
	"testing"
)

// Field.UI is the asking-side copy (step grouping, label, help, option labels) that
// the patient wizard renders. The DB schema_json row is the only source of that
// copy, so it has to survive the unmarshal→marshal hop the bundle makes on its way
// to the client — and it must stay invisible to validation, so re-wording a label
// can never change which answers are accepted (which would orphan stored responses).

func TestField_UISurvivesRoundTrip(t *testing.T) {
	const raw = `[{"name":"reason_for_visit","type":"text","required":true,` +
		`"ui":{"step":{"id":"reason","title":"Reason for visit","prdScreen":"M4"},` +
		`"type":"long_text","label":"Describe your main concern","patientReported":true}}]`
	var fields []Field
	if err := json.Unmarshal([]byte(raw), &fields); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	out, err := json.Marshal(fields)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	for _, want := range []string{`"ui"`, "Describe your main concern", `"reason"`, "M4", "patientReported", "long_text"} {
		if !strings.Contains(string(out), want) {
			t.Fatalf("ui copy lost on re-marshal: want %q in %s", want, out)
		}
	}
}

func TestField_UISurvivesRoundTripForSelectOptions(t *testing.T) {
	const raw = `[{"name":"symptom_onset","type":"select","required":true,` +
		`"options":["today","few_days"],` +
		`"ui":{"label":"When did it start?","options":[{"value":"today","label":"Today"},` +
		`{"value":"few_days","label":"A few days ago"}]}}]`
	var fields []Field
	if err := json.Unmarshal([]byte(raw), &fields); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	out, err := json.Marshal(fields)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	// Both contracts ride along: the option VALUES the validator checks against and
	// the LABELS only ui knows about.
	for _, want := range []string{`"few_days"`, "A few days ago"} {
		if !strings.Contains(string(out), want) {
			t.Fatalf("select contract lost on re-marshal: want %q in %s", want, out)
		}
	}
}

func TestField_UIOmittedWhenAbsent(t *testing.T) {
	out, err := json.Marshal([]Field{{Name: "pulse", Type: "number"}})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(out), `"ui"`) {
		t.Fatalf("a storage-only field must not emit a ui key: %s", out)
	}
}

func TestValidate_IgnoresUI(t *testing.T) {
	var withUI []Field
	const raw = `[{"name":"reason_for_visit","type":"text","required":true,` +
		`"ui":{"label":"Anything at all","type":"med_list","min":-999}}]`
	if err := json.Unmarshal([]byte(raw), &withUI); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	var s Service // ValidateAnswers is pure — it touches no DB
	if err := s.ValidateAnswers(withUI, map[string]any{"reason_for_visit": "headache"}); err != nil {
		t.Fatalf("ui must not affect acceptance: %v", err)
	}
	// The declared type (text) still governs, not the ui type the client renders with.
	if err := s.ValidateAnswers(withUI, map[string]any{"reason_for_visit": float64(1)}); err == nil {
		t.Fatal("ui must not override the storage type check")
	}
	if err := s.ValidateAnswers(withUI, map[string]any{}); err == nil {
		t.Fatal("ui must not satisfy a required field")
	}
}
