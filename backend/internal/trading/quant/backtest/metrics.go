package backtest

import (
	"math"
	"sort"
)

// Risk-adjusted, drawdown-aware performance metrics (§11). Pure functions over the
// equity curve + trade log. These OUTRANK raw return when judging a strategy.

// ComputeMetrics assembles the full Metrics from an equity curve and trades.
func ComputeMetrics(curve []int64, trades []Trade, totalCostKobo int64, cfg Config) Metrics {
	m := Metrics{NumTrades: len(trades)}
	if len(curve) < 2 || curve[0] <= 0 {
		return m
	}
	start, final := curve[0], curve[len(curve)-1]
	m.FinalEquityKobo = final
	m.ReturnBps = Bps(math.Round((float64(final)/float64(start) - 1) * 10_000))

	rets := equityReturns(curve)
	ppy := cfg.PeriodsPerYear
	if ppy <= 0 {
		ppy = 365
	}

	// CAGR.
	n := float64(len(curve) - 1)
	if n > 0 && final > 0 {
		cagr := math.Pow(float64(final)/float64(start), ppy/n) - 1
		m.CAGRBps = Bps(math.Round(cagr * 10_000))
	}

	// Sharpe / Sortino (annualized).
	mu := mean(rets)
	if sd := stddev(rets); sd > 0 {
		m.SharpeBps = Bps(math.Round(mu / sd * math.Sqrt(ppy) * 10_000))
	}
	if dsd := downsideDev(rets); dsd > 0 {
		m.SortinoBps = Bps(math.Round(mu / dsd * math.Sqrt(ppy) * 10_000))
	}

	// Drawdown-based.
	maxDD := maxDrawdownFrac(curve)
	m.MaxDrawdownBps = Bps(math.Round(maxDD * 10_000))
	m.UlcerIndexBps = Bps(math.Round(ulcerIndexFrac(curve) * 10_000))
	if maxDD > 0 && m.CAGRBps != 0 {
		m.CalmarBps = Bps(math.Round(m.CAGRBps.Frac() / maxDD * 10_000))
	}

	// Trade-based.
	var grossWin, grossLoss, sumPnL int64
	var wins int
	for _, t := range trades {
		sumPnL += t.PnLKobo
		if t.PnLKobo > 0 {
			grossWin += t.PnLKobo
			wins++
		} else {
			grossLoss += -t.PnLKobo
		}
	}
	if len(trades) > 0 {
		m.WinRateBps = Bps(math.Round(float64(wins) / float64(len(trades)) * 10_000))
		m.ExpectancyKobo = sumPnL / int64(len(trades))
	}
	if grossLoss > 0 {
		m.ProfitFactorBps = Bps(math.Round(float64(grossWin) / float64(grossLoss) * 10_000))
	} else if grossWin > 0 {
		m.ProfitFactorBps = 1_000_000 // no losses → cap PF at 100x (avoid +Inf)
	}

	// Tail ratio: |95th pct return| / |5th pct return|.
	m.TailRatioBps = Bps(math.Round(tailRatio(rets) * 10_000))

	// Turnover + cost drag.
	var traded int64
	for _, t := range trades {
		traded += t.NotionalKobo * 2 // entry + exit
	}
	if avg := avgEquity(curve); avg > 0 {
		m.TurnoverBps = Bps(math.Round(float64(traded) / avg * 10_000))
	}
	m.CostDragBps = Bps(math.Round(float64(totalCostKobo) / float64(start) * 10_000))
	return m
}

func equityReturns(curve []int64) []float64 {
	r := make([]float64, 0, len(curve)-1)
	for i := 1; i < len(curve); i++ {
		if curve[i-1] == 0 {
			r = append(r, 0)
			continue
		}
		r = append(r, float64(curve[i]-curve[i-1])/float64(curve[i-1]))
	}
	return r
}

func maxDrawdownFrac(curve []int64) float64 {
	var peak int64 = curve[0]
	var maxDD float64
	for _, v := range curve {
		if v > peak {
			peak = v
		}
		if peak > 0 {
			dd := float64(peak-v) / float64(peak)
			if dd > maxDD {
				maxDD = dd
			}
		}
	}
	return maxDD
}

func ulcerIndexFrac(curve []int64) float64 {
	var peak int64 = curve[0]
	var ss float64
	for _, v := range curve {
		if v > peak {
			peak = v
		}
		if peak > 0 {
			dd := float64(peak-v) / float64(peak)
			ss += dd * dd
		}
	}
	return math.Sqrt(ss / float64(len(curve)))
}

func tailRatio(rets []float64) float64 {
	if len(rets) < 20 {
		return 0
	}
	s := append([]float64(nil), rets...)
	sort.Float64s(s)
	p05 := percentile(s, 0.05)
	p95 := percentile(s, 0.95)
	if p05 == 0 {
		return 0
	}
	return math.Abs(p95) / math.Abs(p05)
}

func percentile(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	idx := int(math.Floor(p * float64(len(sorted)-1)))
	if idx < 0 {
		idx = 0
	}
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}

func avgEquity(curve []int64) float64 {
	var s float64
	for _, v := range curve {
		s += float64(v)
	}
	return s / float64(len(curve))
}

func mean(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	var s float64
	for _, x := range xs {
		s += x
	}
	return s / float64(len(xs))
}
func stddev(xs []float64) float64 {
	if len(xs) < 2 {
		return 0
	}
	m := mean(xs)
	var ss float64
	for _, x := range xs {
		d := x - m
		ss += d * d
	}
	return math.Sqrt(ss / float64(len(xs)))
}
func downsideDev(xs []float64) float64 {
	if len(xs) < 2 {
		return 0
	}
	var ss float64
	var k int
	for _, x := range xs {
		if x < 0 {
			ss += x * x
			k++
		}
	}
	if k == 0 {
		return 0
	}
	return math.Sqrt(ss / float64(len(xs)))
}
