// Package validate is the anti-overfitting validation harness (§11) — the
// PROMOTION GATE that a strategy must clear before any capital. It is intentionally
// hard: most strategies should FAIL. Everything is pure and deterministic
// (Monte-Carlo randomness is seeded and reproducible, §0/§15). Nothing here trades.
package validate

import (
	"fmt"
	"math"
	"math/rand"
	"sort"
)

// normCDF is the standard-normal cumulative distribution Φ(x).
func normCDF(x float64) float64 {
	return 0.5 * math.Erfc(-x/math.Sqrt2)
}

// normInvCDF is the inverse standard-normal CDF Φ⁻¹(p) via Acklam's rational
// approximation (|error| < 1.15e-9). Clamps p into (0,1).
func normInvCDF(p float64) float64 {
	if p <= 0 {
		return math.Inf(-1)
	}
	if p >= 1 {
		return math.Inf(1)
	}
	// coefficients
	a := []float64{-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00}
	b := []float64{-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01}
	c := []float64{-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00}
	d := []float64{7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00}
	plow := 0.02425
	phigh := 1 - plow
	switch {
	case p < plow:
		q := math.Sqrt(-2 * math.Log(p))
		return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q + c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q + 1)
	case p <= phigh:
		q := p - 0.5
		r := q * q
		return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r + a[5]) * q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r + 1)
	default:
		q := math.Sqrt(-2 * math.Log(1-p))
		return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q + c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q + 1)
	}
}

// Sharpe is the (non-annualized) Sharpe of a return series: mean/stddev. Returns 0
// for < 2 samples or zero variance.
func Sharpe(returns []float64) float64 {
	if len(returns) < 2 {
		return 0
	}
	m := mean(returns)
	sd := stddev(returns)
	if sd == 0 {
		return 0
	}
	return m / sd
}

// Skew / ExcessKurtosis of a return series (population moments). Used by the
// probabilistic Sharpe correction for non-normal returns.
func Skew(xs []float64) float64 {
	if len(xs) < 3 {
		return 0
	}
	m, sd := mean(xs), stddev(xs)
	if sd == 0 {
		return 0
	}
	var s float64
	for _, x := range xs {
		z := (x - m) / sd
		s += z * z * z
	}
	return s / float64(len(xs))
}

