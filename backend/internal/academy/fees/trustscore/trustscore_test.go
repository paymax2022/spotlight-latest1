package feestrustscore

import (
	"context"
	"testing"
)

// PURE tests — no DB. They prove the score is DETERMINISTIC given fixed inputs, that the
// component breakdown is explainable and sums to the score, and that an admin override records
// the actor + reason (and wins for the reported score while preserving the computed score).

// ── in-memory fakes ──────────────────────────────────────────────────────────────

type fakeMetrics struct{ in map[string]TrustInputs }

func newFakeMetrics() *fakeMetrics { return &fakeMetrics{in: map[string]TrustInputs{}} }

func (f *fakeMetrics) TrustInputs(_ context.Context, schoolID string) (TrustInputs, error) {
	v, ok := f.in[schoolID]
	if !ok {
		return TrustInputs{}, ErrNotFound
	}
	return v, nil
}

type overrideRow struct {
	score  float64
	by     string
	reason string
}

type fakeOverrides struct{ rows map[string]overrideRow }

func newFakeOverrides() *fakeOverrides { return &fakeOverrides{rows: map[string]overrideRow{}} }

func (f *fakeOverrides) SaveOverride(_ context.Context, schoolID, actorID string, score float64, reason string) error {
	f.rows[schoolID] = overrideRow{score: score, by: actorID, reason: reason}
	return nil
}

func (f *fakeOverrides) GetOverride(_ context.Context, schoolID string) (float64, string, string, bool, error) {
	r, ok := f.rows[schoolID]
	if !ok {
		return 0, "", "", false, nil
	}
	return r.score, r.by, r.reason, true, nil
}

// ── Determinism: same inputs → same score ────────────────────────────────────────

func TestComputeFromInputs_Deterministic(t *testing.T) {
	in := TrustInputs{
		TotalBilledMinor:    1_000_000,
		TotalCollectedMinor: 900_000, // 90% collection
		InvoicesDue:         100,
		InvoicesPaidOnTime:  80, // 80% on time
		PaymentsCount:       200,
		DisputedCount:       10, // 5% dispute → 95 dispute score
	}
	a := ComputeFromInputs("school-1", in)
	b := ComputeFromInputs("school-1", in)
	if a.Score != b.Score {
		t.Fatalf("score must be deterministic: %v != %v", a.Score, b.Score)
	}
	// Expected blend: 90*0.5 + 80*0.3 + 95*0.2 = 45 + 24 + 19 = 88.
	if a.Score != 88 {
		t.Errorf("expected computed score 88, got %v", a.Score)
	}
	if a.Band != "excellent" {
		t.Errorf("expected band excellent for 88, got %q", a.Band)
	}
}

// ── Explainability: components present, weighted, and sum to the score ───────────

func TestComputeFromInputs_ComponentBreakdownSumsToScore(t *testing.T) {
	in := TrustInputs{
		TotalBilledMinor: 500_000, TotalCollectedMinor: 250_000, // 50%
		InvoicesDue: 10, InvoicesPaidOnTime: 5, // 50%
		PaymentsCount: 10, DisputedCount: 2, // 20% dispute → 80 score
	}
	ts := ComputeFromInputs("s", in)
	if len(ts.Components) != 3 {
		t.Fatalf("expected 3 explainable components, got %d", len(ts.Components))
	}
	var sumContrib, sumWeight float64
	names := map[string]bool{}
	for _, c := range ts.Components {
		names[c.Name] = true
		sumContrib += c.Contribution
		sumWeight += c.Weight
		if c.Detail == "" {
			t.Errorf("component %q must have an explanation", c.Name)
		}
	}
	for _, want := range []string{"collection_health", "on_time_payment_rate", "dispute_rate"} {
		if !names[want] {
			t.Errorf("missing component %q", want)
		}
	}
	if sumWeight < 0.999 || sumWeight > 1.001 {
		t.Errorf("weights must sum to 1.0, got %v", sumWeight)
	}
	// Σ contributions must equal the score (within rounding): 25 + 15 + 16 = 56.
	if sumContrib < ts.Score-0.02 || sumContrib > ts.Score+0.02 {
		t.Errorf("contributions %v must sum to score %v", sumContrib, ts.Score)
	}
	if ts.Score != 56 {
		t.Errorf("expected score 56, got %v", ts.Score)
	}
}

