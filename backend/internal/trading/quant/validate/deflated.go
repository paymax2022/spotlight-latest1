package validate

import "math"

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
