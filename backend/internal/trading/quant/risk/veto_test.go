package risk

import "testing"

// A generous baseline limit set + a clean small trade that passes everything.
func baseLimits() Limits {
	return Limits{
		MaxDailyLossKobo: 10_000_000, MaxWeeklyLossKobo: 20_000_000, MaxMonthlyLossKobo: 40_000_000,
		MaxDrawdownBps: 2000, MaxOpenPositions: 10, MaxPositionKobo: 30_000_000,
		MaxPositionFracBps: 3000, MaxGrossLeverageBps: 20_000, MaxCorrelatedFracBps: 9000,
		MinConfidenceBps: 6000, AllowedAssets: []string{"BTC", "ETH", "EURUSD"},
	}
}
func cleanCtx() TradeContext {
	return TradeContext{
		Trade:               ProposedTrade{Asset: "BTC", Side: Long, NotionalKobo: 10_000_000, ConfidenceBps: 8000},
		WithinTradingWindow: true,
		Clusters:            [][]string{{"BTC", "ETH"}, {"EURUSD", "GBPUSD"}},
	}
}

func TestCheckLimits_CleanPass(t *testing.T) {
	if b := CheckLimits(mkState(), baseLimits(), cleanCtx()); len(b) != 0 {
		t.Fatalf("clean trade should clear, got breaches: %v", b)
	}
}

func TestCheckLimits_EachBreach(t *testing.T) {
	has := func(bs []Breach, code string) bool {
		for _, b := range bs {
			if b.Code == code {
				return true
			}
		}
		return false
	}
	// fail-closed: no equity.
	if b := CheckLimits(PortfolioState{}, baseLimits(), cleanCtx()); !has(b, "NO_EQUITY") {
		t.Fatal("no-equity must be NO_EQUITY breach")
	}
	// daily loss hit.
	st := mkState(); st.RealizedTodayKobo = -10_000_000
	if b := CheckLimits(st, baseLimits(), cleanCtx()); !has(b, "MAX_DAILY_LOSS") {
		t.Fatal("daily loss not vetoed")
	}
	// drawdown.
	st = mkState(); st.EquityKobo = 75_000_000 // 25% dd > 20%
	if b := CheckLimits(st, baseLimits(), cleanCtx()); !has(b, "MAX_DRAWDOWN") {
		t.Fatal("drawdown not vetoed")
	}
	// position size cap.
	tc := cleanCtx(); tc.Trade.NotionalKobo = 40_000_000
	if b := CheckLimits(mkState(), baseLimits(), tc); !has(b, "MAX_POSITION_SIZE") {
		t.Fatal("oversize not vetoed")
	}
	// gross leverage: existing 90M + new 40M = 130M / 100M = 1.3x, but cap 2.0x → ok;
	// push cap down to 1.0x to trip.
	lim := baseLimits(); lim.MaxGrossLeverageBps = 9000; lim.MaxPositionKobo = 0
	if b := CheckLimits(mkState(), lim, cleanCtx()); !has(b, "MAX_GROSS_LEVERAGE") {
		t.Fatal("leverage not vetoed")
	}
	// correlated cluster: BTC+ETH already 70M; +10M BTC = 80M. Under a 60% cap
	// (60M of 100M equity) this must trip; under the generous 90% baseline it must not.
	if b := CheckLimits(mkState(), baseLimits(), cleanCtx()); has(b, "MAX_CORRELATED_EXPOSURE") {
		t.Fatal("cluster tripped under the 90% baseline (80M < 90M) — should not")
	}
	tight := baseLimits(); tight.MaxCorrelatedFracBps = 6000
	if b := CheckLimits(mkState(), tight, cleanCtx()); !has(b, "MAX_CORRELATED_EXPOSURE") {
		t.Fatal("cluster over-exposure (80M > 60M) not vetoed under the tight cap")
	}
	// min confidence.
	tc = cleanCtx(); tc.Trade.ConfidenceBps = 5000
	if b := CheckLimits(mkState(), baseLimits(), tc); !has(b, "MIN_CONFIDENCE") {
		t.Fatal("low confidence not vetoed")
	}
	// disallowed asset.
	tc = cleanCtx(); tc.Trade.Asset = "DOGE"
	if b := CheckLimits(mkState(), baseLimits(), tc); !has(b, "ASSET_NOT_ALLOWED") {
		t.Fatal("disallowed asset not vetoed")
	}
	// outside trading hours.
	tc = cleanCtx(); tc.WithinTradingWindow = false
	if b := CheckLimits(mkState(), baseLimits(), tc); !has(b, "OUTSIDE_TRADING_HOURS") {
		t.Fatal("out-of-hours not vetoed")
	}
}

