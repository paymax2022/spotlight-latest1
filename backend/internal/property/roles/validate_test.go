package roles

import (
	"errors"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func TestValidateDetails_RejectsUnknownKey(t *testing.T) {
	err := ValidateDetails(RoleAgent, map[string]any{"licenceNumber": "X1", "favouriteColour": "red"})
	if !errors.Is(err, ErrDetailsInvalid) {
		t.Fatalf("want ErrDetailsInvalid, got %v", err)
	}
}

func TestValidateDetails_RejectsKeyOfAnotherRole(t *testing.T) {
	err := ValidateDetails(RoleAgent, map[string]any{"cacNumber": "RC1"})
	if !errors.Is(err, ErrDetailsInvalid) {
		t.Fatalf("want ErrDetailsInvalid, got %v", err)
	}
}

func TestValidateDetails_RejectsOver8KB(t *testing.T) {
	err := ValidateDetails(RoleAgent, map[string]any{"bio": strings.Repeat("a", 9000)})
	if !errors.Is(err, ErrDetailsInvalid) {
		t.Fatalf("want ErrDetailsInvalid, got %v", err)
	}
}

func TestValidateDetails_RejectsWrongTypes(t *testing.T) {
	cases := []struct {
		role string
		d    map[string]any
	}{
		{RoleAgent, map[string]any{"operatingStates": "Lagos"}},
		{RoleAgent, map[string]any{"operatingStates": []any{"Lagos", 3.0}}},
		{RoleAgent, map[string]any{"licenceNumber": 12.0}},
		{RoleEstateManager, map[string]any{"estatesManaged": "many"}},
		{RoleEstateManager, map[string]any{"estatesManaged": -1.0}},
		{RoleEstateManager, map[string]any{"estatesManaged": 4.5}},
		{RoleEstateManager, map[string]any{"authorityLetterKey": "property-roles/u/estate_manager/k"}},
	}
	for _, c := range cases {
		if err := ValidateDetails(c.role, c.d); !errors.Is(err, ErrDetailsInvalid) {
			t.Errorf("%s %v: want ErrDetailsInvalid, got %v", c.role, c.d, err)
		}
	}
}

func TestValidateDetails_AcceptsValid(t *testing.T) {
	ok := map[string]map[string]any{
		RoleAgent:         {"licenceNumber": "FRCN-1", "operatingStates": []any{"Lagos", "Abuja"}, "agencyName": "A", "bio": "b", "specialisations": "lands"},
		RoleDeveloper:     {"companyName": "C", "cacNumber": "RC123", "website": "https://x.test", "projectSummary": "p"},
		RoleEstateManager: {"organisationName": "O", "estatesManaged": 4.0},
	}
	for role, d := range ok {
		if err := ValidateDetails(role, d); err != nil {
			t.Errorf("%s: unexpected %v", role, err)
		}
	}
	if err := ValidateDetails(RoleAgent, map[string]any{"operatingStates": []string{"Lagos"}}); err != nil {
		t.Errorf("[]string states should pass: %v", err)
	}
	if err := ValidateDetails("nope", nil); !errors.Is(err, ErrInvalidRole) {
		t.Errorf("want ErrInvalidRole, got %v", err)
	}
}

func TestMissingForSubmit_ListsRequiredKeysPerRole(t *testing.T) {
	want := map[string][]string{
		RoleAgent:         {"licenceNumber", "operatingStates"},
		RoleDeveloper:     {"cacNumber", "companyName"},
		RoleEstateManager: {"organisationName"},
	}
	for role, w := range want {
		got := MissingForSubmit(role, map[string]any{})
		sort.Strings(got)
		if !reflect.DeepEqual(got, w) {
			t.Errorf("%s: got %v want %v", role, got, w)
		}
	}
	if got := MissingForSubmit(RoleAgent, map[string]any{"licenceNumber": "  ", "operatingStates": []any{}}); len(got) != 2 {
		t.Errorf("blank/empty values count as missing, got %v", got)
	}
	if got := MissingForSubmit(RoleAgent, map[string]any{"licenceNumber": "L", "operatingStates": []any{"Lagos"}}); len(got) != 0 {
		t.Errorf("complete agent should miss nothing, got %v", got)
	}
}

func TestDocumentKeyPrefix(t *testing.T) {
	if got := DocumentKeyPrefix("u1", RoleAgent); got != "property-roles/u1/agent/" {
		t.Fatalf("got %q", got)
	}
}
