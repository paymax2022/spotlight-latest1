package backtest

import (
	"math"
	"testing"
)

func TestCostModels(t *testing.T) {
	// fee 10bps on ₦1,000,000 = 1000 kobo.
	if got := FeeKobo(1_000_000, 10); got != 1000 {
		t.Fatalf("fee = %d, want 1000", got)
	}
	// base slippage 5bps, no impact.
	if got := SlippageKobo(1_000_000, 0, 5, 100); got != 500 {
		t.Fatalf("base slippage = %d, want 500", got)
	}
	// impact: 50% participation (500k of 1M ADV) adds impactBps*0.5 = 50bps → total 55bps.
	if got := SlippageKobo(500_000, 1_000_000, 5, 100); got != int64(math.Ceil(500_000*0.0055)) {
		t.Fatalf("impact slippage = %d, want %d", got, int64(math.Ceil(500_000*0.0055)))
	}
	// costs round UP (never under-charge).
	if got := FeeKobo(1, 1); got != 1 {
		t.Fatalf("tiny fee should round up to 1, got %d", got)
	}
	// funding 0 → 0.
	if got := FundingKobo(1_000_000, 0); got != 0 {
		t.Fatalf("no funding = %d, want 0", got)
	}
}

func TestMetrics_HandComputed(t *testing.T) {
	// A curve that rises then draws down: peak 120, trough 90 → maxDD = 25%.
	curve := []int64{100, 110, 120, 100, 90, 100}
	m := ComputeMetrics(curve, nil, 0, Config{PeriodsPerYear: 365})
	if m.MaxDrawdownBps != 2500 {
		t.Fatalf("maxDD = %d bps, want 2500", m.MaxDrawdownBps)
	}
	// total return 0% (100→100).
	if m.ReturnBps != 0 {
		t.Fatalf("return = %d, want 0", m.ReturnBps)
	}
	// trades: profit factor = grossWin/grossLoss.
	trades := []Trade{{PnLKobo: 300}, {PnLKobo: -100}, {PnLKobo: 200}, {PnLKobo: -100}}
	m2 := ComputeMetrics(curve, trades, 0, Config{PeriodsPerYear: 365})
	if m2.ProfitFactorBps != 25000 { // (300+200)/(100+100)=2.5
		t.Fatalf("profit factor = %d bps, want 25000", m2.ProfitFactorBps)
	}
	if m2.WinRateBps != 5000 { // 2/4
		t.Fatalf("win rate = %d, want 5000", m2.WinRateBps)
	}
	if m2.ExpectancyKobo != 75 { // (300-100+200-100)/4
		t.Fatalf("expectancy = %d, want 75", m2.ExpectancyKobo)
	}
}

// A steady uptrend that an always-long strategy should profit from, even net of
// conservative costs.
func TestEngine_TrendProfitsNetOfCosts(t *testing.T) {
	prices := make([]float64, 60)
	for i := range prices {
		prices[i] = 100 + float64(i) // +1/bar, strong uptrend
	}
	alwaysLong := func(i int, p []float64) Target {
		return Target{Dir: Long, NotionalKobo: 50_000_000, StopDistanceBps: 0}
	}
	cfg := Config{StartEquityKobo: 100_000_000, FeeBps: 10, SlippageBps: 5, Warmup: 2, PeriodsPerYear: 365}
	res := Run(prices, cfg, alwaysLong)
	if len(res.EquityCurveKobo) == 0 {
		t.Fatal("no equity curve produced")
	}
	final := res.EquityCurveKobo[len(res.EquityCurveKobo)-1]
	if final <= cfg.StartEquityKobo {
		t.Fatalf("uptrend + always-long should profit net of costs: start=%d final=%d", cfg.StartEquityKobo, final)
	}
	if res.TotalCostKobo <= 0 {
		t.Fatal("a trade was placed but no costs were charged")
	}
	if res.Metrics.SharpeBps <= 0 {
		t.Fatalf("uptrend should have positive Sharpe, got %d", res.Metrics.SharpeBps)
	}
}

// Whipsaw costs: flip-flopping every bar in a flat market must LOSE to costs
// (cost drag with no edge).
func TestEngine_WhipsawBleedsToCosts(t *testing.T) {
	prices := make([]float64, 60)
	for i := range prices {
		prices[i] = 100 // dead flat: no price edge
	}
	flip := func(i int, p []float64) Target {
		if i%2 == 0 {
			return Target{Dir: Long, NotionalKobo: 50_000_000}
		}
		return Target{Dir: Short, NotionalKobo: 50_000_000}
	}
	cfg := Config{StartEquityKobo: 100_000_000, FeeBps: 10, SlippageBps: 5, Warmup: 2, PeriodsPerYear: 365}
	res := Run(prices, cfg, flip)
	final := res.EquityCurveKobo[len(res.EquityCurveKobo)-1]
	if final >= cfg.StartEquityKobo {
		t.Fatalf("whipsaw in a flat market must bleed to costs: start=%d final=%d", cfg.StartEquityKobo, final)
	}
	if res.Metrics.CostDragBps <= 0 {
		t.Fatal("cost drag should be positive")
	}
}

// Determinism: identical inputs → byte-identical equity curve + metrics.
func TestEngine_Deterministic(t *testing.T) {
	prices := make([]float64, 50)
	for i := range prices {
		prices[i] = 100 + math.Sin(float64(i)/3)*5
	}
	dec := func(i int, p []float64) Target {
		if p[len(p)-1] > 100 {
			return Target{Dir: Long, NotionalKobo: 20_000_000}
		}
		return Target{Dir: Flat}
	}
	cfg := Config{StartEquityKobo: 100_000_000, FeeBps: 8, SlippageBps: 4, Warmup: 1, PeriodsPerYear: 365}
	a := Run(prices, cfg, dec)
	b := Run(prices, cfg, dec)
	if len(a.EquityCurveKobo) != len(b.EquityCurveKobo) || a.Metrics != b.Metrics {
		t.Fatal("backtest is not deterministic")
	}
	for i := range a.EquityCurveKobo {
		if a.EquityCurveKobo[i] != b.EquityCurveKobo[i] {
			t.Fatalf("equity curve differs at %d: %d vs %d", i, a.EquityCurveKobo[i], b.EquityCurveKobo[i])
		}
	}
}

// No look-ahead: a decision at bar i sees only prices[:i+1]. Verify the callback
// never receives future data.
func TestEngine_NoLookAhead(t *testing.T) {
	prices := []float64{100, 101, 102, 103, 104, 105, 106, 107}
	maxLenSeen := 0
	dec := func(i int, p []float64) Target {
		if len(p) != i+1 {
			t.Fatalf("decision at bar %d saw %d prices (look-ahead!)", i, len(p))
		}
		if len(p) > maxLenSeen {
			maxLenSeen = len(p)
		}
		return Target{Dir: Flat}
	}
	Run(prices, Config{StartEquityKobo: 100_000_000, Warmup: 0, PeriodsPerYear: 365}, dec)
	if maxLenSeen != len(prices) {
		t.Fatalf("last decision should see all %d prices, saw %d", len(prices), maxLenSeen)
	}
}
