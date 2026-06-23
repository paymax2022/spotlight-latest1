package orchestration

import (
	"context"
	"time"
)

// StartReconScheduler runs daily reconciliation against the settlement source,
// emitting recon.completed per provider. Stops when ctx is cancelled (spec §8).
func StartReconScheduler(ctx context.Context, svc *Service, src SettlementSource, interval time.Duration) {
	if interval <= 0 {
		interval = 24 * time.Hour
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				_, _ = svc.RunDailyReconciliation(ctx, src, time.Now())
			}
		}
	}()
}

// StartTreasuryMonitor runs a background loop that periodically rebalances any
// float bucket at/below its low-water mark and emits balance.low alerts. Stops
// when ctx is cancelled. (V2 automated treasury, spec §7.)
func StartTreasuryMonitor(ctx context.Context, svc *Service, interval time.Duration) {
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
				svc.AutoRebalance(ctx)
			}
		}
	}()
}
