// Package top5events implements the Top-5 Phase-2 Event Ticketing + cashless
// Event Wallet module. It is a NEW, additive module that REUSES the finance spine
// (ledger / wallet / settlement / tiers), the shared credential primitive (rotating
// QR + NFC gate entry) and the shared cashtag directory (ticket gift/transfer).
//
// NOTE ON PACKAGE NAME: an unrelated legacy `events` package already exists under
// backend/internal/events (the EPIC events CMS wired in finance_routes.go). Per the
// brownfield iron rule we never edit or collide with it, so this Top-5 module lives
// in its own package `top5events`. All RBAC permissions still use the events.*
// namespace as specified in the build plan.
package top5events

import "time"

// EventState is the organiser CMS approval lifecycle.
//
//	DRAFT -> SUBMITTED -> APPROVED -> LIVE -> CLOSED
//	                       APPROVED -> SUSPENDED (admin) -> APPROVED
//	any non-terminal -> SUSPENDED (admin)
type EventState string

const (
	EventDraft     EventState = "DRAFT"
	EventSubmitted EventState = "SUBMITTED"
	EventApproved  EventState = "APPROVED"
	EventLive      EventState = "LIVE"
	EventClosed    EventState = "CLOSED"
	EventSuspended EventState = "SUSPENDED"
)

// Event is an organiser-owned ticketed gathering. The organiser is a *capability*
// on a single identity (no separate organiser account) — object-level authZ is
// "auth.uid() == organiser_id".
type Event struct {
	ID          string     `json:"id"`
	OrganiserID string     `json:"organiser_id"`
	Title       string     `json:"title"`
	Description string     `json:"description,omitempty"`
	Venue       string     `json:"venue,omitempty"`
	State       EventState `json:"state"`
	Category    string     `json:"category,omitempty"` // discovery filter: music/tech/sports/comedy/faith/...
	StartsAt    time.Time  `json:"starts_at"`
	EndsAt      time.Time  `json:"ends_at"`
	FeeBps      int        `json:"fee_bps"` // platform fee in basis points on vendor settlement
	CreatedAt   time.Time  `json:"created_at"`
}

// EventListFilter narrows the discovery/list feed. Category and State are
// optional; an empty State defaults (in the service) to publicly-visible states
// for anonymous/non-owner callers.
type EventListFilter struct {
	Category string
	State    string
	Limit    int
	Offset   int
}

// EventSummary is the lightweight discovery-feed projection of an Event: no
// description, adds a computed MinPriceKobo (cheapest active tier) and SoldOut.
type EventSummary struct {
	ID           string     `json:"id"`
	Title        string     `json:"title"`
	Venue        string     `json:"venue,omitempty"`
	State        EventState `json:"state"`
	Category     string     `json:"category,omitempty"`
	StartsAt     time.Time  `json:"starts_at"`
	EndsAt       time.Time  `json:"ends_at"`
	MinPriceKobo int64      `json:"min_price_kobo"` // 0/null-equivalent when the event is free or has no active tiers
	SoldOut      bool       `json:"sold_out"`
}

// TicketTier is an inventory bucket with a price + capacity.
type TicketTier struct {
	ID        string `json:"id"`
	EventID   string `json:"event_id"`
	Name      string `json:"name"`
	PriceKobo int64  `json:"price_kobo"`
	Capacity  int    `json:"capacity"`
	Sold      int    `json:"sold"`
	Active    bool   `json:"active"`
}

// PromoCode is a versioned discount applied at checkout.
type PromoCode struct {
	ID         string `json:"id"`
	EventID    string `json:"event_id"`
	Code       string `json:"code"`
	Version    int    `json:"version"`
	PercentOff int    `json:"percent_off"` // 0-100
	MaxUses    int    `json:"max_uses"`    // 0 => unlimited
	Used       int    `json:"used"`
	Active     bool   `json:"active"`
}

// TicketState is the per-ticket lifecycle.
//
//	ISSUED -> USED            (scanned at gate, single-use)
//	ISSUED -> TRANSFERRED -> USED  (gifted via cashtag, then scanned)
//	ISSUED -> REFUNDED        (organiser/admin refund)
type TicketState string

