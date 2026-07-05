// Package connectmonetization implements Paymax Connect Phase 6 (monetization):
// subscriptions, boosts and passes purchased via the Paymax wallet, with
// server-side entitlement enforcement, and ride/ticket booking from the date
// planner. Every money mutation reuses the finance ledger/wallet (balanced
// double-entry, idempotent, tier-checked) — money is NEVER mutated here directly.
//
// Iron rules honoured:
//   - amounts are integer kobo (BIGINT) — never float/string math;
//   - every purchase requires an Idempotency-Key and posts a balanced ledger entry;
//   - entitlements are enforced SERVER-SIDE (this package is the source of truth);
//   - plans/prices/entitlements are backend-owned (connect_plans), never hard-coded.
package connectmonetization

import (
	"encoding/json"
	"time"
)

// PlanKind enumerates the purchasable product kinds.
type PlanKind string

const (
	KindSubscription PlanKind = "subscription"
	KindBoost        PlanKind = "boost"
	KindPass         PlanKind = "pass"
)

// ValidPlanKind reports whether k is an allowed plan kind.
func ValidPlanKind(k PlanKind) bool {
	switch k {
	case KindSubscription, KindBoost, KindPass:
		return true
	}
	return false
}

// Plan is a backend-owned catalogue entry (row of connect_plans). Prices and
// entitlements come from the DB, never the client.
type Plan struct {
	ID           string          `json:"id"`
	Code         string          `json:"code"`
	Kind         PlanKind        `json:"kind"`
	Name         string          `json:"name"`
	PriceKobo    int64           `json:"price_kobo"`
	IntervalDays *int            `json:"interval_days,omitempty"`
	Entitlements json.RawMessage `json:"entitlements"`
	Active       bool            `json:"active"`
}

// Order is an immutable purchase record (row of connect_orders).
type Order struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	PlanID         string    `json:"plan_id"`
	PlanCode       string    `json:"plan_code"`
	Kind           PlanKind  `json:"kind"`
	AmountKobo     int64     `json:"amount_kobo"`
	Status         string    `json:"status"`
	IdempotencyKey string    `json:"-"` // never serialised to clients
	LedgerRef      string    `json:"ledger_ref"`
	CreatedAt      time.Time `json:"created_at"`
}

// Entitlement is the server-side projection of what a user may do (row of
// connect_entitlements). Reads are server-side; the client never asserts these.
type Entitlement struct {
	ID        string          `json:"id"`
	UserID    string          `json:"user_id"`
	PlanCode  string          `json:"plan_code"`
	Kind      PlanKind        `json:"kind"`
	Features  json.RawMessage `json:"features"`
	GrantedAt time.Time       `json:"granted_at"`
	ExpiresAt *time.Time      `json:"expires_at,omitempty"`
	Active    bool            `json:"active"`
}

// Booking is a date-planner ride/ticket booking reference (row of
// connect_date_plan_bookings). The actual ride/ticket lives in its own module.
type Booking struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	Kind        string    `json:"kind"` // ride | ticket
	ExternalRef string    `json:"external_ref,omitempty"`
	EventID     string    `json:"event_id,omitempty"`
	AmountKobo  int64     `json:"amount_kobo"`
	Status      string    `json:"status"`
	LedgerRef   string    `json:"ledger_ref"`
	CreatedAt   time.Time `json:"created_at"`
}

// --- Request DTOs ---

// PurchaseRequest is the body for POST /subscriptions|/boosts|/passes.
// Amount is NOT taken from the client — the server resolves price from the plan.
type PurchaseRequest struct {
	PlanCode string `json:"plan_code" binding:"required"`
}

// BookingRequest is the body for POST /date-plans/:id/ride|/tickets.
type BookingRequest struct {
	Kind         string `json:"kind"`           // ride | ticket
	EventID      string `json:"event_id"`       // for tickets
	TicketTypeID string `json:"ticket_type_id"` // for tickets (reuse event_ticket_types)
	AmountKobo   int64  `json:"amount_kobo"`    // server still validates >0 and tier-checks
	ExternalRef  string `json:"external_ref"`   // ride quote id, etc.
}

// expiresFor computes an expiry for a subscription given its interval, or nil
// for one-off boosts/passes (which are short-lived/consumable, expiry optional).
func (p *Plan) expiresFor(now time.Time) *time.Time {
	if p.Kind == KindSubscription && p.IntervalDays != nil && *p.IntervalDays > 0 {
		t := now.AddDate(0, 0, *p.IntervalDays)
		return &t
	}
	return nil
}
