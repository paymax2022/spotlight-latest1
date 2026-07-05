package preconsult

import "testing"

func TestDoctorAuthorized(t *testing.T) {
	if !doctorAuthorized("doc1", "doc1") {
		t.Fatal("assigned doctor must be authorized")
	}
	if doctorAuthorized("doc2", "doc1") {
		t.Fatal("non-assigned doctor must be denied")
	}
	if doctorAuthorized("doc1", "") {
		t.Fatal("empty provider owner must be denied (no assigned doctor)")
	}
}

func TestSummaryOrdering_AllergiesAndMedsFirst(t *testing.T) {
	order := []string{"chief_complaint", "symptom_detail", "allergies", "current_medications",
		"chronic_conditions", "pregnancy", "vitals", "attachments"}
	answers := map[string]any{
		"reason_for_visit":    "cough",
		"allergies":           "penicillin",
		"current_medications": "metformin",
		"temp_c":              float64(38),
	}
	secs := buildSections(order, answers)
	if len(secs) != len(order) {
		t.Fatalf("expected %d sections, got %d", len(order), len(secs))
	}
	// allergies must come before vitals; current_medications must be present early.
	idx := map[string]int{}
	for i, s := range secs {
		idx[s.Key] = i
	}
	if idx["allergies"] > idx["vitals"] || idx["current_medications"] > idx["vitals"] {
		t.Fatal("allergies + current_medications must be ordered ahead of vitals")
	}
	// the allergies section must carry the allergy answer (highlighted data present).
	if secs[idx["allergies"]].Fields["allergies"] != "penicillin" {
		t.Fatal("allergies section must contain the allergy value")
	}
}

func TestHasRouting(t *testing.T) {
	hits := []byte(`[{"rule_code":"self_harm","level":1,"severity":"emergency","routing":"CRISIS"}]`)
	if !hasRouting(hits, "CRISIS") {
		t.Fatal("should detect CRISIS routing in hits")
	}
	if hasRouting(hits, "EMERGENCY") {
		t.Fatal("should not detect EMERGENCY when only CRISIS present")
	}
	if hasRouting(nil, "CRISIS") {
		t.Fatal("nil hits must not match")
	}
}
