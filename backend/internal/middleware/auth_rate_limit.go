package middleware

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// AuthRateLimit throttles the unauthenticated auth endpoints per client IP.
//
// Login, register and password-reset had NO throttle of any kind: StemRateLimit
// exists but is applied only to the stem routes, so the sole limit on credential
// stuffing was whatever Supabase applied downstream. Account lockout
// (failed_login_attempts / locked_until in authService) defends a single account
// being guessed at; it does nothing about one client sweeping many accounts, or
// about hammering password-reset to spend the project's small email quota.
//
// Deliberately separate from StemRateLimit rather than reusing it:
//
//   - StemRateLimit's map NEVER evicts. One entry per (route, method, IP) is
//     harmless for a handful of internal routes and is an unbounded, attacker-
//     controlled allocation on an endpoint facing the internet. This one sweeps.
//   - It keys partly on an `x-stem-role` REQUEST HEADER, which a caller can set
//     freely. On an auth endpoint that is a trivial bypass: vary the header, get
//     a fresh bucket.
//
// The window is fixed rather than sliding, which permits a burst across a window
// boundary. That is accepted: the goal is to make bulk guessing expensive, and a
// 2x burst at the seam does not change that.
type authRateBucket struct {
	count       int
	windowStart time.Time
}

type AuthRateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*authRateBucket
	limit   int
	window  time.Duration
	now     func() time.Time // injectable so the tests do not sleep
}

// NewAuthRateLimiter builds a limiter. A non-positive limit or window falls back
// to conservative defaults rather than disabling the protection.
func NewAuthRateLimiter(limit int, window time.Duration) *AuthRateLimiter {
	if limit <= 0 {
		limit = 10
	}
	if window <= 0 {
		window = time.Minute
	}
	return &AuthRateLimiter{
		buckets: map[string]*authRateBucket{},
		limit:   limit,
		window:  window,
		now:     time.Now,
	}
}

// sweep drops buckets whose window has passed. Called opportunistically on write
// so there is no goroutine to leak, and it holds the lock the caller already has.
func (l *AuthRateLimiter) sweepLocked(now time.Time) {
	for k, b := range l.buckets {
		if now.Sub(b.windowStart) >= l.window {
			delete(l.buckets, k)
		}
	}
}

// Allow records an attempt and reports whether it is permitted, plus the seconds
// until the window resets.
func (l *AuthRateLimiter) Allow(key string) (allowed bool, remaining int, resetIn int) {
	now := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()

	// Bound the map before inserting, so a flood of distinct keys cannot grow it
	// without limit across windows.
	if len(l.buckets) > 0 {
		l.sweepLocked(now)
	}

	b, ok := l.buckets[key]
	if !ok || now.Sub(b.windowStart) >= l.window {
		b = &authRateBucket{windowStart: now}
		l.buckets[key] = b
	}
	b.count++

	resetIn = int((l.window - now.Sub(b.windowStart)).Seconds())
	if resetIn < 0 {
		resetIn = 0
	}
	remaining = l.limit - b.count
	if remaining < 0 {
		remaining = 0
	}
	return b.count <= l.limit, remaining, resetIn
}

// Middleware returns the gin handler. Keyed on route + method + client IP only —
// never on anything the caller controls, which is what makes it non-trivial to
// bypass.
func (l *AuthRateLimiter) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		key := c.FullPath() + "|" + c.Request.Method + "|" + c.ClientIP()
		allowed, remaining, resetIn := l.Allow(key)

		c.Header("X-RateLimit-Limit", strconv.Itoa(l.limit))
		c.Header("X-RateLimit-Remaining", strconv.Itoa(remaining))
		c.Header("X-RateLimit-Reset", strconv.Itoa(resetIn))

		if !allowed {
			c.Header("Retry-After", strconv.Itoa(resetIn))
			// Deliberately says nothing about whether the account exists or the
			// credentials were right — the same reason Login answers a generic 401.
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"success": false,
				"error":   "Too many attempts. Please try again later.",
			})
			return
		}
		c.Next()
	}
}

// Size reports the number of live buckets. For tests and diagnostics.
func (l *AuthRateLimiter) Size() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.buckets)
}
