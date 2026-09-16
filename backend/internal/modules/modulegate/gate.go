package modulegate

import (
	"context"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/modules"
)

// StateSource is the registry read the gate depends on. An interface so the middleware
// is testable without a database.
type StateSource interface {
	VisibleKeys(ctx context.Context) ([]string, error)
}

// cache holds the published set, refreshed on a TTL.
//
// Per-request registry queries would put a database round trip in front of every API
// call in the product. Publication changes are rare and operator-driven, so a short
// staleness window is the right trade — the same 60s the mobile client uses.
type cache struct {
	mu        sync.RWMutex
	live      map[string]struct{}
	fetchedAt time.Time
	ttl       time.Duration
	src       StateSource
	// healthy is false once a refresh has failed, so the gate can allow traffic and
	// say so loudly rather than silently enforcing against a stale or empty set.
	healthy bool
}

func (c *cache) liveSet(ctx context.Context) (map[string]struct{}, bool) {
	c.mu.RLock()
	fresh := time.Since(c.fetchedAt) < c.ttl
	set, healthy := c.live, c.healthy
	c.mu.RUnlock()
	if fresh {
		return set, healthy
	}

	keys, err := c.src.VisibleKeys(ctx)
	if err != nil {
		// Keep serving the last good set if we have one; otherwise report unhealthy so
		// the caller allows. Never promote "unreadable" to "nothing is published" —
		// that would 503 the entire product on a config-table blip.
		c.mu.Lock()
		c.healthy = false
		c.fetchedAt = time.Now() // don't hammer a failing database on every request
		set, healthy = c.live, false
		c.mu.Unlock()
		log.Printf("[modulegate] registry refresh failed, allowing module traffic: %v", err)
		return set, healthy
	}
	next := make(map[string]struct{}, len(keys))
	for _, k := range keys {
		next[k] = struct{}{}
	}
	c.mu.Lock()
	c.live, c.fetchedAt, c.healthy = next, time.Now(), true
	c.mu.Unlock()
	return next, true
}

// Options configures the middleware.
type Options struct {
	// Enabled is the rollout switch. OFF means observe-only: the gate resolves the
	// module and logs what it WOULD have refused, without refusing anything. That is
	// how the route map gets validated against real traffic before it can 503 anyone.
	Enabled bool
	// TTL bounds how stale the published set may be. Zero uses 60s.
	TTL time.Duration
}

// New builds the middleware.
//
// Ordering note: mount this AFTER authentication. The gate is about release state, not
// identity, and running it first would answer 503 to requests that should have been 401
// — which reads to a caller as "the server is broken" rather than "you are not signed
// in", and leaks which modules exist to unauthenticated probes.
func New(src StateSource, opt Options) gin.HandlerFunc {
	ttl := opt.TTL
	if ttl <= 0 {
		ttl = 60 * time.Second
	}
	c := &cache{ttl: ttl, src: src, live: map[string]struct{}{}, healthy: false}

	return func(ctx *gin.Context) {
		p := ctx.Request.URL.Path
		key := ModuleFor(p)
		if key == "" || IsAdminPath(p) {
			ctx.Next() // unmapped surface, or an admin route — always allowed
			return
		}
		set, healthy := c.liveSet(ctx.Request.Context())
		if !healthy {
			ctx.Next() // registry unreadable — allow, already logged
			return
		}
		if _, live := set[key]; live {
			ctx.Next()
			return
		}
		if !opt.Enabled {
			// Observe-only: prove the map is right before it can cost an outage.
			log.Printf("[modulegate] WOULD refuse %s %s (module %q not published) — gate disabled", ctx.Request.Method, p, key)
			ctx.Next()
			return
		}
		// 503, not 404: the module exists and is expected to return, and a distinct code
		// for hidden-vs-coming-soon would leak which unreleased modules exist. The
		// message is deliberately generic for the same reason.
		ctx.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
			"error":  "This feature is not available yet.",
			"module": key,
		})
	}
}

// compile-time assurance that the concrete service satisfies the source interface.
var _ StateSource = (*modules.Service)(nil)
