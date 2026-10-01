package middleware

import (
	"context"
	"crypto/subtle"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// RequestIDHeader is the correlation header honored on inbound requests and
// echoed on every response.
const RequestIDHeader = "X-Request-Id"

// requestIDKey is the gin context key; requestIDCtxKey is the net/http context
// key — kept unexported so callers go through the typed accessors.
const requestIDKey = "spotlight.request_id"

type requestIDCtxKey struct{}

// RequestID mints or adopts a correlation ID for every request. An inbound
// header is reused only when it is a plausible ID — arbitrary strings are
// replaced rather than propagated into logs (log-injection hygiene).
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := sanitizeRequestID(c.GetHeader(RequestIDHeader))
		if id == "" {
			id = uuid.NewString()
		}
		c.Set(requestIDKey, id)
		c.Request = c.Request.WithContext(context.WithValue(c.Request.Context(), requestIDCtxKey{}, id))
		c.Header(RequestIDHeader, id)
		c.Next()
	}
}

// GetRequestID returns the ID set by the RequestID middleware, or "".
func GetRequestID(c *gin.Context) string {
	if v, ok := c.Get(requestIDKey); ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// RequestIDFromContext returns the ID propagated into the request context, or "".
func RequestIDFromContext(ctx context.Context) string {
	if v := ctx.Value(requestIDCtxKey{}); v != nil {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// sanitizeRequestID accepts UUIDs and similar printable token IDs, rejecting
// anything with control characters/whitespace or longer than 128 bytes.
func sanitizeRequestID(s string) string {
	if len(s) == 0 || len(s) > 128 {
		return ""
	}
	for _, r := range s {
		if r < 0x21 || r > 0x7e {
			return ""
		}
	}
	return s
}

// devLANOrigin matches private-network (RFC 1918) origins such as Expo's LAN
// dev URLs (e.g. http://192.168.1.50:8083). Reflected only outside production.
var devLANOrigin = regexp.MustCompile(`^https?://(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$`)

// devLoopbackOrigin matches localhost / 127.0.0.1 dev origins on any port, such
// as Expo web served locally (http://localhost:8081/8083/8084) or the Next.js
// gateway proxying to us. Reflected only outside production. Without this, a
// browser on http://localhost:<port> gets no Access-Control-Allow-Origin and the
// cross-origin request fails (net::ERR_FAILED) even though the server responds.
var devLoopbackOrigin = regexp.MustCompile(`^https?://(localhost|127\.0\.0\.1)(:\d+)?$`)

// AllowedOriginChecker builds a reusable "is this Origin trusted" predicate from
// the same allowlist CORSMiddleware uses (an explicit CSV plus, outside
// production, any localhost/127.0.0.1 or private-LAN origin). Shared with the
// WebSocket hub (backend/internal/platform/ws) so the two enforcement points
// can never drift apart on which origins are trusted.
func AllowedOriginChecker(allowedOriginsCSV string, appEnv string) func(origin string) bool {
	allowed := map[string]struct{}{}
	for origin := range strings.SplitSeq(allowedOriginsCSV, ",") {
		trimmed := strings.TrimSpace(origin)
		if trimmed != "" {
			allowed[trimmed] = struct{}{}
		}
	}
	allowDevLAN := appEnv != "production"

	return func(origin string) bool {
		if _, ok := allowed[origin]; ok {
			return true
		}
		return allowDevLAN && (devLANOrigin.MatchString(origin) || devLoopbackOrigin.MatchString(origin))
	}
}

func CORSMiddleware(allowedOriginsCSV string, appEnv string) gin.HandlerFunc {
	isAllowed := AllowedOriginChecker(allowedOriginsCSV, appEnv)

	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if isAllowed(origin) {
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
			c.Writer.Header().Set("Vary", "Origin")
			c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
			c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-API-Key, X-Stem-Role, Idempotency-Key, X-Device-Id, X-Request-Id")
			c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		}

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}

// ParseTrustedProxies parses a CSV of CIDRs/IPs whose X-Forwarded-For /
// X-Real-Ip headers the Gin engine may trust when resolving ClientIP().
// "none" or empty input returns nil — forwarded headers are then ignored and
// ClientIP falls back to RemoteAddr (fail-closed; rate limits keyed on it may
// aggregate behind an unconfigured proxy, which is the safe direction).
func ParseTrustedProxies(csv string) ([]string, error) {
	csv = strings.TrimSpace(csv)
	if csv == "" || strings.EqualFold(csv, "none") {
		return nil, nil
	}
	var out []string
	for part := range strings.SplitSeq(csv, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if _, _, err := net.ParseCIDR(part); err != nil && net.ParseIP(part) == nil {
			return nil, fmt.Errorf("trusted proxy %q is not a valid IP or CIDR", part)
		}
		out = append(out, part)
	}
	return out, nil
}

// RequireServiceToken guards internal, service-to-service endpoints (e.g. the
// internal ledger API the separate trading service calls). It authenticates the
// caller with a shared Bearer service token compared in CONSTANT TIME to the
// configured expected value — this is NEVER a user JWT and never touches Supabase
// auth / RBAC.
// Fail-closed semantics:
//   - expected == "" (token unconfigured) → 503, so a mis-provisioned deployment
//     cannot silently accept every caller.
//   - missing/malformed Authorization header → 401.
//   - token mismatch → 401.
//
// The constant-time compare avoids leaking the token length/prefix through timing.
// Mirrors the Bearer-parsing shape of RequireAuthContext (auth_context.go) but
// deliberately shares NO code with it: a service token must never be accepted where
// a user token is expected, and vice-versa.
func RequireServiceToken(expected string) gin.HandlerFunc {
	expected = strings.TrimSpace(expected)
	return func(c *gin.Context) {
		if expected == "" {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "service_token_not_configured"})
			return
		}
		h := strings.TrimSpace(c.GetHeader("Authorization"))
		if !strings.HasPrefix(strings.ToLower(h), "bearer ") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing service token"})
			return
		}
		got := strings.TrimSpace(h[7:])
		if subtle.ConstantTimeCompare([]byte(got), []byte(expected)) != 1 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid service token"})
			return
		}
		c.Next()
	}
}

