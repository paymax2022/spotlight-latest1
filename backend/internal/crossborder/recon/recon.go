// Package recon implements the SP-3a three-way reconciliation jobs (spec §9):
// our ledger / orchestration book vs the Verto side vs the commission registry.
//
// All jobs are READ-ONLY against money: the only mutation is writing a break row
// (crossborder_recon_breaks). The Verto side is MODELED behind the Source
// interface (V-items); production wires a Verto reader, tests inject a fake.
// Amounts are int64 minor units; no floats.
//
// Idempotency: a break is identified by (check, type, ref_a, ref_b). Re-running
// a job never duplicates a break that is still OPEN; once a break is resolved a
// recurrence opens a fresh one. Scheduling/flag wiring is Task 9 — the Reconcile*
// funcs are exposed for it.
package recon

import (
	"context"
	"fmt"
	"strings"

	"spotlight/backend/internal/finance/ledger"
)

// BreakType classifies a discrepancy.
type BreakType string

const (
	MissingInProvider   BreakType = "missing-in-provider"
	MissingInLedger     BreakType = "missing-in-ledger"
	MissingInCommission BreakType = "missing-in-commission"
	AmountMismatch      BreakType = "amount-mismatch"
	StatusMismatch      BreakType = "status-mismatch"
	Duplicate           BreakType = "duplicate"
	RecognitionGap      BreakType = "recognition-gap"
)

// Severity of a break for ops triage.
type Severity string

const (
	SevLow    Severity = "low"
	SevMedium Severity = "medium"
	SevHigh   Severity = "high"
)

// Check names.
const (
	CheckLedgerVsProvider    = "ledger_vs_provider"
	CheckTransfersVsProvider = "transfers_vs_provider"
	CheckMarkupVsStatement   = "markup_vs_statement"
	CheckCommissionVsLedger  = "commission_vs_ledger"
	CheckRecognitionGap      = "recognition_gap"
)

// Item is one reconcilable line: a balance key, transfer ref, etc.
type Item struct {
	Ref      string
	Amount   int64 // minor units
	Status   string
	Currency string
}

// SpreadLeg is one orch_ledger_entries `paymax_spread` credit that should have a
// matching recognition accrual (cb:{ref}:fx_spread:{svc}:accrue).
type SpreadLeg struct {
	Reference   string
	Service     string // "" = unknown: any known service's accrual satisfies it
	CustomerID  string
	Currency    string
	AmountMinor int64
	// NoNGNLeg marks a trade with neither leg NGN: recognition legitimately
	// declines it (revenue.ErrNoNGNRate), so it is not a gap.
	NoNGNLeg bool
}

// SETTLED-ONLY SYMMETRY CONTRACT (ReconCommissionVsLedger): commission rolls up
// at settlement, so BOTH CommissionEntries and LedgerRevenue MUST return
// settled-only rows. If either side includes accrued/in-flight transfers, every
// in-flight transfer shows as a false high-severity missing-in-ledger /
// missing-in-commission break. A partially-reversed settled revenue must be
// reported net, matching the commission amount. Task 9's real readers must
// honour this.
//
// Source reads both sides of every comparison. Provider-side methods are the
// modeled Verto data. Every method is read-only.
type Source interface {
	LedgerBalances(ctx context.Context) ([]Item, error)   // our ledger/orch per sub-account & master
	ProviderBalances(ctx context.Context) ([]Item, error) // Verto wallet balances, same Ref keys
	OurTransfers(ctx context.Context) ([]Item, error)
	ProviderTransfers(ctx context.Context) ([]Item, error) // Verto trades/payouts
	ExpectedMarkup(ctx context.Context) ([]Item, error)    // from fxMarkupPerc / PRPreFXMarkupRate / amounts
	StatementMarkup(ctx context.Context) ([]Item, error)   // Verto-reported markup per statement
	// CommissionEntries: NGN commission registry keyed by transfer. SETTLED-ONLY
	// (see the symmetry contract above); must match LedgerRevenue's scope.
	CommissionEntries(ctx context.Context) ([]Item, error)
	// LedgerRevenue is the SETTLED-ONLY revenue per transfer in the ledger
	// revenue accounts, net of partial reversals (commission rolls up at
	// settlement, so accrued-only revenue has no commission row yet).
	LedgerRevenue(ctx context.Context) ([]Item, error)
	SpreadLegs(ctx context.Context) ([]SpreadLeg, error)
}

// EntryReader is the read-only ledger lookup used by the recognition-gap check.
type EntryReader interface {
	EntryByKey(ctx context.Context, idempotencyKey string) (*ledger.Entry, bool, error)
}

var _ EntryReader = (*ledger.Service)(nil)

// Redriver re-runs recognition for a spread leg (idempotent). Optional.
type Redriver interface {
	Redrive(ctx context.Context, leg SpreadLeg) error
}

