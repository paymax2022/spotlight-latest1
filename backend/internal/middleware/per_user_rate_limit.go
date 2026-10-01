package middleware

import (
	"context"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	platformRedis "spotlight/backend/internal/platform/redis"
)

// Envelope field names — consts so this file does not add to the bare-literal
// count goconst tracks package-wide.
const (
	rlErrKey     = "error"
	rlSuccessKey = "success"
)

// PerUserRateLimit caps per-user requests/minute on a route. Redis-backed
// (fixed window via INCR+EXPIRE) when available so the limit holds across
// instances; otherwise an in-memory fallback (per-replica — a documented
// residual of SEC-001). Keyed by user_id, NOT ClientIP: every caller of this
// limiter sits behind auth, and IP keying is spoofable via X-Forwarded-For.
//
// prefix namespaces the Redis key ("rl:<prefix>:<uid>:<minute-bucket>") so two
// routes sharing a Redis never share a budget.
func PerUserRateLimit(redis *platformRedis.Client, prefix string, perMinute int) gin.HandlerFunc {
	if perMinute <= 0 {
		perMinute = 60
	}
	mem := &memLimiter{store: map[string]*memBucket{}, limit: perMinute, window: time.Minute}

	return func(c *gin.Context) {
		uid := ginutil.UserID(c)
		if uid == "" {
			c.Next() // auth middleware will reject; nothing to meter
			return
		}
		var count int
		var ok bool
		if redis != nil {
			count, ok = redisAllow(c.Request.Context(), redis, prefix+":"+uid, perMinute)
		} else {
			count, ok = mem.allow(uid)
		}
		c.Header("X-RateLimit-Limit", strconv.Itoa(perMinute))
		c.Header("X-RateLimit-Remaining", strconv.Itoa(max(perMinute-count, 0)))
		if !ok {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				rlSuccessKey: false,
				rlErrKey:     "rate limit exceeded",
				"code":       "rate_limited",
			})
			return
		}
		c.Next()
	}
}

// redisAllow does a fixed-window counter keyed to the current UTC minute.
// Fails open on cache error — rate limiting must never block users on infra.
func redisAllow(ctx context.Context, r *platformRedis.Client, keySuffix string, limit int) (int, bool) {
	bucket := time.Now().UTC().Format("200601021504") // yyyymmddHHMM
	key := "rl:" + keySuffix + ":" + bucket
	n, err := r.Incr(ctx, key).Result()
	if err != nil {
		return 0, true
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
