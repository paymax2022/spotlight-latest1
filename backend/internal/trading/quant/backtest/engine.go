package backtest

import "math"

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
			PnLKobo:  gross - tradeCost - exitCost,
			CostKobo: tradeCost + exitCost,
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
