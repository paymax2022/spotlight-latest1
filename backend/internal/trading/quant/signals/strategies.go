package signals

import (
	"fmt"
	"math"
	"slices"
	"spotlight/backend/internal/trading/quant/regime"
)

// Context is the point-in-time input a strategy sees: the asset, its price prefix
// (oldest→newest, up to and including "now"), and the classified regime. A
// strategy must read ONLY these — no globals, no clock, no future data.
type Context struct {
	Asset  string
	Prices []float64
	Regime regime.RegimeState
}

// Strategy is a rule-based candidate generator that declares the regimes it is
// valid in (§6). It emits candidates only; it never sizes or orders.
type Strategy interface {
	Name() string
	ValidRegimes() []regime.Regime
	Generate(ctx Context) []Candidate
}

// GenerateCandidates runs every ELIGIBLE strategy and returns their candidates.
// Eligibility is doubly gated: the regime must be tradeable AND the strategy must
// declare the current regime valid. A non-tradeable regime (Unknown/Crisis/
// Illiquid) yields NOTHING — fail-closed.
func GenerateCandidates(ctx Context, catalog []Strategy) []Candidate {
	if !ctx.Regime.Tradeable() {
		return nil
	}
	var out []Candidate
	for _, s := range catalog {
		if !regimeAllowed(ctx.Regime.Regime, s.ValidRegimes()) {
			continue
		}
		out = append(out, s.Generate(ctx)...)
	}
	return out
}

func regimeAllowed(r regime.Regime, valid []regime.Regime) bool {
	return slices.Contains(valid, r)
}

// Long when the fast EMA is above the slow EMA and the regime trend is up (and
// RSI is not blow-off overbought); symmetric short. Confidence scales with the
// EMA separation; stop is a multiple of ATR.
type TrendFollow struct {
	FastN, SlowN, RSIN, ATRMult int
	SepScale                    float64 // EMA-separation (as a fraction) that saturates confidence
}

func NewTrendFollow() TrendFollow {
	return TrendFollow{FastN: 10, SlowN: 30, RSIN: 14, ATRMult: 2, SepScale: 0.05}
}
func (TrendFollow) Name() string                  { return "trend_follow" }
func (TrendFollow) ValidRegimes() []regime.Regime { return []regime.Regime{regime.Trending} }
func (s TrendFollow) Generate(ctx Context) []Candidate {
	p := ctx.Prices
	if len(p) < s.SlowN+1 {
		return nil
	}
	fast, slow := EMA(p, s.FastN), EMA(p, s.SlowN)
	if slow == 0 {
		return nil
	}
	sep := (fast - slow) / slow
	rsi := RSI(p, s.RSIN)
	stop := ATRBps(p, s.RSIN) * int64(s.ATRMult)
	up := ctx.Regime.Trend == regime.TrendUp
	down := ctx.Regime.Trend == regime.TrendDown

	if fast > slow && up && rsi < 80 {
		return []Candidate{{
			Strategy: s.Name(), Asset: ctx.Asset, Side: Long,
			ConfidenceBps: confFromMagnitude(sep, s.SepScale), StopDistanceBps: stop,
			Rationale: []string{"fast EMA above slow EMA", "regime trend up", fmt.Sprintf("RSI %.0f (not blow-off)", rsi)},
		}}
	}
	if fast < slow && down && rsi > 20 {
		return []Candidate{{
			Strategy: s.Name(), Asset: ctx.Asset, Side: Short,
			ConfidenceBps: confFromMagnitude(-sep, s.SepScale), StopDistanceBps: stop,
			Rationale: []string{"fast EMA below slow EMA", "regime trend down", fmt.Sprintf("RSI %.0f", rsi)},
		}}
	}
	return nil
}

// Long when price is oversold (z-score below −threshold); short when overbought.
// Confidence scales with the z-score magnitude.
type MeanReversion struct {
	N, ATRMult int
	ZThreshold float64
	ZScale     float64
}