// Break is one recorded discrepancy.
type Break struct {
	Check    string
	Type     BreakType
	Severity Severity
	RefA     string // our side
	RefB     string // other side
	Delta    int64  // other - ours (minor units); 0 for non-amount breaks
	Detail   string
}

// DedupeKey identifies the discrepancy across re-runs.
func (b Break) DedupeKey() string {
	return strings.Join([]string{b.Check, string(b.Type), b.RefA, b.RefB}, "|")
}

// Report is the outcome of one run.
type Report struct {
	RunID     string
	Check     string
	Breaks    []Break // every discrepancy detected this run
	NewBreaks int     // how many were newly recorded (not already open)
	Redriven  int     // recognition gaps healed by re-driving
}

// Store persists runs and breaks.
type Store interface {
	StartRun(ctx context.Context, check string) (string, error)
	// RecordBreak inserts b unless an OPEN break with the same DedupeKey exists.
	RecordBreak(ctx context.Context, runID string, b Break) (created bool, err error)
	FinishRun(ctx context.Context, runID string, detected, created, redriven int) error
}

// Reconciler runs the jobs.
type Reconciler struct {
	src      Source
	ledger   EntryReader
	store    Store
	redriver Redriver
}

// New builds the reconciler.
func New(src Source, l EntryReader, st Store) *Reconciler {
	return &Reconciler{src: src, ledger: l, store: st}
}

// EnableRedrive lets the recognition-gap check heal gaps by re-driving
// recognition instead of only recording a break.
func (r *Reconciler) EnableRedrive(d Redriver) { r.redriver = d }

// ---- generic comparison --------------------------------------------------

type labels struct {
	notInB BreakType // present in A, absent from B
	notInA BreakType // present in B, absent from A
	sev    map[BreakType]Severity
}

func defaultSev(t BreakType) Severity {
	switch t {
	case StatusMismatch, Duplicate:
		return SevMedium
	default:
		return SevHigh
	}
}

func index(items []Item) (first map[string]Item, dups map[string]int) {
	first = map[string]Item{}
	dups = map[string]int{}
	for _, it := range items {
		dups[it.Ref]++
		if _, ok := first[it.Ref]; !ok {
			first[it.Ref] = it
		}
	}
	return
}

// compare diffs A (ours) against B (other). Output is deterministic (sorted by
// input order of A then B).
func compare(check string, a, b []Item, l labels) []Break {
	_, da := index(a)
	fb, db := index(b)
	var out []Break
	add := func(t BreakType, ra, rb string, delta int64, detail string) {
		out = append(out, Break{Check: check, Type: t, Severity: defaultSev(t), RefA: ra, RefB: rb, Delta: delta, Detail: detail})
	}
	seen := map[string]bool{}
	for _, it := range a {
		if seen[it.Ref] {
			continue
		}
		seen[it.Ref] = true
		if da[it.Ref] > 1 || db[it.Ref] > 1 {
			add(Duplicate, it.Ref, it.Ref, 0, fmt.Sprintf("ref %s appears %d times on side A, %d on side B", it.Ref, da[it.Ref], db[it.Ref]))
		}
		o, ok := fb[it.Ref]
		if !ok {
			add(l.notInB, it.Ref, "", -it.Amount, fmt.Sprintf("%s (%d) has no counterpart", it.Ref, it.Amount))
			continue
		}
		curDiff := !strings.EqualFold(o.Currency, it.Currency)
		if o.Amount != it.Amount || curDiff {
			detail := fmt.Sprintf("ours %d vs other %d", it.Amount, o.Amount)
			if curDiff {
				detail += fmt.Sprintf("; currency ours %q vs other %q", it.Currency, o.Currency)
			}
			add(AmountMismatch, it.Ref, o.Ref, o.Amount-it.Amount, detail)
		}
		if !strings.EqualFold(o.Status, it.Status) {
			add(StatusMismatch, it.Ref, o.Ref, 0, fmt.Sprintf("ours %q vs other %q", it.Status, o.Status))
		}
	}
	for _, it := range b {
		if seen[it.Ref] {
			continue
		}
		seen[it.Ref] = true
		if db[it.Ref] > 1 {
			add(Duplicate, "", it.Ref, 0, fmt.Sprintf("ref %s appears %d times on side B", it.Ref, db[it.Ref]))
		}
		add(l.notInA, "", it.Ref, it.Amount, fmt.Sprintf("%s (%d) has no counterpart", it.Ref, it.Amount))
	}
	return out
}

func (r *Reconciler) finish(ctx context.Context, check string, breaks []Break, redriven int) (*Report, error) {
	runID, err := r.store.StartRun(ctx, check)
	if err != nil {
		return nil, err
	}
	rep := &Report{RunID: runID, Check: check, Breaks: breaks, Redriven: redriven}
	for _, b := range breaks {
		created, err := r.store.RecordBreak(ctx, runID, b)
		if err != nil {
			return rep, err
		}
		if created {
			rep.NewBreaks++
		}
	}
	return rep, r.store.FinishRun(ctx, runID, len(breaks), rep.NewBreaks, redriven)
}

