package middleware

import (
	"testing"
	"time"
)

// Moved here from internal/maps when the limiter generalised — the window-reset
// assertion reaches into the bucket internals, which is why this file is an
// internal test while per_user_rate_limit_test.go stays external.
func TestMemLimiterFixedWindow(t *testing.T) {
	l := &memLimiter{store: map[string]*memBucket{}, limit: 2, window: time.Minute}
	if _, ok := l.allow("u1"); !ok {
		t.Fatal("1st call should pass")
	}
	if _, ok := l.allow("u1"); !ok {
		t.Fatal("2nd call should pass")
	}
	if _, ok := l.allow("u1"); ok {
		t.Fatal("3rd call should be limited")
	}
	// Different user has its own bucket.
	if _, ok := l.allow("u2"); !ok {
		t.Fatal("other user should pass")
	}
	// Window reset.
	l.store["u1"].windowStart = time.Now().Add(-2 * time.Minute)
	if _, ok := l.allow("u1"); !ok {
		t.Fatal("after window reset the call should pass again")
	}
}