func NewMeanReversion() MeanReversion {
	return MeanReversion{N: 20, ATRMult: 2, ZThreshold: 1.5, ZScale: 3.0}
}
func (MeanReversion) Name() string                  { return "mean_reversion" }
func (MeanReversion) ValidRegimes() []regime.Regime { return []regime.Regime{regime.Ranging} }
func (s MeanReversion) Generate(ctx Context) []Candidate {
	p := ctx.Prices
	if len(p) < s.N+1 {
		return nil
	}
	z := ZScore(p, s.N)
	stop := ATRBps(p, s.N) * int64(s.ATRMult)
	if z <= -s.ZThreshold {
		return []Candidate{{
			Strategy: s.Name(), Asset: ctx.Asset, Side: Long,
			ConfidenceBps: confFromMagnitude(-z, s.ZScale), StopDistanceBps: stop,
			Rationale: []string{fmt.Sprintf("z-score %.2f (oversold)", z), "range regime"},
		}}
	}
	if z >= s.ZThreshold {
		return []Candidate{{
			Strategy: s.Name(), Asset: ctx.Asset, Side: Short,
			ConfidenceBps: confFromMagnitude(z, s.ZScale), StopDistanceBps: stop,
			Rationale: []string{fmt.Sprintf("z-score %.2f (overbought)", z), "range regime"},
		}}
	}
	return nil
}

// Long when price closes above the prior N-period high by a buffer; short below
// the prior N-period low. Confidence scales with how far beyond the level.
type Breakout struct {
	N, ATRMult int
	BufferBps  int64
	MagScale   float64 // fractional break beyond the level that saturates confidence
}

func NewBreakout() Breakout {
	return Breakout{N: 20, ATRMult: 2, BufferBps: 10, MagScale: 0.03}
}
func (Breakout) Name() string { return "breakout" }
func (Breakout) ValidRegimes() []regime.Regime {
	return []regime.Regime{regime.Trending, regime.HighVol}
}
func (s Breakout) Generate(ctx Context) []Candidate {
	p := ctx.Prices
	if len(p) < s.N+2 {
		return nil
	}
	last := p[len(p)-1]
	hh := HighestHigh(p, s.N, true) // prior N high (excludes current)
	ll := LowestLow(p, s.N, true)
	buf := float64(s.BufferBps) / 10_000
	stop := ATRBps(p, s.N) * int64(s.ATRMult)

	if hh > 0 && last > hh*(1+buf) {
		return []Candidate{{
			Strategy: s.Name(), Asset: ctx.Asset, Side: Long,
			ConfidenceBps: confFromMagnitude((last-hh)/hh, s.MagScale), StopDistanceBps: stop,
			Rationale: []string{fmt.Sprintf("broke above %d-period high", s.N), "trend/high-vol regime"},
		}}
	}
	if ll > 0 && last < ll*(1-buf) {
		return []Candidate{{
			Strategy: s.Name(), Asset: ctx.Asset, Side: Short,
			ConfidenceBps: confFromMagnitude((ll-last)/ll, s.MagScale), StopDistanceBps: stop,
			Rationale: []string{fmt.Sprintf("broke below %d-period low", s.N), "trend/high-vol regime"},
		}}
	}
	return nil
}

// DefaultCatalog is the starter strategy set (each independently regime-tagged).
func DefaultCatalog() []Strategy {
	return []Strategy{NewTrendFollow(), NewMeanReversion(), NewBreakout()}
}

// Side is a candidate's direction.
type Side string

const (
	Long  Side = "long"
	Short Side = "short"
)

// Candidate is a PROPOSED setup — never an order. It carries a deterministic
// confidence and a suggested protective-stop distance, plus a structured rationale
// for explainability (§15). The risk package turns confidence + stop into a size
// (or a veto); the committee selects among candidates. This type deliberately has
// NO size, price, or quantity field.
type Candidate struct {
	Strategy        string
	Asset           string
	Side            Side
	ConfidenceBps   int64    // deterministic signal strength, 0..10000
	StopDistanceBps int64    // suggested stop distance in bps of price
	Rationale       []string // human-readable evidence, for the explanation record
}

// confFromMagnitude maps a non-negative signal magnitude to a confidence in bps,
// linearly saturating at `scale` (magnitude >= scale → 10000). Deterministic and
// clamped; a non-finite or non-positive magnitude → 0.
func confFromMagnitude(magnitude, scale float64) int64 {
	if !finite(magnitude) || magnitude <= 0 || scale <= 0 {
		return 0
	}
	c := magnitude / scale
	if c > 1 {
		c = 1
	}
	return int64(math.Round(c * 10_000))
}

