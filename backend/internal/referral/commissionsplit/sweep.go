package commissionsplit

import (
	"context"
	"log"
	"time"

	"spotlight/backend/internal/finance/commission"
)

// sweepLockKey is the pg advisory-lock key that keeps the catch-up sweep to one
// runner at a time across replicas. Arbitrary, fixed, and unique to this job.
const sweepLockKey int64 = 0x5f5c_0353_7765_6570 // "commission-split sweep"

// SweepOptions bounds one catch-up pass.
type SweepOptions struct {
	// MinAge skips earnings younger than this, so the sweep never races the live
	// hook for a row commission.Service is still processing.
	MinAge time.Duration
	// Lookback is how far back the sweep looks. Bounded so a code that was
	// retired when an old purchase happened is not paid for it months later
	// after an admin raises the cap.
	Lookback time.Duration
	// Limit caps the rows handled per pass.
	Limit int
}

// SweepResult reports one pass.
type SweepResult struct {
	Scanned  int // candidate earnings found
	Credited int // earnings whose reward is now CREDITED
	Retried  int // stranded PENDING rewards that were credited this pass
	Failed   int // earnings/rewards that returned an error (retried next pass)
}

// Sweep is the catch-up for the ReferralHook. The hook only fires for earnings
// written through commission.Service; a writer that inserts commission_earnings
// directly (frontend-web's utility path does) never triggers it, so its
// referrer was never paid. Sweep finds those earnings and runs the SAME split
// on them. Every guard is the hook's own: the referral_rewards existence check
// and its UNIQUE source_transaction_id, the per-code cap claim, and a ledger
// credit keyed on the reward id. Running it any number of times pays each
// earning at most once.
//
// Only earnings whose payer was already attributed to a human referrer at
// purchase time (the attribution's effective time is at or before the
// earning) are candidates: a purchase made before the referral, or before a
// reassignment, does not pay whoever owns the payer now.
func (s *Service) Sweep(ctx context.Context, opts SweepOptions) (SweepResult, error) {
	var res SweepResult
	if !s.enabled || s.pool == nil {
		return res, nil
	}
	if opts.Limit <= 0 {
		opts.Limit = 200
	}

	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return res, err
	}
	defer conn.Release()
	var locked bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, sweepLockKey).Scan(&locked); err != nil {
		return res, err
	}
	if !locked {
		return res, nil // another replica is sweeping
	}
	defer func() {
		_, _ = conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock($1)`, sweepLockKey)
	}()

	rows, err := conn.Query(ctx, `
		SELECT ce.id, ce.service_category, ce.service, ce.service_subtype,
		       ce.gross_amount_kobo, ce.spotlight_revenue_kobo, ce.currency,
		       ce.source_module, ce.source_ref, ce.user_id::text, ce.created_at
		FROM public.commission_earnings ce
		JOIN public.referral_attributions ra ON ra.referred_user_id = ce.user_id
		LEFT JOIN public.referral_links rl ON rl.referrer_id = ra.referrer_id
		WHERE ce.user_id IS NOT NULL
		  AND ce.spotlight_revenue_kobo > 0
		  AND ce.created_at <= now() - make_interval(secs => $1)
		  AND ce.created_at >= now() - make_interval(secs => $2)
		  AND ra.is_house = false
		  AND ra.referrer_id IS NOT NULL
		  AND COALESCE(ra.reassigned_at, ra.created_at) <= ce.created_at
		  AND (rl.id IS NULL OR rl.reward_count < rl.reward_cap)
		  AND NOT EXISTS (
		        SELECT 1 FROM public.referral_rewards rr
		        WHERE rr.source_transaction_id = 'commission:' || ce.id::text)
		ORDER BY ce.created_at
		LIMIT $3`,
		opts.MinAge.Seconds(), opts.Lookback.Seconds(), opts.Limit)
	if err != nil {
		return res, err
	}
	var batch []commission.Earning
	for rows.Next() {
		var e commission.Earning
		var userID string
		if err := rows.Scan(&e.ID, &e.ServiceCategory, &e.Service, &e.ServiceSubtype,
			&e.GrossAmountKobo, &e.SpotlightRevenueKobo, &e.Currency,
			&e.SourceModule, &e.SourceRef, &userID, &e.CreatedAt); err != nil {
			rows.Close()
			return res, err
		}
		e.UserID = &userID
		batch = append(batch, e)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return res, err
	}

	res.Scanned = len(batch)
	for _, e := range batch {
		if err := ctx.Err(); err != nil {
			return res, err
		}
		if err := s.trySplit(ctx, e); err != nil {
			res.Failed++
			log.Printf("[referral/commissionsplit] sweep: split failed (earning=%s user=%s): %v", e.ID, *e.UserID, err)
			continue
		}
		var credited bool
		if err := s.pool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM public.referral_rewards WHERE source_transaction_id = $1 AND status = 'CREDITED')`,
			"commission:"+e.ID,
		).Scan(&credited); err == nil && credited {
			res.Credited++
		}
	}

	if err := s.retryPending(ctx, opts, &res); err != nil {
		return res, err
	}
	return res, nil
}

// retryPending re-drives the ledger credit for this engine's rewards left
// PENDING by a failed credit. The row already holds its cap slot, so no slot is
// claimed again; the ledger key is derived from the reward id, so a credit that
// actually landed before the failure is reported as a duplicate and only the
// status is repaired. Rows younger than MinAge are left to the call that
// created them.
func (s *Service) retryPending(ctx context.Context, opts SweepOptions, res *SweepResult) error {
	rows, err := s.pool.Query(ctx, `
		SELECT id, referrer_id::text, referred_user_id::text, source_transaction_id,
		       module, margin_kobo, reward_kobo
		FROM public.referral_rewards
		WHERE status = 'PENDING'
		  AND source_transaction_id LIKE 'commission:%'
		  AND created_at <= now() - make_interval(secs => $1)
		  AND created_at >= now() - make_interval(secs => $2)
		ORDER BY created_at
		LIMIT $3`,
		opts.MinAge.Seconds(), opts.Lookback.Seconds(), opts.Limit)
	if err != nil {
		return err
	}
	var pending []pendingReward
	for rows.Next() {
		var r pendingReward
		if err := rows.Scan(&r.ID, &r.ReferrerID, &r.ReferredUserID, &r.SourceTransactionID,
			&r.Module, &r.MarginKobo, &r.RewardKobo); err != nil {
			rows.Close()
			return err
		}
		pending = append(pending, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, r := range pending {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := s.creditReward(ctx, r); err != nil {
			res.Failed++
			log.Printf("[referral/commissionsplit] sweep: pending credit failed (reward=%s): %v", r.ID, err)
			continue
		}
		res.Retried++
	}
	return nil
}

// StartSweeper runs Sweep every interval until ctx is cancelled. The first pass
// fires one interval after boot so it never competes with startup. A no-op when
// the split is disabled.
func (s *Service) StartSweeper(ctx context.Context, every time.Duration, opts SweepOptions) {
	if !s.enabled || s.pool == nil {
		return
	}
	go func() {
		t := time.NewTicker(every)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				res, err := s.Sweep(ctx, opts)
				if err != nil {
					log.Printf("[referral/commissionsplit] sweep error: %v", err)
					continue
				}
				if res.Credited > 0 || res.Retried > 0 || res.Failed > 0 {
					log.Printf("[referral/commissionsplit] sweep: scanned=%d credited=%d retried=%d failed=%d", res.Scanned, res.Credited, res.Retried, res.Failed)
				}
			}
		}
	}()
}
