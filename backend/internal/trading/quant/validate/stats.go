// Package validate is the anti-overfitting validation harness (§11) — the
// PROMOTION GATE that a strategy must clear before any capital. It is intentionally
// hard: most strategies should FAIL. Everything is pure and deterministic
// (Monte-Carlo randomness is seeded and reproducible, §0/§15). Nothing here trades.
package validate

import "math"

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
