package risk

import "testing"

func mkState() PortfolioState {
	return PortfolioState{
		EquityKobo:     100_000_000,
		PeakEquityKobo: 100_000_000,
		Positions: []Position{
			{Asset: "BTC", Side: Long, NotionalKobo: 40_000_000},
			{Asset: "ETH", Side: Long, NotionalKobo: 30_000_000},
			{Asset: "EURUSD", Side: Short, NotionalKobo: 20_000_000},
		},
		OpenPositionCount: 3,
	}
}

func TestExposureAndLeverage(t *testing.T) {
	st := mkState()
	if g := GrossExposureKobo(st); g != 90_000_000 {
		t.Fatalf("gross = %d, want 90_000_000", g)
	}
	if n := NetExposureKobo(st); n != 50_000_000 { // 40+30-20
		t.Fatalf("net = %d, want 50_000_000", n)
	}
	if l := GrossLeverageBps(st); l != 9000 { // 90M/100M = 0.9x
		t.Fatalf("gross leverage = %d bps, want 9000", l)
	}
	// non-positive equity → leverage 0 (fail-closed for the checker to treat as over-levered).
	st.EquityKobo = 0
	if l := GrossLeverageBps(st); l != 0 {
		t.Fatalf("no-equity leverage = %d, want 0", l)
	}
}

func TestClusterExposure(t *testing.T) {
	st := mkState()
	if c := ClusterExposureKobo(st, []string{"BTC", "ETH"}); c != 70_000_000 {
		t.Fatalf("BTC+ETH cluster = %d, want 70_000_000", c)
	}
	if c := ClusterExposureKobo(st, []string{"EURUSD", "GBPUSD"}); c != 20_000_000 {
		t.Fatalf("FX cluster = %d, want 20_000_000 (abs of short)", c)
	}
}

func TestVaRAndCVaR(t *testing.T) {
	// 20 samples: worst two are −1000 and −500; the rest are non-losses.
	pnl := []int64{-1000, -500}
	for i := 0; i < 18; i++ {
		pnl = append(pnl, int64(i*10)) // 0,10,...,170 (gains)
	}
	// n=20, 95% conf → alpha 0.05 → idx floor(1)=1 → sorted[1]=−500 → VaR 500.
	if v := HistoricalVaRKobo(pnl, 9500); v != 500 {
		t.Fatalf("VaR95 = %d, want 500", v)
	}
	// CVaR95: k=floor(0.05*20)=1 → mean of worst 1 = −1000 → 1000. CVaR ≥ VaR.
	cv := ConditionalVaRKobo(pnl, 9500)
	if cv != 1000 {
		t.Fatalf("CVaR95 = %d, want 1000", cv)
	}
	if cv < HistoricalVaRKobo(pnl, 9500) {
		t.Fatal("CVaR must be >= VaR")
	}
	// Insufficient data → 0 (caller must veto on this).
	if v := HistoricalVaRKobo([]int64{-100, -50, 10}, 9500); v != 0 {
		t.Fatalf("VaR on tiny sample = %d, want 0 (insufficient)", v)
	}
	// All-gains distribution → no modelled loss → 0.
	all := make([]int64, 25)
	for i := range all {
		all[i] = int64(i + 1)
	}
	if v := HistoricalVaRKobo(all, 9500); v != 0 {
		t.Fatalf("VaR on all-gains = %d, want 0", v)
	}
}

func TestDrawdownLadder(t *testing.T) {
	cfg := DrawdownLadderConfig{ReduceAtBps: 500, HedgeAtBps: 1000, FlatAtBps: 1500, HaltAtBps: 2000}
	cases := []struct {
		equity int64
		want   DrawdownAction
	}{
		{100_000_000, ActNormal}, // 0% dd
		{94_000_000, ActReduce},  // 6% dd (>= 5% reduce)
		{89_000_000, ActHedge},   // 11%
		{84_000_000, ActFlat},    // 16%
		{79_000_000, ActHalt},    // 21%
	}
	for _, c := range cases {
		st := PortfolioState{EquityKobo: c.equity, PeakEquityKobo: 100_000_000}
		if a := DrawdownLadder(CurrentDrawdownBps(st), cfg); a != c.want {
			t.Fatalf("equity %d → %s, want %s", c.equity, a, c.want)
		}
	}
	// AllowsNewRisk only for normal/reduce.
	if AllowsNewRisk(ActHedge) || AllowsNewRisk(ActHalt) || !AllowsNewRisk(ActReduce) {
		t.Fatal("AllowsNewRisk gate wrong")
	}
	// peak<=0 → max drawdown (fail-closed).
	if dd := CurrentDrawdownBps(PortfolioState{EquityKobo: 10, PeakEquityKobo: 0}); dd != 10_000 {
		t.Fatalf("degenerate peak dd = %d, want 10000", dd)
	}
}
