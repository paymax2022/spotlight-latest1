package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	platformRedis "spotlight/backend/internal/platform/redis"
)

// liveRedis returns a client for the compose Redis, or skips. Mirrors the
// TEST_DATABASE_URL convention for live-DB tests.
func liveRedis(t *testing.T) *platformRedis.Client {
	t.Helper()
	url := os.Getenv("TEST_REDIS_URL")
	if url == "" {
		url = os.Getenv("REDIS_URL")
	}
	if url == "" {
		t.Skip("TEST_REDIS_URL unset — skipping live Redis limiter tests")
	}
	r, err := platformRedis.New(url)
	if err != nil {
		t.Fatalf("redis connect: %v", err)
	}
	if err := platformRedis.Ping(context.Background(), r); err != nil {
		t.Skipf("redis unreachable at %s: %v", url, err)
	}
	t.Cleanup(func() { _ = r.Close() })
	return r
}

// Two limiter instances sharing one Redis must share the budget — the bug
// E2E-BE-032 fixes is N replicas each handing out their own allowance.
func TestSharedCounterAcrossInstances(t *testing.T) {
	r := liveRedis(t)
	ctx := context.Background()
	key := "be032|" + strconv.FormatInt(time.Now().UnixNano(), 10)
	a := NewAuthRateLimiter(3, time.Minute).WithRedis(func() *platformRedis.Client { return r }, "test")
	b := NewAuthRateLimiter(3, time.Minute).WithRedis(func() *platformRedis.Client { return r }, "test")

	for i := range 3 {
		if ok, _, _ := a.AllowCtx(ctx, key); !ok {
			t.Fatalf("attempt %d on instance A should be allowed", i+1)
		}
	}
	// The 4th attempt lands on a DIFFERENT instance — only a shared counter blocks it.
	if ok, _, _ := b.AllowCtx(ctx, key); ok {
		t.Fatal("instance B must see A's attempts — replicas do not share the budget")
	}
	// Separate namespaces must not share a budget.
	c := NewAuthRateLimiter(3, time.Minute).WithRedis(func() *platformRedis.Client { return r }, "other")
	if ok, _, _ := c.AllowCtx(ctx, key); !ok {
		t.Fatal("a different namespace must get its own budget")
	}
}

// A nil client or a dead Redis must fall back to the in-memory path — the
// protection degrades to per-instance, it never disappears.
func TestRedisFailureFallsBackToLocal(t *testing.T) {
	ctx := context.Background()
	key := "be032fb|" + strconv.FormatInt(time.Now().UnixNano(), 10)

	nilLimiter := NewAuthRateLimiter(2, time.Minute).WithRedis(func() *platformRedis.Client { return nil }, "test")
	for i := range 2 {
		if ok, _, _ := nilLimiter.AllowCtx(ctx, key); !ok {
			t.Fatalf("local fallback attempt %d should be allowed", i+1)
		}
	}
	if ok, _, _ := nilLimiter.AllowCtx(ctx, key); ok {
		t.Fatal("local fallback must still enforce the limit")
	}
	if nilLimiter.Size() == 0 {
		t.Fatal("the attempt should have been recorded in the local map")
	}
}

// Remaining/reset values come off the fixed window, matching the headers the
// middleware emits.
func TestRedisRemainingAndReset(t *testing.T) {
	r := liveRedis(t)
	ctx := context.Background()
	key := "be032rr|" + strconv.FormatInt(time.Now().UnixNano(), 10)
	l := NewAuthRateLimiter(5, time.Minute).WithRedis(func() *platformRedis.Client { return r }, "test")

	ok, remaining, resetIn := l.AllowCtx(ctx, key)
	if !ok || remaining != 4 {
		t.Fatalf("first attempt: ok=%v remaining=%d, want ok=true remaining=4", ok, remaining)
	}
	if resetIn <= 0 || resetIn > 60 {
		t.Fatalf("resetIn=%d, want within (0,60]", resetIn)
	}
}

// StemRateLimit's Redis path shares the budget across replicas the same way —
// two separate handler chains must count against one counter.
func TestStemSharedCounterAcrossInstances(t *testing.T) {
	r := liveRedis(t)
	BindStemRateRedis(func() *platformRedis.Client { return r })
	t.Cleanup(func() { BindStemRateRedis(nil) })

	gin.SetMode(gin.TestMode)
	ip := "10.99." + strconv.FormatInt(time.Now().UnixNano()%255+1, 10) + ".7"
	call := func(h gin.HandlerFunc) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/x", nil)
		c.Request.RemoteAddr = ip + ":1234"
		h(c)
		return w
	}
	// FullPath is empty in test contexts — the key still distinguishes this run.
	h1 := StemRateLimit(2, time.Minute)
	h2 := StemRateLimit(2, time.Minute)

	for i := range 2 {
		if w := call(h1); w.Code == http.StatusTooManyRequests {
			t.Fatalf("attempt %d on handler 1 should be allowed", i+1)
		}
	}
	if w := call(h2); w.Code != http.StatusTooManyRequests {
		t.Fatalf("handler 2 must see handler 1's attempts — got %d, want 429", w.Code)
	}
}
