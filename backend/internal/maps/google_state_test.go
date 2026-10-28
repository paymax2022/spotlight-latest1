package maps

import (
	"encoding/json"
	"testing"
)

func googleStateFrom(t *testing.T, body string) string {
	t.Helper()
	var r googleGeocodeResp
	if err := json.Unmarshal([]byte(body), &r); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(r.Results) == 0 {
		t.Fatal("no results in fixture")
	}
	return googleState(r.Results[0].AddressComponents)
}

func TestGoogleState_LocalityAndState(t *testing.T) {
	body := `{"status":"OK","results":[{"formatted_address":"x","address_components":[
		{"long_name":"Ikeja","types":["locality","political"]},
		{"long_name":"Lagos State","types":["administrative_area_level_1","political"]}]}]}`
	if got := googleStateFrom(t, body); got != "Lagos" {
		t.Fatalf("state = %q, want Lagos (suffix dropped)", got)
	}
}

func TestGoogleState_StateOnly(t *testing.T) {
	body := `{"status":"OK","results":[{"formatted_address":"x","address_components":[
		{"long_name":"Federal Capital Territory","types":["administrative_area_level_1","political"]}]}]}`
	if got := googleStateFrom(t, body); got != "Federal Capital Territory" {
		t.Fatalf("state = %q, want Federal Capital Territory", got)
	}
}

func TestGoogleState_MissingIsEmpty(t *testing.T) {
	body := `{"status":"OK","results":[{"formatted_address":"x","address_components":[
		{"long_name":"Lekki","types":["locality","political"]},
		{"long_name":"Nigeria","types":["country","political"]}]}]}`
	if got := googleStateFrom(t, body); got != "" {
		t.Fatalf("state = %q, want empty (never invent a state)", got)
	}
}

func TestGeoResult_StateJSON(t *testing.T) {
	b, err := json.Marshal(GeoResult{Lat: 1, Lng: 2, City: "Lagos", State: "Lagos"})
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	if m["state"] != "Lagos" {
		t.Fatalf("state not serialised: %s", b)
	}
	// A result without a state (e.g. a cache hit) omits the key and still decodes.
	b, _ = json.Marshal(GeoResult{Lat: 1, Lng: 2})
	var back GeoResult
	if err := json.Unmarshal(b, &back); err != nil || back.State != "" {
		t.Fatalf("round trip without state: err=%v state=%q", err, back.State)
	}
	if _, ok := m2(b)["state"]; ok {
		t.Fatalf("empty state should be omitted: %s", b)
	}
}

func m2(b []byte) map[string]any {
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	return m
}
