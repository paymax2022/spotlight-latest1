package fractionalre

import "math"

// scopedIdemKey namespaces a client-supplied Idempotency-Key to this module and
// the acting user. The UNIQUE indexes it lands in — fre_subscriptions,
// fre_secondary_orders, fre_secondary_listings, fre_distributions,
// fre_distribution_payments, the shared settlements table and the ledger
// journal key — are all GLOBAL, so a raw client key collides across users and
// across every module that also passes it through unchanged. A cross-user
// collision previously returned the other user's row, or (in the window
// between the escrow debit and the row insert) let the second caller record a
// subscription/order paid for by the first caller's escrow.
func scopedIdemKey(actorID, clientKey string) string {
	return moduleType + ":" + actorID + ":" + clientKey
}

// mulKobo is the checked integer-kobo multiply for units*price and similar.
// Both operands must be positive; an overflowing product fails closed instead
// of wrapping into a small or negative amount that would defeat the
// ticket-range and income-cap checks downstream.
func mulKobo(a, b int64) (int64, error) {
	if a <= 0 || b <= 0 || a > math.MaxInt64/b {
		return 0, ErrAmountOverflow
	}
	return a * b, nil
}

// mulDivKobo computes a*b/c with the multiply checked before the divide —
// used for fee and pro-rata distribution lines. A wrapped product would shrink
// a fee or payout line below its true value, so it fails closed.
func mulDivKobo(a, b, c int64) (int64, error) {
	if c <= 0 {
		return 0, ErrAmountOverflow
	}
	if a == 0 || b == 0 {
		return 0, nil
	}
	if a < 0 || b < 0 || a > math.MaxInt64/b {
		return 0, ErrAmountOverflow
	}
	return a * b / c, nil
}
