package middleware

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// resetStemRateStore clears the shared limiter state so tests do not leak
// buckets or sweep bookkeeping into each other.
func resetStemRateStore() {
	stemRateMu.Lock()
	stemRateStore = map[string]*stemRateBucket{}
	stemRateLastSweep = time.Time{}
	stemRateMu.Unlock()
}

func stemRequest(r *gin.Engine, remoteAddr, role string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/x", nil)
	if remoteAddr != "" {
		req.RemoteAddr = remoteAddr
	}
	if role != "" {
		req.Header.Set("X-Stem-Role", role)
	}
	r.ServeHTTP(w, req)
	return w
}

func TestStemRateLimit_AllowsWithinLimit(t *testing.T) {
	stemRateMu.Lock()
	stemRateStore = map[string]*stemRateBucket{}
	stemRateMu.Unlock()

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(StemRateLimit(2, time.Minute))
	r.GET("/x", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	for i := range 2 {
		req := httptest.NewRequest(http.MethodGet, "/x", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d on request %d", w.Code, i+1)
		}
	}
}

func TestStemRateLimit_BlocksWhenExceeded(t *testing.T) {
	stemRateMu.Lock()
	stemRateStore = map[string]*stemRateBucket{}
	stemRateMu.Unlock()

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(StemRateLimit(1, time.Minute))
	r.GET("/x", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	req1 := httptest.NewRequest(http.MethodGet, "/x", nil)
	w1 := httptest.NewRecorder()
	r.ServeHTTP(w1, req1)
	if w1.Code != http.StatusOK {
		t.Fatalf("expected first request 200, got %d", w1.Code)
	}

	req2 := httptest.NewRequest(http.MethodGet, "/x", nil)
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)
	if w2.Code != http.StatusTooManyRequests {
		t.Fatalf("expected second request 429, got %d", w2.Code)
	}
}

// The caller-set x-stem-role header used to be part of the bucket key, which
// made the limit trivially bypassable — each distinct header value minted a
// fresh bucket. It must no longer participate (AUD-BE-004 residual; the header
// is dead for authz since ADR-056).
func TestStemRateLimit_RoleHeaderCannotRotateBucket(t *testing.T) {
	resetStemRateStore()

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(StemRateLimit(1, time.Minute))
	r.GET("/x", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	addr := "203.0.113.40:7777"
	if w := stemRequest(r, addr, "school-admin"); w.Code != http.StatusOK {
		t.Fatalf("first request = %d, want 200", w.Code)
	}
	if w := stemRequest(r, addr, "mentor"); w.Code != http.StatusTooManyRequests {
		t.Fatalf("rotating x-stem-role minted a fresh bucket: got %d, want 429", w.Code)
	}
}

// Distinct client IPs still get independent budgets — the cap must not fold
// everyone into one bucket.
func TestStemRateLimit_DistinctIPsAreIndependent(t *testing.T) {
	resetStemRateStore()

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(StemRateLimit(1, time.Minute))
	r.GET("/x", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	if w := stemRequest(r, "203.0.113.50:1", ""); w.Code != http.StatusOK {
		t.Fatalf("first IP = %d, want 200", w.Code)
	}
	if w := stemRequest(r, "203.0.113.51:1", ""); w.Code != http.StatusOK {
		t.Fatalf("second IP = %d, want 200 (own budget)", w.Code)
	}
}

// A flood of distinct keys must not grow the shared store without bound
// (AUD-BE-004 residual: the store previously never evicted and had no cap).
func TestStemRateLimit_StoreIsBoundedUnderKeyRotation(t *testing.T) {
	resetStemRateStore()
	old := stemRateMaxKeys
	stemRateMaxKeys = 50
	defer func() { stemRateMaxKeys = old }()

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(StemRateLimit(5, time.Minute))
	r.GET("/x", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	for i := range 500 {
		stemRequest(r, fmt.Sprintf("198.51.%d.%d:80", i/256, i%256), "")
	}

	stemRateMu.Lock()
	size := len(stemRateStore)
	stemRateMu.Unlock()
	if size > 50 {
		t.Fatalf("store exceeded the cap: %d entries, want <= 50", size)
	}
}

// Idle buckets must eventually be evicted even without a flood — the periodic
// sweep keeps one-shot callers from accumulating forever.
func TestStemRateLimit_SweepsExpiredBuckets(t *testing.T) {
	resetStemRateStore()

	stemRateMu.Lock()
	stemRateStore["/x|GET|198.51.100.1"] = &stemRateBucket{
		count:       1,
		windowStart: time.Now().Add(-2 * time.Minute),
		window:      time.Minute,
	}
	stemRateMu.Unlock()

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(StemRateLimit(5, time.Minute))
	r.GET("/x", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	stemRequest(r, "198.51.100.2:80", "")

	stemRateMu.Lock()
	size := len(stemRateStore)
	stemRateMu.Unlock()
	if size != 1 {
		t.Fatalf("stale bucket survived the sweep: size = %d, want 1", size)
	}
}