const (
	TicketIssued      TicketState = "ISSUED"
	TicketTransferred TicketState = "TRANSFERRED"
	TicketUsed        TicketState = "USED"
	TicketRefunded    TicketState = "REFUNDED"
)

// Ticket binds an attendee to a tier and to a credential (the rotating-QR gate
// entry token lives in the credential package; CredentialID is the link).
type Ticket struct {
	ID            string      `json:"id"`
	EventID       string      `json:"event_id"`
	TierID        string      `json:"tier_id"`
	OrderID       string      `json:"order_id"`
	OwnerID       string      `json:"owner_id"`
	State         TicketState `json:"state"`
	CredentialID  string      `json:"credential_id"`
	PricePaidKobo int64       `json:"price_paid_kobo"`
	CreatedAt     time.Time   `json:"created_at"`
}

// Order is a checkout aggregate (one or more tickets paid via wallet.Debit).
type Order struct {
	ID             string    `json:"id"`
	EventID        string    `json:"event_id"`
	BuyerID        string    `json:"buyer_id"`
	TotalKobo      int64     `json:"total_kobo"`
	Status         string    `json:"status"` // PAID | REFUNDED
	IdempotencyKey string    `json:"idempotency_key"`
	CreatedAt      time.Time `json:"created_at"`
}

// EventWalletState is the cashless wallet lifecycle (closed-loop, NL-3).
//
//	OPEN -> SPENDING -> CLOSED   (residual auto-refunded to the main wallet)
type EventWalletState string

const (
	WalletOpen     EventWalletState = "OPEN"
	WalletSpending EventWalletState = "SPENDING"
	WalletClosed   EventWalletState = "CLOSED"
)

// EventWallet is a per-attendee cashless balance for one event. It is a CLOSED-LOOP
// sub-balance: top-ups move money from the main wallet into the shared escrow
// standing account (held as float); tap-charges move float to the vendor's float
// ledger; on close the unspent residual is credited back to the attendee's MAIN
// wallet (NL-3). There is no path to cash out the event-wallet balance directly.
type EventWallet struct {
	ID           string           `json:"id"`
	EventID      string           `json:"event_id"`
	OwnerID      string           `json:"owner_id"`
	State        EventWalletState `json:"state"`
	BalanceKobo  int64            `json:"balance_kobo"`            // projection of event_wallet_ledger
	CredentialID string           `json:"credential_id,omitempty"` // optional wallet band/tag
	CreatedAt    time.Time        `json:"created_at"`
}

// EventWalletEntry is one append-only sub-balance movement (NL-8 style for the
// closed-loop float). Direction is by Type; amounts are positive kobo.
type EventWalletEntry struct {
	ID             string    `json:"id"`
	WalletID       string    `json:"wallet_id"`
	Type           string    `json:"type"` // TOPUP | CHARGE | REFUND
	AmountKobo     int64     `json:"amount_kobo"`
	Reference      string    `json:"reference"`
	IdempotencyKey string    `json:"idempotency_key"`
	CreatedAt      time.Time `json:"created_at"`
}

// Vendor is a POS-lite seller at an event. Payouts to a vendor are KYC-gated (NL-10).
type Vendor struct {
	ID           string    `json:"id"`
	EventID      string    `json:"event_id"`
	UserID       string    `json:"user_id"` // FK auth.users(id) — payout beneficiary
	Name         string    `json:"name"`
	Active       bool      `json:"active"`
	CredentialID string    `json:"credential_id,omitempty"` // POS-lite identity
	CreatedAt    time.Time `json:"created_at"`
}

// VendorCharge records a single tap-charge from an attendee event-wallet to a vendor.
type VendorCharge struct {
	ID             string    `json:"id"`
	VendorID       string    `json:"vendor_id"`
	WalletID       string    `json:"wallet_id"`
	AmountKobo     int64     `json:"amount_kobo"`
	IdempotencyKey string    `json:"idempotency_key"`
	CreatedAt      time.Time `json:"created_at"`
}

// TopUpSource enumerates the cashless top-up rails (all closed-loop into float).
type TopUpSource string

const (
	TopUpWallet TopUpSource = "wallet" // from the attendee's main Paymax wallet
	TopUpAgent  TopUpSource = "agent"  // cash collected by an on-site agent
	TopUpCard   TopUpSource = "card"   // card collection (provider-cleared)
)
