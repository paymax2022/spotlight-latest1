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
	"math"
	"strings"
)

// Money is the canonical money object: an integer amount in minor units
// (kobo/cents/pence) plus an ISO-4217 currency code.
type Money struct {
	AmountMinor int64  `json:"amount"`
	Currency    string `json:"currency"`
}

// MinorExponent returns the number of minor-unit decimal places for a currency.
// All supported currencies use 2; stablecoins are normalized to 2 for display.
func MinorExponent(currency string) int { return 2 }

// NewMoney builds a Money, normalizing the currency to upper-case.
func NewMoney(amountMinor int64, currency string) Money {
	return Money{AmountMinor: amountMinor, Currency: strings.ToUpper(currency)}
}

// IsZero reports whether the amount is zero.
func (m Money) IsZero() bool { return m.AmountMinor == 0 }

// applyRate converts an integer minor amount in one currency to another using a
// decimal rate (units of `to` per 1 unit of `from`), rounding to the nearest
// minor unit. Both sides share the 2dp minor-unit convention so the rate maps
// minor->minor directly.
func applyRate(sourceMinor int64, rate float64) int64 {
	return int64(math.Round(float64(sourceMinor) * rate))
}

// inverseAmount computes the source minor amount required to yield a target
// minor amount at the given rate (used for destination-pegged quotes).
func inverseAmount(destMinor int64, rate float64) int64 {
	if rate == 0 {
		return 0
	}
	return int64(math.Round(float64(destMinor) / rate))
}

// bpsOf returns `bps` basis points of an integer minor amount, rounded.
func bpsOf(amountMinor int64, bps int) int64 {
	return int64(math.Round(float64(amountMinor) * float64(bps) / 10_000.0))
}
