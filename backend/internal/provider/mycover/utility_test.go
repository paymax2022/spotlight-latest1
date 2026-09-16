package mycover

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The options_url arrives as DATA from a provider catalog sync, and this fetch
// happens server-side — so a row carrying an internal address would be an SSRF
// unless the host is pinned to the configured provider. These are the cases that
// pin must reject.
func TestFetchUtilityOptions_RefusesURLsOffTheProviderOrigin(t *testing.T) {
	c := New("sk_test", "pk_test", "whsec", "https://v2.api.mycover.ai/v2")

	for _, tc := range []struct{ name, url string }{
		{"link-local metadata", "https://169.254.169.254/latest/meta-data/"},
		{"loopback", "https://127.0.0.1:8091/api/finance/insurance/policies"},
		{"internal hostname", "https://postgres.internal/secrets"},
		{"lookalike host", "https://v2.api.mycover.ai.evil.test/v2/products/utility/x"},
		{"plain http on the right host", "http://v2.api.mycover.ai/v2/products/utility/x"},
		{"not a url", "products/utility/x"},
		{"empty", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := c.FetchUtilityOptions(context.Background(), tc.url, ""); err == nil {
				t.Fatalf("accepted %q — the host pin is the only thing standing between a synced row and an SSRF", tc.url)
			}
		})
	}
}

// Happy path against the verified live shape: the standard v2 envelope with
// `data` already in {label,value} form.
func TestFetchUtilityOptions_ParsesEnvelopeAndForwardsQuery(t *testing.T) {
	var gotQuery, gotAuth string
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.Query().Get("query")
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"responseCode":1,"responseText":"ok","data":[
			{"label":"Abia","value":"Abia"},
			{"label":"","value":"Lagos"},
			{"label":"Blank","value":"  "}
		]}`))
	}))
	defer srv.Close()

	c := New("sk_test", "pk_test", "whsec", srv.URL)
	c.httpClient = srv.Client() // trust the test server's self-signed cert

	opts, err := c.FetchUtilityOptions(context.Background(), srv.URL+"/products/utility/abc", "Lagos")
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if gotQuery != "Lagos" {
		t.Errorf("dependent query not forwarded: got %q", gotQuery)
	}
	if !strings.HasPrefix(gotAuth, "Bearer ") {
		t.Errorf("request was not authenticated: %q", gotAuth)
	}
	// The blank-value row is dropped (a value is what gets submitted, so an
	// option without one is unusable); the blank LABEL falls back to its value.
	if len(opts) != 2 {
		b, _ := json.Marshal(opts)
		t.Fatalf("got %d options, want 2: %s", len(opts), b)
	}
	if opts[1].Value != "Lagos" || opts[1].Label != "Lagos" {
		t.Errorf("label fallback: got %+v want value and label both \"Lagos\"", opts[1])
	}
}
