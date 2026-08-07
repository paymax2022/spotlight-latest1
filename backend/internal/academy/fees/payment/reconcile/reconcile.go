// Package feesreconcile is the EdTech School-Fees NIGHTLY RECONCILIATION job (build-spec §4
// SF-8). It walks recent settled money records — academy_invoice_payments and vault
// contributions — and cross-checks each against the authoritative gateway/ledger state, then
// returns a DRIFT REPORT and ALERTS on any mismatch.
//
// Iron discipline (SF-8): reconciliation NEVER silently auto-corrects money. It is a read-only
// cross-checker: it detects drift and reports/alerts, leaving corrections to a human via
// reversing entries (finance/ledger.PostReversal). The job is idempotent and safe to re-run —
// running it twice over the same window yields the same report and mutates nothing.
//
// All collaborators are SMALL locally-declared interfaces so reconcile_test.go can inject
// in-memory fakes (no live DB / ledger / gateway) and assert that a seeded drift is flagged
// without any mutation. The concrete adapters are wired at the composition root by the
// integration task (pgx-backed payment/contribution sources; a ledger "Posted"/amount reader;
// the provider.PaymentProvider for gateway verification).
package feesreconcile

import (
	"context"
	"sort"
	"time"
)

// ── Injected read-only collaborators ────────────────────────────────────────────────

// PaymentSource yields recent invoice-payment records to reconcile. Read-only.
type PaymentSource interface {
	// RecentPayments returns succeeded invoice payments created since `since`.
	RecentPayments(ctx context.Context, since time.Time) ([]PaymentRecord, error)
}

// ContributionSource yields recent vault contributions to reconcile. Read-only.
type ContributionSource interface {
	// RecentContributions returns vault contributions created since `since`.
	RecentContributions(ctx context.Context, since time.Time) ([]ContributionRecord, error)
}

// LedgerReader is the authoritative ledger cross-check. It never mutates. Posted reports whether
// the balanced pair for a base idempotency key was durably written (mirrors
// finance/ledger.Service.Posted, which checks the ":credit" leg — the ledger of record,
// independent of any cache). This is exactly what tells us a money record has a matching ledger
// entry (SF-8's core check).
type LedgerReader interface {
	// Posted reports whether the ledger holds a balanced entry for baseIdempotencyKey.
	Posted(ctx context.Context, baseIdempotencyKey string) (bool, error)
}

// GatewayReader is the optional authoritative gateway cross-check for payment records that carry
// a gateway reference. It never mutates. It returns the gateway-side status + amount so the job
// can flag status/amount drift against our record.
type GatewayReader interface {
	// VerifyAmount returns the gateway's (status, amountMinor) for a reference. An implementation
	// backed by provider.PaymentProvider.VerifyPayment satisfies this via a thin shim.
	VerifyAmount(ctx context.Context, reference string) (status string, amountMinor int64, err error)
}

// ── Records under reconciliation ─────────────────────────────────────────────────────

// PaymentRecord is a thin, read-only view of an invoice payment row for reconciliation.
type PaymentRecord struct {
	PaymentID      string
	InvoiceID      string
	AmountMinor    int64
	GatewayRef     string // may be empty (e.g. vault-applied payments have no gateway ref)
	IdempotencyKey string // shared base key used for the ledger move (SF-8 join key)
	CreatedAt      time.Time
}

// ContributionRecord is a thin, read-only view of a vault contribution row for reconciliation.
type ContributionRecord struct {
	ContributionID string
	VaultID        string
	AmountMinor    int64
	IdempotencyKey string
	CreatedAt      time.Time
}

// ── Drift report ─────────────────────────────────────────────────────────────────────

// DriftKind classifies a detected mismatch.
type DriftKind string

const (
	// DriftMissingLedgerEntry: a settled money record (payment/contribution) has NO matching
	// balanced ledger entry — the money leg and the record disagree. The core SF-8 alarm.
	DriftMissingLedgerEntry DriftKind = "missing_ledger_entry"
	// DriftGatewayStatusMismatch: our record is settled but the gateway does not report success.
	DriftGatewayStatusMismatch DriftKind = "gateway_status_mismatch"
	// DriftGatewayAmountMismatch: the gateway amount differs from our recorded amount.
	DriftGatewayAmountMismatch DriftKind = "gateway_amount_mismatch"
	// DriftCheckError: a collaborator errored while checking this record (surfaced, not swallowed;
	// treated as an alert because we could not confirm consistency).
	DriftCheckError DriftKind = "check_error"
)

