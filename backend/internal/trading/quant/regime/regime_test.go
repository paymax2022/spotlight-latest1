package regime

import "math"

import "testing"

// helper: build a series and its returns.
func seriesReturns(prices []float64) []float64 {
	r := make([]float64, 0, len(prices)-1)
	for i := 1; i < len(prices); i++ {
		r = append(r, (prices[i]-prices[i-1])/prices[i-1])
	}
	return r
}

func TestEfficiencyRatio(t *testing.T) {
	// Monotonic ramp: net change == path length → ER == 1.0 (perfectly trending).
	ramp := []float64{100, 101, 102, 103, 104, 105}
	if er := EfficiencyRatio(ramp); math.Abs(er-1.0) > 1e-9 {
		t.Fatalf("ramp ER = %v, want 1.0", er)
	}
	// Zig-zag that returns to start: net 0 → ER 0 (perfectly choppy).
	zig := []float64{100, 105, 100, 105, 100}
	if er := EfficiencyRatio(zig); er != 0 {
		t.Fatalf("round-trip ER = %v, want 0", er)
	}
	// Flat series → 0.
	if er := EfficiencyRatio([]float64{100, 100, 100}); er != 0 {
		t.Fatalf("flat ER = %v, want 0", er)
	}
}

func TestTrendSlopeSign(t *testing.T) {
	if TrendSlope([]float64{1, 2, 3, 4}) <= 0 {
		t.Fatal("rising series must have positive slope")
	}
	if TrendSlope([]float64{4, 3, 2, 1}) >= 0 {
		t.Fatal("falling series must have negative slope")
	}
	if s := TrendSlope([]float64{5, 5, 5, 5}); s != 0 {
		t.Fatalf("flat slope = %v, want 0", s)
	}
}

func TestRealizedVol(t *testing.T) {
	// constant returns → zero vol.
	if v := RealizedVolBps([]float64{0.01, 0.01, 0.01}); v != 0 {
		t.Fatalf("constant returns vol = %d, want 0", v)
	}
	// a noisier series has higher vol than a calmer one.
	calm := RealizedVolBps([]float64{0.001, -0.001, 0.001, -0.001, 0.001})
	wild := RealizedVolBps([]float64{0.05, -0.05, 0.05, -0.05, 0.05})
	if wild <= calm {
		t.Fatalf("wild vol (%d) must exceed calm (%d)", wild, calm)
	}
}

// build a smooth uptrend of n points.
func uptrend(n int) []float64 {
	p := make([]float64, n)
	for i := range p {
		p[i] = 100 + float64(i)*0.5
	}
	return p
}

// build a choppy, range-bound series of n points (mean-reverting, net ~0).
func choppy(n int) []float64 {
	p := make([]float64, n)
	for i := range p {
		if i%2 == 0 {
			p[i] = 100
		} else {
			p[i] = 101
		}
	}
	return p
}

func TestClassify(t *testing.T) {
	cfg := DefaultConfig()

	// Trending up.
	up := uptrend(40)
	rsUp := Classify(RegimeInputs{Prices: up, Returns: seriesReturns(up), LiquidityScoreBps: 8000}, cfg)
	if rsUp.Regime != Trending || rsUp.Trend != TrendUp {
		t.Fatalf("uptrend → %+v, want Trending/up", rsUp)
	}

	// Ranging (choppy, low efficiency).
	ch := choppy(40)
	rsCh := Classify(RegimeInputs{Prices: ch, Returns: seriesReturns(ch), BaselineVolBps: RealizedVolBps(seriesReturns(ch)), LiquidityScoreBps: 8000}, cfg)
	if rsCh.Regime != Ranging {
		t.Fatalf("choppy → %+v, want Ranging", rsCh)
	}

	// Crisis: a genuinely volatile series (~±2.5%/period) whose realized vol is
	// far (>3x) above the supplied baseline → Crisis, priority over everything.
	vol := make([]float64, 40)
	vol[0] = 100
	for i := 1; i < len(vol); i++ {
		if i%2 == 1 {
			vol[i] = vol[i-1] * 1.03
		} else {
			vol[i] = vol[i-1] * 0.98
		}
	}
	volRet := seriesReturns(vol)
	baseline := RealizedVolBps(volRet) / 4 // realized ≈ 4x this baseline
	if baseline == 0 {
		t.Fatal("test setup: volatile series has ~zero vol")
	}
	rsCrisis := Classify(RegimeInputs{Prices: vol, Returns: volRet, BaselineVolBps: baseline, LiquidityScoreBps: 8000}, cfg)
	if rsCrisis.Regime != Crisis {
		t.Fatalf("vol ~4x baseline → %+v, want Crisis", rsCrisis)
	}

	// Illiquid: liquidity below threshold (and not crisis) → Illiquid.
	rsThin := Classify(RegimeInputs{Prices: up, Returns: seriesReturns(up), LiquidityScoreBps: 1000}, cfg)
	if rsThin.Regime != Illiquid {
		t.Fatalf("thin liquidity → %+v, want Illiquid", rsThin)
	}

	// Fail-closed: too few samples → Unknown.
	short := uptrend(5)
	if rs := Classify(RegimeInputs{Prices: short, Returns: seriesReturns(short)}, cfg); rs.Regime != Unknown {
		t.Fatalf("short series → %+v, want Unknown", rs)
	}
	// Degenerate flat series → Unknown (zero vol).
	flat := make([]float64, 40)
	for i := range flat {
		flat[i] = 100
	}
	if rs := Classify(RegimeInputs{Prices: flat, Returns: seriesReturns(flat)}, cfg); rs.Regime != Unknown {
		t.Fatalf("flat series → %+v, want Unknown", rs)
	}
}

func TestEligibleStrategies(t *testing.T) {
	catalog := []StrategyDecl{
		{Name: "trend_follow", ValidRegimes: []Regime{Trending}},
		{Name: "mean_reversion", ValidRegimes: []Regime{Ranging}},
		{Name: "breakout", ValidRegimes: []Regime{Trending, HighVol}},
	}
	names := func(ss []StrategyDecl) []string {
		var n []string
		for _, s := range ss {
			n = append(n, s.Name)
		}
		return n
	}

	// Trending → trend_follow + breakout; NOT mean_reversion.
	el := EligibleStrategies(RegimeState{Regime: Trending, Trend: TrendUp}, catalog)
	if got := names(el); len(got) != 2 || got[0] != "trend_follow" || got[1] != "breakout" {
		t.Fatalf("trending eligibility = %v, want [trend_follow breakout]", got)
	}
	// Ranging → mean_reversion only.
	el = EligibleStrategies(RegimeState{Regime: Ranging}, catalog)
	if got := names(el); len(got) != 1 || got[0] != "mean_reversion" {
		t.Fatalf("ranging eligibility = %v, want [mean_reversion]", got)
	}
	// Non-tradeable regimes → NOTHING, regardless of declarations (fail-closed).
	for _, r := range []Regime{Unknown, Crisis, Illiquid} {
		if el := EligibleStrategies(RegimeState{Regime: r}, catalog); len(el) != 0 {
			t.Fatalf("regime %s must yield no eligible strategies, got %v", r, names(el))
		}
	}
}
