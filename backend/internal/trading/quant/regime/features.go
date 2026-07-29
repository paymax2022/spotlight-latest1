package regime

import "math"

// Pure feature functions used by the classifier. All are deterministic and
// side-effect-free, and defend against degenerate input (empty / constant series).

// RealizedVolBps is the per-period return volatility (population stddev) expressed
// in bps. Returns 0 for < 2 samples (the caller treats 0-vol-with-few-samples as
// Unknown via MinSamples).
func RealizedVolBps(returns []float64) Bps {
	if len(returns) < 2 {
		return 0
	}
	sd := stddev(returns)
	if !finite(sd) || sd < 0 {
		return 0
	}
	return Bps(math.Round(sd * 10_000))
}

// EfficiencyRatio is Kaufman's ratio over the price window: |net change| divided
// by the total path length (Σ|step|). It is in [0,1]: →1 means a clean directional
// move (trending), →0 means a choppy, mean-reverting path (ranging). Returns 0 for
// a flat or too-short series.
func EfficiencyRatio(prices []float64) float64 {
	if len(prices) < 2 {
		return 0
	}
	net := math.Abs(prices[len(prices)-1] - prices[0])
	var path float64
	for i := 1; i < len(prices); i++ {
		path += math.Abs(prices[i] - prices[i-1])
	}
	if path == 0 {
		return 0
	}
	er := net / path
	if !finite(er) {
		return 0
	}
	return clamp01(er)
}

// TrendSlope is the least-squares slope of price against the integer time index.
// Its SIGN gives the trend direction; magnitude is not used for sizing. Returns 0
// for a too-short or degenerate series.
func TrendSlope(prices []float64) float64 {
	n := len(prices)
	if n < 2 {
		return 0
	}
	var sx, sy, sxy, sxx float64
	for i, p := range prices {
		x := float64(i)
		sx += x
		sy += p
		sxy += x * p
		sxx += x * x
	}
	fn := float64(n)
	denom := fn*sxx - sx*sx
	if denom == 0 {
		return 0
	}
	slope := (fn*sxy - sx*sy) / denom
	if !finite(slope) {
		return 0
	}
	return slope
}

// ── helpers ────────────────────────────────────────────────────────────────
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

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}
