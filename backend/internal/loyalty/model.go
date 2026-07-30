// Package loyalty wires the points earn-rules to live modules (payments, savings,
// tickets, referral §7A), runs the membership tier engine, and exposes the rewards
// catalog + redemption. It owns NO money primitive and NO points ledger of its own:
// awards go through points.Earn, redemptions through points.Redeem, and reward
// fulfilment is delegated to bill-pay / airtime / ticket-discount (NL-4: never cash).
package loyalty

import "time"

// Tier is the membership level. BLACK is reserved for Phase-3.
type Tier string

const (
	Tier1 Tier = "TIER1"
	Tier2 Tier = "TIER2"
	Tier3 Tier = "TIER3"
	// TierBlack Tier = "BLACK" // P3
)

// Membership is a user's loyalty standing. Lifetime points drive tier; the tier is
// re-evaluated on every earn (monotonic up within P1 — no auto-downgrade mid-period).
type Membership struct {
	UserID         string    `json:"user_id"`
	Tier           Tier      `json:"tier"`
	LifetimePoints int64     `json:"lifetime_points"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// TierDef is the versioned threshold + benefits config for a tier.
type TierDef struct {
	Tier            Tier           `json:"tier"`
	ThresholdPoints int64          `json:"threshold_points"`
	Benefits        map[string]any `json:"benefits"`
	Active          bool           `json:"active"`
}

// EarnRuleBinding maps a live-module action to a points rule key (config-driven so a
// new module event can be wired without code). Mirrors the points earn-rule but at
// the loyalty layer it records WHICH module trigger fires WHICH rule.
type EarnRuleBinding struct {
	ID        string    `json:"id"`
	Module    string    `json:"module"`   // payments | savings | tickets | referral
	Trigger   string    `json:"trigger"`  // e.g. bill_paid, vault_deposit, ticket_purchased, referral_converted
	RuleKey   string    `json:"rule_key"` // -> points_earn_rules.rule_key
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"created_at"`
}

// CatalogItem is a loyalty reward surfaced to members (a view over points catalog
// SKUs that are loyalty-eligible). Kind constrains fulfilment to non-cash rails.
type CatalogItem struct {
	ID         string `json:"id"`
	SKU        string `json:"sku"` // -> points_catalog.sku
	Title      string `json:"title"`
	Kind       string `json:"kind"` // airtime | bill | ticket_discount | perk
	CostPoints int64  `json:"cost_points"`
	MinTier    Tier   `json:"min_tier"` // gate a reward behind a tier
	Active     bool   `json:"active"`
}

// Redemption is the loyalty-side record of a reward claim (points already debited
// by points.Redeem). Fulfilment status tracks the non-cash dispatch.
type Redemption struct {
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	SKU          string    `json:"sku"`
	Kind         string    `json:"kind"`
	CostPoints   int64     `json:"cost_points"`
	FulfilStatus string    `json:"fulfil_status"` // PENDING | FULFILLED | FAILED
	CreatedAt    time.Time `json:"created_at"`
}
