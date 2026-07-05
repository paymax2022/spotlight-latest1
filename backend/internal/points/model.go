package points

import "time"

// EntryType is the direction of a points-ledger row. Append-only: balance is the
// projection of EARN - REDEEM - EXPIRE (never an updated column).
type EntryType string

const (
	EntryEarn   EntryType = "EARN"
	EntryRedeem EntryType = "REDEEM"
	EntryExpire EntryType = "EXPIRE"
	EntryAdjust EntryType = "ADJUST" // manual correction (admin, audited)
)

// Entry is one immutable points movement. Points are NOT money (NL-4): there is no
// kobo column and no path that converts a points balance to a cash withdrawal.
type Entry struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	Type           EntryType `json:"type"`
	Points         int64     `json:"points"`           // always positive; direction from Type
	RuleKey        string    `json:"rule_key,omitempty"`
	Module         string    `json:"module,omitempty"` // payments | savings | tickets | referral | ...
	Reference      string    `json:"reference"`
	IdempotencyKey string    `json:"idempotency_key"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
}

// EarnRule is a versioned, config-driven earn definition (per action/module). A new
// version supersedes the prior one; historical entries keep the version they earned
// under, so a rule change never rewrites past awards.
type EarnRule struct {
	ID          string    `json:"id"`
	RuleKey     string    `json:"rule_key"`     // e.g. "payments.bill_paid"
	Module      string    `json:"module"`
	Version     int       `json:"version"`
	PointsFixed int64     `json:"points_fixed"` // flat award
	PointsPerKobo float64 `json:"points_per_kobo"` // optional value-scaled award
	ExpiryDays  int       `json:"expiry_days"`  // 0 => never expires
	Active      bool      `json:"active"`
	CreatedAt   time.Time `json:"created_at"`
}

// CatalogItem is a redeemable reward. Redemption only ever targets airtime, bills,
// a ticket discount or a perk (NL-4) — never cash. Fulfilment is delegated to the
// owning module (bill-pay / airtime / ticketing) via the loyalty layer.
type CatalogItem struct {
	ID          string `json:"id"`
	SKU         string `json:"sku"`
	Title       string `json:"title"`
	Kind        string `json:"kind"` // airtime | bill | ticket_discount | perk
	CostPoints  int64  `json:"cost_points"`
	ValueKobo   int64  `json:"value_kobo"`   // notional value for airtime/bill fulfilment (NOT cash-out)
	Active      bool   `json:"active"`
	Metadata    map[string]any `json:"metadata,omitempty"`
}

// Redemption records a points spend against a catalog item.
type Redemption struct {
	ID         string    `json:"id"`
	UserID     string    `json:"user_id"`
	SKU        string    `json:"sku"`
	CostPoints int64     `json:"cost_points"`
	Status     string    `json:"status"` // REDEEMED | FULFILLED | FAILED
	CreatedAt  time.Time `json:"created_at"`
}

// EarnContext carries the data an earn rule scales against (e.g. the kobo amount of
// the underlying transaction) plus the reference that makes the award idempotent.
type EarnContext struct {
	Module    string
	Reference string         // unique business ref of the earning event
	AmountKobo int64         // for value-scaled rules
	Metadata  map[string]any
}
