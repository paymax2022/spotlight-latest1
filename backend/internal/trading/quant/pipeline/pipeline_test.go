package pipeline

import (
	"math"
	"testing"

	"spotlight/backend/internal/trading/quant/committee"
	"spotlight/backend/internal/trading/quant/regime"
	"spotlight/backend/internal/trading/quant/risk"
	"spotlight/backend/internal/trading/quant/signals"
)

// alwaysRanging is a deterministic test strategy that emits one candidate whenever
// the regime is Ranging — used to exercise the risk→committee composition without
// depending on a built-in indicator crossing a threshold at the final bar.
type alwaysRanging struct{}

func (alwaysRanging) Name() string                        { return "test_ranging" }
func (alwaysRanging) ValidRegimes() []regime.Regime       { return []regime.Regime{regime.Ranging} }
func (alwaysRanging) Generate(ctx signals.Context) []signals.Candidate {
	return []signals.Candidate{{
		Strategy: "test_ranging", Asset: ctx.Asset, Side: signals.Long,
		ConfidenceBps: 8000, StopDistanceBps: 300, Rationale: []string{"test candidate"},
	}}
}

func returnsOf(p []float64) []float64 {
	r := make([]float64, 0, len(p)-1)
	for i := 1; i < len(p); i++ {
		r = append(r, (p[i]-p[i-1])/p[i-1])
	}
	return r
}

func baseInputs(prices []float64, equity int64) Inputs {
	return Inputs{
		Asset: "BTC", Prices: prices, Returns: returnsOf(prices),
		BaselineVolBps: regime.RealizedVolBps(returnsOf(prices)), LiquidityScoreBps: 8000,
		RegimeConfig: regime.DefaultConfig(),
		State: risk.PortfolioState{EquityKobo: equity, PeakEquityKobo: equity},
		Limits: risk.Limits{
			MaxDrawdownBps: 2000, MaxOpenPositions: 10, MaxPositionKobo: 60_000_000,
			MaxGrossLeverageBps: 30_000, MinConfidenceBps: 1, AllowedAssets: []string{"BTC"},
		},
		Ladder:       risk.DrawdownLadderConfig{ReduceAtBps: 500, HedgeAtBps: 1000, FlatAtBps: 1500, HaltAtBps: 2000},
		Clusters:     [][]string{{"BTC", "ETH"}},
		WithinWindow: true,
		TargetVolBps: 1000,
		Committee:    committee.Config{QuorumBps: 5000, MinConfidenceBps: 1, RequireSupervisor: true},
	}
}

// Flat series → Unknown regime → not tradeable → NO TRADE (no candidates run).
func TestPipeline_NonTradeableRegime(t *testing.T) {
	flat := make([]float64, 60)
	for i := range flat {
		flat[i] = 100
	}
	res := Evaluate(baseInputs(flat, 100_000_000))
	if res.Approved || res.Final != nil {
		t.Fatalf("flat/unknown regime must not trade, got %+v", res)
	}
	if len(res.Evals) != 0 {
		t.Fatal("no candidates should be evaluated in a non-tradeable regime")
	}
}

// A ranging sinusoid classifies Ranging and (at an extreme) fires MeanReversion —
// exercising the full regime→signals→risk→committee chain end to end.
func rangingSeries(n int) []float64 {
	p := make([]float64, n)
	for i := range p {
		p[i] = 100 + math.Sin(float64(i)*0.45)*5
	}
	return p
}

func TestPipeline_EndToEnd_RangingGeneratesAndScreens(t *testing.T) {
	prices := rangingSeries(80)
	in := baseInputs(prices, 100_000_000)
	in.Catalog = []signals.Strategy{alwaysRanging{}}
	res := Evaluate(in)
	if res.Regime.Regime != regime.Ranging {
		t.Fatalf("sinusoid should classify Ranging, got %s", res.Regime.Regime)
	}
	if len(res.Evals) == 0 {
		t.Fatalf("expected candidates from the ranging strategy; got none (regime=%+v)", res.Regime)
	}
	if res.Final == nil || !res.Approved {
		t.Fatalf("a healthy ranging candidate should be approved end-to-end, got %+v", res)
	}
	if res.Final.NotionalKobo <= 0 {
		t.Fatalf("approved order must be positively sized, got %+v", res.Final)
	}
	// Every eval must carry both a risk decision and a committee decision (full trace).
	for _, ev := range res.Evals {
		if ev.Committee.Outcome == "" {
			t.Fatal("eval missing committee decision")
		}
		// Viability requires BOTH risk and committee approval (defense in depth).
		if ev.Viable && (!ev.Risk.Approved || !ev.Committee.Approved) {
			t.Fatalf("viable eval must have both risk+committee approval: %+v", ev)
		}
	}
	// If a final order was chosen, it must be positively sized.
	if res.Final != nil && res.Final.NotionalKobo <= 0 {
		t.Fatalf("final order must be positively sized, got %+v", res.Final)
	}
}

// Risk veto is absolute end to end: a candidate that generates but breaches a hard
// limit (here: zero equity) must NOT be viable, and the committee must show the
// risk hard-veto.
func TestPipeline_RiskVetoBlocksEndToEnd(t *testing.T) {
	prices := rangingSeries(80)
	in := baseInputs(prices, 100_000_000)
	in.Catalog = []signals.Strategy{alwaysRanging{}}
	in.State = risk.PortfolioState{EquityKobo: 0} // NO_EQUITY → risk vetoes everything
	res := Evaluate(in)
	if res.Approved || res.Final != nil {
		t.Fatalf("zero-equity must block any trade, got %+v", res)
	}
	if len(res.Evals) > 0 {
		found := false
		for _, ev := range res.Evals {
			if !ev.Viable && ev.Committee.Outcome == committee.Vetoed {
				found = true
			}
		}
		if !found {
			t.Fatal("a risk breach should surface as a committee hard-veto in at least one eval")
		}
	}
}

// A circuit breaker (stale data) blocks end to end regardless of signal quality.
func TestPipeline_CircuitBreakerBlocks(t *testing.T) {
	prices := rangingSeries(80)
	in := baseInputs(prices, 100_000_000)
	in.Catalog = []signals.Strategy{alwaysRanging{}}
	in.Circuit = risk.CircuitInputs{DataStale: true}
	res := Evaluate(in)
	if res.Approved {
		t.Fatalf("stale data must block all trades, got %+v", res)
	}
}
