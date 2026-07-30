package maps

import (
	"context"
	"encoding/json"
	"testing"
)

// contribution_test.go — pure unit tests for the OSM contribution loop. No DB:
// these cover stripPII (denylist/whitelist), the guarded state machine
// (canContribTransition), and that Propose refuses non-PII-stripped input.

func TestStripPII_DropsPIIKeysKeepsOSMTags(t *testing.T) {
	in := map[string]any{
		// PII — must all be dropped
		"phone":         "08030000000",
		"customer_name": "Ada",
		"owner":         "Mr. Bello",
		"house_number":  "12B",
		"apartment":     "3",
		"email":         "ada@example.com",
		"nin":           "12345678901",
		"recipient":     "Chidi",
		// non-whitelisted but harmless — closed-world: also dropped
		"random_tag": "x",
		// OSM-safe — must be kept
		"highway": "residential",
		"amenity": "bus_station",
		"surface": "asphalt",
	}
	out := stripPII(in)

	keptWant := []string{"highway", "amenity", "surface"}
	for _, k := range keptWant {
		if _, ok := out[k]; !ok {
			t.Errorf("stripPII dropped OSM-safe key %q", k)
		}
	}
	dropWant := []string{
		"phone", "customer_name", "owner", "house_number", "apartment",
		"email", "nin", "recipient", "random_tag", "name",
	}
	for _, k := range dropWant {
		if _, ok := out[k]; ok {
			t.Errorf("stripPII kept PII/non-whitelisted key %q", k)
		}
	}
}

func TestStripPII_NameNeverGlobal(t *testing.T) {
	// Type-agnostic stripPII must always drop "name" (re-admitted only by
	// stripPIIForType for name-bearing public types).
	out := stripPII(map[string]any{"name": "Ada's house", "highway": "service"})
	if _, ok := out["name"]; ok {
		t.Error("stripPII must not keep bare name")
	}
}

func TestStripPIIForType_NameOnlyForPublicTypes(t *testing.T) {
	props := map[string]any{"name": "Allen Avenue", "highway": "primary"}

	// road → name allowed (it's a road name, OSM-safe)
	if out := stripPIIForType(props, "road"); out["name"] != "Allen Avenue" {
		t.Error("road candidate should keep generic road name")
	}
	// area_name / landmark / poi / bus_stop → allowed
	for _, ty := range []string{"area_name", "landmark", "poi", "bus_stop"} {
		if out := stripPIIForType(props, ty); out["name"] != "Allen Avenue" {
			t.Errorf("%s candidate should keep generic name", ty)
		}
	}
	// address/house/unit-ish types → name NOT re-admitted
	for _, ty := range []string{"address", "house", "unit", "building"} {
		if out := stripPIIForType(props, ty); out["name"] != nil {
			t.Errorf("%s candidate must NOT keep name (potential person/house name)", ty)
		}
	}
}

func TestStripPII_DenylistFragmentMatch(t *testing.T) {
	// Fragment matching catches variants like "contact_phone", "next_of_kin",
	// "client_account", "homeowner".
	in := map[string]any{
		"contact_phone":  "x",
		"next_of_kin":    "x",
		"client_account": "x",
		"homeowner":      "x",
		"building":       "yes", // safe — kept
	}
	out := stripPII(in)
	if _, ok := out["building"]; !ok {
		t.Error("building should be kept")
	}
	for _, k := range []string{"contact_phone", "next_of_kin", "client_account", "homeowner"} {
		if _, ok := out[k]; ok {
			t.Errorf("fragment-PII key %q should be dropped", k)
		}
	}
}

func TestCanContribTransition(t *testing.T) {
	legal := [][2]string{
		{"pending", "approved"},
		{"pending", "rejected"},
		{"approved", "uploaded"},
	}
	for _, tr := range legal {
		if !canContribTransition(tr[0], tr[1]) {
			t.Errorf("expected legal transition %s->%s", tr[0], tr[1])
		}
	}
	illegal := [][2]string{
		{"pending", "uploaded"},  // skips review approval
		{"pending", "pending"},   // self-loop
		{"approved", "pending"},  // backwards
		{"approved", "rejected"}, // can't reject after approve
		{"rejected", "approved"}, // terminal
		{"rejected", "pending"},  // terminal
		{"uploaded", "approved"}, // terminal
		{"uploaded", "uploaded"}, // terminal self-loop
		{"", "approved"},         // unknown from
		{"approved", ""},         // unknown to
	}
	for _, tr := range illegal {
		if canContribTransition(tr[0], tr[1]) {
			t.Errorf("expected ILLEGAL transition %s->%s", tr[0], tr[1])
		}
	}
}

func TestPropose_RefusesNonStripped(t *testing.T) {
	// Propose must reject before any DB access when PIIStripped is false, so a nil
	// pool is fine here — the guard returns first.
	svc := NewContributionService(nil)
	_, err := svc.Propose(context.Background(), ContributionCandidate{
		H3Cell:      "s14fcd",
		Geometry:    `{"type":"Feature","properties":{"highway":"residential"},"geometry":{"type":"LineString","coordinates":[]}}`,
		Type:        "road",
		PIIStripped: false,
	})
	if err == nil {
		t.Fatal("Propose must refuse a candidate with PIIStripped=false")
	}
}

func TestStripPII_FeatureScrubsPropertiesKeepsGeometry(t *testing.T) {
	svc := NewContributionService(nil)
	feature := `{"type":"Feature","properties":{"phone":"080","highway":"primary","name":"Allen Avenue","owner":"Bello"},"geometry":{"type":"LineString","coordinates":[[3.3,6.5],[3.4,6.6]]}}`
	out, err := svc.StripPII(feature, "road")
	if err != nil {
		t.Fatalf("StripPII error: %v", err)
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(out), &parsed); err != nil {
		t.Fatalf("result not valid JSON: %v", err)
	}
	props, _ := parsed["properties"].(map[string]any)
	if _, ok := props["phone"]; ok {
		t.Error("phone must be scrubbed from Feature properties")
	}
	if _, ok := props["owner"]; ok {
		t.Error("owner must be scrubbed from Feature properties")
	}
	if props["highway"] != "primary" {
		t.Error("highway must survive")
	}
	if props["name"] != "Allen Avenue" {
		t.Error("road name must survive for road type")
	}
	if _, ok := parsed["geometry"]; !ok {
		t.Error("geometry coordinates must be preserved untouched")
	}
}
