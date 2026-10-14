package healthvet

import (
	"encoding/json"
	"net/http"
	"testing"
)

// The rules a listing applies to a profile draft, without a database.

const sampleDraft = `{"draft":{
  "personalInfo":{"title":"Dr.","firstName":"Amaka","lastName":"Obi","address":"12 Admiralty Way","city":"Lekki","state":"Lagos"},
  "bio":"Small-animal vet.",
  "specialtyId":"spec-1","subSpecialtyIds":["spec-2"],
  "speciesTreated":["dog","CAT","dragon"],
  "affiliations":[{"name":"Old Clinic","isPrimary":false},{"name":"Lagoon Medical Centre","isPrimary":true}]
}}`

func TestDraftParsesThePublicFields(t *testing.T) {
	var d draftPublic
	if err := json.Unmarshal([]byte(sampleDraft), &d); err != nil {
		t.Fatal(err)
	}
	if got := displayName(d, "fallback"); got != "Dr. Amaka Obi" {
		t.Fatalf("name = %q", got)
	}
	if got := primaryClinic(d); got != "Lagoon Medical Centre" {
		t.Fatalf("clinic = %q", got)
	}
	if got := joinNonEmpty(", ", d.Draft.PersonalInfo.Address, d.Draft.PersonalInfo.City, d.Draft.PersonalInfo.State); got != "12 Admiralty Way, Lekki, Lagos" {
		t.Fatalf("address = %q", got)
	}
	if got := lowerSpecies(d.Draft.SpeciesTreated); len(got) != 2 || got[0] != "dog" || got[1] != "cat" {
		t.Fatalf("species = %v (unknown codes must be dropped, case folded)", got)
	}
	labels := specialtyLabels(d, map[string]string{"spec-1": "Small animal", "spec-2": "Dermatology"})
	if len(labels) != 2 || labels[0] != "Small animal" || labels[1] != "Dermatology" {
		t.Fatalf("specialties = %v", labels)
	}
}

func TestDisplayNameFallsBackToTheProviderName(t *testing.T) {
	var d draftPublic
	if got := displayName(d, "Provider Row Name"); got != "Provider Row Name" {
		t.Fatalf("name = %q", got)
	}
}

func TestMalformedDraftLeavesFieldsBlankNotFatal(t *testing.T) {
	var d draftPublic
	_ = json.Unmarshal([]byte(`not json`), &d)
	if displayName(d, "x") != "x" || primaryClinic(d) != "" || len(lowerSpecies(d.Draft.SpeciesTreated)) != 0 {
		t.Fatal("a malformed draft must yield blank profile fields")
	}
}

func TestFilterNarrowsByNameSpecialtyTypeAndSpecies(t *testing.T) {
	v := VetListing{Name: "Dr. Amaka Obi", Specialties: []string{"Dermatology"}, Types: []string{"tele", "home"}, Species: []string{"dog"}}
	cases := []struct {
		f    VetFilter
		want bool
	}{
		{VetFilter{}, true},
		{VetFilter{Query: "amaka"}, true},
		{VetFilter{Query: "dermato"}, true},
		{VetFilter{Query: "vaccine"}, false},
		{VetFilter{Type: "home"}, true},
		{VetFilter{Type: "clinic"}, false},
		{VetFilter{Species: "DOG"}, true},
		{VetFilter{Species: "cat"}, false},
	}
	for _, c := range cases {
		if got := matchesFilter(v, c.f); got != c.want {
			t.Fatalf("filter %+v = %v, want %v", c.f, got, c.want)
		}
	}
}

// The listing carries no licence number, whatever the draft holds.
func TestListingCredentialCarriesNoLicenceNumber(t *testing.T) {
	b, err := json.Marshal(VetListing{Credential: ListingCredential{Authority: "VCN", Status: "verified"}})
	if err != nil {
		t.Fatal(err)
	}
	if containsStr(string(b), "licen") {
		t.Fatalf("listing JSON must not carry a licence field: %s", b)
	}
}

func containsStr(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

// A single vet with an unknown or malformed id is refused before any database call.
func TestGetVet_MalformedID_Is400BeforeService(t *testing.T) {
	r, h := uuidGuardRouter()
	r.GET("/vets/:id", h.GetVet)
	w := doReq(t, r, http.MethodGet, "/vets/not-a-uuid", "", "")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
}
