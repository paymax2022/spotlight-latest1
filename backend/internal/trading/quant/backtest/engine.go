package backtest

import (
	"math"
)

// Run executes an event-driven backtest over a single-instrument close-price
// series. A decision made on bar i (using prices[:i+1]) FILLS on bar i+1 — modelled
// via a one-bar pending queue, so there is no look-ahead in the decision OR the
// fill. Fills clear at the bar's mid price; frictions (fee + slippage + funding)
// are charged as EXPLICIT kobo costs so P&L is clean and every cost lands in
// TotalCost/CostDrag. Deterministic: same prices + same DecisionFunc → same Result.
func Run(prices []float64, cfg Config, decide DecisionFunc) Result {
	res := Result{}
	if len(prices) < 2 || cfg.StartEquityKobo <= 0 || decide == nil {
		return res
	}
	if cfg.Warmup < 0 {
		cfg.Warmup = 0
	}

	realizedKobo := cfg.StartEquityKobo // cash: reduced by costs, increased by realized P&L

	// Open position (single instrument).
	var (
		pos        Dir = Flat
		entryPrice float64
		notional   int64
		units      float64
		stopPrice  float64
		tradeCost  int64 // costs accrued on the currently-open trade (entry + funding so far)
	)

	unrealized := func(price float64) int64 {
		if pos == Flat {
			return 0
		}
		if pos == Long {
			return int64(math.Round(units * (price - entryPrice)))
		}
		return int64(math.Round(units * (entryPrice - price)))
	}
	openCost := func(n int64) int64 {
		return FeeKobo(n, cfg.FeeBps) + SlippageKobo(n, cfg.ADVKobo, cfg.SlippageBps, cfg.ImpactBps)
	}
	// close the open position at `price` for `reason`, realizing P&L and exit costs.
	closePosition := func(price float64, reason string) {
		gross := unrealized(price)
		exitCost := openCost(notional)
		realizedKobo += gross - exitCost
		res.TotalCostKobo += exitCost
		res.Trades = append(res.Trades, Trade{
			Dir: pos, EntryPrice: entryPrice, ExitPrice: price, NotionalKobo: notional,
			PnLKobo:    gross - tradeCost - exitCost,
			CostKobo:   tradeCost + exitCost,
			ExitReason: reason,
		})
		pos, entryPrice, notional, units, stopPrice, tradeCost = Flat, 0, 0, 0, 0, 0
	}
	openPosition := func(dir Dir, n int64, price float64, stopBps Bps) {
		if dir == Flat || n <= 0 || price <= 0 {
			return
		}
		c := openCost(n)
		realizedKobo -= c
		res.TotalCostKobo += c
		pos, entryPrice, notional, units, tradeCost = dir, price, n, float64(n)/price, c
		if stopBps > 0 {
			if dir == Long {
				stopPrice = price * (1 - stopBps.Frac())
			} else {
				stopPrice = price * (1 + stopBps.Frac())
			}
		} else {
			stopPrice = 0
		}
	}

	var pending *Target // set on bar i, executed on bar i+1

	for i := cfg.Warmup; i < len(prices); i++ {
		price := prices[i]

		// A. Execute the pending decision from the previous bar (fill at THIS price).
		if pending != nil {
			t := *pending
			pending = nil
			if t.Dir != pos {
				if pos != Flat {
					closePosition(price, "signal")
				}
				if t.Dir != Flat {
					openPosition(t.Dir, t.NotionalKobo, price, t.StopDistanceBps)
				}
			}
		}

		// B. Protective stop (approximated on close for a single-series backtest).
		if pos != Flat && stopPrice > 0 {
			if (pos == Long && price <= stopPrice) || (pos == Short && price >= stopPrice) {
				closePosition(stopPrice, "stop")
			}
		}

		// C. Funding cost for holding this bar.
		if pos != Flat {
			f := FundingKobo(notional, cfg.FundingBpsPerBar)
			realizedKobo -= f
			res.TotalCostKobo += f
			tradeCost += f
		}

		// D. Decide for next bar (uses only prices up to and including i).
		tgt := decide(i, prices[:i+1])
		pending = &tgt

		// E. Mark-to-market equity at this bar.
		res.EquityCurveKobo = append(res.EquityCurveKobo, realizedKobo+unrealized(price))
	}

	// Force-close any open position at the last price; reflect in the final point.
	if pos != Flat {
		closePosition(prices[len(prices)-1], "end")
		if n := len(res.EquityCurveKobo); n > 0 {
			res.EquityCurveKobo[n-1] = realizedKobo
		}
	}

	res.Metrics = ComputeMetrics(res.EquityCurveKobo, res.Trades, res.TotalCostKobo, cfg)
	return res
}

