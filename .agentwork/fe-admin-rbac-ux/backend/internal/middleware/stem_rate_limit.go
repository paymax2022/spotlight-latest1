package middleware

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

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
		resetIn := int(window.Seconds() - now.Sub(b.windowStart).Seconds())
		if resetIn < 0 {
			resetIn = 0
		}
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

