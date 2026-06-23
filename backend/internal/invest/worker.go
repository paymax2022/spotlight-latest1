package invest

import (
	"context"
	"log"
	"time"
)

// StartSettlementWorker runs a background ticker that advances PendingSettlement
// orders whose T+N window has elapsed (buy → shares credited, sell → cash
// released). Mirrors orchestration.StartTreasuryMonitor.
//
// In a multi-instance deployment this should be guarded by a Redlock so only one
// instance settles per tick; for now the work is idempotent at the ledger level
// (settlement-release entries carry a unique idempotency key) so double-runs are
// safe — a duplicate release is rejected by the unique index.
func StartSettlementWorker(ctx context.Context, svc *Service, interval time.Duration) {
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
				n, err := svc.ProcessDueSettlements(ctx, 200)
				if err != nil {
					log.Printf("[invest] settlement worker error: %v", err)
					continue
				}
				if n > 0 {
					log.Printf("[invest] settlement worker settled %d order(s)", n)
				}
			}
		}
	}()
	log.Printf("[invest] settlement worker started (interval=%s)", interval)
}
