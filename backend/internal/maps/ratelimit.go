package maps

import (
	"context"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	platformRedis "spotlight/backend/internal/platform/redis"
)

// PerUserRateLimit protects the cost surface: every maps call can hit a paid
// provider, so we cap per-user requests/minute. Redis-backed (fixed window via
// INCR+EXPIRE) when available so the limit holds across instances; otherwise an
// in-memory fallback. Keyed by user_id (the proxy is always authenticated).
func PerUserRateLimit(redis *platformRedis.Client, perMinute int) gin.HandlerFunc {
	if perMinute <= 0 {
		perMinute = 120
	}
	mem := &memLimiter{store: map[string]*memBucket{}, limit: perMinute, window: time.Minute}

	return func(c *gin.Context) {
		uid := c.GetString("user_id")
		if uid == "" {
			c.Next() // auth middleware will reject; nothing to meter
			return
		}
		var count int
		var ok bool
		if redis != nil {
			count, ok = redisAllow(c.Request.Context(), redis, uid, perMinute)
		} else {
			count, ok = mem.allow(uid)
		}
		c.Header("X-RateLimit-Limit", strconv.Itoa(perMinute))
		remaining := perMinute - count
		if remaining < 0 {
			remaining = 0
		}
		c.Header("X-RateLimit-Remaining", strconv.Itoa(remaining))
		if !ok {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "rate limit exceeded", "code": "rate_limited",
			})
			return
		}
		c.Next()
	}
}

// redisAllow does a fixed-window counter keyed to the current UTC minute.
func redisAllow(ctx context.Context, r *platformRedis.Client, uid string, limit int) (int, bool) {
	bucket := time.Now().UTC().Format("200601021504") // yyyymmddHHMM
	key := "maps:rl:" + uid + ":" + bucket
	n, err := r.Incr(ctx, key).Result()
	if err != nil {
		return 0, true // fail-open on cache error — never block users on infra
	}
	if n == 1 {
		_ = r.Expire(ctx, key, 70*time.Second).Err()
	}
	return int(n), int(n) <= limit
}

type memBucket struct {
	count       int
	windowStart time.Time
}

type memLimiter struct {
	mu     sync.Mutex
	store  map[string]*memBucket
	limit  int
	window time.Duration
}

func (m *memLimiter) allow(uid string) (int, bool) {
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	b, ok := m.store[uid]
	if !ok || now.Sub(b.windowStart) >= m.window {
		b = &memBucket{windowStart: now}
		m.store[uid] = b
	}
	b.count++
	return b.count, b.count <= m.limit
}
