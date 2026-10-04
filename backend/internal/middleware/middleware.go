package middleware

import (
	"context"
	"crypto/sha256"
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

	platformRedis "spotlight/backend/internal/platform/redis"
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
// It is a separate limiter rather than the shared stemRateStore because the key
// here must exclude everything the caller controls (route + method + client IP
// only) and the store is bounded — the two properties an internet-facing
// credential endpoint cannot do without.
//
// The window is fixed rather than sliding, which permits a burst across a window
// boundary. That is accepted: the goal is to make bulk guessing expensive, and a
// 2x burst at the seam does not change that.
type authRateBucket struct {
	count       int
	windowStart time.Time
}

// authRateLimitMaxKeys bounds the bucket map. Distinct keys are
// attacker-influenced (rotated source IPs behind a botnet or a permissive
// proxy chain), so without a hard cap a key-rotation flood grows the map
// unboundedly inside a single window — the sweep only removes buckets whose
// window expired. AUD-BE-004 / AUD-PERF-002 residual.
const authRateLimitMaxKeys = 100_000

type AuthRateLimiter struct {
	mu        sync.Mutex
	buckets   map[string]*authRateBucket
	limit     int
	window    time.Duration
	maxKeys   int
	lastSweep time.Time
	now       func() time.Time // injectable so the tests do not sleep
	redisGet  func() *platformRedis.Client
	redisNS   string
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
		maxKeys: authRateLimitMaxKeys,
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

// evictLocked drops up to n arbitrary buckets. A partial map range is O(n) and
// self-batches, so the cost of freeing space during a key-rotation flood stays
// amortized instead of scanning for the oldest entry on every overflow.
// Accuracy during an active flood loosens slightly — an evicted client regains
// a fresh budget — but bounding memory wins.
func (l *AuthRateLimiter) evictLocked(n int) {
	i := 0
	for k := range l.buckets {
		delete(l.buckets, k)
		if i++; i >= n {
			return
		}
	}
}

// WithRedis makes the limit shared across replicas: a fixed-window counter in
// Redis instead of the per-instance map, so N replicas can't hand an attacker
// N× the budget (E2E-BE-032). get is resolved per request (lazy because route
// registration runs before the shared Redis client is built); a nil result or
// any Redis error falls back to the in-memory map — protection degrades to
// per-instance, never disappears. ns namespaces the counter per mount (login
// vs reset can share a limiter type but not a budget).
func (l *AuthRateLimiter) WithRedis(get func() *platformRedis.Client, ns string) *AuthRateLimiter {
	l.redisGet = get
	l.redisNS = ns
	return l
}

// allowRedis records the attempt in the shared counter. The last return value
// is false on a Redis failure — the caller falls back to the local bucket path.
func (l *AuthRateLimiter) allowRedis(ctx context.Context, key string) (bool, int, int, bool) {
	r := l.redisGet()
	if r == nil {
		return false, 0, 0, false
	}
	now := l.now()
	bucket := now.Unix() / int64(l.window.Seconds())
	sum := sha256.Sum256([]byte(key))
	rkey := fmt.Sprintf("rl:authl:%s:%x:%d", l.redisNS, sum[:8], bucket)
	n, err := r.Incr(ctx, rkey).Result()
	if err != nil {
		return false, 0, 0, false
	}
	if n == 1 {
		_ = r.Expire(ctx, rkey, l.window+time.Minute).Err()
	}
	reset := time.Duration((bucket+1)*int64(l.window.Seconds())-now.Unix()) * time.Second
	return n <= int64(l.limit), max(int(int64(l.limit)-n), 0), int(reset.Seconds()), true
}

// Allow records an attempt and reports whether it is permitted, plus the seconds
// until the window resets.
func (l *AuthRateLimiter) Allow(key string) (bool, int, int) {
	return l.AllowCtx(context.Background(), key)
}

// AllowCtx is Allow with the caller's request context so a hung Redis can't
// outlive the request.
func (l *AuthRateLimiter) AllowCtx(ctx context.Context, key string) (bool, int, int) {
	if l.redisGet != nil {
		if ok, remaining, resetIn, hit := l.allowRedis(ctx, key); hit {
			return ok, remaining, resetIn
		}
	}
	var remaining int
	var resetIn int

	now := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()

	maxKeys := l.maxKeys
	if maxKeys <= 0 {
		maxKeys = authRateLimitMaxKeys
	}

	// Sweep stale buckets at most once per window — an O(len) scan on every
	// request against a near-cap map would itself be a CPU amplifier.
	if now.Sub(l.lastSweep) >= l.window {
		l.sweepLocked(now)
		l.lastSweep = now
	}

	b, ok := l.buckets[key]
	if !ok || now.Sub(b.windowStart) >= l.window {
		if !ok && len(l.buckets) >= maxKeys {
			// At capacity with a fresh key: prefer expired buckets, then a
			// batch of arbitrary ones, so the map never exceeds the cap.
			l.sweepLocked(now)
			if len(l.buckets) >= maxKeys {
				l.evictLocked(max(maxKeys/10, 1))
			}
		}
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
		allowed, remaining, resetIn := l.AllowCtx(c.Request.Context(), key)

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
	// window is the owning limiter's window, recorded at bucket creation so the
	// shared sweeper knows when the entry went stale — the store is global but
	// each (route, method) key belongs to exactly one limiter instance.
	window time.Duration
}

var (
	stemRateMu        sync.Mutex
	stemRateStore     = map[string]*stemRateBucket{}
	stemRateLastSweep time.Time
	// Bounds for the shared store (AUD-BE-004). The key is derived from route +
	// method + client IP — an attacker rotating source IPs must not be able to
	// grow the map without limit, and the caller-set `x-stem-role` header must
	// NOT be part of the key (each distinct value would mint a fresh bucket).
	// Vars (not consts) so tests can shrink them.
	stemRateMaxKeys       = 100_000
	stemRateSweepInterval = time.Minute
	stemRateLimitError    = "rate limit exceeded"
)

// sweepStemRateStoreLocked drops buckets whose owning window has passed. The
// caller holds stemRateMu.
func sweepStemRateStoreLocked(now time.Time) {
	for k, b := range stemRateStore {
		if now.Sub(b.windowStart) >= b.window {
			delete(stemRateStore, k)
		}
	}
}

// evictStemRateStoreLocked drops up to n arbitrary buckets — a partial map
// range is O(n) and self-batches, keeping overflow cost amortized under a
// key-rotation flood. The caller holds stemRateMu.
func evictStemRateStoreLocked(n int) {
	i := 0
	for k := range stemRateStore {
		delete(stemRateStore, k)
		if i++; i >= n {
			return
		}
	}
}

// stemRateRedisGet is bound once by BindStemRateRedis (route setup time).
// Resolved per request so a nil or errored client always falls back to the
// local store — protection degrades to per-instance, never disappears
// (E2E-BE-032 residual).
var stemRateRedisGet func() *platformRedis.Client

// BindStemRateRedis makes every StemRateLimit handler share its budget across
// replicas through Redis fixed-window counters. Call once at startup; handlers
// mounted before the call still pick it up because the getter is resolved at
// request time.
func BindStemRateRedis(get func() *platformRedis.Client) {
	stemRateRedisGet = get
}

// stemAllowRedis mirrors AuthRateLimiter.allowRedis for the shared stem store.
// Returns (allowed, remaining, resetSeconds, handled) — handled=false means the
// caller must use the local path.
func stemAllowRedis(ctx context.Context, r *platformRedis.Client, key string, limit int, window time.Duration, now time.Time) (bool, int, int, bool) {
	bucket := now.Unix() / int64(window.Seconds())
	sum := sha256.Sum256([]byte(key))
	rkey := fmt.Sprintf("rl:stem:%x:%d", sum[:8], bucket)
	n, err := r.Incr(ctx, rkey).Result()
	if err != nil {
		return false, 0, 0, false
	}
	if n == 1 {
		_ = r.Expire(ctx, rkey, window+time.Minute).Err()
	}
	reset := time.Duration((bucket+1)*int64(window.Seconds())-now.Unix()) * time.Second
	return n <= int64(limit), max(int(int64(limit)-n), 0), int(reset.Seconds()), true
}

// StemRateLimit enforces a fixed-window rate limit per route+client key. With
// BindStemRateRedis the budget is shared across replicas; otherwise it uses
// the bounded in-memory store (shared across all mount points). The key
// deliberately excludes the caller-set `x-stem-role` header — it is dead for
// authz since roles resolve via RBAC (ADR-056), and as a key component it let
// any caller mint a fresh bucket per request.
func StemRateLimit(limit int, window time.Duration) gin.HandlerFunc {
	if limit <= 0 {
		limit = 60
	}
	if window <= 0 {
		window = time.Minute
	}
	return func(c *gin.Context) {
		key := c.FullPath() + "|" + c.Request.Method + "|" + c.ClientIP()

		now := time.Now()
		if stemRateRedisGet != nil {
			if r := stemRateRedisGet(); r != nil {
				if allowed, remaining, resetIn, hit := stemAllowRedis(c.Request.Context(), r, key, limit, window, now); hit {
					c.Header("X-RateLimit-Limit", strconv.Itoa(limit))
					c.Header("X-RateLimit-Remaining", strconv.Itoa(remaining))
					c.Header("X-RateLimit-Reset", strconv.Itoa(resetIn))
					if !allowed {
						c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
							"success": false,
							"error":   stemRateLimitError,
						})
						return
					}
					c.Next()
					return
				}
			}
		}
		stemRateMu.Lock()
		if now.Sub(stemRateLastSweep) >= stemRateSweepInterval {
			sweepStemRateStoreLocked(now)
			stemRateLastSweep = now
		}
		b, ok := stemRateStore[key]
		if !ok || now.Sub(b.windowStart) >= window {
			if !ok && len(stemRateStore) >= stemRateMaxKeys {
				// At capacity with a fresh key: prefer expired buckets, then
				// a batch of arbitrary ones, so the map never exceeds the cap.
				sweepStemRateStoreLocked(now)
				if len(stemRateStore) >= stemRateMaxKeys {
					evictStemRateStoreLocked(max(stemRateMaxKeys/10, 1))
				}
			}
			b = &stemRateBucket{count: 0, windowStart: now, window: window}
			stemRateStore[key] = b
		}
		b.count++
		current := b.count
		resetIn := max(int(window.Seconds()-now.Sub(b.windowStart).Seconds()), 0)
		stemRateMu.Unlock()

		c.Header("X-RateLimit-Limit", strconv.Itoa(limit))
		c.Header("X-RateLimit-Remaining", strconv.Itoa(max(limit-current, 0)))
		c.Header("X-RateLimit-Reset", strconv.Itoa(resetIn))

		if current > limit {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"success": false,
				"error":   stemRateLimitError,
			})
			return
		}
		c.Next()
	}
}
