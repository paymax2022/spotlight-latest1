package cryptosvc

// GAP-DEP-01 Slice 2b — the deposit reconciler: the money-IN safety net.
//
// A deposit webhook is the fast path, but it can be lost outright or delivered while the
// transfer is still below the confirmation floor. Unlike a swap, an inbound transfer has
// no local row to re-read, so the only way to discover one the webhook missed is to ask the
// provider. The reconciler sweeps each provider sub-account's ListDeposits and re-feeds
// every transfer into the SAME once-only, confirmation-gated settler the webhook uses, so:
//   - a missed webhook is finally settled;
//   - a transfer delivered under-confirmed is settled once its confirmations reach the floor;
//   - a transfer already settled is a no-op (the store's UNIQUE(provider_op_id) dedupes it).
// It therefore can never double-credit, no matter how often it runs or overlaps itself —
// the money invariant lives in the settler, and the reconciler only ever re-submits.
//
// It mirrors the swap Reconciler (single-leader across replicas, telemetry for the admin
// status view, per-pass bounds so one hung account cannot stall the sweep).

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"spotlight/backend/internal/cryptoprov"
)

// DepositAccountSource enumerates the provider sub-accounts the platform holds crypto for,
// so the sweep knows whose deposit list to poll. Implemented over crypto_accounts in the app
// wiring; kept a seam so this package stays free of that table.
type DepositAccountSource interface {
	ListProviderAccounts(ctx context.Context, provider string) ([]string, error)
}

// DepositReconcilerConfig tunes the deposit safety net.
type DepositReconcilerConfig struct {
	ProviderName string
	Registry     *cryptoprov.Registry
	Settler      DepositSettler
	Accounts     DepositAccountSource
	// Leader is mandatory: two replicas sweeping the same account would issue duplicate
	// provider calls (harmless to the ledger, wasteful and noisy).
	Leader LeaderLock
	// Alert surfaces conditions a human must see (a sweep error, a truncated pass).
	Alert func(kind, message string)

	Batch         int           // max deposits settled per account per pass (default 100)
	MaxAccounts   int           // max sub-accounts swept per pass (default 500)
	HandleTimeout time.Duration // cap on one account's sweep (default 20s)
}

// DepositReconcileResult counts what one deposit pass did.
type DepositReconcileResult struct {
	Skipped    bool // another replica leads
	Accounts   int  // sub-accounts swept
	Scanned    int  // deposits looked at
	Settled    int  // first-time credits
	Duplicates int  // already-settled op ids, no balance change
	Awaiting   int  // confirmed-but-under-floor or pending; not credited yet
	Ignored    int  // unmapped / rejected; credits nobody
	Truncated  bool // more deposits or accounts existed than this pass's bounds allowed
	Errors     int
}

// DepositReconcilerTotals accumulate across the passes this replica has led.
type DepositReconcilerTotals struct {
	Settled, Duplicates, Awaiting, Ignored, Errors int64
}

// DepositReconcilerSnapshot is this replica's reconciler state for the admin status view.
type DepositReconcilerSnapshot struct {
	StartedAt    time.Time
	Runs         int64
	LedRuns      int64
	SkippedRuns  int64
	LastRunAt    time.Time
	LastLedAt    time.Time
	LastLed      bool
	LastResult   DepositReconcileResult
	LastError    string
	Totals       DepositReconcilerTotals
	RecentAlerts []ReconcilerAlert
}

type depositTelemetry struct {
	mu     sync.Mutex
	snap   DepositReconcilerSnapshot
	alerts []ReconcilerAlert
}

func (t *depositTelemetry) alert(at time.Time, kind, msg string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.alerts = append(t.alerts, ReconcilerAlert{At: at, Kind: kind, Message: msg})
	if len(t.alerts) > maxRecentAlerts {
		t.alerts = t.alerts[len(t.alerts)-maxRecentAlerts:]
	}
}

func (t *depositTelemetry) pass(at time.Time, res DepositReconcileResult, err error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.snap.StartedAt.IsZero() {
		t.snap.StartedAt = at
	}
	t.snap.Runs++
	t.snap.LastRunAt = at
	t.snap.LastError = ""
	if err != nil {
		t.snap.LastError = err.Error()
		return
	}
	if res.Skipped {
		t.snap.SkippedRuns++
		t.snap.LastLed = false
		return
	}
	t.snap.LedRuns++
	t.snap.LastLed = true
	t.snap.LastLedAt = at
	t.snap.LastResult = res
	t.snap.Totals.Settled += int64(res.Settled)
	t.snap.Totals.Duplicates += int64(res.Duplicates)
	t.snap.Totals.Awaiting += int64(res.Awaiting)
	t.snap.Totals.Ignored += int64(res.Ignored)
	t.snap.Totals.Errors += int64(res.Errors)
}

// DepositReconciler sweeps provider deposits and re-submits each to the settler.
type DepositReconciler struct {
	cfg DepositReconcilerConfig
	tel depositTelemetry
	now func() time.Time
}

