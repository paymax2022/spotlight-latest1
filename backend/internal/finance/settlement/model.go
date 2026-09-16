package settlement

import (
	"fmt"
	"time"
)

// Status tracks a settlement's lifecycle.
type Status string

const (
	StatusEscrowed  Status = "escrowed"
	StatusReleasing Status = "releasing"
	StatusSettled   Status = "settled"
	StatusDisputed  Status = "disputed"
	StatusRefunded  Status = "refunded"
)

// Settlement represents a single escrowed amount that will be split on completion.
type Settlement struct {
	ID             string     `json:"id"`
	Reference      string     `json:"reference"`   // links to the originating order/event/appointment
	ModuleType     string     `json:"module_type"` // food | transport | events | telemedicine | crowdfunding
	PayerID        string     `json:"payer_id"`    // user who paid
	TotalKobo      int64      `json:"total_kobo"`
	FeeKobo        int64      `json:"fee_kobo"`      // Paymax platform commission
	ProviderKobo   int64      `json:"provider_kobo"` // amount destined to the provider (merchant/rider/doctor/etc.)
	Status         Status     `json:"status"`
	EscrowedAt     time.Time  `json:"escrowed_at"`
	SettledAt      *time.Time `json:"settled_at,omitempty"`
	IdempotencyKey string     `json:"idempotency_key"`
}

// Split defines how a settlement is divided. Validated: TotalKobo == sum of all parts.
type Split struct {
	ProviderID  string  `json:"provider_id"`  // merchant / driver / doctor user ID
	ProviderPct float64 `json:"provider_pct"` // e.g. 0.80 = 80%
	PlatformPct float64 `json:"platform_pct"` // e.g. 0.10 = 10%
	RiderID     *string `json:"rider_id,omitempty"`
	RiderPct    float64 `json:"rider_pct,omitempty"`
	// TipKobo is a fixed, whole-kobo amount paid 100% to the rider ON TOP of the
	// percentage split — it is NOT part of the percentages (those apply to the
	// non-tip base = total − tip). Defaults to 0, which reproduces the pure
	// percentage split exactly (backward-compatible for every non-tipping caller).
	// A tip requires a rider; Validate rejects a tip with no RiderID.
	TipKobo int64 `json:"tip_kobo,omitempty"`
	// DiscountKobo is a promo discount already reflected in the escrowed total (the
	// payer paid total = gross − discount [+ tip]). The percentages apply to the
	// PRE-discount gross, and the discount is borne entirely by ONE party:
	//   - DiscountFundedByPlatform == true  → subtracted from the platform leg
	//     (the marketplace ate it; provider + rider settle on the full gross).
	//   - DiscountFundedByPlatform == false → borne by the provider (it falls out of
	//     the provider remainder; platform + rider are unaffected).
	// The rider never funds a discount. Defaults to 0, reproducing the pure split.
	DiscountKobo             int64 `json:"discount_kobo,omitempty"`
	DiscountFundedByPlatform bool  `json:"discount_funded_by_platform,omitempty"`
	// ServiceFeeKobo is a fixed, whole-kobo platform service fee paid 100% to the
	// platform ON TOP of the percentage split — the mirror of TipKobo (which is 100%
	// rider). It is NOT part of the percentages (those apply to the pre-discount
	// gross = total − tip − serviceFee + discount). Defaults to 0, reproducing the
	// pure split. Non-negative; tip + serviceFee may not exceed the escrowed total.
	ServiceFeeKobo int64 `json:"service_fee_kobo,omitempty"`
	// ProviderFeeKobo is a fixed, whole-kobo amount paid 100% to the PROVIDER on top
	// of the percentage split — the provider-side mirror of ServiceFeeKobo (100%
	// platform) and TipKobo (100% rider). It is NOT part of the percentages (those
	// apply to gross = total − tip − serviceFee − providerFee + discount).
	//
	// For a pass-through cost the provider actually bears, so that the platform and
	// the rider take no cut of it — the same reason a restaurant takes no cut of a
	// rider's tip. First caller: restaurant takeaway packaging, where the restaurant
	// buys the packs.
	//
	// Defaults to 0, reproducing the pure split exactly for every existing caller.
	// Non-negative; tip + serviceFee + providerFee may not exceed the escrowed total.
	ProviderFeeKobo int64 `json:"provider_fee_kobo,omitempty"`
}

// SplitLegs is what each party receives from an escrowed total, in whole kobo.
type SplitLegs struct {
	ProviderKobo int64
	PlatformKobo int64
	RiderKobo    int64
}

