package feesreconcile

import (
	"context"
	"testing"
	"time"
)

// PURE tests — no live DB / ledger / gateway. All sources + checkers are in-memory fakes so the
// SF-8 invariants are exercised in isolation:
//   - a seeded drift (a payment with NO matching ledger entry) is FLAGGED and reported;
//   - the reconciler MUTATES NOTHING (read-only; never auto-corrects);
//   - the job is idempotent + safe to re-run (identical report on a second run).

// ── fakePaymentSource ────────────────────────────────────────────────────────────────

type fakePaymentSource struct {
	rows  []PaymentRecord
	calls int
}

func (f *fakePaymentSource) RecentPayments(_ context.Context, _ time.Time) ([]PaymentRecord, error) {
	f.calls++
	// Return a copy so a caller mutation cannot leak back (read-only source contract).
	out := make([]PaymentRecord, len(f.rows))
	copy(out, f.rows)
	return out, nil
}

// ── fakeContributionSource ─────────────────────────────────────────────────────────

type fakeContributionSource struct {
	rows  []ContributionRecord
	calls int
}

func (f *fakeContributionSource) RecentContributions(_ context.Context, _ time.Time) ([]ContributionRecord, error) {
	f.calls++
	out := make([]ContributionRecord, len(f.rows))
	copy(out, f.rows)
	return out, nil
}

// ── fakeLedger: knows which idempotency keys are posted ───────────────────────────────

type fakeLedgerReader struct {
	posted map[string]bool
	calls  int
	// mutations counts any write attempt; MUST remain 0 (reconciler never mutates).
	mutations int
}

func (l *fakeLedgerReader) Posted(_ context.Context, baseIdempotencyKey string) (bool, error) {
	l.calls++
	return l.posted[baseIdempotencyKey], nil
}

// ── fakeGateway (optional) ────────────────────────────────────────────────────────────

type fakeGatewayReader struct {
	status map[string]string
	amount map[string]int64
}

func (g *fakeGatewayReader) VerifyAmount(_ context.Context, reference string) (string, int64, error) {
	return g.status[reference], g.amount[reference], nil
}

// ═══════════════════════════════════════════════════════════════════════════════════
// SF-8: a seeded drift (payment with no matching ledger entry) is flagged, and nothing
//        is mutated.
// ═══════════════════════════════════════════════════════════════════════════════════

func TestSF8_FlagsPaymentWithNoLedgerEntry(t *testing.T) {
	ctx := context.Background()
	since := time.Now().Add(-24 * time.Hour)

	pays := &fakePaymentSource{rows: []PaymentRecord{
		{PaymentID: "pay-ok", InvoiceID: "inv-1", AmountMinor: 50000, IdempotencyKey: "idem-ok"},
		{PaymentID: "pay-drift", InvoiceID: "inv-2", AmountMinor: 30000, IdempotencyKey: "idem-drift"}, // NO ledger entry
	}}
	contribs := &fakeContributionSource{}
	// Only idem-ok is posted to the ledger; idem-drift is the seeded drift.
	led := &fakeLedgerReader{posted: map[string]bool{"idem-ok": true}}

	rc := NewReconciler(pays, contribs, led, nil)
	rep, err := rc.Run(ctx, since)
	if err != nil {
		t.Fatalf("run: %v", err)
	}

	if !rep.HasDrift() {
		t.Fatal("SF-8: reconciliation must flag the seeded drift")
	}
	if len(rep.Drifts) != 1 {
		t.Fatalf("expected exactly 1 drift, got %d: %+v", len(rep.Drifts), rep.Drifts)
	}
	d := rep.Drifts[0]
	if d.Kind != DriftMissingLedgerEntry {
		t.Fatalf("drift kind must be missing_ledger_entry, got %q", d.Kind)
	}
	if d.RecordID != "pay-drift" || d.RecordType != RecordPayment {
		t.Fatalf("drift must point at the payment with no ledger entry, got %+v", d)
	}
	if len(rep.Alerts) != 1 {
		t.Fatalf("each drift must produce an alert, got %d", len(rep.Alerts))
	}
	if rep.PaymentsChecked != 2 {
		t.Fatalf("both payments must be checked, got %d", rep.PaymentsChecked)
	}
	// SF-8: the reconciler never mutates. The read-only ledger reader has no mutation path,
	// and neither source was written back.
	if led.mutations != 0 {
		t.Fatalf("SF-8 VIOLATED: reconciler mutated %d ledger records", led.mutations)
	}
}

// A clean window (every record posted) produces no drift and no alerts.
func TestSF8_CleanWindowNoDrift(t *testing.T) {
	ctx := context.Background()
	pays := &fakePaymentSource{rows: []PaymentRecord{
		{PaymentID: "p1", AmountMinor: 100, IdempotencyKey: "k1"},
		{PaymentID: "p2", AmountMinor: 200, IdempotencyKey: "k2"},
	}}
	contribs := &fakeContributionSource{rows: []ContributionRecord{
		{ContributionID: "c1", AmountMinor: 50, IdempotencyKey: "k3"},
	}}
	led := &fakeLedgerReader{posted: map[string]bool{"k1": true, "k2": true, "k3": true}}

	rep, err := NewReconciler(pays, contribs, led, nil).Run(ctx, time.Now().Add(-time.Hour))
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if rep.HasDrift() {
		t.Fatalf("clean window must report no drift, got %+v", rep.Drifts)
	}
	if rep.Drifts == nil || rep.Alerts == nil {
		t.Fatal("clean report must return non-nil empty slices")
	}
	if rep.ContributionsChecked != 1 {
		t.Fatalf("contribution must be checked, got %d", rep.ContributionsChecked)
	}
}