func (r *Reconciler) pair(ctx context.Context, check string,
	ours, theirs func(context.Context) ([]Item, error), l labels) (*Report, error) {
	a, err := ours(ctx)
	if err != nil {
		return nil, fmt.Errorf("recon %s: side A: %w", check, err)
	}
	b, err := theirs(ctx)
	if err != nil {
		return nil, fmt.Errorf("recon %s: side B: %w", check, err)
	}
	return r.finish(ctx, check, compare(check, a, b, l), 0)
}

// ReconLedgerVsProvider compares our ledger/orch balances to the modeled Verto
// wallet balances, per sub-account and master.
func (r *Reconciler) ReconLedgerVsProvider(ctx context.Context) (*Report, error) {
	return r.pair(ctx, CheckLedgerVsProvider, r.src.LedgerBalances, r.src.ProviderBalances,
		labels{notInB: MissingInProvider, notInA: MissingInLedger})
}

// ReconTransfersVsProvider compares our transfers to Verto trades/payouts
// (status and amount).
func (r *Reconciler) ReconTransfersVsProvider(ctx context.Context) (*Report, error) {
	return r.pair(ctx, CheckTransfersVsProvider, r.src.OurTransfers, r.src.ProviderTransfers,
		labels{notInB: MissingInProvider, notInA: MissingInLedger})
}

// ReconMarkupVsStatement compares the expected markup to the Verto-reported
// markup per statement.
func (r *Reconciler) ReconMarkupVsStatement(ctx context.Context) (*Report, error) {
	return r.pair(ctx, CheckMarkupVsStatement, r.src.ExpectedMarkup, r.src.StatementMarkup,
		labels{notInB: MissingInProvider, notInA: MissingInLedger})
}

// ReconCommissionVsLedger compares commission entries to the ledger revenue
// accounts (side A = commission, side B = ledger revenue).
func (r *Reconciler) ReconCommissionVsLedger(ctx context.Context) (*Report, error) {
	return r.pair(ctx, CheckCommissionVsLedger, r.src.CommissionEntries, r.src.LedgerRevenue,
		labels{notInB: MissingInLedger, notInA: MissingInCommission})
}

// knownServices mirrors revenue's service set (spec §8).
var knownServices = []string{"fx", "convert", "send", "receive", "onboarding"}

func accrueKey(ref, svc string) string { return "cb:" + ref + ":fx_spread:" + svc + ":accrue:debit" }

func (r *Reconciler) recognised(ctx context.Context, leg SpreadLeg) (bool, error) {
	svcs := knownServices
	if leg.Service != "" {
		svcs = []string{leg.Service}
	}
	for _, s := range svcs {
		_, ok, err := r.ledger.EntryByKey(ctx, accrueKey(leg.Reference, s))
		if err != nil {
			return false, err
		}
		if ok {
			return true, nil
		}
	}
	return false, nil
}

// ReconRecognitionGap is the best-effort-recognition safety net: it finds
// orch_ledger_entries `paymax_spread` legs with no recognition accrual in the
// durable ledger and either re-drives recognition (when a Redriver is enabled
// and the accrual then exists) or records a recognition-gap break.
func (r *Reconciler) ReconRecognitionGap(ctx context.Context) (*Report, error) {
	legs, err := r.src.SpreadLegs(ctx)
	if err != nil {
		return nil, fmt.Errorf("recon %s: %w", CheckRecognitionGap, err)
	}
	var breaks []Break
	redriven := 0
	for _, leg := range legs {
		if leg.NoNGNLeg || leg.AmountMinor <= 0 {
			continue
		}
		ok, err := r.recognised(ctx, leg)
		if err != nil {
			return nil, err
		}
		if ok {
			continue
		}
		detail := fmt.Sprintf("paymax_spread %d %s for %s has no cb:%s:fx_spread:*:accrue recognition", leg.AmountMinor, leg.Currency, leg.Reference, leg.Reference)
		if r.redriver != nil {
			if derr := r.redriver.Redrive(ctx, leg); derr != nil {
				detail += "; redrive failed: " + derr.Error()
			} else if ok, err = r.recognised(ctx, leg); err != nil {
				return nil, err
			} else if ok {
				redriven++
				continue
			} else {
				detail += "; redrive reported success but no accrual appeared"
			}
		}
		breaks = append(breaks, Break{Check: CheckRecognitionGap, Type: RecognitionGap, Severity: SevHigh,
			RefA: leg.Reference, Delta: leg.AmountMinor, Detail: detail})
	}
	return r.finish(ctx, CheckRecognitionGap, breaks, redriven)
}
