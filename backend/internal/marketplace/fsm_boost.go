package marketplace

import "net/http"

// Boost FSM (§2.4). Explicit guarded transitions only.
//
//	purchased            → active (auto on purchase) | rejected_with_reason
//	active               → completed (ends_at passed) | rejected_with_reason
//	rejected_with_reason → auto_refunded (automatic refund ledger tx)
//	(terminal: completed, auto_refunded)

var boostTransitions = map[BoostStatus]map[BoostStatus]bool{
	BoostPurchased: {
		BoostActive:             true,
		BoostRejectedWithReason: true,
	},
	BoostActive: {
		BoostCompleted:          true,
		BoostRejectedWithReason: true,
	},
	BoostRejectedWithReason: {
		BoostAutoRefunded: true,
	},
	// terminals
	BoostCompleted:    {},
	BoostAutoRefunded: {},
}

// canBoostTransition reports whether from → to is a legal boost edge.
func canBoostTransition(from, to BoostStatus) bool {
	return boostTransitions[from][to]
}

// guardBoostTransition returns a typed error when from → to is illegal.
func guardBoostTransition(from, to BoostStatus) error {
	if !canBoostTransition(from, to) {
		return &CodedError{
			Status:  http.StatusConflict,
			Code:    CodeInvalidBoostTransition,
			Message: "illegal boost transition " + string(from) + " → " + string(to),
		}
	}
	return nil
}

// BoostTier is one resolved, purchasable boost — either a preset package
// (mkt_boost_packages, admin-editable via ADM-002) or a synthesized "custom"
// entry priced by the admin-set ₦/day rate (ComputeBoostQuote in
// service_boost.go resolves either shape into this same struct so
// postBoostCharge/postBoostRefund need not know which).
type BoostTier struct {
	Tier         string  `json:"tier"`
	DurationDays int     `json:"duration_days"`
	PriceKobo    int64   `json:"price_kobo"`
	Weight       float64 `json:"weight"` // additive boost_weight in ES function_score (§4)
}
