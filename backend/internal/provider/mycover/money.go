package mycover

import (
	"fmt"
	"math/big"
	"regexp"
)

// ════════════════════════════════════════════════════════════════════════════
// MONEY BOUNDARY — naira (provider) → kobo (Paymax)
// ════════════════════════════════════════════════════════════════════════════
//
// MyCover speaks NAIRA as decimal STRINGS ("6000.0000", "0.5", "10817.0000").
// Paymax's iron rule is INTEGER KOBO. This file is the ONLY place that crossing
// happens, and it happens exactly once per value, on the way in.
//
// Implementation rule: exact decimal arithmetic via math/big (big.Rat / big.Int).
// A float64 is NEVER used as an intermediate — float64(0.46)*100 is
// 45.99999999999999 and float64(1.04)*100 is 103.99999999999999, which is
// precisely the drift that turns a rate table into a money bug.
//
// ROUNDING RULE (single rule, applied everywhere in this file):
//
//	ROUND HALF-UP (ties away from zero) to the target integer unit.
//
// Inputs are non-negative, so "away from zero" == "up". Half-up is chosen over
// bankers' rounding because it is the rule a human reconciling a premium against
// MyCover's own displayed figure will apply, and over ceiling because ceiling
// would systematically over-collect from members. The maximum divergence from
// the provider on any single premium is 0.5 kobo.
//
// FAIL CLOSED: anything that is not a plain non-negative decimal literal is
// rejected with an error. We never fall back to a guessed amount.

// decimalRe matches a plain non-negative decimal literal, e.g. "0", "0.5",
// "6000.0000". It deliberately rejects the other forms big.Rat.SetString
// accepts — "1/3" (rational) and "1e5" (exponent) — because a money field
// arriving in either form means the provider contract changed and we must stop,
// not interpret.
var decimalRe = regexp.MustCompile(`^[0-9]+(\.[0-9]+)?$`)

// kobosPerNaira is the minor-unit scale.
var (
	kobosPerNaira = big.NewInt(100)
	bpsPerPercent = big.NewInt(100)
	bpsDivisor    = big.NewInt(10_000) // basis points → fraction
	bigTwo        = big.NewInt(2)
)

// parseDecimal converts a validated decimal string to an exact rational. No
// float64 is involved at any point.
func parseDecimal(s string) (*big.Rat, error) {
	if s == "" {
		return nil, fmt.Errorf("mycover: empty decimal amount")
	}
	if !decimalRe.MatchString(s) {
		return nil, fmt.Errorf("mycover: %q is not a plain non-negative decimal", s)
	}
	r, ok := new(big.Rat).SetString(s)
	if !ok {
		return nil, fmt.Errorf("mycover: cannot parse decimal %q", s)
	}
	return r, nil
}

// ratRoundHalfUp rounds an exact non-negative rational to the nearest integer,
// ties away from zero. Pure big.Int arithmetic: floor((2n + d) / 2d).
func ratRoundHalfUp(r *big.Rat) *big.Int {
	num := new(big.Int).Set(r.Num())
	den := new(big.Int).Set(r.Denom())
	// 2n + d
	n2 := new(big.Int).Mul(num, bigTwo)
	n2.Add(n2, den)
	// 2d
	d2 := new(big.Int).Mul(den, bigTwo)
	q := new(big.Int)
	// Div is Euclidean (floor for positive divisor), which is what we want:
	// all inputs here are non-negative.
	q.Div(n2, d2)
	return q
}

// NairaToKobo converts a MyCover naira decimal string to integer kobo, rounding
// half-up at the kobo. This is the adapter boundary conversion — call it once,
// on the way in, and never convert again downstream.
func NairaToKobo(naira string) (int64, error) {
	r, err := parseDecimal(naira)
	if err != nil {
		return 0, err
	}
	r = new(big.Rat).Mul(r, new(big.Rat).SetInt(kobosPerNaira))
	k := ratRoundHalfUp(r)
	if !k.IsInt64() {
		return 0, fmt.Errorf("mycover: naira amount %q overflows int64 kobo", naira)
	}
	return k.Int64(), nil
}

// RateToBps converts a MyCover percentage rate string (base_price when
// is_percentage is true, e.g. "0.46" meaning 0.46% of the sum insured) to
// integer BASIS POINTS, rounding half-up at the basis point.
//
// Every rate in the live 68-product catalog is exact at bps precision
// (0.2500, 0.46, 0.5, 0.65, 0.9, 1, 1.04, 2.15, 2.5, 5, 7 → 25…700 bps), so
// rounding is a guard against a future rate, not a live lossy path.
func RateToBps(rate string) (int64, error) {
	r, err := parseDecimal(rate)
	if err != nil {
		return 0, err
	}
	r = new(big.Rat).Mul(r, new(big.Rat).SetInt(bpsPerPercent))
	b := ratRoundHalfUp(r)
	if !b.IsInt64() {
		return 0, fmt.Errorf("mycover: rate %q overflows int64 bps", rate)
	}
	return b.Int64(), nil
}

// PremiumFromRateBps computes the premium in kobo for a percentage-priced
// product: premium = sum_insured × rate, with rate expressed in basis points.
//
//	premium_kobo = round_half_up(sum_insured_kobo × rate_bps / 10_000)
//
// big.Int throughout: sum_insured_kobo × rate_bps can exceed int64 for large
// covers (₦100m at 700bps is 7×10^12 before the divide), so the multiply is done
// in arbitrary precision and only the result is narrowed.
func PremiumFromRateBps(sumInsuredKobo, rateBps int64) int64 {
	if sumInsuredKobo <= 0 || rateBps <= 0 {
		return 0
	}
	num := new(big.Int).Mul(big.NewInt(sumInsuredKobo), big.NewInt(rateBps))
	r := new(big.Rat).SetFrac(num, bpsDivisor)
	k := ratRoundHalfUp(r)
	if !k.IsInt64() {
		// Unreachable for any real cover amount; clamp rather than wrap silently.
		return 0
	}
	return k.Int64()
}

// CommissionFromPercent computes a commission slice in kobo from a WHOLE-PERCENT
// string as it appears in MyCover's sharing_formula (distributor_commission: 10
// means 10%), rounding half-up at the kobo.
//
// An empty or unparseable percent yields 0 — we never guess a revenue figure.
func CommissionFromPercent(baseKobo int64, percent string) int64 {
	if baseKobo <= 0 {
		return 0
	}
	p, err := parseDecimal(percent)
	if err != nil {
		return 0
	}
	// baseKobo × percent / 100
	r := new(big.Rat).Mul(new(big.Rat).SetInt64(baseKobo), p)
	r = new(big.Rat).Quo(r, new(big.Rat).SetInt(kobosPerNaira))
	k := ratRoundHalfUp(r)
	if !k.IsInt64() {
		return 0
	}
	return k.Int64()
}
