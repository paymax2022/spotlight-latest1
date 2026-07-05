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

// BoostTier is one purchasable boost catalog entry.
type BoostTier struct {
	Tier         string  `json:"tier"`
	DurationDays int     `json:"duration_days"`
	PriceKobo    int64   `json:"price_kobo"`
	Weight       float64 `json:"weight"` // additive boost_weight in ES function_score (§4)
}

// BoostTiers is the frozen boost catalog (§1 mkt_boosts.tier enum values).
var BoostTiers = []BoostTier{
	{Tier: "start", DurationDays: 7, PriceKobo: 50000, Weight: 1.0},
	{Tier: "vip", DurationDays: 14, PriceKobo: 200000, Weight: 2.0},
	{Tier: "vip_gold", DurationDays: 30, PriceKobo: 500000, Weight: 3.0},
	{Tier: "diamond", DurationDays: 30, PriceKobo: 1500000, Weight: 5.0},
	{Tier: "enterprise", DurationDays: 60, PriceKobo: 5000000, Weight: 8.0},
}

// lookupBoostTier returns the catalog entry for a tier, or (zero,false).
func lookupBoostTier(tier string) (BoostTier, bool) {
	for _, t := range BoostTiers {
		if t.Tier == tier {
			return t, true
		}
	}
	return BoostTier{}, false
}
