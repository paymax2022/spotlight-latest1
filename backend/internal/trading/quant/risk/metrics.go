package risk

import (
	"math"
	"sort"
)

// Portfolio risk metrics (§8): exposure, leverage, VaR/CVaR, and correlated-cluster
// exposure. Pure and deterministic. Risk magnitudes round UP (never understate).

// GrossExposureKobo is Σ|notional| across open positions.
func GrossExposureKobo(st PortfolioState) int64 {
	var g int64
	for _, p := range st.Positions {
		if p.NotionalKobo > 0 {
			g += p.NotionalKobo
		}
	}
	return g
}

// NetExposureKobo is Σ(signed notional) — long minus short.
func NetExposureKobo(st PortfolioState) int64 {
	var n int64
	for _, p := range st.Positions {
		n += p.SignedNotional()
	}
	return n
}

// GrossLeverageBps is gross exposure / equity, in bps (20000 = 2.0x). 0 when
// equity is non-positive (fail closed — treated as over-levered by the checker).
func GrossLeverageBps(st PortfolioState) Bps {
	if st.EquityKobo <= 0 {
		return 0
	}
	return Bps(math.Ceil(float64(GrossExposureKobo(st)) / float64(st.EquityKobo) * 10_000))
}

// ExposureByAssetKobo returns signed net exposure per asset (long +, short −).
func ExposureByAssetKobo(st PortfolioState) map[string]int64 {
	m := make(map[string]int64, len(st.Positions))
	for _, p := range st.Positions {
		m[p.Asset] += p.SignedNotional()
	}
	return m
}

// ClusterExposureKobo is the summed ABSOLUTE exposure to a set of correlated
// assets (e.g. {"BTC","ETH"} or {"EURUSD","GBPUSD"}) — the number the correlated-
// risk guard caps so the fund can't take one big bet dressed as several.
func ClusterExposureKobo(st PortfolioState, cluster []string) int64 {
	in := make(map[string]bool, len(cluster))
	for _, a := range cluster {
		in[a] = true
	}
	var sum int64
	for _, p := range st.Positions {
		if in[p.Asset] {
			sum += absI64(p.SignedNotional())
		}
	}
	return sum
}

// HistoricalVaRKobo is the empirical Value-at-Risk: the loss magnitude (positive
// kobo) that period P&L falls below only (1−confidence) of the time. periodPnLKobo
// is the historical distribution of per-period P&L (negative = loss). Returns 0
// when there is too little data to estimate a tail (caller must treat 0-with-few-
// samples as "insufficient risk data" and veto). Rounds the loss magnitude UP.
func HistoricalVaRKobo(periodPnLKobo []int64, confidenceBps Bps) int64 {
	q := varQuantile(periodPnLKobo, confidenceBps)
	if q >= 0 {
		return 0 // the tail quantile is a gain — no modelled loss at this confidence
	}
	return absI64(q)
}

// ConditionalVaRKobo (Expected Shortfall) is the MEAN loss in the tail beyond VaR
// — a coherent risk measure that, unlike VaR, accounts for how bad the tail is.
// Returns positive kobo, rounded UP; 0 on insufficient data.
func ConditionalVaRKobo(periodPnLKobo []int64, confidenceBps Bps) int64 {
	n := len(periodPnLKobo)
	if n < minTailSamples {
		return 0
	}
	sorted := append([]int64(nil), periodPnLKobo...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	// tail = the worst (1−confidence) fraction of outcomes.
	alpha := 1 - clamp01(confidenceBps.Frac())
	k := int(math.Floor(alpha * float64(n)))
	if k < 1 {
		k = 1 // always include at least the single worst outcome
	}
	var sum float64
	for i := 0; i < k; i++ {
		sum += float64(sorted[i])
	}
	mean := sum / float64(k)
	if mean >= 0 {
		return 0
	}
	return int64(math.Ceil(-mean))
}

// varQuantile returns the P&L value at the (1−confidence) quantile (may be a gain
// or a loss). Returns +1 sentinel-safe 0-handling via the callers; here it returns
// the quantile value, or 0 sentinel when insufficient data (callers guard).
func varQuantile(periodPnLKobo []int64, confidenceBps Bps) int64 {
	n := len(periodPnLKobo)
	if n < minTailSamples {
		return 0
	}
	sorted := append([]int64(nil), periodPnLKobo...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	alpha := 1 - clamp01(confidenceBps.Frac())
	// lower-tail index (conservative: floor, and never below 0).
	idx := int(math.Floor(alpha * float64(n)))
	if idx < 0 {
		idx = 0
	}
	if idx >= n {
		idx = n - 1
	}
	return sorted[idx]
}

// minTailSamples is the minimum history to even attempt a tail estimate. Fewer →
// VaR/CVaR report 0 and the limit layer vetoes for insufficient risk data.
const minTailSamples = 20

func absI64(x int64) int64 {
	if x < 0 {
		return -x
	}
	return x
}
