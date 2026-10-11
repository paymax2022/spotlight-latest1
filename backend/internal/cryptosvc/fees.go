package cryptosvc

import (
	"errors"
	"fmt"
	"strings"

	"github.com/shopspring/decimal"
)

// FeeSchedule is the platform markup in basis points per crypto asset, applied per
// side (buy and sell each pay it). Defaults follow the owner's suggested pricing:
// majors 0.75%, other liquid assets 1.00%, higher-volatility / lower-liquidity assets
// 1.25-1.50% subject to risk and liquidity review. Order-book trading (0.15-0.25% total
// per executed order) is a separate fee on a later slice. It is configuration, not
// policy baked into the money path: callers store the resolved bps on each swap at
// quote time, so a later schedule change never reprices an open swap.
type FeeSchedule struct {
	// Majors are priced at MajorBps. Keys are upper-case asset codes.
	Majors map[string]struct{}
	// MajorBps / OtherBps are the base markups for majors and for every other asset.
	MajorBps, OtherBps int
	// Overrides set an explicit bps for an asset (for example a higher-volatility
	// asset at 125-150). Overrides win over both bases.
	Overrides map[string]int
	// MaxBps is a hard ceiling; a schedule or override above it is rejected.
	MaxBps int
}

// ErrFeeBps is returned for a markup outside [0, MaxBps].
var ErrFeeBps = errors.New("cryptosvc: markup bps out of range")

// DefaultFeeSchedule returns the suggested pricing.
func DefaultFeeSchedule() FeeSchedule {
	return FeeSchedule{
		Majors:   map[string]struct{}{"BTC": {}, "ETH": {}, "USDT": {}, "USDC": {}},
		MajorBps: 75,
		OtherBps: 100,
		MaxBps:   150,
	}
}

// Validate checks every configured rate against the ceiling.
func (f FeeSchedule) Validate() error {
	if f.MaxBps <= 0 {
		return fmt.Errorf("%w: MaxBps must be positive", ErrFeeBps)
	}
	for name, v := range map[string]int{"MajorBps": f.MajorBps, "OtherBps": f.OtherBps} {
		if v < 0 || v > f.MaxBps {
			return fmt.Errorf("%w: %s=%d (max %d)", ErrFeeBps, name, v, f.MaxBps)
		}
	}
	for a, v := range f.Overrides {
		if v < 0 || v > f.MaxBps {
			return fmt.Errorf("%w: override %s=%d (max %d)", ErrFeeBps, a, v, f.MaxBps)
		}
	}
	return nil
}

// Bps returns the markup for a crypto asset code. An invalid schedule fails closed
// (error) rather than quietly charging nothing or too much.
func (f FeeSchedule) Bps(asset string) (int, error) {
	if err := f.Validate(); err != nil {
		return 0, err
	}
	a := strings.ToUpper(strings.TrimSpace(asset))
	if a == "" {
		return 0, errors.New("cryptosvc: asset is required to price a fee")
	}
	if v, ok := f.Overrides[a]; ok {
		return v, nil
	}
	if _, ok := f.Majors[a]; ok {
		return f.MajorBps, nil
	}
	return f.OtherBps, nil
}

// FeeKobo returns floor(ngnKobo * bps / 10000). Flooring favours the customer on the
// last kobo and makes the split exact: fee + (ngnKobo - fee) == ngnKobo.
func FeeKobo(ngnKobo int64, bps int) (int64, error) {
	if ngnKobo <= 0 {
		return 0, errors.New("cryptosvc: fee base must be positive kobo")
	}
	if bps < 0 || bps > 10_000 {
		return 0, ErrFeeBps
	}
	fee := decimal.NewFromInt(ngnKobo).Mul(decimal.NewFromInt(int64(bps))).Div(decimal.NewFromInt(10_000)).Floor()
	if !fee.IsInteger() || fee.GreaterThan(decimal.NewFromInt(ngnKobo)) {
		return 0, errors.New("cryptosvc: fee computation out of range")
	}
	return fee.IntPart(), nil
}
