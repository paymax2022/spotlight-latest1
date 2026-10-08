package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/middleware"
)

// drive sends one request through a router carrying only PerUserRateLimit,
// with the user_id key pre-set the way RequireAuthContext leaves it.
func drive(t *testing.T, limit int, uid string) *httptest.ResponseRecorder {
	t.Helper()
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set("user_id", uid) })
	r.POST("/vote", middleware.PerUserRateLimit(nil, "test", limit),
		func(c *gin.Context) { c.Status(http.StatusCreated) })
	w := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/vote", nil)
	r.ServeHTTP(w, req)
	return w
}

// The limiter state lives on the middleware instance, so requests must share
// ONE router to accumulate. drive() rebuilds a router per call and is only for
// the no-user pass-through case below.
func TestPerUserRateLimit_SingleInstanceCapsAndIsolates(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		// Test injects uid per request via header (never a real auth path).
		c.Set("user_id", c.GetHeader("X-Test-Uid"))
	})
	r.POST("/vote", middleware.PerUserRateLimit(nil, "test", 2),
		func(c *gin.Context) { c.Status(http.StatusCreated) })

	hit := func(uid string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/vote", nil)
		req.Header.Set("X-Test-Uid", uid)
		r.ServeHTTP(w, req)
		return w
	}

	for i := 1; i <= 2; i++ {
		if w := hit("alice"); w.Code != http.StatusCreated {
			t.Fatalf("alice request %d: got %d, want 201", i, w.Code)
		}
	}
	w := hit("alice")
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("alice request 3: got %d, want 429", w.Code)
	}
	if w.Header().Get("X-Ratelimit-Limit") != "2" {
		t.Fatalf("X-RateLimit-Limit = %q, want 2", w.Header().Get("X-Ratelimit-Limit"))
	}
	// Budgets are per-user: bob is unaffected by alice's exhaustion.
	if w := hit("bob"); w.Code != http.StatusCreated {
		t.Fatalf("bob request 1: got %d, want 201", w.Code)
	}
}

func TestPerUserRateLimit_NoUserPassesThrough(t *testing.T) {
	t.Parallel()
	// Empty user_id → the limiter no-ops; auth middleware downstream owns the
	// rejection. This guards against the limiter 429ing unauthenticated traffic.
	if w := drive(t, 1, ""); w.Code != http.StatusCreated {
		t.Fatalf("anonymous request: got %d, want pass-through 201", w.Code)
	}
}