// AuthRateLimit throttles the unauthenticated auth endpoints per client IP.
// Login, register and password-reset had NO throttle of any kind: StemRateLimit
// exists but is applied only to the stem routes, so the sole limit on credential
// stuffing was whatever Supabase applied downstream. Account lockout
// (failed_login_attempts / locked_until in authService) defends a single account
// being guessed at; it does nothing about one client sweeping many accounts, or
// about hammering password-reset to spend the project's small email quota.
// Deliberately separate from StemRateLimit rather than reusing it:
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
func (l *AuthRateLimiter) Allow(key string) (bool, int, int) {
	var remaining int
	var resetIn int

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

	resetIn = max(int((l.window - now.Sub(b.windowStart)).Seconds()), 0)
	remaining = max(l.limit-b.count, 0)
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

type stemRateBucket struct {
	count       int
	windowStart time.Time
}

var (
	stemRateMu    sync.Mutex
	stemRateStore = map[string]*stemRateBucket{}
)

// StemRateLimit enforces a simple in-memory fixed-window rate limit per route+client key.
func StemRateLimit(limit int, window time.Duration) gin.HandlerFunc {
	if limit <= 0 {
		limit = 60
	}
	if window <= 0 {
		window = time.Minute
	}
	return func(c *gin.Context) {
		clientKey := c.ClientIP()
		if role := c.GetHeader("x-stem-role"); role != "" {
			clientKey = clientKey + "|" + role
		}
		key := c.FullPath() + "|" + c.Request.Method + "|" + clientKey

		now := time.Now()
		stemRateMu.Lock()
		b, ok := stemRateStore[key]
		if !ok || now.Sub(b.windowStart) >= window {
			b = &stemRateBucket{count: 0, windowStart: now}
			stemRateStore[key] = b
		}
		b.count++
		current := b.count
		resetIn := max(int(window.Seconds()-now.Sub(b.windowStart).Seconds()), 0)
		stemRateMu.Unlock()

		c.Header("X-RateLimit-Limit", strconv.Itoa(limit))
		c.Header("X-RateLimit-Remaining", strconv.Itoa(maxIntStem(limit-current, 0)))
		c.Header("X-RateLimit-Reset", strconv.Itoa(resetIn))

		if current > limit {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"success": false,
				"error":   "rate limit exceeded",
			})
			return
		}
		c.Next()
	}
}

func maxIntStem(a, b int) int {
	if a > b {
		return a
	}
	return b
}
