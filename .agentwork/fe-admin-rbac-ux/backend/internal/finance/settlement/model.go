package settlement

import "time"

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
}
