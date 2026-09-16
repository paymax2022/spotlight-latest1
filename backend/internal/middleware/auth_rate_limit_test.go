package middleware

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func newTestLimiter(limit int, window time.Duration, clock *time.Time) *AuthRateLimiter {
	l := NewAuthRateLimiter(limit, window)
	l.now = func() time.Time { return *clock }
	return l
}

func TestAllowsUpToTheLimitThenBlocks(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	l := newTestLimiter(3, time.Minute, &now)

	for i := 1; i <= 3; i++ {
		if ok, _, _ := l.Allow("k"); !ok {
			t.Fatalf("attempt %d should be allowed", i)
		}
	}
	if ok, _, _ := l.Allow("k"); ok {
		t.Fatal("the 4th attempt within the window must be blocked")
	}
}

func TestWindowResets(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	l := newTestLimiter(2, time.Minute, &now)

	l.Allow("k")
	l.Allow("k")
	if ok, _, _ := l.Allow("k"); ok {
		t.Fatal("should be blocked before the window elapses")
	}

	now = now.Add(time.Minute + time.Second)
	if ok, _, _ := l.Allow("k"); !ok {
		t.Fatal("a new window must admit the client again")
	}
}

func TestKeysAreIndependent(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	l := newTestLimiter(1, time.Minute, &now)

	l.Allow("ip-a")
	// One client exhausting its budget must not lock out everyone else.
	if ok, _, _ := l.Allow("ip-b"); !ok {
		t.Fatal("a different key must have its own budget")
	}
}

// The reason this limiter exists rather than reusing StemRateLimit: that one's
// map never evicts, so an attacker rotating IPs grows it without bound.
func TestExpiredBucketsAreEvicted(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	l := newTestLimiter(5, time.Minute, &now)

	for i := 0; i < 500; i++ {
		l.Allow("ip-" + strconv.Itoa(i))
	}
	if l.Size() < 500 {
		t.Fatalf("expected 500 live buckets, got %d", l.Size())
	}

	now = now.Add(2 * time.Minute)
	l.Allow("fresh")
	if l.Size() != 1 {
		t.Errorf("stale buckets survived: size = %d, want 1 — the map grows unbounded", l.Size())
	}
}

func TestMiddlewareReturns429WithRetryAfter(t *testing.T) {
	gin.SetMode(gin.TestMode)
	now := time.Unix(1_700_000_000, 0)
	l := newTestLimiter(1, time.Minute, &now)

	r := gin.New()
	r.POST("/api/auth/login", l.Middleware(), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	call := func() *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/auth/login", nil)
		req.RemoteAddr = "203.0.113.9:1234"
		r.ServeHTTP(w, req)
		return w
	}

	if got := call().Code; got != http.StatusOK {
		t.Fatalf("first call = %d, want 200", got)
	}
	w := call()
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("second call = %d, want 429", w.Code)
	}
	if w.Header().Get("Retry-After") == "" {
		t.Error("429 must carry Retry-After so a client knows when to return")
	}
	// It must not disclose whether the account exists.
	if body := w.Body.String(); !contains(body, "Too many attempts") {
		t.Errorf("unexpected body: %s", body)
	}
}

// A header the caller controls must not create a fresh bucket — that is exactly
// the bypass StemRateLimit's x-stem-role keying allows.
func TestClientSuppliedHeadersCannotResetTheBudget(t *testing.T) {
	gin.SetMode(gin.TestMode)
	now := time.Unix(1_700_000_000, 0)
	l := newTestLimiter(1, time.Minute, &now)

	r := gin.New()
	r.POST("/api/auth/login", l.Middleware(), func(c *gin.Context) { c.Status(http.StatusOK) })

	send := func(role string) int {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/auth/login", nil)
		req.RemoteAddr = "203.0.113.10:9999"
		if role != "" {
			req.Header.Set("x-stem-role", role)
		}
		r.ServeHTTP(w, req)
		return w.Code
	}

	send("")
	if got := send("admin"); got != http.StatusTooManyRequests {
		t.Errorf("varying a request header got %d — the limit is bypassable", got)
	}
}

func TestConcurrentAllowIsRaceFree(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	l := newTestLimiter(100, time.Minute, &now)

	var wg sync.WaitGroup
	for i := 0; i < 200; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); l.Allow("shared") }()
	}
	wg.Wait()

	// Exactly 200 attempts were recorded against one key, so the next is blocked.
	if ok, _, _ := l.Allow("shared"); ok {
		t.Error("counter lost increments under concurrency")
	}
}

func TestZeroValuesFallBackToDefaultsRatherThanDisabling(t *testing.T) {
	l := NewAuthRateLimiter(0, 0)
	if l.limit <= 0 || l.window <= 0 {
		t.Fatalf("a misconfigured limiter must not become a no-op: limit=%d window=%s", l.limit, l.window)
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