// Also flags a vault contribution with no ledger entry.
func TestSF8_FlagsContributionWithNoLedgerEntry(t *testing.T) {
	ctx := context.Background()
	pays := &fakePaymentSource{}
	contribs := &fakeContributionSource{rows: []ContributionRecord{
		{ContributionID: "c-drift", VaultID: "v-1", AmountMinor: 15000, IdempotencyKey: "idem-cdrift"},
	}}
	led := &fakeLedgerReader{posted: map[string]bool{}} // nothing posted

	rep, _ := NewReconciler(pays, contribs, led, nil).Run(ctx, time.Now().Add(-time.Hour))
	if len(rep.Drifts) != 1 || rep.Drifts[0].RecordType != RecordContribution {
		t.Fatalf("expected one contribution drift, got %+v", rep.Drifts)
	}
	if rep.Drifts[0].Kind != DriftMissingLedgerEntry {
		t.Fatalf("expected missing_ledger_entry, got %q", rep.Drifts[0].Kind)
	}
}

// Idempotent + safe to re-run: a second run over the same window yields an identical report.
func TestSF8_IdempotentReRun(t *testing.T) {
	ctx := context.Background()
	since := time.Now().Add(-time.Hour)
	pays := &fakePaymentSource{rows: []PaymentRecord{
		{PaymentID: "pB", AmountMinor: 20000, IdempotencyKey: "kB"},
		{PaymentID: "pA", AmountMinor: 10000, IdempotencyKey: "kA"}, // no ledger entry
	}}
	contribs := &fakeContributionSource{}
	led := &fakeLedgerReader{posted: map[string]bool{"kB": true}}

	rc := NewReconciler(pays, contribs, led, nil)
	r1, _ := rc.Run(ctx, since)
	r2, _ := rc.Run(ctx, since)

	if len(r1.Drifts) != len(r2.Drifts) {
		t.Fatalf("re-run must be idempotent: %d vs %d drifts", len(r1.Drifts), len(r2.Drifts))
	}
	if len(r1.Drifts) != 1 || r1.Drifts[0].RecordID != "pA" {
		t.Fatalf("expected the single kA drift, got %+v", r1.Drifts)
	}
	// Deterministic ordering + content across runs.
	if r1.Drifts[0].RecordID != r2.Drifts[0].RecordID || r1.Alerts[0] != r2.Alerts[0] {
		t.Fatal("re-run must produce an identical report")
	}
}

// Gateway status/amount cross-check: a settled record whose gateway status is not success is
// flagged (in addition to any ledger check).
func TestSF8_GatewayStatusMismatch(t *testing.T) {
	ctx := context.Background()
	pays := &fakePaymentSource{rows: []PaymentRecord{
		{PaymentID: "pg", AmountMinor: 50000, GatewayRef: "gw-1", IdempotencyKey: "kg"},
	}}
	contribs := &fakeContributionSource{}
	led := &fakeLedgerReader{posted: map[string]bool{"kg": true}} // ledger fine...
	gw := &fakeGatewayReader{
		status: map[string]string{"gw-1": "failed"}, // ...but gateway disagrees
		amount: map[string]int64{"gw-1": 50000},
	}

	rep, _ := NewReconciler(pays, contribs, led, gw).Run(ctx, time.Now().Add(-time.Hour))
	found := false
	for _, d := range rep.Drifts {
		if d.Kind == DriftGatewayStatusMismatch && d.RecordID == "pg" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected a gateway_status_mismatch drift, got %+v", rep.Drifts)
	}
}

// Gateway amount mismatch is flagged when status is success but amount differs.
func TestSF8_GatewayAmountMismatch(t *testing.T) {
	ctx := context.Background()
	pays := &fakePaymentSource{rows: []PaymentRecord{
		{PaymentID: "pa", AmountMinor: 50000, GatewayRef: "gw-a", IdempotencyKey: "ka"},
	}}
	led := &fakeLedgerReader{posted: map[string]bool{"ka": true}}
	gw := &fakeGatewayReader{
		status: map[string]string{"gw-a": "success"},
		amount: map[string]int64{"gw-a": 49000}, // 1000 short
	}
	rep, _ := NewReconciler(pays, &fakeContributionSource{}, led, gw).Run(ctx, time.Now().Add(-time.Hour))
	found := false
	for _, d := range rep.Drifts {
		if d.Kind == DriftGatewayAmountMismatch && d.GatewayAmountMinor == 49000 {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected a gateway_amount_mismatch drift, got %+v", rep.Drifts)
	}
}
