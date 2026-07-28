package symptomsearch

// Per-user+device rate limit for the symptom-search surface (mapping-IP
// scraping guard, PRD §7 + NDPR query-volume cap). Mirrors maps.PerUserRateLimit:
// Redis-backed fixed window (INCR + EXPIRE on a per-minute bucket key) when a
// client is available — so the limit holds across instances — with an
// in-memory per-instance fallback otherwise. Fail-open on Redis errors: an
// infra hiccup never blocks members (the taxonomy stays server-mediated and
// APPROVED-only regardless).

import (
	"context"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	platformRedis "spotlight/backend/internal/platform/redis"
)

// PerUserDeviceRateLimit is a fixed-window limiter keyed by
// user_id|device_hash. rdb nil ⇒ in-memory fallback (single instance).
func PerUserDeviceRateLimit(rdb *platformRedis.Client, limit int, window time.Duration) gin.HandlerFunc {
	if limit <= 0 {
		limit = 20
	}
	if window <= 0 {
		window = time.Minute
	}
	mem := &searchLimiter{store: map[string]*searchBucket{}, limit: limit, window: window}

	return func(c *gin.Context) {
		key := c.GetString("user_id") + "|" + deviceHash(c)
		var count int
		var ok bool
		if rdb != nil {
			count, ok = redisAllow(c.Request.Context(), rdb, key, limit, window)
		} else {
			count, ok = mem.allow(key)
		}
		c.Header("X-RateLimit-Limit", strconv.Itoa(limit))
		remaining := limit - count
		if remaining < 0 {
			remaining = 0
		}
		c.Header("X-RateLimit-Remaining", strconv.Itoa(remaining))
		if !ok {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "rate limit exceeded", "code": "rate_limited"})
			return
		}
		c.Next()
	}
}

// redisAllow does a fixed-window counter on a per-minute UTC bucket (the same
// scheme as maps.redisAllow). Fail-open on cache errors.
func redisAllow(ctx context.Context, rdb *platformRedis.Client, key string, limit int, window time.Duration) (int, bool) {
	bucket := time.Now().UTC().Format("200601021504") // yyyymmddHHMM
	rkey := "symptom:rl:" + key + ":" + bucket
	n, err := rdb.Incr(ctx, rkey).Result()
	if err != nil {
		return 0, true // fail-open — never block members on infra
	}
	if n == 1 {
		_ = rdb.Expire(ctx, rkey, window+10*time.Second).Err()
	}
	return int(n), int(n) <= limit
}

type searchBucket struct {
	count       int
	windowStart time.Time
}

type searchLimiter struct {
	mu     sync.Mutex
	store  map[string]*searchBucket
	limit  int
	window time.Duration
}

func (l *searchLimiter) allow(key string) (int, bool) {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	b, ok := l.store[key]
	if !ok || now.Sub(b.windowStart) >= l.window {
		b = &searchBucket{windowStart: now}
		l.store[key] = b
	}
	b.count++
	return b.count, b.count <= l.limit
}