// ComputeLegs divides an escrowed total between provider, platform and rider.
//
// This is the ONE definition of the split arithmetic: Service.Settle calls it to
// move the money, and the tests call it to check the money. It used to live
// inline in Settle with a second copy in split_invariant_test.go — and a formula
// that grades its own homework proves only that the copy matches, not that either
// is right, so a change to the production expression could not fail the test.
//
// The percentages apply to the pre-discount GROSS, not to the escrowed total.
// Three fixed legs sit inside that total and are removed before the percentages
// are taken, then handed whole to their party:
//
//	tip         → 100% rider
//	serviceFee  → 100% platform
//	providerFee → 100% provider
//
//	base  = total − tip − serviceFee − providerFee
//	gross = base + discount
//
// The provider's leg is the REMAINDER (total − platform − rider), so providerFee
// reaches it without a separate term: whatever the other two legs do not take is
// the provider's. A promo discount is borne by exactly one party — platform-funded
// comes off the platform leg, otherwise it falls out of the provider remainder.
// The rider never funds a discount.
//
// With every fixed leg at 0 and no discount, gross == base == total and this is
// the pure percentage split, unchanged for callers that set none of them.
func ComputeLegs(totalKobo int64, s Split) (SplitLegs, error) {
	if err := s.Validate(); err != nil {
		return SplitLegs{}, err
	}
	// Fixed legs larger than what was escrowed would drive the gross negative and
	// pay out money nobody put in. Fail closed.
	if s.TipKobo+s.ServiceFeeKobo+s.ProviderFeeKobo > totalKobo {
		return SplitLegs{}, fmt.Errorf(
			"settlement: tip %d + service fee %d + provider fee %d exceed escrowed total %d",
			s.TipKobo, s.ServiceFeeKobo, s.ProviderFeeKobo, totalKobo)
	}

	base := totalKobo - s.TipKobo - s.ServiceFeeKobo - s.ProviderFeeKobo
	gross := base + s.DiscountKobo

	platformKobo := int64(float64(gross)*s.PlatformPct) + s.ServiceFeeKobo
	if s.DiscountFundedByPlatform {
		platformKobo -= s.DiscountKobo
	}
	riderKobo := int64(0)
	if s.RiderID != nil {
		riderKobo = int64(float64(gross)*s.RiderPct) + s.TipKobo
	}
	providerKobo := totalKobo - platformKobo - riderKobo

	// A discount larger than its funder's gross share must never silently invert a
	// payout into a debt.
	if platformKobo < 0 || riderKobo < 0 || providerKobo < 0 {
		return SplitLegs{}, fmt.Errorf(
			"settlement: split produced a negative leg (provider=%d platform=%d rider=%d) — discount too large for the funder",
			providerKobo, platformKobo, riderKobo)
	}
	return SplitLegs{ProviderKobo: providerKobo, PlatformKobo: platformKobo, RiderKobo: riderKobo}, nil
}

// splitEpsilon tolerates float rounding (configs store pct as floats like 0.80).
const splitEpsilon = 1e-6

// Validate enforces the money invariant that the percentage split sums to exactly
// 1.0 (within float epsilon) at settlement time, and that no share is negative.
// The rider share only counts when a rider is present. Provider share is computed
// as the remainder in Settle (so kobo always balances), but a malformed split
// could otherwise drive the provider's kobo negative — this catches that up front.
func (s Split) Validate() error {
	if s.ProviderPct < 0 || s.PlatformPct < 0 || s.RiderPct < 0 {
		return fmt.Errorf("settlement: split percentages must be non-negative")
	}
	// The tip is a fixed rider leg: it must be non-negative and can only be paid when
	// a rider is present (there is no one else it may be attributed to). The tip ≤ total
	// bound is enforced in Settle, where the escrowed total is known.
	if s.TipKobo < 0 {
		return fmt.Errorf("settlement: tip must be non-negative")
	}
	if s.TipKobo > 0 && s.RiderID == nil {
		return fmt.Errorf("settlement: tip requires a rider")
	}
	// A promo discount is non-negative. That it does not drive any leg negative (a too-
	// large platform-funded discount, or a too-large provider-funded one) is enforced in
	// Settle, where the gross and each leg's kobo are known.
	if s.DiscountKobo < 0 {
		return fmt.Errorf("settlement: discount must be non-negative")
	}
	if s.ServiceFeeKobo < 0 {
		return fmt.Errorf("settlement: service fee must be non-negative")
	}
	// A negative provider fee would inflate the gross the percentages price and
	// quietly pay the platform and rider more than the order was worth.
	if s.ProviderFeeKobo < 0 {
		return fmt.Errorf("settlement: provider fee must be non-negative")
	}
	sum := s.ProviderPct + s.PlatformPct
	if s.RiderID != nil {
		sum += s.RiderPct
	}
	if sum < 1.0-splitEpsilon || sum > 1.0+splitEpsilon {
		return fmt.Errorf("settlement: split must sum to 1.0, got %.6f", sum)
	}
	return nil
}
