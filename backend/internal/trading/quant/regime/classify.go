package regime

import (
	"math"
)

// Classify maps validated point-in-time inputs to a RegimeState, deterministically.
// Priority (most-defensive first): Unknown → Crisis → Illiquid → Trending →
// HighVol → Ranging. A Crisis or Illiquid or Unknown regime makes every strategy
// ineligible downstream (§6). Volatility is judged RELATIVE to BaselineVolBps; with
// no baseline the vol state is Normal (we don't infer a crisis we can't measure).
func Classify(in RegimeInputs, cfg RegimeConfig) RegimeState {
	rs := RegimeState{Regime: Unknown, Trend: TrendNone, Vol: VolNormal}

	// Fail-closed: need enough return samples and matching prices.
	if cfg.MinSamples < 2 {
		cfg.MinSamples = 2
	}
	if len(in.Returns) < cfg.MinSamples || len(in.Prices) < cfg.MinSamples {
		return rs // Unknown
	}

	// Volatility state (relative to baseline).
	rvol := RealizedVolBps(in.Returns)
	rs.RealizedVolBps = rvol
	if rvol == 0 {
		return rs // degenerate (flat) series → Unknown
	}
	baseline := in.BaselineVolBps
	if baseline <= 0 {
		baseline = rvol // no baseline → ratio 1.0 (vol judged Normal)
	}
	ratioBps := Bps(math.Round(float64(rvol) / float64(baseline) * 10_000))
	rs.VolRatioBps = ratioBps
	switch {
	case cfg.CrisisVolRatioBps > 0 && ratioBps >= cfg.CrisisVolRatioBps:
		rs.Vol = VolCrisis
	case cfg.HighVolRatioBps > 0 && ratioBps >= cfg.HighVolRatioBps:
		rs.Vol = VolHigh
	case cfg.LowVolRatioBps > 0 && ratioBps <= cfg.LowVolRatioBps:
		rs.Vol = VolLow
	default:
		rs.Vol = VolNormal
	}

	// Trend state.
	er := EfficiencyRatio(in.Prices)
	slope := TrendSlope(in.Prices)
	rs.EfficiencyRatio = er
	rs.Slope = slope
	if Bps(math.Round(er*10_000)) >= cfg.TrendEffRatioMinBps {
		switch {
		case slope > 0:
			rs.Trend = TrendUp
		case slope < 0:
			rs.Trend = TrendDown
		default:
			rs.Trend = TrendNone
		}
	}

	// Liquidity.
	rs.Illiquid = cfg.IlliquidBelowBps > 0 && in.LiquidityScoreBps < cfg.IlliquidBelowBps

	// Primary label by priority (most-defensive wins).
	switch {
	case rs.Vol == VolCrisis:
		rs.Regime = Crisis
	case rs.Illiquid:
		rs.Regime = Illiquid
	case rs.Trend != TrendNone:
		rs.Regime = Trending
	case rs.Vol == VolHigh:
		rs.Regime = HighVol
	default:
		rs.Regime = Ranging
	}
	return rs
}

// Tradeable reports whether the regime permits opening new positions at all.
// Unknown / Crisis / Illiquid are never tradeable (defensive only).
func (rs RegimeState) Tradeable() bool {
	switch rs.Regime {
	case Trending, Ranging, HighVol:
		return true
	default:
		return false
	}
}

// EligibleStrategies returns the strategies whose declared valid regimes include
// the current regime — the ONLY switch that turns a strategy on (§6). A non-
// tradeable regime yields none, regardless of declarations (fail-closed).
func EligibleStrategies(rs RegimeState, catalog []StrategyDecl) []StrategyDecl {
	if !rs.Tradeable() {
		return nil
	}
	var out []StrategyDecl
	for _, s := range catalog {
		for _, r := range s.ValidRegimes {
			if r == rs.Regime {
				out = append(out, s)
				break
			}
		}
	}
	return out
}

// Bps is a rate in basis points (mirrors risk.Bps; kept local so the packages
// don't couple). 1 bp = 0.01%.
type Bps int64

func (b Bps) Frac() float64 { return float64(b) / 10_000.0 }

// Regime is the primary market-state label.
type Regime string

const (
	Unknown  Regime = "unknown"  // insufficient/degenerate data → nothing eligible
	Crisis   Regime = "crisis"   // volatility far above baseline → defensive only
	Illiquid Regime = "illiquid" // liquidity too thin to trade safely
	Trending Regime = "trending" // strong directional move (see TrendState for sign)
	Ranging  Regime = "ranging"  // mean-reverting / choppy, no dominant trend
	HighVol  Regime = "high_vol" // elevated (not crisis) vol without a clean trend
)

// TrendState is the directional sub-classification.
type TrendState string

const (
	TrendNone TrendState = "none"
	TrendUp   TrendState = "up"
	TrendDown TrendState = "down"
)

// VolState buckets realized volatility relative to a longer-run baseline.
type VolState string

const (
	VolLow    VolState = "low"
	VolNormal VolState = "normal"
	VolHigh   VolState = "high"
	VolCrisis VolState = "crisis"
)

// RegimeState is the full classification result.
type RegimeState struct {
	Regime   Regime
	Trend    TrendState
	Vol      VolState
	Illiquid bool
	// Diagnostics (for explainability / audit — never used to size).
	RealizedVolBps  Bps
	VolRatioBps     Bps     // realized / baseline (10000 = 1.0x)
	EfficiencyRatio float64 // 0..1 (Kaufman): →1 trending, →0 choppy
	Slope           float64 // sign of the regression slope
}

// RegimeConfig holds the deterministic thresholds. All are explicit so a change
// is auditable and versioned; no magic numbers hide in the classifier.
type RegimeConfig struct {
	MinSamples          int // fewer → Unknown (fail closed)
	TrendEffRatioMinBps Bps // efficiency ratio above this ⇒ trending (e.g. 4000 = 0.40)
	HighVolRatioBps     Bps // realized/baseline at/above this ⇒ high vol (e.g. 15000 = 1.5x)
	CrisisVolRatioBps   Bps // …⇒ crisis (e.g. 30000 = 3.0x)
	LowVolRatioBps      Bps // at/below this ⇒ low vol (e.g. 6000 = 0.6x)
	IlliquidBelowBps    Bps // liquidity score below this ⇒ illiquid (0 disables)
}

// DefaultConfig is a reasonable, conservative starting point. These are DEFAULTS
// to be tuned per market/venue in the validation phase — not tuned parameters.
func DefaultConfig() RegimeConfig {
	return RegimeConfig{
		MinSamples: 30, TrendEffRatioMinBps: 4000, HighVolRatioBps: 15_000,
		CrisisVolRatioBps: 30_000, LowVolRatioBps: 6000, IlliquidBelowBps: 3000,
	}
}

// RegimeInputs are the point-in-time series + liquidity for one instrument. The
// caller supplies validated, point-in-time-correct data (§9); this package does
// no fetching and assumes no look-ahead.
type RegimeInputs struct {
	Prices            []float64 // recent close prices, oldest→newest
	Returns           []float64 // recent per-period returns (len == len(Prices)-1 typically)
	BaselineVolBps    Bps       // longer-run realized vol for the ratio (0 ⇒ use in-sample)
	LiquidityScoreBps Bps       // 0..10000; higher = deeper. 0 with IlliquidBelowBps>0 ⇒ illiquid
}

// StrategyDecl is a strategy's declaration of the regimes it is valid in (§6:
// "each strategy declares the regimes it is valid in"). The eligibility filter is
// the ONLY way a strategy is switched on.
type StrategyDecl struct {
	Name         string
	ValidRegimes []Regime
}

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
