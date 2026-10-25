package top5events

import (
	"context"
	"log"
	"time"
)

// StartPendingOrderReconciler starts a background ticker that sweeps ticket
// checkouts left PENDING by a crash between reservation and payment (see Purchase
// / ReconcilePendingOrders). Each tick charges + issues tickets to buyers who can
// pay, and expires — releasing the reserved seat — those who cannot. Wired from
// RegisterEvents behind FeatureEventsEnabled; mirrors the house ticker pattern
// (fractionalre.StartAutoInvestRunner / symptomsearch.StartRetentionPurge).
//
// Multi-instance safe: ReconcilePendingOrders drives each order through the SAME
// idempotent finalizePurchase as the live Purchase path — the wallet debit dedups
// on its idempotency key, the PAID flip is guarded WHERE status='PENDING', and
// expiry is guarded by the PENDING row lock — so overlapping sweeps (or a sweep
// racing a client's own retry) replay rather than double-charge or double-release.
//
// interval is the tick cadence; olderThan is the grace period before a PENDING
// order is eligible, kept comfortably longer than a client's own retry window so
// the reconciler never races an in-flight checkout to expiry.
func StartPendingOrderReconciler(ctx context.Context, svc *Service, interval, olderThan time.Duration) {
	if svc == nil || svc.db == nil {
		return
	}
	if interval <= 0 {
		interval = 5 * time.Minute
	}
	if olderThan <= 0 {
		olderThan = 15 * time.Minute
	}
	run := func() {
		cctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		defer cancel()
		finalized, swept, err := svc.ReconcilePendingOrders(cctx, olderThan)
		if err != nil {
			// Log and CONTINUE: the cancel sweep must still run.
			log.Printf("[top5events] pending-order sweep error: %v", err)
		} else if finalized > 0 || swept > 0 {
			log.Printf("[top5events] pending-order sweep: finalized=%d swept=%d", finalized, swept)
		}
		// Re-drive cancelled events whose refund sweep did not finish (same
		// ticket-derived idempotency keys as Cancel, so this never double-refunds).
		if n, cerr := svc.ReconcileCancelledEvents(cctx); cerr != nil {
			log.Printf("[top5events] cancelled-event refund sweep error: %v", cerr)
		} else if n > 0 {
			log.Printf("[top5events] cancelled-event refund sweep: events=%d", n)
		}
		// Card-rail sweep — a no-op until EnableCardCheckout wires the rail
		// (EVTB-D013). Settles paid charges whose webhook never arrived, takes
		// over settle claims a crashed worker abandoned, releases expired unpaid
		// holds (verified unpaid first) and finishes refunds whose gateway call
		// failed. 2 min keeps it off intents the live webhook/poll is handling.
		if st, cerr := svc.ReconcileCardCheckouts(cctx, 2*time.Minute); cerr != nil {
			log.Printf("[top5events] card checkout sweep error: %v", cerr)
		} else if st.Confirmed+st.Expired+st.Refunded > 0 {
			log.Printf("[top5events] card checkout sweep: confirmed=%d expired=%d refunded=%d errors=%d",
				st.Confirmed, st.Expired, st.Refunded, st.Errors)
		}
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
	log.Printf("[top5events] pending-order reconciler started (interval %s, grace %s)", interval, olderThan)
}
