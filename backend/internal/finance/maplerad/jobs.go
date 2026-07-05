package maplerad

import (
	"context"
	"log"
	"time"
)

// Background reconciliation jobs (ADR-012 reconciliation.md). Both follow the
// goroutine+ticker pattern used by orchestration/monitor.go: they run on an
// interval and stop when ctx is cancelled. All work is idempotent (drift is
// quarantined, never auto-corrected; orphan transitions go through the guard).

// StartReconcile runs daily full reconciliation of internal derived balances vs
// Maplerad custody balances. Drift → quarantine + alert (never auto-correct).
func StartReconcile(ctx context.Context, svc *Service, interval time.Duration) {
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
				if err := svc.ReconcileWallets(ctx); err != nil {
					log.Printf("maplerad: reconcile job: %v", err)
				}
			}
		}
	}()
}

// StartOrphanSweep periodically finds PENDING transfers with no terminal webhook
// past the TTL and re-queries/transitions them. The TTL equals the sweep
// interval here (a PENDING op older than one interval is an orphan candidate).
func StartOrphanSweep(ctx context.Context, svc *Service, interval time.Duration) {
	if interval <= 0 {
		interval = time.Hour
	}
	ttl := interval
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := svc.SweepOrphans(ctx, ttl); err != nil {
					log.Printf("maplerad: orphan sweep job: %v", err)
				}
			}
		}
	}()
}
