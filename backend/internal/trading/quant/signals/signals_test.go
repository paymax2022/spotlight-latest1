package signals

import (
	"testing"

	"spotlight/backend/internal/trading/quant/regime"
)

func TestIndicators(t *testing.T) {
	xs := []float64{1, 2, 3, 4, 5}
	if got := SMA(xs, 3); got != 4 { // (3+4+5)/3
		t.Fatalf("SMA = %v, want 4", got)
	}
	if got := SMA(xs, 9); got != 0 { // insufficient
		t.Fatalf("SMA insufficient = %v, want 0", got)
	}
	// RSI of a monotonic rise = 100 (all gains).
	if got := RSI([]float64{1, 2, 3, 4, 5, 6}, 5); got != 100 {
		t.Fatalf("RSI monotonic-up = %v, want 100", got)
	}
	// RSI of a monotonic fall = 0.
	if got := RSI([]float64{6, 5, 4, 3, 2, 1}, 5); got != 0 {
		t.Fatalf("RSI monotonic-down = %v, want 0", got)
	}
	// flat → neutral 50.
	if got := RSI([]float64{5, 5, 5, 5, 5, 5}, 5); got != 50 {
		t.Fatalf("RSI flat = %v, want 50", got)
	}
	// ZScore: last point far above the mean → positive; below → negative.
	up := append(rep(100, 19), 110)
	if z := ZScore(up, 20); z <= 0 {
		t.Fatalf("z above mean should be positive, got %v", z)
	}
	dn := append(rep(100, 19), 90)
	if z := ZScore(dn, 20); z >= 0 {
		t.Fatalf("z below mean should be negative, got %v", z)
	}
	// HighestHigh excluding current ignores the latest bar.
	pr := []float64{1, 5, 2, 3, 99}
	if hh := HighestHigh(pr, 4, true); hh != 5 { // prior 4 highs are {1,5,2,3} → 5
		t.Fatalf("prior HH = %v, want 5", hh)
	}
	if hh := HighestHigh(pr, 5, false); hh != 99 {
		t.Fatalf("HH incl current = %v, want 99", hh)
	}
}

// no-look-ahead: a candidate computed on a price prefix is UNCHANGED when future
// bars are appended (the strategy reads only its prefix; no hidden state).
func TestNoLookAhead(t *testing.T) {
	base := breakoutSeries()
	rs := regime.RegimeState{Regime: regime.Trending, Trend: regime.TrendUp}
	cat := DefaultCatalog()

	got := GenerateCandidates(Context{Asset: "BTC", Prices: base, Regime: rs}, cat)
	// Append wild future bars, then evaluate on the SAME prefix length.
	future := append(append([]float64{}, base...), 9_999, -9_999, 0.01)
	gotTrunc := GenerateCandidates(Context{Asset: "BTC", Prices: future[:len(base)], Regime: rs}, cat)

	if len(got) != len(gotTrunc) {
		t.Fatalf("look-ahead: candidate count changed with future data: %d vs %d", len(got), len(gotTrunc))
	}
	for i := range got {
		if got[i].Side != gotTrunc[i].Side || got[i].ConfidenceBps != gotTrunc[i].ConfidenceBps {
			t.Fatalf("look-ahead: candidate %d changed with future data", i)
		}
	}
}

func TestTrendFollow(t *testing.T) {
	p := trendUpNoisy(45)
	rsUp := regime.RegimeState{Regime: regime.Trending, Trend: regime.TrendUp}
	cs := NewTrendFollow().Generate(Context{Asset: "BTC", Prices: p, Regime: rsUp})
	if len(cs) != 1 || cs[0].Side != Long || cs[0].ConfidenceBps <= 0 {
		t.Fatalf("trend-follow should emit a long with confidence, got %+v", cs)
	}
	if cs[0].StopDistanceBps <= 0 {
		t.Fatal("candidate should carry a positive stop distance")
	}
	// Same series but regime says trend NONE → no candidate (trend confirmation required).
	if cs := NewTrendFollow().Generate(Context{Asset: "BTC", Prices: p, Regime: regime.RegimeState{Regime: regime.Ranging}}); len(cs) != 0 {
		t.Fatalf("trend-follow must stay silent without a trend regime, got %+v", cs)
	}
}

func TestMeanReversion(t *testing.T) {
	// flat ~100 then a sharp dip → deeply negative z → oversold long.
	p := append(rep(100, 25), 96, 95, 94)
	cs := NewMeanReversion().Generate(Context{Asset: "ETH", Prices: p, Regime: regime.RegimeState{Regime: regime.Ranging}})
	if len(cs) != 1 || cs[0].Side != Long {
		t.Fatalf("mean-reversion should emit an oversold long, got %+v", cs)
	}
	// flat with no dislocation → no candidate.
	if cs := NewMeanReversion().Generate(Context{Asset: "ETH", Prices: rep(100, 30), Regime: regime.RegimeState{Regime: regime.Ranging}}); len(cs) != 0 {
		t.Fatalf("mean-reversion must be silent with no dislocation, got %+v", cs)
	}
}

func TestBreakout(t *testing.T) {
	cs := NewBreakout().Generate(Context{Asset: "BTC", Prices: breakoutSeries(), Regime: regime.RegimeState{Regime: regime.HighVol}})
	if len(cs) != 1 || cs[0].Side != Long {
		t.Fatalf("breakout should emit a long on a new high, got %+v", cs)
	}
}

func TestGenerateCandidates_RegimeGating(t *testing.T) {
	cat := DefaultCatalog()
	p := trendUpNoisy(45)
	// Trending regime → trend_follow eligible (breakout too if it fires); NOT mean_reversion.
	cs := GenerateCandidates(Context{Asset: "BTC", Prices: p, Regime: regime.RegimeState{Regime: regime.Trending, Trend: regime.TrendUp}}, cat)
	for _, c := range cs {
		if c.Strategy == "mean_reversion" {
			t.Fatal("mean_reversion must not run in a trending regime")
		}
	}
	// Non-tradeable regimes → NOTHING regardless of strategy declarations (fail-closed).
	for _, r := range []regime.Regime{regime.Unknown, regime.Crisis, regime.Illiquid} {
		if cs := GenerateCandidates(Context{Asset: "BTC", Prices: p, Regime: regime.RegimeState{Regime: r}}, cat); len(cs) != 0 {
			t.Fatalf("regime %s must yield no candidates, got %+v", r, cs)
		}
	}
}

// ── fixtures ──────────────────────────────────────────────────────────────
func rep(v float64, n int) []float64 {
	out := make([]float64, n)
	for i := range out {
		out[i] = v
	}
	return out
}

// a steady rise then a consolidation near the top: the fast EMA stays above the
// slow EMA (uptrend intact) but RSI cools below the blow-off guard (not chasing).
func trendUpNoisy(n int) []float64 {
	p := make([]float64, n)
	rise := n - 15
	base := 100 + float64(rise-1)
	for i := 0; i < n; i++ {
		if i < rise {
			p[i] = 100 + float64(i) // steady climb
		} else if i%2 == 0 {
			p[i] = base + 1 // small oscillation at the top
		} else {
			p[i] = base - 1
		}
	}
	return p
}

// flat range then a clean upside breakout above the prior high on the last bar.
func breakoutSeries() []float64 {
	p := make([]float64, 0, 30)
	for i := 0; i < 25; i++ {
		if i%2 == 0 {
			p = append(p, 100)
		} else {
			p = append(p, 101)
		}
	}
	p = append(p, 108) // breaks well above the prior 101 high
	return p
}
