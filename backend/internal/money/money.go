// Package money is the single place where amounts change representation.
//
// NGN accounting stays in integer kobo (the finance ledger's unit). Crypto and
// any financial computation use shopspring/decimal, quantized to each asset's
// atomic precision. Conversions between the two go through this package only,
// with one rounding vocabulary, so every module agrees on how a fraction of a
// kobo or a satoshi is treated.
package money

import (
	"errors"
	"fmt"
	"math"

	"github.com/shopspring/decimal"
)

var (
	// ErrOverflow is returned when a result would leave the int64 kobo range.
	ErrOverflow = errors.New("money: amount overflows int64 kobo range")
	// ErrNotPositive is returned for an amount that must be greater than zero.
	ErrNotPositive = errors.New("money: amount must be positive")
	// ErrPrecision is returned when a value is finer than an asset's precision.
	ErrPrecision = errors.New("money: value exceeds asset precision")
)

// Rounding is how a fraction beyond the target precision is resolved.
type Rounding int

const (
	// RoundDown truncates toward negative infinity. Use for amounts the user receives.
	RoundDown Rounding = iota
	// RoundUp rounds toward positive infinity. Use for amounts the user pays (gross-up).
	RoundUp
	// RoundNearest rounds half away from zero. Use for display-only values.
	RoundNearest
)

// Kobo is an NGN amount in integer kobo (1 NGN = 100 kobo).
type Kobo int64

// Add returns k+o, failing closed on overflow.
func (k Kobo) Add(o Kobo) (Kobo, error) {
	if (o > 0 && k > math.MaxInt64-o) || (o < 0 && k < math.MinInt64-o) {
		return 0, ErrOverflow
	}
	return k + o, nil
}

// Sub returns k-o, failing closed on overflow.
func (k Kobo) Sub(o Kobo) (Kobo, error) {
	if o == math.MinInt64 {
		return 0, ErrOverflow
	}
	return k.Add(-o)
}

// Decimal returns the amount in NGN major units, exactly.
func (k Kobo) Decimal() decimal.Decimal {
	return decimal.New(int64(k), -2)
}

// String renders NGN major units with two decimal places, e.g. "1234.50".
func (k Kobo) String() string {
	return k.Decimal().StringFixed(2)
}

// KoboFromNGN converts an NGN decimal to kobo. It is the only supported path
// from a decimal NGN amount into the ledger.
func KoboFromNGN(ngn decimal.Decimal, mode Rounding) (Kobo, error) {
	kobo, err := roundTo(ngn.Shift(2), 0, mode)
	if err != nil {
		return 0, err
	}
	if kobo.GreaterThan(decimal.NewFromInt(math.MaxInt64)) || kobo.LessThan(decimal.NewFromInt(math.MinInt64)) {
		return 0, ErrOverflow
	}
	return Kobo(kobo.IntPart()), nil
}

// Asset is a crypto asset's atomic precision as reported by the provider's market
// config. Precision is loaded, never hardcoded.
type Asset struct {
	Code     string
	Decimals int32
}

// NewAsset validates and returns an Asset.
func NewAsset(code string, decimals int32) (Asset, error) {
	if code == "" {
		return Asset{}, errors.New("money: asset code required")
	}
	if decimals < 0 || decimals > 18 {
		return Asset{}, fmt.Errorf("money: decimals %d out of range 0..18", decimals)
	}
	return Asset{Code: code, Decimals: decimals}, nil
}

// Quantize rounds d to the asset's precision using mode. Use it when a rounded
// value is the intended result (for example a quote); use Validate when a value
// must already be exact.
func (a Asset) Quantize(d decimal.Decimal, mode Rounding) (decimal.Decimal, error) {
	return roundTo(d, a.Decimals, mode)
}

// Validate reports whether d is positive and exactly representable at the
// asset's precision. It never rounds, so a value can't be silently truncated.
func (a Asset) Validate(d decimal.Decimal) error {
	if !d.IsPositive() {
		return ErrNotPositive
	}
	if !d.Equal(d.Truncate(a.Decimals)) {
		return ErrPrecision
	}
	return nil
}

func roundTo(d decimal.Decimal, places int32, mode Rounding) (decimal.Decimal, error) {
	switch mode {
	case RoundDown:
		return d.RoundFloor(places), nil
	case RoundUp:
		return d.RoundCeil(places), nil
	case RoundNearest:
		return d.Round(places), nil
	default:
		return decimal.Zero, fmt.Errorf("money: unknown rounding mode %d", mode)
	}
}
