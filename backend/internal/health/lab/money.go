package healthlab

import (
	"errors"
	"math"
)

// Payment/cart money errors (TS-13). Amounts are integer minor units (kobo) — no
// floats anywhere on the money path.
var (
	ErrNegativeLinePrice = errors.New("lab: line price must not be negative")
	ErrTotalOverflow     = errors.New("lab: order total overflows")
)

// sumLineKobo sums integer minor-unit (kobo) line prices exactly (PM-008/PM-011:
// cart totals are exact with no drift). It rejects a negative line price (which
// could silently offset the total) and guards against int64 overflow (no
// wrap-around). The catalog is the source of prices; this is the server-side total.
func sumLineKobo(prices []int64) (int64, error) {
	var total int64
	for _, p := range prices {
		if p < 0 {
			return 0, ErrNegativeLinePrice
		}
		if total > math.MaxInt64-p {
			return 0, ErrTotalOverflow
		}
		total += p
	}
	return total, nil
}
