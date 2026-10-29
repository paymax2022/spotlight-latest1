package maps

import (
	"encoding/json"
	"testing"
)

// googleCityFrom decodes a Google geocode body and returns the city picked from
// the first result's address components.
func googleCityFrom(t *testing.T, body string) string {
	t.Helper()
	var r googleGeocodeResp
	if err := json.Unmarshal([]byte(body), &r); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(r.Results) == 0 {
		t.Fatal("no results in fixture")
	}
	return googleCity(r.Results[0].AddressComponents)
}

func TestGoogleCity_PrefersLocality(t *testing.T) {
	body := `{"status":"OK","results":[{"formatted_address":"x","address_components":[
		{"long_name":"Lekki","types":["neighborhood","political"]},
		{"long_name":"Lagos","types":["locality","political"]},
		{"long_name":"Lagos State","types":["administrative_area_level_1","political"]}]}]}`
	if got := googleCityFrom(t, body); got != "Lagos" {
		t.Fatalf("city = %q, want Lagos", got)
	}
}

func TestGoogleCity_FallsBackToStateWithoutSuffix(t *testing.T) {
	body := `{"status":"OK","results":[{"formatted_address":"x","address_components":[
		{"long_name":"Lagos State","types":["administrative_area_level_1","political"]}]}]}`
	if got := googleCityFrom(t, body); got != "Lagos" {
		t.Fatalf("city = %q, want Lagos (state with suffix dropped)", got)
	}
}

func TestGoogleCity_EmptyWhenNoLocalityOrState(t *testing.T) {
	body := `{"status":"OK","results":[{"formatted_address":"x","address_components":[
		{"long_name":"Nigeria","types":["country","political"]}]}]}`
	if got := googleCityFrom(t, body); got != "" {
		t.Fatalf("city = %q, want empty (never invent a city)", got)
	}
}