// ── Zero-denominator inputs are neutral (not penalised) ──────────────────────────

func TestComputeFromInputs_ZeroDenominatorsNeutral(t *testing.T) {
	ts := ComputeFromInputs("new-school", TrustInputs{}) // nothing billed/due/paid
	if ts.Score != 100 {
		t.Errorf("a school with no activity must score neutral 100, got %v", ts.Score)
	}
}

// ── Override records actor + reason and wins for the reported score ───────────────

func TestOverride_RecordsActorAndReason(t *testing.T) {
	ctx := context.Background()
	metrics := newFakeMetrics()
	metrics.in["school-1"] = TrustInputs{
		TotalBilledMinor: 100, TotalCollectedMinor: 100,
		InvoicesDue: 1, InvoicesPaidOnTime: 1,
		PaymentsCount: 1, DisputedCount: 0,
	} // computes to 100
	ovr := newFakeOverrides()
	svc := NewService(metrics, ovr)

	out, err := svc.Override(ctx, "admin-7", OverrideRequest{SchoolID: "school-1", Score: 42, Reason: "manual sanction pending review"})
	if err != nil {
		t.Fatalf("override should succeed, got %v", err)
	}
	// The override actor + reason are recorded.
	row := ovr.rows["school-1"]
	if row.by != "admin-7" || row.reason != "manual sanction pending review" || row.score != 42 {
		t.Errorf("override must record actor+reason+score, got %+v", row)
	}
	// Reported score is the override; the computed score is preserved for transparency.
	if !out.Overridden || out.Score != 42 || out.ComputedScore != 100 {
		t.Errorf("override must win reported score but retain computed: %+v", out)
	}
	if out.OverrideBy != "admin-7" || out.OverrideReason == "" {
		t.Errorf("override metadata must be surfaced: %+v", out)
	}
}

func TestOverride_RequiresReasonAndValidScore(t *testing.T) {
	svc := NewService(newFakeMetrics(), newFakeOverrides())
	ctx := context.Background()
	if _, err := svc.Override(ctx, "a", OverrideRequest{SchoolID: "s", Score: 50}); err != ErrMissingReason {
		t.Errorf("missing reason must be rejected, got %v", err)
	}
	if _, err := svc.Override(ctx, "a", OverrideRequest{SchoolID: "s", Score: 150, Reason: "x"}); err != ErrInvalidScore {
		t.Errorf("out-of-range score must be rejected, got %v", err)
	}
	if _, err := svc.Override(ctx, "", OverrideRequest{SchoolID: "s", Score: 50, Reason: "x"}); err != ErrUnauthenticated {
		t.Errorf("missing actor must be rejected, got %v", err)
	}
}

// ── Compute applies an active override on read ────────────────────────────────────

func TestCompute_AppliesActiveOverride(t *testing.T) {
	ctx := context.Background()
	metrics := newFakeMetrics()
	metrics.in["s"] = TrustInputs{TotalBilledMinor: 100, TotalCollectedMinor: 50, InvoicesDue: 2, InvoicesPaidOnTime: 1, PaymentsCount: 2, DisputedCount: 0}
	ovr := newFakeOverrides()
	_ = ovr.SaveOverride(ctx, "s", "admin-1", 10, "fraud hold")
	svc := NewService(metrics, ovr)

	out, err := svc.Compute(ctx, "s")
	if err != nil {
		t.Fatal(err)
	}
	if !out.Overridden || out.Score != 10 {
		t.Errorf("active override must apply on compute, got %+v", out)
	}
	if out.ComputedScore == 10 {
		t.Error("computed score must be retained distinct from the override")
	}
}
