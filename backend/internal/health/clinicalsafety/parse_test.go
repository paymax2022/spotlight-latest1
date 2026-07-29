package clinicalsafety

import (
	"reflect"
	"testing"
)

func TestParseTerms(t *testing.T) {
	cases := []struct {
		name string
		in   any
		want []string
	}{
		{"nil", nil, nil},
		{"comma string", "Penicillin, Sulfa; Aspirin", []string{"Penicillin", "Sulfa", "Aspirin"}},
		{"none sentinel", "none", nil},
		{"nka sentinel", "No known allergies", nil},
		{"slice", []string{"Warfarin", "Ibuprofen"}, []string{"Warfarin", "Ibuprofen"}},
		{"any slice", []any{"Amoxicillin", "  ", "Warfarin"}, []string{"Amoxicillin", "Warfarin"}},
		{"dedup case-insensitive", "penicillin, Penicillin", []string{"penicillin"}},
		{"newline+pipe", "Aspirin\nWarfarin|Metformin", []string{"Aspirin", "Warfarin", "Metformin"}},
	}
	for _, c := range cases {
		if got := ParseTerms(c.in); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: ParseTerms(%v) = %#v, want %#v", c.name, c.in, got, c.want)
		}
	}
}

// End-to-end: parsed allergy terms drive a hard stop through the engine.
func TestParseTermsFeedsEngine(t *testing.T) {
	pc := PatientContext{Species: "human", Allergies: ParseTerms("Penicillin, Peanuts")}
	r := Check(pc, []RxItem{{DrugName: "Amoxicillin", Quantity: 1}})
	if !r.Blocked {
		t.Fatalf("parsed penicillin allergy should block amoxicillin: %+v", r)
	}
}
