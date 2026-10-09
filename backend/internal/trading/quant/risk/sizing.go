package risk

import (
	"math"
	"slices"
)

// Sizing (§8): size by volatility target and/or fractional-Kelly, then apply hard
// caps, confidence scaling, and reduce-before-increase. Every function fails
// CLOSED (returns 0) on invalid input, and every kobo result rounds DOWN so the
// engine can never over-size. Size shrinks in high-vol / low-confidence regimes.

// SizeVolTarget returns the position notional (kobo) whose expected volatility
// equals targetVolBps of equity, given the instrument's own annualized vol. A
// more volatile instrument gets a smaller notional. instrumentVolBps <= 0 is
// "unknown" and fails closed (0 — never guess a size on unknown risk).
func SizeVolTarget(equityKobo int64, targetVolBps, instrumentVolBps Bps) int64 {
	if equityKobo <= 0 || targetVolBps <= 0 || instrumentVolBps <= 0 {
		return 0
	}
	notional := float64(equityKobo) * targetVolBps.Frac() / instrumentVolBps.Frac()
	return floorKobo(notional)
}

// KellyFraction is the full-Kelly optimal fraction for a bet with win probability
// winProb (0..1) and payoff ratio b (win size / loss size). f* = (p(b+1)-1)/b.
// Returns 0 for a non-positive-edge or malformed bet (fail closed). Clamped to
// [0,1] — full Kelly never implies leverage here.
func KellyFraction(winProb, payoffRatio float64) float64 {
	if !finite(winProb) || !finite(payoffRatio) || winProb <= 0 || winProb >= 1 || payoffRatio <= 0 {
		return 0
	}
	f := (winProb*(payoffRatio+1) - 1) / payoffRatio
	if f <= 0 {
		return 0 // no edge → no bet
	}
	return clamp01(f)
}

// FractionalKelly returns the notional (kobo) from a FRACTION of full Kelly
// (kellyFraction, e.g. 0.25 for quarter-Kelly) with a hard fraction ceiling
// (maxFracBps of equity). Fractional Kelly is standard practice — full Kelly is
// too aggressive and assumes perfectly known edge. kellyFraction is clamped to
// [0,1]; a non-positive Kelly edge yields 0.
func FractionalKelly(equityKobo int64, winProb, payoffRatio, kellyFraction float64, maxFracBps Bps) int64 {
	if equityKobo <= 0 {
		return 0
	}
	kf := KellyFraction(winProb, payoffRatio)
	if kf <= 0 {
		return 0
	}
	frac := kf * clamp01(kellyFraction)
	if maxFracBps > 0 {
		frac = math.Min(frac, maxFracBps.Frac())
	}
	return floorKobo(float64(equityKobo) * frac)
}

// ConfidenceScale scales a proposed size by aggregate confidence: linearly from
// minConfidence (→ 0) to full confidence (→ full size). Below minConfidence the
// trade is refused (0). This makes low-confidence regimes automatically smaller.
// minConfidenceBps == 0 means "no floor" and confidence still scales the size.
func ConfidenceScale(sizeKobo int64, confidenceBps, minConfidenceBps Bps) int64 {
	if sizeKobo <= 0 || confidenceBps <= 0 {
		return 0
	}
	if minConfidenceBps > 0 && confidenceBps < minConfidenceBps {
		return 0 // below the user's minimum confidence → no trade
	}
	c := clamp01(confidenceBps.Frac())
	return floorKobo(float64(sizeKobo) * c)
}

// ApplyCaps returns the largest notional that respects every BINDING cap in
// SizeCaps (a 0 cap is not binding). This is the hard ceiling — a proposed size
// can only be reduced here, never increased.
func ApplyCaps(proposedKobo int64, caps SizeCaps) int64 {
	if proposedKobo <= 0 {
		return 0
	}
	out := proposedKobo
	for _, cap := range []int64{caps.MaxPositionKobo, caps.MaxByEquityFracKobo, caps.MaxByLeverageKobo} {
		if cap > 0 && cap < out {
			out = cap
		}
	}
	if out < 0 {
		return 0
	}
	return out
}

// CapsFromLimits precomputes the per-position SizeCaps from the fund's limits and
// current state: the absolute cap, the equity-fraction cap, and the remaining
// headroom under the gross-leverage cap (so a new position can't push gross
// leverage past MaxGrossLeverage).
func CapsFromLimits(lim Limits, st PortfolioState) SizeCaps {
	var caps SizeCaps
	caps.MaxPositionKobo = lim.MaxPositionKobo
	if lim.MaxPositionFracBps > 0 && st.EquityKobo > 0 {
		caps.MaxByEquityFracKobo = floorKobo(float64(st.EquityKobo) * lim.MaxPositionFracBps.Frac())
	}
	if lim.MaxGrossLeverageBps > 0 && st.EquityKobo > 0 {
		maxGross := floorKobo(float64(st.EquityKobo) * lim.MaxGrossLeverageBps.Frac())
		headroom := max(maxGross-GrossExposureKobo(st), 0)
		caps.MaxByLeverageKobo = headroom
	}
	return caps
}