// RecordType distinguishes what kind of money record drifted.
type RecordType string

const (
	RecordPayment      RecordType = "invoice_payment"
	RecordContribution RecordType = "vault_contribution"
)

// Drift is one detected mismatch. It carries enough identity for a human to investigate + issue a
// reversing entry — the job itself corrects nothing.
type Drift struct {
	Kind           DriftKind  `json:"kind"`
	RecordType     RecordType `json:"recordType"`
	RecordID       string     `json:"recordId"`
	IdempotencyKey string     `json:"idempotencyKey"`
	AmountMinor    int64      `json:"amountMinor"`
	// GatewayAmountMinor is populated for gateway amount-mismatch drift.
	GatewayAmountMinor int64  `json:"gatewayAmountMinor,omitempty"`
	GatewayStatus      string `json:"gatewayStatus,omitempty"`
	Detail             string `json:"detail"`
}

// Report is the SF-8 output: the reconciled window, counts, and the list of drifts. Alerts is a
// convenience slice of human-readable alert strings (one per drift) for logging/paging. Clean
// reports (no drift) return an empty Drifts/Alerts slice — never nil, so callers can log counts
// deterministically.
type Report struct {
	Since                time.Time `json:"since"`
	RanAt                time.Time `json:"ranAt"`
	PaymentsChecked      int       `json:"paymentsChecked"`
	ContributionsChecked int       `json:"contributionsChecked"`
	Drifts               []Drift   `json:"drifts"`
	Alerts               []string  `json:"alerts"`
}

// HasDrift reports whether the run found any mismatch (the paging signal).
func (r *Report) HasDrift() bool { return len(r.Drifts) > 0 }

// ── Reconciler ───────────────────────────────────────────────────────────────────────

// Reconciler runs the nightly SF-8 cross-check. It is stateless + read-only.
type Reconciler struct {
	payments      PaymentSource
	contributions ContributionSource
	ledger        LedgerReader
	gateway       GatewayReader // optional; nil skips gateway cross-checks
}

// NewReconciler wires the read-only sources + checkers. gateway may be nil (ledger cross-check
// still runs, which is the primary SF-8 invariant).
func NewReconciler(payments PaymentSource, contributions ContributionSource, ledger LedgerReader, gateway GatewayReader) *Reconciler {
	return &Reconciler{payments: payments, contributions: contributions, ledger: ledger, gateway: gateway}
}

// Run reconciles all money records created since `since`. It returns a drift report and NEVER
// mutates anything (SF-8). Idempotent + safe to re-run: it only reads. A check that itself errors
// is recorded as a DriftCheckError alert rather than aborting the whole run, so one bad record
// cannot hide the rest.
func (rc *Reconciler) Run(ctx context.Context, since time.Time) (*Report, error) {
	rep := &Report{
		Since:  since,
		RanAt:  time.Now().UTC(),
		Drifts: []Drift{},
		Alerts: []string{},
	}

	// ── Invoice payments ──
	pays, err := rc.payments.RecentPayments(ctx, since)
	if err != nil {
		return nil, err
	}
	rep.PaymentsChecked = len(pays)
	for _, p := range pays {
		rc.checkPayment(ctx, rep, p)
	}

	// ── Vault contributions ──
	contribs, err := rc.contributions.RecentContributions(ctx, since)
	if err != nil {
		return nil, err
	}
	rep.ContributionsChecked = len(contribs)
	for _, cont := range contribs {
		rc.checkContribution(ctx, rep, cont)
	}

	// Deterministic ordering so re-runs produce identical reports (idempotent output).
	sort.SliceStable(rep.Drifts, func(i, j int) bool {
		if rep.Drifts[i].RecordType != rep.Drifts[j].RecordType {
			return rep.Drifts[i].RecordType < rep.Drifts[j].RecordType
		}
		return rep.Drifts[i].RecordID < rep.Drifts[j].RecordID
	})
	// Rebuild alerts in the same deterministic order.
	rep.Alerts = rep.Alerts[:0]
	for _, d := range rep.Drifts {
		rep.Alerts = append(rep.Alerts, alertString(d))
	}
	return rep, nil
}

