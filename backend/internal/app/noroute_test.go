package app

// The engine's NoRoute must answer JSON, not Gin's plain-text default: the
// BFF catch-all proxies forward the body verbatim while forcing
// Content-Type: application/json, so a text body is a protocol lie to every
// client that calls response.json().

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func newNoRouteTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.NoRoute(noRouteJSON)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

func TestNoRouteJSON_UnmatchedPathReturnsJSON404(t *testing.T) {
	srv := newNoRouteTestServer(t)

	resp, err := http.Get(srv.URL + "/api/v1/definitely-not-a-route")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("body is not valid JSON: %q (%v)", string(body), err)
	}
	if parsed["success"] != false {
		t.Fatalf("success = %v, want false", parsed["success"])
	}
	msg, _ := parsed["error"].(string)
	if msg == "" {
		t.Fatal("error message missing")
	}
	if want := "GET /api/v1/definitely-not-a-route"; msg != "No API route matches "+want {
		t.Fatalf("error = %q, want it to name %q", msg, want)
	}
}

func TestNoRouteJSON_NonGETMethodAlsoJSON(t *testing.T) {
	srv := newNoRouteTestServer(t)

	resp, err := http.Post(srv.URL+"/api/v1/nope", "application/json", nil)
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
	var parsed map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		t.Fatalf("body is not valid JSON: %v", err)
	}
	if parsed["error"] != "No API route matches POST /api/v1/nope" {
		t.Fatalf("error = %v", parsed["error"])
	}
}
