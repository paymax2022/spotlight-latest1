package cryptosvc

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
)

// LeaderLock makes the reconciler single-leader across replicas. TryLead returns
// ok=false (and no error) when another replica leads; release must be called when done.
type LeaderLock interface {
	TryLead(ctx context.Context) (release func(), ok bool, err error)
}

// ReconcilerConfig tunes the safety-net job (spec 8.4).
type ReconcilerConfig struct {
	Service *Service
	// Leader is mandatory: without it two replicas would process the same swaps.
	Leader LeaderLock
	// Alert is called for conditions a human must see (parked swaps with money held,
	// repeated errors, a negative clearing balance). Nil drops alerts.
	Alert func(kind, message string)
	// ClearingBalance reads the crypto_clearing ledger balance in kobo; nil disables the check.
	ClearingBalance func(ctx context.Context) (int64, error)

	ProcessingAfter time.Duration // re-read a processing swap untouched this long (default 20s)
	ConfirmingAfter time.Duration // a confirming swap this stale has no live Confirm behind it (default 2m)
	QuotedGrace     time.Duration // expire a quote this long after its expiry (default 1m)
	Batch           int           // swaps per state per pass (default 50)
}

// ReconcileResult counts what one pass did.
type ReconcileResult struct {
	Skipped          bool // another replica leads
	Resolved         int  // provider state applied (ledger settled, state moved)
	Released         int  // hold released for a swap that never reached the provider
	Parked           int  // moved to needs_review with the hold kept
	Expired          int  // unconfirmed quotes expired
	Errors           int
	ClearingNegative bool
}

// Reconciler re-reads in-flight swaps from the provider and repairs the ones a crash or a
// lost webhook left behind. It never calls ConfirmSwap and never refunds a swap whose
// provider call may have happened.
type Reconciler struct{ cfg ReconcilerConfig }

// NewReconciler applies defaults.
func NewReconciler(cfg ReconcilerConfig) *Reconciler {
	if cfg.ProcessingAfter <= 0 {
		cfg.ProcessingAfter = 20 * time.Second
	}
	if cfg.ConfirmingAfter <= 0 {
		cfg.ConfirmingAfter = 2 * time.Minute
	}
	if cfg.QuotedGrace <= 0 {
		cfg.QuotedGrace = time.Minute
	}
	if cfg.Batch <= 0 {
		cfg.Batch = 50
	}
	return &Reconciler{cfg: cfg}
}

func (r *Reconciler) alert(kind, msg string) {
	if r.cfg.Alert != nil {
		r.cfg.Alert(kind, msg)
	}
}

// RunOnce does one pass. Safe to call from several replicas: only the leader works.
func (r *Reconciler) RunOnce(ctx context.Context) (ReconcileResult, error) {
	var res ReconcileResult
	if r.cfg.Leader == nil || r.cfg.Service == nil {
		return res, errors.New("cryptosvc: reconciler needs a service and a leader lock")
	}
	release, ok, err := r.cfg.Leader.TryLead(ctx)
	if err != nil {
		return res, fmt.Errorf("cryptosvc: leader lock: %w", err)
	}
	if !ok {
		res.Skipped = true
		return res, nil
	}
	defer release()

	svc := r.cfg.Service
	now := svc.cfg.Now()
	for _, q := range []struct {
		state  cryptoprov.SwapState
		cutoff time.Time
	}{
		{cryptoprov.SwapStateProcessing, now.Add(-r.cfg.ProcessingAfter)},
		{cryptoprov.SwapStateConfirming, now.Add(-r.cfg.ConfirmingAfter)},
		{cryptoprov.SwapStateQuoted, now.Add(-r.cfg.QuotedGrace)},
	} {
		swaps, err := svc.cfg.Store.StaleSwaps(ctx, q.state, q.cutoff, r.cfg.Batch)
		if err != nil {
			res.Errors++
			r.alert("reconcile_error", fmt.Sprintf("list %s swaps: %v", q.state, err))
			continue
		}
		for _, rec := range swaps {
			if ctx.Err() != nil {
				return res, ctx.Err()
			}
			if err := r.handle(ctx, rec, q.state, q.cutoff, &res); err != nil {
				res.Errors++
				r.alert("reconcile_error", fmt.Sprintf("swap %s (%s): %v", rec.ID, q.state, err))
			}
		}
	}

	if r.cfg.ClearingBalance != nil {
		bal, err := r.cfg.ClearingBalance(ctx)
		switch {
		case err != nil:
			res.Errors++
			r.alert("reconcile_error", fmt.Sprintf("read clearing balance: %v", err))
		case bal < 0:
			res.ClearingNegative = true
			r.alert("clearing_negative", fmt.Sprintf("crypto_clearing balance is %d kobo: treasury must fund clearing", bal))
		}
	}
	return res, nil
}

