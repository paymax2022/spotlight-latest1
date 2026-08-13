package restaurant

import (
	"errors"
	"fmt"
	"strings"
)

// Food-dispute domain. A dispute is a formal complaint about a DELIVERED order (wrong/
// missing items, quality, non-delivery). The ticket lives in the shared `disputes`
// table; this module adds order-grounded authorization on raise and the actual
// platform-funded refund on resolution (the shared finance resolve moves no money).

// ErrDisputeInvalid is a client-side dispute error (bad state, amount, or authorization
// for the resolution). The handler maps it to 4xx.
var ErrDisputeInvalid = errors.New("restaurant: dispute cannot be processed")

// FoodDisputeResolution is the reviewer's ruling.
type FoodDisputeResolution string

const (
	FoodRefundFull    FoodDisputeResolution = "refund_full"    // refund the whole order total
	FoodRefundPartial FoodDisputeResolution = "refund_partial" // refund a specified amount (< total)
	FoodReplacement   FoodDisputeResolution = "replacement"    // re-send the order; no cash refund
	FoodDismissed     FoodDisputeResolution = "dismissed"      // no action / not upheld
)

// allowed dispute types for a food order (subset of the shared DisputeType vocabulary).
var foodDisputeTypes = map[string]bool{
	"non_delivery": true,
	"wrong_item":   true,
	"no_show":      true,
	"other":        true,
}

// platformRefundableKobo is the basis a PLATFORM-FUNDED dispute refund is computed on:
// the order total LESS the customer tip. See ADR-030.
//
// A dispute resolves only on a DELIVERED order, i.e. after settlement has already paid
// the rider 100% of the tip (settlement.Split.TipKobo) and there is no provider clawback
// on this path. Refunding the tip-inclusive total would therefore have the platform hand
// the customer money it never held — its own revenue covering the rider's tip. The
// platform refunds only what it actually took in on the order; the tip is refunded
// separately and funded by the RIDER (see tip_clawback.go).
//
// Fails closed: a total that does not cover its own tip (only reachable if orders.tip_kobo
// and orders.total_kobo have diverged) yields no refundable basis at all rather than a
// negative one.
func platformRefundableKobo(orderTotalKobo, tipKobo int64) int64 {
	if tipKobo <= 0 {
		return orderTotalKobo
	}
	if tipKobo >= orderTotalKobo {
		return 0
	}
	return orderTotalKobo - tipKobo
}

// foodRefundKobo computes the platform-funded refund a resolution owes the customer,
// PURELY. full → the whole refundable basis; partial → the requested amount, which must
// be strictly between 0 and that basis (a full-value "partial" must use refund_full; 0
// must use dismissed); replacement/dismissed → 0. Fails closed on an unknown resolution
// or an out-of-range partial so a dispute can never refund more than the platform held.
//
// refundableKobo is platformRefundableKobo(total, tip) — NOT the raw order total. Both
// branches are bounded by the same basis on purpose: the partial branch's ceiling is
// derived from it, so a tip-inclusive basis here would let `refund_partial` refund the
// tip one kobo at a time and reopen the exact exposure refund_full was capped to close.
func foodRefundKobo(res FoodDisputeResolution, requestedKobo, refundableKobo int64) (int64, error) {
	switch res {
	case FoodRefundFull:
		return refundableKobo, nil
	case FoodRefundPartial:
		if refundableKobo <= 1 {
			// No band to sit in: the platform holds nothing refundable on this order
			// (an all-tip order, or diverged tip/total data). Say so plainly rather than
			// rendering "between 1 and -1 kobo".
			return 0, fmt.Errorf("%w: this order has no platform-refundable amount (order total is %d kobo net of the tip)", ErrDisputeInvalid, refundableKobo)
		}
		if requestedKobo <= 0 || requestedKobo >= refundableKobo {
			return 0, fmt.Errorf("%w: partial refund must be between 1 and %d kobo", ErrDisputeInvalid, refundableKobo-1)
		}
		return requestedKobo, nil
	case FoodReplacement, FoodDismissed:
		return 0, nil
	default:
		return 0, fmt.Errorf("%w: unknown resolution %q", ErrDisputeInvalid, res)
	}
}

// foodDisputeResolvable reports whether a dispute in the given (shared-table) status can
// still be resolved. open/investigating are actionable; resolved/closed are terminal.
func foodDisputeResolvable(status string) bool {
	return status == "open" || status == "investigating"
}

// resolutionToDBFields maps a food resolution onto the shared disputes table's
// resolution enum (refund | partial_refund | no_action).
func resolutionToDBFields(res FoodDisputeResolution) string {
	switch res {
	case FoodRefundFull:
		return "refund"
	case FoodRefundPartial:
		return "partial_refund"
	default: // replacement, dismissed
		return "no_action"
	}
}

// validateRaise checks a raise request PURELY: the reporter must be a party to the
// order (customer, owner, or rider — reuses classifyOrderActor), the type must be a
// known food dispute type, and the description must meet the shared table's 20-char
// minimum. Returns nil when the raise is allowed.
func validateRaise(actorID, customer, owner, rider, dtype, description string) error {
	if classifyOrderActor(actorID, customer, owner, rider) == roleNone {
		return fmt.Errorf("%w: only a party to the order may raise a dispute", ErrForbidden)
	}
	if !foodDisputeTypes[dtype] {
		return fmt.Errorf("%w: unknown dispute type %q", ErrDisputeInvalid, dtype)
	}
	if len(strings.TrimSpace(description)) < 20 {
		return fmt.Errorf("%w: description must be at least 20 characters", ErrDisputeInvalid)
	}
	return nil
}
