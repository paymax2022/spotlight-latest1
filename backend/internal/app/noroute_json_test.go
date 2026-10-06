package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"spotlight/backend/internal/config"
)

// Every flag-off module surface and every mistyped path used to leak Gin's
// default NoRoute body — "404 page not found" as text/plain — which the BFF
// proxies then forwarded stamped Content-Type: application/json. Clients
// calling res.json() on the 404 got a parse error instead of an envelope.
// The engine-level NoRoute handler must answer JSON in the same shape as the
// BFF's own no-route responder.
func TestNoRouteAnswersJSON404(t *testing.T) {
	r := NewRouter(config.Config{})
	srv := httptest.NewServer(r)
	defer srv.Close()

	for _, tc := range []struct{ method, path string }{
		{"GET", "/api/v1/crypto/wallet"},
		{"POST", "/api/v1/doctor/payouts"},
		{"GET", "/definitely/not/a/route"},
	} {
		req, err := http.NewRequest(tc.method, srv.URL+tc.path, nil)
		if err != nil {
			t.Fatal(err)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%s %s: %v", tc.method, tc.path, err)
		}
		if res.StatusCode != http.StatusNotFound {
			t.Fatalf("%s %s: want 404, got %d", tc.method, tc.path, res.StatusCode)
		}
		var body map[string]any
		if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
			res.Body.Close()
			t.Fatalf("%s %s: 404 body must be JSON, decode failed: %v", tc.method, tc.path, err)
		}
		res.Body.Close()
		if body["success"] != false {
			t.Fatalf("%s %s: want success=false, got %v", tc.method, tc.path, body)
		}
		msg, _ := body["error"].(string)
		if !strings.Contains(msg, tc.method+" "+tc.path) {
			t.Fatalf("%s %s: error should echo method+path, got %q", tc.method, tc.path, msg)
		}
	}
}