// handle repairs one swap under the same per-swap lock Confirm uses, re-reading it first so
// a Confirm that finished in the meantime is never overridden.
func (r *Reconciler) handle(ctx context.Context, queued SwapRecord, state cryptoprov.SwapState, cutoff time.Time, res *ReconcileResult) error {
	svc := r.cfg.Service
	return svc.locked(ctx, "confirm:"+queued.ID, func(ctx context.Context) error {
		rec, err := svc.reload(ctx, queued.UserID, queued.ID)
		if err != nil {
			return err
		}
		if rec.State != state || !rec.UpdatedAt.Before(cutoff) {
			return nil // moved on, or touched again since it was queued
		}
		in := SwapLedgerInput{SwapID: rec.ID, UserID: rec.UserID, Side: rec.Side, NGNKobo: rec.NGNKobo, FeeKobo: rec.FeeKobo, FeeBps: rec.FeeBps}

		switch state {
		case cryptoprov.SwapStateQuoted:
			if svc.cfg.Now().Before(rec.ExpiresAt.Add(r.cfg.QuotedGrace)) {
				return nil
			}
			if applied, err := svc.cfg.Store.TransitionSwap(ctx, rec.ID, state, cryptoprov.SwapStateExpired, decimal.Zero, "quote expired unconfirmed"); err != nil {
				return err
			} else if applied {
				res.Expired++
			}

		case cryptoprov.SwapStateProcessing, cryptoprov.SwapStateConfirming:
			if rec.ProviderSwapID != "" {
				out, err := svc.cfg.Ingest.ResolveSwap(ctx, svc.cfg.Provider, rec)
				if err != nil {
					return err
				}
				if out == OutcomeApplied {
					res.Resolved++
				}
				return nil
			}
			if state == cryptoprov.SwapStateProcessing || rec.ExecuteAttempted {
				// Either a data anomaly (processing with no provider id) or a provider call
				// of unknown outcome. Never re-call, never refund: park it with the hold kept.
				if err := svc.mustTo(ctx, rec, cryptoprov.SwapStateNeedsReview, "reconciler: provider outcome unknown and no provider swap id recorded"); err != nil {
					return err
				}
				res.Parked++
				r.alert("swap_parked", fmt.Sprintf("swap %s parked in needs_review with %d kobo held and no provider swap id", rec.ID, rec.NGNKobo+rec.FeeKobo))
				return nil
			}
			// Confirming, provider never called: nothing executed, so release any hold.
			if err := svc.cfg.Settler.FailBuy(ctx, in); err != nil {
				return err
			}
			if err := svc.mustTo(ctx, rec, cryptoprov.SwapStateFailed, "reconciler: confirm never reached the provider; hold released"); err != nil {
				return err
			}
			res.Released++
		}
		return nil
	})
}

// Run loops RunOnce every interval until ctx ends. Errors are alerted, never fatal.
func (r *Reconciler) Run(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 30 * time.Second
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		if _, err := r.RunOnce(ctx); err != nil && ctx.Err() == nil {
			r.alert("reconcile_error", err.Error())
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
