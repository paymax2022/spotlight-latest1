package settlement

import (
	"fmt"
	"time"
)

// Status tracks a settlement's lifecycle.
type Status string

const (
	StatusEscrowed   Status = "escrowed"
	StatusReleasing  Status = "releasing"
	StatusSettled    Status = "settled"
	StatusDisputed   Status = "disputed"
	StatusRefunded   Status = "refunded"
)

// Settlement represents a single escrowed amount that will be split on completion.
type Settlement struct {
	ID             string    `json:"id"`
	Reference      string    `json:"reference"`       // links to the originating order/event/appointment
	ModuleType     string    `json:"module_type"`     // food | transport | events | telemedicine | crowdfunding
	PayerID        string    `json:"payer_id"`        // user who paid
	TotalKobo      int64     `json:"total_kobo"`
	FeeKobo        int64     `json:"fee_kobo"`        // Paymax platform commission
	ProviderKobo   int64     `json:"provider_kobo"`   // amount destined to the provider (merchant/rider/doctor/etc.)
	Status         Status    `json:"status"`
	EscrowedAt     time.Time `json:"escrowed_at"`
	SettledAt      *time.Time `json:"settled_at,omitempty"`
	IdempotencyKey string    `json:"idempotency_key"`
}

// Split defines how a settlement is divided. Validated: TotalKobo == sum of all parts.
type Split struct {
	ProviderID  string  `json:"provider_id"`   // merchant / driver / doctor user ID
	ProviderPct float64 `json:"provider_pct"`  // e.g. 0.80 = 80%
	PlatformPct float64 `json:"platform_pct"`  // e.g. 0.10 = 10%
	RiderID     *string `json:"rider_id,omitempty"`
	RiderPct    float64 `json:"rider_pct,omitempty"`
	// TipKobo is a fixed, whole-kobo amount paid 100% to the rider ON TOP of the
	// percentage split — it is NOT part of the percentages (those apply to the
	// non-tip base = total − tip). Defaults to 0, which reproduces the pure
	// percentage split exactly (backward-compatible for every non-tipping caller).
	// A tip requires a rider; Validate rejects a tip with no RiderID.
	TipKobo int64 `json:"tip_kobo,omitempty"`
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
	sum := s.ProviderPct + s.PlatformPct
	if s.RiderID != nil {
		sum += s.RiderPct
	}
	if sum < 1.0-splitEpsilon || sum > 1.0+splitEpsilon {
		return fmt.Errorf("settlement: split must sum to 1.0, got %.6f", sum)
	}
	return nil
}