// NewDepositReconciler applies defaults.
func NewDepositReconciler(cfg DepositReconcilerConfig) *DepositReconciler {
	if cfg.Batch <= 0 {
		cfg.Batch = 100
	}
	if cfg.MaxAccounts <= 0 {
		cfg.MaxAccounts = 500
	}
	if cfg.HandleTimeout <= 0 {
		cfg.HandleTimeout = 20 * time.Second
	}
	return &DepositReconciler{cfg: cfg, now: time.Now}
}

// Snapshot returns a copy of this replica's deposit-reconciler state. Safe from any goroutine.
func (r *DepositReconciler) Snapshot() DepositReconcilerSnapshot {
	r.tel.mu.Lock()
	defer r.tel.mu.Unlock()
	s := r.tel.snap
	s.RecentAlerts = make([]ReconcilerAlert, 0, len(r.tel.alerts))
	for i := len(r.tel.alerts) - 1; i >= 0; i-- {
		s.RecentAlerts = append(s.RecentAlerts, r.tel.alerts[i])
	}
	return s
}

func (r *DepositReconciler) alert(kind, msg string) {
	r.tel.alert(r.now(), kind, msg)
	if r.cfg.Alert == nil {
		return
	}
	defer func() { _ = recover() }()
	r.cfg.Alert(kind, msg)
}

// RunOnce does one sweep and records it. Safe across replicas: only the leader works.
func (r *DepositReconciler) RunOnce(ctx context.Context) (DepositReconcileResult, error) {
	res, err := r.runOnce(ctx)
	r.tel.pass(r.now(), res, err)
	return res, err
}

func (r *DepositReconciler) runOnce(ctx context.Context) (DepositReconcileResult, error) {
	var res DepositReconcileResult
	cfg := r.cfg
	if cfg.Registry == nil || cfg.Settler == nil || cfg.Accounts == nil || cfg.Leader == nil || cfg.ProviderName == "" {
		return res, errors.New("cryptosvc: deposit reconciler needs provider, registry, settler, accounts and a leader lock")
	}
	release, ok, err := cfg.Leader.TryLead(ctx)
	if err != nil {
		return res, fmt.Errorf("cryptosvc: deposit leader lock: %w", err)
	}
	if !ok {
		res.Skipped = true
		return res, nil
	}
	defer release()

	p, err := cfg.Registry.Get(cfg.ProviderName)
	if err != nil {
		return res, fmt.Errorf("cryptosvc: deposit provider %q: %w", cfg.ProviderName, err)
	}
	dp, err := cryptoprov.As[cryptoprov.DepositProvider](p)
	if err != nil {
		return res, fmt.Errorf("cryptosvc: provider %q cannot list deposits: %w", cfg.ProviderName, err)
	}

	all, err := cfg.Accounts.ListProviderAccounts(ctx, cfg.ProviderName)
	if err != nil {
		r.alert("deposit_reconcile_error", fmt.Sprintf("list provider accounts: %v", err))
		return res, fmt.Errorf("cryptosvc: list provider accounts: %w", err)
	}
	if len(all) > cfg.MaxAccounts {
		res.Truncated = true
		r.alert("deposit_reconcile_truncated", fmt.Sprintf("%d provider accounts, sweeping only the first %d this pass", len(all), cfg.MaxAccounts))
		all = all[:cfg.MaxAccounts]
	}

	for _, acct := range all {
		if ctx.Err() != nil {
			return res, ctx.Err()
		}
		res.Accounts++
		hctx, cancel := context.WithTimeout(ctx, cfg.HandleTimeout)
		deps, err := dp.ListDeposits(hctx, acct)
		if err != nil {
			res.Errors++
			r.alert("deposit_reconcile_error", fmt.Sprintf("list deposits for %s: %v", acct, err))
			cancel()
			continue
		}
		// A deposit provider lists oldest-first; re-submit the earliest so an under-confirmed
		// one reaches its floor first. Beyond Batch, defer the rest to the next pass.
		if len(deps) > cfg.Batch {
			res.Truncated = true
			deps = deps[:cfg.Batch]
		}
		for _, d := range deps {
			res.Scanned++
			out, err := cfg.Settler.SettleDeposit(hctx, cfg.ProviderName, d)
			if err != nil {
				res.Errors++
				r.alert("deposit_reconcile_error", fmt.Sprintf("settle deposit %s (acct %s): %v", d.ID, acct, err))
				continue
			}
			switch out {
			case OutcomeApplied:
				res.Settled++
			case OutcomeDuplicate:
				res.Duplicates++
			case OutcomePending:
				res.Awaiting++
			default:
				res.Ignored++
			}
		}
		cancel()
	}
	return res, nil
}

// Run loops RunOnce every interval until ctx ends. Errors are alerted, never fatal.
func (r *DepositReconciler) Run(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 60 * time.Second
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		if _, err := r.RunOnce(ctx); err != nil && ctx.Err() == nil {
			r.alert("deposit_reconcile_error", err.Error())
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
