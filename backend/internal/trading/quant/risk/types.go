// Package risk is the deterministic risk spine of the AI-trading quant core (§8).
//
// EVERYTHING here is pure, reproducible math with no I/O, no randomness, and no
// LLMs — sizing, VaR/CVaR, exposure/leverage/correlation, drawdown de-risking,
// hard limit checks, and circuit breakers. It is the layer that makes the upstream
// reasoning layer safe: the committee may only SELECT among or VETO candidates
// this package has already sized and risk-screened; it never produces a number
// that moves money.
//
// Money conventions: all monetary values are integer NGN kobo (int64). Statistical
// ratios (volatility, correlation, Kelly fraction, VaR as a fraction) are float64
// intermediates. Rounding is deliberately CONSERVATIVE and fail-safe:
//   - position SIZES round DOWN (never over-size);
//   - risk/loss estimates (VaR, CVaR, worst-case) round UP (never understate risk).
// Any invalid input (non-positive equity, empty series, NaN/Inf) fails CLOSED:
// sizing returns 0, checks return a breach. When uncertain, risk nothing.
package risk

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
	Asset       string // e.g. "BTC", "EURUSD"
	Side        Side
	NotionalKobo int64 // signed magnitude of exposure (always >= 0; Side carries sign)
	EntryKobo   int64  // entry price in kobo (per unit) — informational
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
	RealizedTodayKobo   int64
	RealizedWeekKobo    int64
	RealizedMonthKobo   int64
	OpenPositionCount   int
}

// Limits are the user- and platform-defined HARD limits (§8). Any breach BLOCKS
// or unwinds — never a soft warning. A zero value on a limit means "unset / no
// cap" EXCEPT where noted (min confidence, allowed assets, trading window are
// explicit opt-ins). All kobo, all fail-closed.
type Limits struct {
	MaxDailyLossKobo    int64   // max loss allowed today (positive number)
	MaxWeeklyLossKobo   int64
	MaxMonthlyLossKobo  int64
	MaxDrawdownBps      Bps     // max peak-to-trough drawdown
	MaxOpenPositions    int     // max concurrent positions (0 = unset)
	MaxPositionKobo     int64   // hard cap on a single position notional (0 = unset)
	MaxPositionFracBps  Bps     // single position as a fraction of equity (0 = unset)
	MaxGrossLeverageBps Bps     // gross exposure / equity cap (e.g. 20000 = 2.0x)
	MaxCorrelatedFracBps Bps    // cap on summed exposure to a correlated cluster
	MinConfidenceBps    Bps     // minimum aggregate confidence to trade (0 = unset)
	AllowedAssets       []string // if non-empty, only these assets may be traded
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
	Code    string // stable machine code, e.g. "MAX_DAILY_LOSS"
	Detail  string // human-readable, with the offending numbers
}

// DrawdownAction is the staged de-risking response (§8 drawdown ladder): as the
// drawdown deepens the fund reduces size, then hedges, then flattens, then halts.
type DrawdownAction string

const (
	ActNormal DrawdownAction = "normal" // trade within limits
	ActReduce DrawdownAction = "reduce" // scale new/size down
	ActHedge  DrawdownAction = "hedge"  // hedge open risk, no new directional risk
	ActFlat   DrawdownAction = "flatten" // close to cash
	ActHalt   DrawdownAction = "halt"   // stop entirely until reviewed
)