// ReduceBeforeIncrease encodes the "reduce exposure before adding on uncertainty"
// rule (§8 / original Rule 5): when uncertainty is rising, an increase is refused
// — the position may only stay flat or shrink. Returns the permitted notional.
func ReduceBeforeIncrease(currentKobo, proposedKobo int64, uncertaintyRising bool) int64 {
	if proposedKobo < 0 {
		return 0
	}
	if uncertaintyRising && proposedKobo > currentKobo {
		return currentKobo // no adds while uncertainty rises
	}
	return proposedKobo
}

func floorKobo(v float64) int64 {
	if !finite(v) || v <= 0 {
		return 0
	}
	return int64(math.Floor(v))
}
func ceilKobo(v float64) int64 {
	if !finite(v) || v <= 0 {
		return 0
	}
	return int64(math.Ceil(v))
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

// Bps is a rate in basis points (1 bp = 0.01%). Used for vol targets, fees, and
// limit thresholds so callers never pass raw floats for rates.
type Bps int64

// Frac returns the basis-point rate as a float fraction (250 bps -> 0.025).
func (b Bps) Frac() float64 { return float64(b) / 10_000.0 }

// Side is a position direction.
type Side string

const (
	Long  Side = "long"
	Short Side = "short"
)

// Position is one open position, valued in kobo, with the exposure metadata the
// portfolio/correlation checks need.
type Position struct {
	Asset        string // e.g. "BTC", "EURUSD"
	Side         Side
	NotionalKobo int64 // signed magnitude of exposure (always >= 0; Side carries sign)
	EntryKobo    int64 // entry price in kobo (per unit) — informational
	// AnnualVolBps is the instrument's annualized volatility in bps (from the
	// feature store); used by sizing and VaR. 0 is treated as "unknown" → fail-closed.
	AnnualVolBps Bps
}

// SignedNotional returns +notional for Long, -notional for Short.
func (p Position) SignedNotional() int64 {
	if p.Side == Short {
		return -p.NotionalKobo
	}
	return p.NotionalKobo
}

// PortfolioState is the fund's live risk state, all in kobo. It is the input to
// every limit check and to leverage/exposure/drawdown math.
type PortfolioState struct {
	EquityKobo     int64      // current mark-to-market equity (NAV * units, in kobo)
	PeakEquityKobo int64      // high-water equity for drawdown (>= EquityKobo normally)
	Positions      []Position // currently open positions
	// Realized P&L windows (negative = loss), for daily/weekly/monthly loss limits.
	RealizedTodayKobo int64
	RealizedWeekKobo  int64
	RealizedMonthKobo int64
	OpenPositionCount int
}

// Limits are the user- and platform-defined HARD limits (§8). Any breach BLOCKS
// or unwinds — never a soft warning. A zero value on a limit means "unset / no
// cap" EXCEPT where noted (min confidence, allowed assets, trading window are
// explicit opt-ins). All kobo, all fail-closed.
type Limits struct {
	MaxDailyLossKobo     int64 // max loss allowed today (positive number)
	MaxWeeklyLossKobo    int64
	MaxMonthlyLossKobo   int64
	MaxDrawdownBps       Bps      // max peak-to-trough drawdown
	MaxOpenPositions     int      // max concurrent positions (0 = unset)
	MaxPositionKobo      int64    // hard cap on a single position notional (0 = unset)
	MaxPositionFracBps   Bps      // single position as a fraction of equity (0 = unset)
	MaxGrossLeverageBps  Bps      // gross exposure / equity cap (e.g. 20000 = 2.0x)
	MaxCorrelatedFracBps Bps      // cap on summed exposure to a correlated cluster
	MinConfidenceBps     Bps      // minimum aggregate confidence to trade (0 = unset)
	AllowedAssets        []string // if non-empty, only these assets may be traded
}

// SizeCaps are the hard ceilings applied to any proposed size, derived from Limits
// + equity. All in kobo; a 0 cap means "not binding" for that dimension.
type SizeCaps struct {
	MaxPositionKobo     int64 // absolute per-position cap
	MaxByEquityFracKobo int64 // MaxPositionFrac * equity, precomputed
	MaxByLeverageKobo   int64 // headroom under the gross-leverage cap
}

// Breach is one violated limit (the veto evidence). A non-empty []Breach is an
// absolute block.
type Breach struct {
	Code   string // stable machine code, e.g. "MAX_DAILY_LOSS"
	Detail string // human-readable, with the offending numbers
}

// DrawdownAction is the staged de-risking response (§8 drawdown ladder): as the
// drawdown deepens the fund reduces size, then hedges, then flattens, then halts.
type DrawdownAction string

const (
	ActNormal DrawdownAction = "normal"  // trade within limits
	ActReduce DrawdownAction = "reduce"  // scale new/size down
	ActHedge  DrawdownAction = "hedge"   // hedge open risk, no new directional risk
	ActFlat   DrawdownAction = "flatten" // close to cash
	ActHalt   DrawdownAction = "halt"    // stop entirely until reviewed
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
	slices.Sort(sorted)
	// tail = the worst (1−confidence) fraction of outcomes.
	alpha := 1 - clamp01(confidenceBps.Frac())
	k := max(int(math.Floor(alpha*float64(n))),
		// always include at least the single worst outcome
		1)
	var sum float64
	for i := range k {
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
	slices.Sort(sorted)
	alpha := 1 - clamp01(confidenceBps.Frac())
	// lower-tail index (conservative: floor, and never below 0).
	idx := max(int(math.Floor(alpha*float64(n))), 0)
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
