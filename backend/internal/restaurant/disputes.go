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

// foodRefundKobo computes the refund a resolution owes the customer, PURELY. full →
// the order total; partial → the requested amount, which must be strictly between 0 and
// the total (a full-value "partial" must use refund_full; 0 must use dismissed);
// replacement/dismissed → 0. Fails closed on an unknown resolution or an out-of-range
// partial so a dispute can never refund more than the order was worth.
func foodRefundKobo(res FoodDisputeResolution, requestedKobo, orderTotalKobo int64) (int64, error) {
	switch res {
	case FoodRefundFull:
		return orderTotalKobo, nil
	case FoodRefundPartial:
		if requestedKobo <= 0 || requestedKobo >= orderTotalKobo {
			return 0, fmt.Errorf("%w: partial refund must be between 1 and %d kobo", ErrDisputeInvalid, orderTotalKobo-1)
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
