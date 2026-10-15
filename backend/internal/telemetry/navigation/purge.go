package navigation

import (
	"context"
	"log"
	"time"
)

// RetentionDays is how long navigation events are kept before being purged.
const RetentionDays = 90

const purgeBatchSize = 10000

// purger is the narrow slice of Repository the purge needs (test seam).
type purger interface {
	PurgeOlderThan(ctx context.Context, cutoff time.Time, batch int) (int64, error)
}

// purgeOnce is the single-tick body: delete events older than RetentionDays
// relative to the injected now.
func purgeOnce(ctx context.Context, repo purger, now time.Time) (int64, error) {
	cutoff := now.Add(-RetentionDays * 24 * time.Hour)
	return repo.PurgeOlderThan(ctx, cutoff, purgeBatchSize)
}

// StartPurgeScheduler runs purgeOnce every interval until ctx is done.
// Running this on multiple instances is harmless: the DELETE of old rows is
// idempotent, so concurrent or repeated purges just find nothing left.
func StartPurgeScheduler(ctx context.Context, repo *Repository, interval time.Duration) {
	run := func() {
		n, err := purgeOnce(ctx, repo, time.Now())
		if err != nil {
			log.Printf("[navtel] retention purge failed: %v", err)
			return
		}
		log.Printf("[navtel] retention purge deleted %d rows", n)
	}
	go func() {
		run()
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				run()
			}
		}
	}()
	log.Printf("[navtel] retention purge scheduler started (interval %s, retention %dd)", interval, RetentionDays)
}
