// Package p2pmarket is the Phase-3 P2P escrow marketplace: peer listings, escrow
// checkout (consuming the shared escrow core + dispute extension), and seller
// ratings. Money never moves directly here — checkout holds funds via escrow.Hold,
// confirm releases via escrow.Release, and a contested order resolves through the
// escrow dispute/arbitration loop. NL-6 (escrow holds, never lends), NL-9
// (idempotent), NL-10 (AML inherited from escrow), NL-12 (audit).
package p2pmarket

import "time"

// ListingState is the listing lifecycle.
type ListingState string

const (
	ListingActive ListingState = "ACTIVE"
	ListingSold   ListingState = "SOLD"
	ListingClosed ListingState = "CLOSED"
)

// Listing is a seller's offer.
type Listing struct {
	ID          string       `json:"id"`
	SellerID    string       `json:"seller_id"` // FK auth.users(id)
	Title       string       `json:"title"`
	Description string       `json:"description"`
	PriceKobo   int64        `json:"price_kobo"`
	State       ListingState `json:"state"`
	CreatedAt   time.Time    `json:"created_at"`
	UpdatedAt   time.Time    `json:"updated_at"`
}

// OrderState is the order lifecycle. It mirrors the escrow hold underneath:
// CHECKOUT (funds HELD) → CONFIRMED (RELEASED to seller) | DISPUTED → resolved.
type OrderState string

const (
	OrderCheckout  OrderState = "CHECKOUT"  // funds held in escrow
	OrderConfirmed OrderState = "CONFIRMED" // buyer confirmed delivery → released
	OrderDisputed  OrderState = "DISPUTED"  // contested → arbitration
	OrderRefunded  OrderState = "REFUNDED"  // refunded to buyer
)

// Order is a buyer's purchase of a listing, backed by an escrow hold.
type Order struct {
	ID         string     `json:"id"`
	ListingID  string     `json:"listing_id"`
	BuyerID    string     `json:"buyer_id"`
	SellerID   string     `json:"seller_id"`
	AmountKobo int64      `json:"amount_kobo"`
	EscrowID   string     `json:"escrow_id"` // -> escrow_holds.id
	State      OrderState `json:"state"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

// Rating is a buyer's rating of a seller after an order (1..5).
type Rating struct {
	ID        string    `json:"id"`
	OrderID   string    `json:"order_id"`
	SellerID  string    `json:"seller_id"`
	BuyerID   string    `json:"buyer_id"`
	Stars     int       `json:"stars"`
	Comment   string    `json:"comment"`
	CreatedAt time.Time `json:"created_at"`
}
