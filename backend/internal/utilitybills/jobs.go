package utilitybills

// Background reconciliation job (Phase 3, closes UTIL-002). Follows the
// goroutine+ticker pattern from maplerad/jobs.go's StartOrphanSweep: runs on an
// interval, stops when ctx is cancelled, and never lets one bad tick kill the
// loop.

import (
	"context"
	"log"
	"time"
)

// defaultSweepLimit mirrors requeryPendingUtilityTransactions's own default —
// the TS source's admin worker route falls back to 25 when no ?limit is given.
const defaultSweepLimit = 25

// StartPendingSweep periodically requeries transactions stuck in a non-terminal
// state (initiated / wallet_debited / provider_pending) with no resolved
// webhook or synchronous answer. Before this, NOTHING automatically resolved
// them — the only path was an admin manually hitting the requery-pending
// worker endpoint (UTIL-002).
func StartPendingSweep(ctx context.Context, svc *Service, interval time.Duration) {
	if interval <= 0 {
		interval = time.Hour
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				res, err := svc.SweepPending(ctx, defaultSweepLimit)
				if err != nil {
					log.Printf("utilitybills: pending sweep job: %v", err)
					continue
				}
				if res.Processed > 0 {
					log.Printf("utilitybills: pending sweep: processed=%d succeeded=%d failed=%d",
						res.Processed, res.Succeeded, res.Failed)
				}
			}
		}
	}()
}
