// Package orchestration implements the Paymax FX orchestration layer: a
// provider-agnostic normalized API (quotes, conversions, transfers, collections)
// on top of a smart order router, spread engine, treasury and unified ledger.
//
// Design invariants (apply everywhere):
//   - Money is always {amount: integer minor units, currency: ISO-4217}. Never floats for storage.
//   - Every mutating request carries an Idempotency-Key.
//   - The caller is provider-agnostic; routing is internal.
//   - Quote -> (lock) -> execute against a quote_id; a price is never assumed stable.
//   - One ledger is the source of truth.
package orchestration

import (
	"math/big"
	"strings"
)

// Money is the canonical money object: an integer amount in minor units
// (kobo/cents/pence) plus an ISO-4217 currency code.
type Money struct {
	AmountMinor int64  `json:"amount"`
	Currency    string `json:"currency"`
}

// MinorExponent returns the number of minor-unit decimal places for a currency,
// read from the authoritative currency registry (CU-002). Unknown currencies
// default to 2 (the safe fiat default) so callers never divide by an unknown
// scale; SupportedCurrency gates real conversions before this matters.
func MinorExponent(currency string) int {
	if c, ok := currencyRegistry[strings.ToUpper(currency)]; ok {
		return c.Exponent
	}
	return 2
}

// NewMoney builds a Money, normalizing the currency to upper-case.
func NewMoney(amountMinor int64, currency string) Money {
	return Money{AmountMinor: amountMinor, Currency: strings.ToUpper(currency)}
}

// IsZero reports whether the amount is zero.
func (m Money) IsZero() bool { return m.AmountMinor == 0 }

// applyRate converts an integer minor amount to another currency at `rate` when
// both sides share the same minor-unit exponent (2dp fiat). Retained for the
// same-precision fast path and existing callers/tests; cross-precision callers
// must use convertMinor, which respects each currency's exponent.
func applyRate(sourceMinor int64, rate float64) int64 {
	if rate <= 0 {
		return 0
	}
	return roundRatHalfEven(new(big.Rat).Mul(new(big.Rat).SetInt64(sourceMinor), ratFromFloat(rate)))
}

// inverseAmount computes the source minor amount required to yield a target minor
// amount at the given rate, same-exponent fast path (see applyRate).
func inverseAmount(destMinor int64, rate float64) int64 {
	if rate <= 0 {
		return 0
	}
	q := new(big.Rat).Quo(new(big.Rat).SetInt64(destMinor), ratFromFloat(rate))
	return roundRatHalfEven(q)
}

// convertMinor converts an integer minor amount from `source` to `dest` currency
// at `rate` (dest-major units per 1 source-major unit), respecting each
// currency's minor-unit exponent and rounding half-even to the dest precision.
//
// Precision-safe across differing exponents (USD 2dp -> JPY 0dp, JPY 0dp -> BTC
// 8dp): amounts stay integer minor units and the multiply is carried out exactly
// in big.Rat with a single deterministic rounding at the end — no lossy binary
// float on the money path (PR-005). Formula:
//
//	destMinor = round_half_even( sourceMinor * rate * 10^(destExp - srcExp) )
func convertMinor(sourceMinor int64, source, dest string, rate float64) int64 {
	if rate <= 0 {
		return 0
	}
	es, ed := MinorExponent(source), MinorExponent(dest)
	product := new(big.Rat).SetInt64(sourceMinor)
	product.Mul(product, ratFromFloat(rate))
	product.Mul(product, pow10Rat(ed-es))
	return roundRatHalfEven(product)
}

// inverseConvertMinor computes the source minor amount required to yield
// `destMinor` of `dest` at `rate`, respecting both currencies' exponents. Used
// for destination-pegged ("I want exactly X EUR") quotes (QT-009).
//
//	sourceMinor = round_half_even( destMinor / rate * 10^(srcExp - destExp) )
func inverseConvertMinor(destMinor int64, source, dest string, rate float64) int64 {
	if rate <= 0 {
		return 0
	}
	es, ed := MinorExponent(source), MinorExponent(dest)
	q := new(big.Rat).SetInt64(destMinor)
	q.Quo(q, ratFromFloat(rate))
	q.Mul(q, pow10Rat(es-ed))
	return roundRatHalfEven(q)
}

// bpsOf returns `bps` basis points of an integer minor amount, half-even rounded.
// The result is same-currency (spread on the source amount), so exponent-neutral.
func bpsOf(amountMinor int64, bps int) int64 {
	r := new(big.Rat).SetInt64(amountMinor)
	r.Mul(r, big.NewRat(int64(bps), 10_000))
	return roundRatHalfEven(r)
}

// ratFromFloat converts a float64 rate to an exact big.Rat. SetFloat64 captures
// the float's exact binary value (the same value the legacy float path used), so
// results are deterministic; Inf/NaN degrade to zero (guarded by callers).
func ratFromFloat(f float64) *big.Rat {
	if r := new(big.Rat).SetFloat64(f); r != nil {
		return r
	}
	return new(big.Rat)
}

// pow10Rat returns 10^exp as a big.Rat, handling negative exponents (1/10^|exp|).
func pow10Rat(exp int) *big.Rat {
	n := exp
	if n < 0 {
		n = -n
	}
	p := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(n)), nil)
	if exp >= 0 {
		return new(big.Rat).SetInt(p)
	}
	return new(big.Rat).SetFrac(big.NewInt(1), p)
}

// roundRatHalfEven rounds a big.Rat to the nearest integer using banker's
// rounding (round-half-to-even), the deterministic policy for all money
// conversions (PR-004). Half-even avoids the systematic upward bias of
// round-half-up so cumulative rounding residue reconciles (PR-006) and the
// platform never silently gains from rounding.
func roundRatHalfEven(r *big.Rat) int64 {
	n := r.Num()
	d := r.Denom() // normalized: always > 0
	q := new(big.Int)
	m := new(big.Int)
	q.DivMod(n, d, m) // Euclidean: q = floor(n/d), 0 <= m < d
	twoM := new(big.Int).Lsh(m, 1)
	switch twoM.Cmp(d) {
	case -1: // fraction < 0.5 -> round down (toward floor)
		return q.Int64()
	case 1: // fraction > 0.5 -> round up
		return new(big.Int).Add(q, big.NewInt(1)).Int64()
	default: // exactly 0.5 -> round to even
		if q.Bit(0) == 0 {
			return q.Int64()
		}
		return new(big.Int).Add(q, big.NewInt(1)).Int64()
	}
}
