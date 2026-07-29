// Package signals is the deterministic feature store + rule-based strategy library
// of the quant core (§6). Pure, reproducible Go — no I/O, no randomness, no LLM.
//
// Two guarantees make it safe:
//   1. POINT-IN-TIME: every indicator is a function of ONLY the prefix it is given
//      (prices[:t+1]); appending future data can never change a past value. There
//      is no look-ahead (§9, §11).
//   2. CANDIDATES ONLY: strategies emit *candidate setups* (asset, side, a
//      deterministic confidence, a suggested stop) — never a size, price, or order.
//      Sizing and the hard vetoes live in the risk package; selection lives in the
//      (later) committee. This layer proposes; it never disposes.
//
// Fail-closed: an indicator with too little data returns a zero/NaN-free default
// and the strategy simply emits no candidate.
package signals

import "math"

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

// ── helpers ────────────────────────────────────────────────────────────────
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
