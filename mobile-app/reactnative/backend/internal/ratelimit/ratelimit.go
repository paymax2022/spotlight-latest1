// Package ratelimit is a small stdlib per-key token-bucket limiter (no external
// deps). Used to bound request rate per client IP (platform mandate: rate
// limiting). Buckets refill continuously at `rate` tokens/sec up to `burst`.
package ratelimit

import (
	"sync"
	"time"
)

type bucket struct {
	tokens float64
	last   time.Time
}

// Limiter is a thread-safe per-key token-bucket set.
type Limiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	rate    float64 // tokens per second
	burst   float64 // bucket capacity
}

// New returns a limiter allowing ~rate requests/sec with the given burst.
func New(rate, burst float64) *Limiter {
	if burst < 1 {
		burst = 1
	}
	return &Limiter{buckets: map[string]*bucket{}, rate: rate, burst: burst}
}

// Allow consumes a token for key, returning false if none are available.
func (l *Limiter) Allow(key string) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()

	b := l.buckets[key]
	if b == nil {
		b = &bucket{tokens: l.burst, last: now}
		l.buckets[key] = b
	}
	// Refill based on elapsed time, capped at burst.
	b.tokens += now.Sub(b.last).Seconds() * l.rate
	if b.tokens > l.burst {
		b.tokens = l.burst
	}
	b.last = now

	if b.tokens >= 1 {
		b.tokens--
		return true
	}
	return false
}