// Conservative cost models (§11). Every cost rounds UP (kobo) — the simulator must
// never flatter a strategy by under-charging. Optimistic costs are the leading
// cause of live underperformance, so slippage and impact are modelled pessimistically.

// FeeKobo is the taker fee on a fill of the given notional.
func FeeKobo(notionalKobo int64, feeBps Bps) int64 {
	return ceilKobo(float64(notionalKobo) * feeBps.Frac())
}

// SlippageKobo is the adverse slippage on a fill: a base component plus a
// market-impact component that grows with participation (notional / ADV). Both
// are charged as a cost regardless of trade direction (you always cross the spread
// against yourself). ADVKobo == 0 disables the impact term.
func SlippageKobo(notionalKobo, advKobo int64, baseBps, impactBps Bps) int64 {
	slipBps := baseBps.Frac()
	if advKobo > 0 && impactBps > 0 {
		participation := float64(notionalKobo) / float64(advKobo)
		if participation > 1 {
			participation = 1 // cap the modelled impact at the full-ADV rate
		}
		slipBps += impactBps.Frac() * participation
	}
	return ceilKobo(float64(notionalKobo) * slipBps)
}

// FundingKobo is the perp funding cost charged on a held notional for one bar.
// Modelled as always a COST (worst case for the holder), never a rebate.
func FundingKobo(notionalKobo int64, fundingBpsPerBar Bps) int64 {
	if fundingBpsPerBar <= 0 {
		return 0
	}
	return ceilKobo(float64(notionalKobo) * fundingBpsPerBar.Frac())
}

func ceilKobo(v float64) int64 {
	if !finite(v) || v <= 0 {
		return 0
	}
	return int64(math.Ceil(v))
}
func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

// Bps is a rate in basis points (1 bp = 0.01%).
type Bps int64

func (b Bps) Frac() float64 { return float64(b) / 10_000.0 }

// Dir is the desired position direction from a decision.
type Dir string

const (
	Flat  Dir = "flat"
	Long  Dir = "long"
	Short Dir = "short"
)

// Target is what a decision wants the position to BE at a bar (not an order): a
// direction, a notional in kobo (0 with Flat), and a protective-stop distance.
// The engine diffs this against the current position and executes the change.
type Target struct {
	Dir             Dir
	NotionalKobo    int64
	StopDistanceBps Bps
}

// DecisionFunc is the strategy under test. It receives the bar index and the price
// history UP TO AND INCLUDING that bar (prices[:i+1]) — never the future — and
// returns the desired position. In production this callback wraps
// regime-classify → signals → risk.Screen; here it is injected so the engine is
// testable in isolation.
type DecisionFunc func(i int, pricesSoFar []float64) Target

// Config parameterizes a run. Costs are all conservative/pessimistic.
type Config struct {
	StartEquityKobo  int64
	FeeBps           Bps     // per-side taker fee
	SlippageBps      Bps     // base adverse slippage per fill
	ImpactBps        Bps     // extra slippage proportional to participation (size/ADV)
	ADVKobo          int64   // average daily volume proxy for impact (0 ⇒ no impact term)
	FundingBpsPerBar Bps     // perp funding cost charged on notional each bar held
	Warmup           int     // bars to skip before trading (indicator warmup)
	PeriodsPerYear   float64 // annualization factor (e.g. 365 for daily crypto)
}

// Trade is one round-trip (entry→exit) with its realized economics.
type Trade struct {
	Dir          Dir
	EntryPrice   float64
	ExitPrice    float64
	NotionalKobo int64
	PnLKobo      int64  // net of costs
	CostKobo     int64  // fees + slippage + funding attributed to this trade
	ExitReason   string // "signal" | "stop" | "end"
}

// Result is the full backtest output.
type Result struct {
	EquityCurveKobo []int64
	Trades          []Trade
	TotalCostKobo   int64
	Metrics         Metrics
}

// Metrics are the risk-adjusted performance measures (§11). Risk-adjusted and
// drawdown-aware measures outrank raw return.
type Metrics struct {
	FinalEquityKobo int64
	ReturnBps       Bps // total return over the run
	CAGRBps         Bps // annualized
	SharpeBps       Bps // annualized Sharpe * 10000 (so 12000 = 1.2)
	SortinoBps      Bps
	CalmarBps       Bps
	MaxDrawdownBps  Bps
	UlcerIndexBps   Bps
	ProfitFactorBps Bps // grossProfit/grossLoss * 10000
	WinRateBps      Bps
	ExpectancyKobo  int64 // mean trade P&L
	TailRatioBps    Bps
	TurnoverBps     Bps // traded notional / avg equity
	CostDragBps     Bps // total costs / start equity
	NumTrades       int
}
