// Package regime deterministically classifies the market state (§5 agent 2, §6).
// The regime GATES which strategy families are even eligible — a mean-reversion
// strategy must not run in a strong trend, a breakout strategy must not run in a
// dead range, and NOTHING runs in a crisis/illiquid/unknown regime. Pure,
// reproducible, no I/O, no randomness, no LLM: same inputs → same label, always.
//
// Fail-closed: too little data, or a degenerate series, classifies as Unknown,
// which makes EVERY strategy ineligible. When the state is unclear, don't trade.
package regime

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
	Regime           Regime
	Trend            TrendState
	Vol              VolState
	Illiquid         bool
	// Diagnostics (for explainability / audit — never used to size).
	RealizedVolBps   Bps
	VolRatioBps      Bps     // realized / baseline (10000 = 1.0x)
	EfficiencyRatio  float64 // 0..1 (Kaufman): →1 trending, →0 choppy
	Slope            float64 // sign of the regression slope
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
