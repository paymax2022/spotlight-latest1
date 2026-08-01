package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() { gin.SetMode(gin.TestMode) }

// runCORS drives the middleware for a single request and returns the recorder.
func runCORS(t *testing.T, allowedCSV, appEnv, method, origin string) *httptest.ResponseRecorder {
	t.Helper()
	r := gin.New()
	r.Use(CORSMiddleware(allowedCSV, appEnv))
	r.GET("/x", func(c *gin.Context) { c.Status(http.StatusOK) })

	req := httptest.NewRequest(method, "/x", nil)
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if method == http.MethodOptions {
		req.Header.Set("Access-Control-Request-Method", "GET")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestCORS_ReflectsLocalhostOriginsInDev(t *testing.T) {
	// Expo web / Next dev gateway run on http://localhost:<port>; the browser
	// blocks the response unless the origin is reflected. Regression for the
	// fx/rates net::ERR_FAILED report.
	origins := []string{
		"http://localhost:8081",
		"http://localhost:8083",
		"http://localhost:8084",
		"http://127.0.0.1:3000",
		"https://localhost:19006",
	}
	for _, o := range origins {
		w := runCORS(t, "", "staging", http.MethodGet, o)
		if got := w.Header().Get("Access-Control-Allow-Origin"); got != o {
			t.Errorf("origin %q: Access-Control-Allow-Origin = %q, want %q", o, got, o)
		}
		if got := w.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
			t.Errorf("origin %q: Access-Control-Allow-Credentials = %q, want %q", o, got, "true")
		}
	}
}

func TestCORS_ReflectsLANOriginsInDev(t *testing.T) {
	o := "http://192.168.1.50:8083"
	w := runCORS(t, "", "staging", http.MethodGet, o)
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != o {
		t.Errorf("LAN origin: Access-Control-Allow-Origin = %q, want %q", got, o)
	}
}

func TestCORS_PreflightReflectsLocalhost(t *testing.T) {
	o := "http://localhost:8084"
	w := runCORS(t, "", "staging", http.MethodOptions, o)
	if w.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d, want %d", w.Code, http.StatusNoContent)
	}
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != o {
		t.Errorf("preflight Access-Control-Allow-Origin = %q, want %q", got, o)
	}
}

func TestCORS_ProductionRejectsUnlistedLocalhost(t *testing.T) {
	// In production the dev reflection is off; only the explicit allow-list wins.
	w := runCORS(t, "https://app.example.com", "production", http.MethodGet, "http://localhost:8084")
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("production localhost: Access-Control-Allow-Origin = %q, want empty", got)
	}

	// The allow-listed prod origin is still reflected.
	o := "https://app.example.com"
	w = runCORS(t, o, "production", http.MethodGet, o)
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != o {
		t.Errorf("production allow-listed: Access-Control-Allow-Origin = %q, want %q", got, o)
	}
}

func TestCORS_UnknownOriginNotReflected(t *testing.T) {
	w := runCORS(t, "", "staging", http.MethodGet, "https://evil.example.com")
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("unknown origin: Access-Control-Allow-Origin = %q, want empty", got)
	}
}
