package validate

import (
	"math"
	"math/rand"
	"sort"
)

// Monte-Carlo robustness (§11): resample the trade sequence many times to get a
// DISTRIBUTION of outcomes, not a single equity curve. Randomness is SEEDED, so a
// run is fully reproducible (§0/§15). Bootstrap WITH replacement varies both the
// total return and the path (and thus the drawdown).

// MCConfig parameterizes the simulation. Seed makes it deterministic.
type MCConfig struct {
	Trials int
	Seed   int64
}

// MCDistribution reports the 5th/50th/95th percentiles of total return (as a
// fraction of start equity) and of max drawdown (fraction) across the trials.
type MCDistribution struct {
	ReturnP5, ReturnP50, ReturnP95 float64
	MaxDDP5, MaxDDP50, MaxDDP95    float64
	Trials                        int
}

// MonteCarloBootstrap resamples the per-trade P&Ls (with replacement) into many
// equity paths and returns the outcome distribution. A strategy whose 5th-
// percentile return is deeply negative or whose 95th-percentile drawdown is severe
// is fragile even if its single historical run looked fine.
func MonteCarloBootstrap(tradePnLKobo []int64, startEquityKobo int64, cfg MCConfig) MCDistribution {
	out := MCDistribution{Trials: cfg.Trials}
	if len(tradePnLKobo) == 0 || startEquityKobo <= 0 || cfg.Trials <= 0 {
		return out
	}
	rng := rand.New(rand.NewSource(cfg.Seed))
	n := len(tradePnLKobo)
	rets := make([]float64, 0, cfg.Trials)
	dds := make([]float64, 0, cfg.Trials)

	for tr := 0; tr < cfg.Trials; tr++ {
		equity := startEquityKobo
		peak := equity
		var maxDD float64
		for i := 0; i < n; i++ {
			pnl := tradePnLKobo[rng.Intn(n)] // resample with replacement
			equity += pnl
			if equity > peak {
				peak = equity
			}
			if peak > 0 {
				dd := float64(peak-equity) / float64(peak)
				if dd > maxDD {
					maxDD = dd
				}
			}
		}
		rets = append(rets, float64(equity-startEquityKobo)/float64(startEquityKobo))
		dds = append(dds, maxDD)
	}
	sort.Float64s(rets)
	sort.Float64s(dds)
	out.ReturnP5, out.ReturnP50, out.ReturnP95 = pct(rets, 0.05), pct(rets, 0.50), pct(rets, 0.95)
	out.MaxDDP5, out.MaxDDP50, out.MaxDDP95 = pct(dds, 0.05), pct(dds, 0.50), pct(dds, 0.95)
	return out
}

func pct(sorted []float64, p float64) float64 {
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
