package validate

import (
	"math"
	"testing"
)

func TestStatsPrimitives(t *testing.T) {
	// normCDF/normInv round-trip at known points.
	if math.Abs(normCDF(0)-0.5) > 1e-9 {
		t.Fatalf("normCDF(0) = %v, want 0.5", normCDF(0))
	}
	if math.Abs(normInvCDF(0.975)-1.959964) > 1e-4 {
		t.Fatalf("normInv(0.975) = %v, want ~1.95996", normInvCDF(0.975))
	}
	// Sharpe of a clean positive series is positive.
	if Sharpe([]float64{0.01, 0.012, 0.008, 0.011}) <= 0 {
		t.Fatal("positive returns should have positive Sharpe")
	}
}

func TestPurgedKFold(t *testing.T) {
	folds := PurgedKFold(100, 5, 3, 2)
	if len(folds) != 5 {
		t.Fatalf("want 5 folds, got %d", len(folds))
	}
	for _, f := range folds {
		// train and test must be disjoint.
		test := map[int]bool{}
		for _, i := range f.TestIdx {
			test[i] = true
		}
		for _, i := range f.TrainIdx {
			if test[i] {
				t.Fatal("train/test overlap — leakage")
			}
		}
		// the purge/embargo buffer around the test block must be excluded from train.
		lo := f.TestIdx[0] - 3
		hi := f.TestIdx[len(f.TestIdx)-1] + 1 + 2
		for _, i := range f.TrainIdx {
			if i >= lo && i < hi {
				t.Fatalf("train index %d falls inside the purge/embargo buffer [%d,%d)", i, lo, hi)
			}
		}
	}
}

func TestWalkForwardWindows(t *testing.T) {
	ws := WalkForwardWindows(100, 40, 10, 10)
	if len(ws) == 0 {
		t.Fatal("no walk-forward windows")
	}
	for i, w := range ws {
		if w.TrainEnd != w.TestStart {
			t.Fatalf("window %d: train must end where test begins", i)
		}
		if w.TrainStart >= w.TrainEnd || w.TestStart >= w.TestEnd {
			t.Fatalf("window %d: degenerate ranges", i)
		}
		if i > 0 && ws[i].TestStart <= ws[i-1].TestStart {
			t.Fatal("test windows must advance forward")
		}
	}
}

func TestDeflatedSharpe_MultipleTestingPenalty(t *testing.T) {
	// Same observed Sharpe; trying MANY strategies must lower the deflated Sharpe
	// (harder to believe the best of many is real).
	sr := 0.15
	few := DeflatedSharpe(sr, 0.05, 5, 500, 0, 0)
	many := DeflatedSharpe(sr, 0.05, 500, 500, 0, 0)
	if !(few > many) {
		t.Fatalf("more trials must reduce DSR: few=%.4f many=%.4f", few, many)
	}
	// A strong Sharpe over a long sample with few trials should be believable.
	strong := DeflatedSharpe(0.25, 0.05, 3, 1000, 0, 0)
	if strong < 0.90 {
		t.Fatalf("a strong, lightly-searched Sharpe should have high DSR, got %.4f", strong)
	}
	// The multiple-testing hurdle rises with the number of trials.
	if ExpectedMaxSharpe(1000, 0.05) <= ExpectedMaxSharpe(10, 0.05) {
		t.Fatal("expected-max Sharpe hurdle must grow with trials")
	}
	if ExpectedMaxSharpe(1, 0.05) != 0 {
		t.Fatal("a single trial has no selection bias (hurdle 0)")
	}
}

func TestMonteCarlo_SeededDeterministic(t *testing.T) {
	pnl := []int64{500, -300, 400, -200, 600, -100, 300, -400, 200, 350}
	a := MonteCarloBootstrap(pnl, 100_000, MCConfig{Trials: 500, Seed: 42})
	b := MonteCarloBootstrap(pnl, 100_000, MCConfig{Trials: 500, Seed: 42})
	if a != b {
		t.Fatal("seeded Monte-Carlo must be reproducible")
	}
	// percentiles ordered.
	if !(a.ReturnP5 <= a.ReturnP50 && a.ReturnP50 <= a.ReturnP95) {
		t.Fatalf("return percentiles unordered: %+v", a)
	}
	if !(a.MaxDDP5 <= a.MaxDDP50 && a.MaxDDP50 <= a.MaxDDP95) {
		t.Fatalf("drawdown percentiles unordered: %+v", a)
	}
	// A positive-expectancy trade set should have a positive median return.
	if a.ReturnP50 <= 0 {
		t.Fatalf("positive-edge set should have positive median MC return, got %.4f", a.ReturnP50)
	}
	// A different seed generally gives a different (but still valid) draw.
	c := MonteCarloBootstrap(pnl, 100_000, MCConfig{Trials: 500, Seed: 7})
	if c.Trials != 500 {
		t.Fatal("trials mismatch")
	}
}

func TestPromotionGate(t *testing.T) {
	thr := PromotionThresholds{
		MinDeflatedSharpe: 0.95, MinOOSSharpeBps: 10_000, MaxDrawdownBps: 2500,
		MinProfitFactorBps: 12_500, MinTrades: 100, RequirePositiveMCP5: true,
	}
	// A robust strategy clears every bar.
	good := Evaluate(EvaluationInputs{
		DeflatedSharpe: 0.97, OOSSharpeBps: 13_000, MaxDrawdownBps: 1800,
		ProfitFactorBps: 15_000, NumTrades: 240, MonteCarloReturnP5: 0.03,
	}, thr)
	if !good.Pass {
		t.Fatalf("robust strategy should pass, reasons: %v", good.Reasons)
	}
	// A classic overfit: great in-sample look but fails DSR + fragile MC + shallow sample.
	overfit := Evaluate(EvaluationInputs{
		DeflatedSharpe: 0.40, OOSSharpeBps: 6000, MaxDrawdownBps: 3500,
		ProfitFactorBps: 11_000, NumTrades: 22, MonteCarloReturnP5: -0.08,
	}, thr)
	if overfit.Pass {
		t.Fatal("overfit strategy must be REJECTED")
	}
	if len(overfit.Reasons) < 4 {
		t.Fatalf("expected several rejection reasons, got %d: %v", len(overfit.Reasons), overfit.Reasons)
	}
}