// SMA is the simple moving average of the last n values. Returns 0 for n<=0 or
// insufficient data.
func SMA(xs []float64, n int) float64 {
	if n <= 0 || len(xs) < n {
		return 0
	}
	var s float64
	for _, x := range xs[len(xs)-n:] {
		s += x
	}
	return s / float64(n)
}

// EMA is the exponential moving average with span n (smoothing 2/(n+1)), seeded
// with the SMA of the first n points. Returns 0 for insufficient data.
func EMA(xs []float64, n int) float64 {
	if n <= 0 || len(xs) < n {
		return 0
	}
	k := 2.0 / (float64(n) + 1)
	ema := SMA(xs[:n], n)
	for _, x := range xs[n:] {
		ema = x*k + ema*(1-k)
	}
	return ema
}

// RSI is Wilder's Relative Strength Index over n periods (0..100). 50 is neutral;
// >70 overbought, <30 oversold. Returns 50 (neutral) for insufficient data or a
// flat series (fail-neutral — never a false extreme).
func RSI(prices []float64, n int) float64 {
	if n <= 0 || len(prices) < n+1 {
		return 50
	}
	var gain, loss float64
	for i := len(prices) - n; i < len(prices); i++ {
		d := prices[i] - prices[i-1]
		if d > 0 {
			gain += d
		} else {
			loss -= d
		}
	}
	if loss == 0 {
		if gain == 0 {
			return 50
		}
		return 100
	}
	rs := (gain / float64(n)) / (loss / float64(n))
	return 100 - 100/(1+rs)
}

// ATRBps is a close-only average-true-range proxy: the mean absolute period
// return over n periods, in bps of the latest price. A range/vol proxy for stop
// sizing. Returns 0 for insufficient data.
func ATRBps(prices []float64, n int) int64 {
	if n <= 0 || len(prices) < n+1 {
		return 0
	}
	var sum float64
	for i := len(prices) - n; i < len(prices); i++ {
		sum += math.Abs(prices[i] - prices[i-1])
	}
	atr := sum / float64(n)
	last := prices[len(prices)-1]
	if last == 0 {
		return 0
	}
	return int64(math.Round(atr / last * 10_000))
}

// ZScore is (last − SMA_n) / stddev_n over the last n values — how many standard
// deviations the latest value sits from its recent mean. Returns 0 for
// insufficient data or a zero-variance window.
func ZScore(xs []float64, n int) float64 {
	if n <= 1 || len(xs) < n {
		return 0
	}
	win := xs[len(xs)-n:]
	m := meanF(win)
	sd := stddevF(win)
	if sd == 0 {
		return 0
	}
	z := (xs[len(xs)-1] - m) / sd
	if !finite(z) {
		return 0
	}
	return z
}

// HighestHigh / LowestLow over the last n values (excluding the current point when
// exclCurrent is true — for a genuine breakout test against PRIOR extremes).
func HighestHigh(prices []float64, n int, exclCurrent bool) float64 {
	end := len(prices)
	if exclCurrent {
		end--
	}
	if n <= 0 || end < n {
		return 0
	}
	hi := prices[end-n]
	for _, p := range prices[end-n : end] {
		if p > hi {
			hi = p
		}
	}
	return hi
}

func LowestLow(prices []float64, n int, exclCurrent bool) float64 {
	end := len(prices)
	if exclCurrent {
		end--
	}
	if n <= 0 || end < n {
		return 0
	}
	lo := prices[end-n]
	for _, p := range prices[end-n : end] {
		if p < lo {
			lo = p
		}
	}
	return lo
}

func meanF(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	var s float64
	for _, x := range xs {
		s += x
	}
	return s / float64(len(xs))
}
func stddevF(xs []float64) float64 {
	if len(xs) < 2 {
		return 0
	}
	m := meanF(xs)
	var ss float64
	for _, x := range xs {
		d := x - m
		ss += d * d
	}
	return math.Sqrt(ss / float64(len(xs)))
}
func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