func TestCircuitBreakers(t *testing.T) {
	cfg := CircuitConfig{MaxConsecutiveLosses: 5, MaxLossRateBps: 6000, MaxSlippageBps: 50, MaxVolSpikeBps: 30_000}
	if b := EvalCircuitBreakers(CircuitInputs{ConsecutiveLosses: 2, RecentLossRateBps: 3000}, cfg); len(b) != 0 {
		t.Fatalf("calm inputs should not trip, got %v", b)
	}
	// data staleness ALWAYS trips (fail-closed), even with an otherwise-calm scope.
	if b := EvalCircuitBreakers(CircuitInputs{DataStale: true}, CircuitConfig{}); !Tripped(b) {
		t.Fatal("stale data must trip")
	}
	if b := EvalCircuitBreakers(CircuitInputs{PriceAnomaly: true}, CircuitConfig{}); !Tripped(b) {
		t.Fatal("price anomaly must trip")
	}
	if b := EvalCircuitBreakers(CircuitInputs{ConsecutiveLosses: 6}, cfg); !Tripped(b) {
		t.Fatal("consecutive losses must trip")
	}
	if b := EvalCircuitBreakers(CircuitInputs{VolSpikeRatioBps: 40_000}, cfg); !Tripped(b) {
		t.Fatal("vol spike must trip")
	}
}

// The pipeline: a veto/trip is ABSOLUTE — Approved is false and SizedKobo is 0.
func TestScreen_Pipeline(t *testing.T) {
	base := ScreenInputs{
		State: mkState(), Limits: baseLimits(),
		Ladder:  DrawdownLadderConfig{ReduceAtBps: 500, HedgeAtBps: 1000, FlatAtBps: 1500, HaltAtBps: 2000},
		Trade:   ProposedTrade{Asset: "BTC", Side: Long, NotionalKobo: 8_000_000, ConfidenceBps: 8000},
		Clusters: [][]string{{"BTC", "ETH"}}, WithinWindow: true,
	}
	// Clean: approved, sized (BTC+ETH cluster 70M + 8M = 78M > 60M cap → actually vetoed!).
	// Use a fresh state with no correlated exposure to get a clean approval.
	base.State = PortfolioState{EquityKobo: 100_000_000, PeakEquityKobo: 100_000_000}
	d := Screen(base)
	if !d.Approved || d.SizedKobo <= 0 {
		t.Fatalf("clean candidate should be approved, got %+v", d)
	}

	// Circuit trip → blocked.
	trip := base
	trip.Circuit = CircuitInputs{DataStale: true}
	if d := Screen(trip); d.Approved || len(d.CircuitTrips) == 0 {
		t.Fatalf("circuit trip must block, got %+v", d)
	}

	// Deep drawdown → defensive mode blocks new risk.
	dd := base
	dd.State = PortfolioState{EquityKobo: 82_000_000, PeakEquityKobo: 100_000_000} // 18% dd → flatten
	if d := Screen(dd); d.Approved || d.Action != ActFlat {
		t.Fatalf("defensive mode must block, got %+v", d)
	}

	// Reduce posture halves the size (10% dd → reduce).
	red := base
	red.State = PortfolioState{EquityKobo: 92_000_000, PeakEquityKobo: 100_000_000} // 8% dd → reduce
	red.Trade.NotionalKobo = 10_000_000
	d = Screen(red)
	if !d.Approved || d.Action != ActReduce {
		t.Fatalf("reduce posture should still approve a trimmed size, got %+v", d)
	}
	if d.SizedKobo > 5_000_000 {
		t.Fatalf("reduce posture should ~halve the size, got %d", d.SizedKobo)
	}

	// Confidence below the minimum → sized to zero → blocked.
	lc := base
	lc.Trade.ConfidenceBps = 4000
	if d := Screen(lc); d.Approved {
		t.Fatalf("below-min confidence must block, got %+v", d)
	}
}
