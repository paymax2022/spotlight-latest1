package invest

import (
	"context"
	"log"
	"time"

	platformRedis "spotlight/backend/internal/platform/redis"
)

// withLock runs fn while holding a short Redis lock so only one instance acts
// per tick. When rc is nil (no Redis) it runs fn directly — safe on a single
// node because the underlying work is idempotent (unique idempotency keys /
// status guards). Returns false if the lock was held elsewhere.
func withLock(ctx context.Context, rc *platformRedis.Client, key string, ttl time.Duration, fn func()) bool {
	if rc == nil {
		fn()
		return true
	}
	ok, val, err := platformRedis.AcquireLock(ctx, rc, key, ttl)
	if err != nil || !ok {
		return false
	}
	defer platformRedis.ReleaseLock(ctx, rc, key, val)
	fn()
	return true
}

// StartSettlementWorker runs a background ticker that advances PendingSettlement
// orders whose T+N window has elapsed (buy → shares credited, sell → cash
// released). Guarded by a Redlock so only one node settles per tick.
func StartSettlementWorker(ctx context.Context, svc *Service, rc *platformRedis.Client, interval time.Duration) {
	if svc == nil {
		return
	}
	if interval <= 0 {
		interval = time.Minute
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				withLock(ctx, rc, "invest:settlement", 55*time.Second, func() {
					n, err := svc.ProcessDueSettlements(ctx, 200)
					if err != nil {
						log.Printf("[invest] settlement worker error: %v", err)
						return
					}
					if n > 0 {
						log.Printf("[invest] settlement worker settled %d order(s)", n)
					}
				})
			}
		}
	}()
	log.Printf("[invest] settlement worker started (interval=%s, redlock=%v)", interval, rc != nil)
}
