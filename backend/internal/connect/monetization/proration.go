package connectmonetization

import "time"

// proratedRefundKobo computes the refund (in kobo) for the UNUSED portion of a
// subscription period when it is cancelled immediately at `now`.
//
//	refund = priceKobo * remainingSeconds / totalSeconds   (integer, floored)
//
// It uses integer arithmetic on seconds — never floats (iron rule: money math is
// integer minor units). The result is clamped to [0, priceKobo]: a `now` at/after
// expiry refunds nothing; a `now` at/before period start refunds the whole price.
// Flooring means we never over-refund a partial kobo.
func proratedRefundKobo(priceKobo int64, periodStart, expiresAt, now time.Time) int64 {
	if priceKobo <= 0 || !expiresAt.After(periodStart) {
		return 0
	}
	total := expiresAt.Sub(periodStart).Seconds()
	remaining := expiresAt.Sub(now).Seconds()
	if remaining <= 0 {
		return 0
	}
	if remaining >= total {
		return priceKobo
	}
	// int64 math: priceKobo * remaining / total, computed on whole seconds.
	refund := priceKobo * int64(remaining) / int64(total)
	if refund < 0 {
		return 0
	}
	if refund > priceKobo {
		return priceKobo
	}
	return refund
}
