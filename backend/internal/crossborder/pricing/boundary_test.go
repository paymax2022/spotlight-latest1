package pricing

import (
	"context"
	"errors"
	"testing"

	"spotlight/backend/internal/orchestration"
)

func TestResolve_AmbiguousCostRowsFailClosed(t *testing.T) {
	cards := RateCard{Entries: []CostEntry{
		{Service: "SEND", FlatMinor: 10, PctBPS: 10},
		{Service: "SEND", FlatMinor: 1, PctBPS: 1}, // cheaper twin at equal precedence
	}}
	sched := FeeSchedule{Rules: []FeeRule{rule("u", LevelUniversal, nil)}}
	res, err := NewResolver(sched, orchestration.NewSpreadEngine(20), cards, testGuard(), 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := res.Resolve(context.Background(), baseInput()); !errors.Is(err, ErrAmbiguousCost) {
		t.Fatalf("err = %v, want ErrAmbiguousCost", err)
	}
	// a strictly more specific row still resolves without ambiguity
	cards.Entries = append(cards.Entries, CostEntry{Service: "SEND", Corridor: "NGN-USD", FlatMinor: 10, PctBPS: 10})
	res, _ = NewResolver(sched, orchestration.NewSpreadEngine(20), cards, testGuard(), 0)
	if _, err := res.Resolve(context.Background(), baseInput()); err != nil {
		t.Fatalf("specific row should resolve: %v", err)
	}
}

// Single-point band at 1_000_000 with zero spread: cost = 10 + 1000 = 1010,
// floor margin 5 => floor exactly 1015.
func boundaryResolver(t *testing.T, fee FeeSpec, g Guardrails, bounded bool) *Resolver {
	t.Helper()
	r := rule("b", LevelUniversal, func(r *FeeRule) {
		r.Fee = fee
		r.AmountMin, r.AmountMax = 1_000_000, 1_000_000
		if !bounded {
			r.AmountMax = 0
		}
	})
	res, err := NewResolver(FeeSchedule{Rules: []FeeRule{r}}, orchestration.NewSpreadEngine(0), testCosts(), g, 0)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestGuardrail_FloorBoundaryExact(t *testing.T) {
	g := Guardrails{FloorMarginMinor: 5, HardCapBPS: 500}
	for _, c := range []struct {
		flat int64
		ok   bool
	}{{1015, true}, {1014, false}, {1016, true}} {
		_, err := boundaryResolver(t, FeeSpec{FlatMinor: c.flat}, g, true).Resolve(context.Background(), baseInput())
		if c.ok && err != nil {
			t.Fatalf("revenue %d should pass floor: %v", c.flat, err)
		}
		if !c.ok && !errors.Is(err, ErrBelowCostFloor) {
			t.Fatalf("revenue %d should fail floor, err=%v", c.flat, err)
		}
	}
}

func TestGuardrail_HardCapBoundaryExact(t *testing.T) {
	abs := Guardrails{FloorMarginMinor: 5, HardCapMinor: 5000}
	bps := Guardrails{FloorMarginMinor: 5, HardCapBPS: 500} // 5% of 1_000_000 = 50_000
	for _, c := range []struct {
		name string
		g    Guardrails
		flat int64
		ok   bool
	}{
		{"abs at cap", abs, 5000, true}, {"abs cap+1", abs, 5001, false},
		{"bps at cap", bps, 50_000, true}, {"bps cap+1", bps, 50_001, false},
	} {
		_, err := boundaryResolver(t, FeeSpec{FlatMinor: c.flat}, c.g, true).Resolve(context.Background(), baseInput())
		if c.ok && err != nil {
			t.Fatalf("%s: should pass: %v", c.name, err)
		}
		if !c.ok && !errors.Is(err, ErrAboveHardCap) {
			t.Fatalf("%s: should fail cap, err=%v", c.name, err)
		}
	}
}

func TestGuardrail_UnboundedProbeTripsHardCap(t *testing.T) {
	// 50 bps fee, absolute cap 10_000_000. The requested amount (fee 5000) and the
	// band start pass; only the unbounded-band probe (2^50) breaches the cap.
	g := Guardrails{FloorMarginMinor: 5, HardCapMinor: 10_000_000}
	fee := FeeSpec{PctBPS: 50}
	_, err := boundaryResolver(t, fee, g, false).Resolve(context.Background(), baseInput())
	var ge *GuardrailError
	if !errors.Is(err, ErrAboveHardCap) || !errors.As(err, &ge) || ge.AmountMinor != unboundedProbe {
		t.Fatalf("probe should trip cap at %d, err=%v", unboundedProbe, err)
	}
	// identical rule with a bounded band passes: the probe is what caught it.
	if _, err := boundaryResolver(t, fee, g, true).Resolve(context.Background(), baseInput()); err != nil {
		t.Fatalf("bounded band should pass: %v", err)
	}
}
