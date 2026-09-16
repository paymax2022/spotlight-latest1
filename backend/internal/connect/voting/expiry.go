package connectvoting

// Contest expiry loop: closes contests whose voting deadline has passed.
//
// Nothing ever moved a contest to 'ended'. A finished contest stayed 'active',
// so /api/v1/contests kept listing it and the connect_contests mirror kept it
// 'open' — ListContests then served it to the phone with a LIVE badge. Votes
// were still refused correctly (votingOpen checks the closes_at window, not just
// the status), so this was never a money bug, but every finished contest went on
// advertising itself as running.
//
// Scheduling decision: the repo has NO pg_cron (the one cron.schedule line in
// supabase/migrations is commented out) and NO asynq periodic scheduler — the
// house pattern for periodic work is a background ticker goroutine
// (symptomsearch.StartRetentionPurge, orchestration.StartReconScheduler). This
// mirrors that pattern.
//
// The work itself is the SECURITY DEFINER SQL function
// public.close_expired_contests() (migration 20261227000000), service_role-
// executable only; this loop merely invokes it on a schedule.

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DefaultExpiryInterval is how often expired contests are swept. Hourly rather
// than daily: a contest that ends at 09:00 should not still read LIVE at 20:00,
// and the statement is a cheap indexed no-op when nothing has expired.
const DefaultExpiryInterval = time.Hour

// StartExpiryCloser runs close_expired_contests once at startup and then every
// `every` until ctx is cancelled.
//
// Multi-instance safe: the UPDATE is guarded on status IN ('active','upcoming')
// and a past deadline, so a row can only transition once. Concurrent runs are
// redundant, never harmful — the second sees no matching rows.
func StartExpiryCloser(ctx context.Context, db *pgxpool.Pool, every time.Duration) {
	if db == nil {
		return
	}
	if every <= 0 {
		every = DefaultExpiryInterval
	}
	run := func() {
		cctx, cancel := context.WithTimeout(ctx, time.Minute)
		defer cancel()
		var closed int
		if err := db.QueryRow(cctx, `SELECT public.close_expired_contests()`).Scan(&closed); err != nil {
			// Logged, never fatal: a failed sweep leaves contests reading LIVE for
			// another interval, which is the status quo this fixes — not a reason to
			// take the process down.
			log.Printf("[connect.voting] contest expiry sweep failed: %v", err)
			return
		}
		if closed > 0 {
			log.Printf("[connect.voting] contest expiry sweep: %d contest(s) past their deadline closed", closed)
		}
	}
	go func() {
		run()
		t := time.NewTicker(every)
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
}