func ExcessKurtosis(xs []float64) float64 {
	if len(xs) < 4 {
		return 0
	}
	m, sd := mean(xs), stddev(xs)
	if sd == 0 {
		return 0
	}
	var s float64
	for _, x := range xs {
		z := (x - m) / sd
		s += z * z * z * z
	}
	return s/float64(len(xs)) - 3
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

// eulerMascheroni is used in the expected-maximum-Sharpe estimate.
const eulerMascheroni = 0.5772156649015329

// ProbabilisticSharpe (PSR): the probability that the true Sharpe exceeds a
// benchmark sr0, given the observed Sharpe, sample length, and the return
// distribution's skew/kurtosis (López de Prado). Returns a probability in [0,1].
//
//	PSR = Φ[ (SR − SR0)·√(n−1) / √(1 − γ3·SR + ((γ4−1)/4)·SR²) ]
//
// skew is γ3; excessKurt is (γ4 − 3), so raw γ4 = excessKurt + 3.
func ProbabilisticSharpe(sr, sr0 float64, nObs int, skew, excessKurt float64) float64 {
	if nObs < 2 {
		return 0
	}
	rawKurt := excessKurt + 3
	denomVar := 1 - skew*sr + (rawKurt-1)/4*sr*sr
	if denomVar <= 0 {
		return 0 // fail closed on a degenerate distribution
	}
	z := (sr - sr0) * math.Sqrt(float64(nObs-1)) / math.Sqrt(denomVar)
	if !finite(z) {
		return 0
	}
	return normCDF(z)
}

// ExpectedMaxSharpe estimates SR0 — the Sharpe you'd expect to see as the MAXIMUM
// of nTrials independent strategies with zero true edge and Sharpe-estimate std
// sharpeStd. This is the hurdle that corrects for multiple testing: trying many
// strategies inflates the best observed Sharpe, and this is how much. nTrials <= 1
// ⇒ 0 (no selection bias).
func ExpectedMaxSharpe(nTrials int, sharpeStd float64) float64 {
	if nTrials <= 1 || sharpeStd <= 0 {
		return 0
	}
	n := float64(nTrials)
	term := (1-eulerMascheroni)*normInvCDF(1-1/n) + eulerMascheroni*normInvCDF(1-1/(n*math.E))
	if !finite(term) {
		return 0
	}
	return sharpeStd * term
}

// DeflatedSharpe (DSR): PSR evaluated against the multiple-testing hurdle
// ExpectedMaxSharpe. It is the probability the observed Sharpe is real AFTER
// accounting for how many strategies were tried. A high DSR (e.g. ≥ 0.95) is the
// bar; a strong in-sample Sharpe found among many trials will have a LOW DSR.
func DeflatedSharpe(sr, sharpeStd float64, nTrials, nObs int, skew, excessKurt float64) float64 {
	sr0 := ExpectedMaxSharpe(nTrials, sharpeStd)
	return ProbabilisticSharpe(sr, sr0, nObs, skew, excessKurt)
}

// SharpeStd is the standard deviation of the Sharpe estimates across the trials —
// the variability the deflation formula needs. Returns 0 for < 2 trials.
func SharpeStd(trialSharpes []float64) float64 { return stddev(trialSharpes) }

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

// The promotion gate (§11/§12): a strategy is promoted toward capital ONLY if it
// clears every predefined threshold on OUT-OF-SAMPLE, cost-inclusive, multiple-
// testing-corrected, robustness-tested metrics. Thresholds MUST be set before
// testing (not fitted afterward). The default posture is REJECT.

// PromotionThresholds are the bars, fixed before validation. A zero on a numeric
// bar means "not required".
type PromotionThresholds struct {
	MinDeflatedSharpe   float64 // e.g. 0.95 — the DSR must clear this (multiple-testing corrected)
	MinOOSSharpeBps     int64   // out-of-sample annualized Sharpe floor (bps, 12000 = 1.2)
	MaxDrawdownBps      int64   // OOS max drawdown ceiling
	MinProfitFactorBps  int64   // e.g. 12500 = 1.25
	MinTrades           int     // a minimum sample so the stats mean something
	RequirePositiveMCP5 bool    // the Monte-Carlo 5th-percentile return must be > 0
}

// EvaluationInputs are the measured, out-of-sample results fed to the gate.
type EvaluationInputs struct {
	DeflatedSharpe     float64
	OOSSharpeBps       int64
	MaxDrawdownBps     int64
	ProfitFactorBps    int64
	NumTrades          int
	MonteCarloReturnP5 float64
}

// Verdict is the gate decision plus the reasons for any rejection (for the audit
// trail — a rejection is as important to record as a pass).
type Verdict struct {
	Pass    bool
	Reasons []string
}

// Evaluate applies the thresholds. It returns Pass only if EVERY required bar is
// cleared; otherwise it lists exactly which bars failed. Fail-closed: missing/
// zeroed inputs against a required bar are failures.
func Evaluate(in EvaluationInputs, thr PromotionThresholds) Verdict {
	var reasons []string

	if thr.MinDeflatedSharpe > 0 && in.DeflatedSharpe < thr.MinDeflatedSharpe {
		reasons = append(reasons, fmt.Sprintf("deflated Sharpe %.3f < %.3f (likely overfit / multiple-testing noise)", in.DeflatedSharpe, thr.MinDeflatedSharpe))
	}
	if thr.MinOOSSharpeBps > 0 && in.OOSSharpeBps < thr.MinOOSSharpeBps {
		reasons = append(reasons, fmt.Sprintf("OOS Sharpe %d < %d bps", in.OOSSharpeBps, thr.MinOOSSharpeBps))
	}
	if thr.MaxDrawdownBps > 0 && in.MaxDrawdownBps > thr.MaxDrawdownBps {
		reasons = append(reasons, fmt.Sprintf("OOS max drawdown %d > %d bps", in.MaxDrawdownBps, thr.MaxDrawdownBps))
	}
	if thr.MinProfitFactorBps > 0 && in.ProfitFactorBps < thr.MinProfitFactorBps {
		reasons = append(reasons, fmt.Sprintf("profit factor %d < %d bps", in.ProfitFactorBps, thr.MinProfitFactorBps))
	}
	if thr.MinTrades > 0 && in.NumTrades < thr.MinTrades {
		reasons = append(reasons, fmt.Sprintf("only %d trades < %d required (insufficient sample)", in.NumTrades, thr.MinTrades))
	}
	if thr.RequirePositiveMCP5 && in.MonteCarloReturnP5 <= 0 {
		reasons = append(reasons, fmt.Sprintf("Monte-Carlo 5th-pctile return %.4f <= 0 (fragile to trade ordering/resampling)", in.MonteCarloReturnP5))
	}

	return Verdict{Pass: len(reasons) == 0, Reasons: reasons}
}

// Data-splitting for leakage-free validation (§11).

// Fold is one purged-k-fold split: disjoint train/test index sets with a purge
// (and embargo) buffer removed from training around the test block.
type Fold struct {
	TrainIdx []int
	TestIdx  []int
}

// PurgedKFold splits [0,n) into k contiguous TEST blocks. For each, the TRAIN set
// is every index NOT within [testStart-purge, testEnd+embargo) — so labels that
// overlap the test window (purge) and a forward buffer (embargo) can't leak into
// training. This is the correct CV for serially-correlated financial data; a plain
// k-fold leaks and overstates performance. Deterministic. Returns nil for bad args.
func PurgedKFold(n, k, purge, embargo int) []Fold {
	if n <= 0 || k <= 1 || k > n {
		return nil
	}
	if purge < 0 {
		purge = 0
	}
	if embargo < 0 {
		embargo = 0
	}
	folds := make([]Fold, 0, k)
	blk := n / k
	for i := range k {
		testStart := i * blk
		testEnd := testStart + blk
		if i == k-1 {
			testEnd = n // last block absorbs the remainder
		}
		lo := testStart - purge
		hi := testEnd + embargo
		var f Fold
		for idx := testStart; idx < testEnd; idx++ {
			f.TestIdx = append(f.TestIdx, idx)
		}
		for idx := range n {
			if idx < lo || idx >= hi {
				f.TrainIdx = append(f.TrainIdx, idx)
			}
		}
		folds = append(folds, f)
	}
	return folds
}

// Window is one rolling walk-forward split (half-open [start,end) index ranges).
type Window struct {
	TrainStart, TrainEnd int
	TestStart, TestEnd   int
}

// WalkForwardWindows produces rolling train→test windows advancing by step. Train
// always PRECEDES its test (no future in training), and successive test segments
// move forward — the strategy must generalize across time, not fit one history.
func WalkForwardWindows(n, train, test, step int) []Window {
	if n <= 0 || train <= 0 || test <= 0 || step <= 0 {
		return nil
	}
	var ws []Window
	for start := 0; start+train+test <= n; start += step {
		ws = append(ws, Window{
			TrainStart: start, TrainEnd: start + train,
			TestStart: start + train, TestEnd: start + train + test,
		})
	}
	return ws
}

// Monte-Carlo robustness (§11): resample the trade sequence many times to get a
// DISTRIBUTION of outcomes, not a single equity curve. Randomness is SEEDED, so a
// run is fully reproducible (§0/§15). Bootstrap WITH replacement varies both the
// total return and the path (and thus the drawdown).

// MCConfig parameterizes the simulation. Seed makes it deterministic.
type MCConfig struct {
	Trials int
	Seed   int64
}

// MCDistribution reports the 5th/50th/95th percentiles of total return (as a
// fraction of start equity) and of max drawdown (fraction) across the trials.
type MCDistribution struct {
	ReturnP5, ReturnP50, ReturnP95 float64
	MaxDDP5, MaxDDP50, MaxDDP95    float64
	Trials                         int
}

// MonteCarloBootstrap resamples the per-trade P&Ls (with replacement) into many
// equity paths and returns the outcome distribution. A strategy whose 5th-
// percentile return is deeply negative or whose 95th-percentile drawdown is severe
// is fragile even if its single historical run looked fine.
func MonteCarloBootstrap(tradePnLKobo []int64, startEquityKobo int64, cfg MCConfig) MCDistribution {
	out := MCDistribution{Trials: cfg.Trials}
	if len(tradePnLKobo) == 0 || startEquityKobo <= 0 || cfg.Trials <= 0 {
		return out
	}
	rng := rand.New(rand.NewSource(cfg.Seed))
	n := len(tradePnLKobo)
	rets := make([]float64, 0, cfg.Trials)
	dds := make([]float64, 0, cfg.Trials)

	for tr := 0; tr < cfg.Trials; tr++ {
		equity := startEquityKobo
		peak := equity
		var maxDD float64
		for range n {
			pnl := tradePnLKobo[rng.Intn(n)] // resample with replacement
			equity += pnl
			if equity > peak {
				peak = equity
			}
			if peak > 0 {
				dd := float64(peak-equity) / float64(peak)
				if dd > maxDD {
					maxDD = dd
				}
			}
		}
		rets = append(rets, float64(equity-startEquityKobo)/float64(startEquityKobo))
		dds = append(dds, maxDD)
	}
	sort.Float64s(rets)
	sort.Float64s(dds)
	out.ReturnP5, out.ReturnP50, out.ReturnP95 = pct(rets, 0.05), pct(rets, 0.50), pct(rets, 0.95)
	out.MaxDDP5, out.MaxDDP50, out.MaxDDP95 = pct(dds, 0.05), pct(dds, 0.50), pct(dds, 0.95)
	return out
}

func pct(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	idx := max(int(math.Floor(p*float64(len(sorted)-1))), 0)
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}