// checkPayment cross-checks one invoice payment against the ledger (and gateway, if wired). Any
// mismatch appends a Drift; it corrects nothing.
func (rc *Reconciler) checkPayment(ctx context.Context, rep *Report, p PaymentRecord) {
	// Primary SF-8 check: does a balanced ledger entry exist for this money record?
	posted, err := rc.ledger.Posted(ctx, p.IdempotencyKey)
	if err != nil {
		rep.add(Drift{Kind: DriftCheckError, RecordType: RecordPayment, RecordID: p.PaymentID,
			IdempotencyKey: p.IdempotencyKey, AmountMinor: p.AmountMinor,
			Detail: "ledger check failed: " + err.Error()})
		return
	}
	if !posted {
		rep.add(Drift{Kind: DriftMissingLedgerEntry, RecordType: RecordPayment, RecordID: p.PaymentID,
			IdempotencyKey: p.IdempotencyKey, AmountMinor: p.AmountMinor,
			Detail: "invoice payment has no matching balanced ledger entry"})
		// A missing ledger entry is the headline alarm; still fall through to the gateway check
		// so a report can carry every independent signal for this record.
	}

	// Optional gateway cross-check for gateway-originated payments.
	if rc.gateway != nil && p.GatewayRef != "" {
		status, amt, gerr := rc.gateway.VerifyAmount(ctx, p.GatewayRef)
		if gerr != nil {
			rep.add(Drift{Kind: DriftCheckError, RecordType: RecordPayment, RecordID: p.PaymentID,
				IdempotencyKey: p.IdempotencyKey, AmountMinor: p.AmountMinor,
				Detail: "gateway verify failed: " + gerr.Error()})
			return
		}
		if !isSuccess(status) {
			rep.add(Drift{Kind: DriftGatewayStatusMismatch, RecordType: RecordPayment, RecordID: p.PaymentID,
				IdempotencyKey: p.IdempotencyKey, AmountMinor: p.AmountMinor, GatewayStatus: status,
				Detail: "record settled but gateway status is not success"})
		} else if amt != p.AmountMinor {
			rep.add(Drift{Kind: DriftGatewayAmountMismatch, RecordType: RecordPayment, RecordID: p.PaymentID,
				IdempotencyKey: p.IdempotencyKey, AmountMinor: p.AmountMinor, GatewayAmountMinor: amt,
				Detail: "gateway amount differs from recorded amount"})
		}
	}
}

// checkContribution cross-checks one vault contribution against the ledger (contributions have no
// gateway ref — they are wallet→segregated-account internal moves, so only the ledger check
// applies).
func (rc *Reconciler) checkContribution(ctx context.Context, rep *Report, c ContributionRecord) {
	posted, err := rc.ledger.Posted(ctx, c.IdempotencyKey)
	if err != nil {
		rep.add(Drift{Kind: DriftCheckError, RecordType: RecordContribution, RecordID: c.ContributionID,
			IdempotencyKey: c.IdempotencyKey, AmountMinor: c.AmountMinor,
			Detail: "ledger check failed: " + err.Error()})
		return
	}
	if !posted {
		rep.add(Drift{Kind: DriftMissingLedgerEntry, RecordType: RecordContribution, RecordID: c.ContributionID,
			IdempotencyKey: c.IdempotencyKey, AmountMinor: c.AmountMinor,
			Detail: "vault contribution has no matching balanced ledger entry"})
	}
}

// add appends a drift + its alert string.
func (rep *Report) add(d Drift) {
	rep.Drifts = append(rep.Drifts, d)
	rep.Alerts = append(rep.Alerts, alertString(d))
}

func alertString(d Drift) string {
	return "[SF-8 DRIFT] " + string(d.Kind) + " " + string(d.RecordType) + " id=" + d.RecordID +
		" idem=" + d.IdempotencyKey + ": " + d.Detail
}

func isSuccess(status string) bool {
	switch status {
	case "success", "successful", "SUCCESS", "Success":
		return true
	default:
		return false
	}
}
