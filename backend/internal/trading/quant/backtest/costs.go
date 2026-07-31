package backtest

import "math"

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
