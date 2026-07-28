package restaurant

import "time"

// Restaurant is a merchant registered on the platform.
type Restaurant struct {
	ID          string    `json:"id"`
	OwnerID     string    `json:"owner_id"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	Address     string    `json:"address"`
	LogoURL     *string   `json:"logo_url,omitempty"`
	IsOpen      bool      `json:"is_open"`
	CreatedAt   time.Time `json:"created_at"`
}

// MenuCategory groups menu items (e.g. "Starters", "Mains").
type MenuCategory struct {
	ID           string     `json:"id"`
	RestaurantID string     `json:"restaurant_id"`
	Name         string     `json:"name"`
	Items        []MenuItem `json:"items,omitempty"`
}

// MenuItem is a single item on the menu.
type MenuItem struct {
	ID           string  `json:"id"`
	CategoryID   string  `json:"category_id"`
	RestaurantID string  `json:"restaurant_id"`
	Name         string  `json:"name"`
	Description  string  `json:"description,omitempty"`
	PriceKobo    int64   `json:"price_kobo"`
	ImageURL     *string `json:"image_url,omitempty"`
	IsAvailable  bool    `json:"is_available"`
}

// OrderStatus tracks a delivery order through its lifecycle.
type OrderStatus string

const (
	OrderPending   OrderStatus = "pending"
	OrderConfirmed OrderStatus = "confirmed"
	OrderPreparing OrderStatus = "preparing"
	OrderReady     OrderStatus = "ready"
	OrderPickedUp  OrderStatus = "picked_up"
	OrderDelivered OrderStatus = "delivered"
	OrderCancelled OrderStatus = "cancelled"
)

// DeliveryFeeKobo is the flat delivery charge added to every order.
const DeliveryFeeKobo int64 = 50000 // ₦500

// Order is a customer's food delivery order.
type Order struct {
	ID              string      `json:"id"`
	CustomerID      string      `json:"customer_id"`
	RestaurantID    string      `json:"restaurant_id"`
	RiderID         *string     `json:"rider_id,omitempty"`
	Items           []OrderItem `json:"items"`
	SubtotalKobo    int64       `json:"subtotal_kobo"`
	DeliveryKobo    int64       `json:"delivery_kobo"`
	TipKobo         int64       `json:"tip_kobo"`
	TotalKobo       int64       `json:"total_kobo"`
	Status          OrderStatus `json:"status"`
	IdempotencyKey  string      `json:"idempotency_key"`
	SettlementID    string      `json:"settlement_id"`
	DeliveryAddress string      `json:"delivery_address"`
	// DispatchStatus tracks rider sourcing once food is ready:
	// none → searching (auto-dispatch offered) → assigned → delivered.
	DispatchStatus string `json:"dispatch_status"`
	// DeliveryCode is the customer's handoff code. The rider must enter it at
	// drop-off to confirm the handoff. Returned only to the order's participants.
	DeliveryCode *string   `json:"delivery_code,omitempty"`
	// Distance/time-based fee inputs + breakdown (persisted for transparency/audit).
	// Zero/empty when the order fell back to the flat DeliveryFeeKobo (no coords).
	DistanceMeters    *float64              `json:"distance_meters,omitempty"`
	EtaMinutes        *float64              `json:"eta_minutes,omitempty"`
	DeliveryBreakdown *DeliveryFeeBreakdown `json:"delivery_breakdown,omitempty"`
	CreatedAt         time.Time             `json:"created_at"`
}

// OrderItem is one line in an order.
type OrderItem struct {
	ID         string `json:"id"`
	OrderID    string `json:"order_id"`
	MenuItemID string `json:"menu_item_id"`
	Name       string `json:"name"`
	PriceKobo  int64  `json:"price_kobo"` // base unit price (before modifiers)
	Quantity   int    `json:"quantity"`
	// ModifiersKobo is the per-unit modifier surcharge; Modifiers is the chosen-option
	// snapshot. SubtotalKobo = (PriceKobo + ModifiersKobo) * Quantity.
	ModifiersKobo int64               `json:"modifiers_kobo"`
	Modifiers     []OrderItemModifier `json:"modifiers,omitempty"`
	SubtotalKobo  int64               `json:"subtotal_kobo"`
}

// OrderItemModifier is one chosen modifier snapshotted onto an order line.
type OrderItemModifier struct {
	ModifierID     string `json:"modifier_id"`
	Name           string `json:"name"`
	PriceDeltaKobo int64  `json:"price_delta_kobo"`
}

// CreateRestaurantRequest is the body for POST /restaurant.
type CreateRestaurantRequest struct {
	Name        string  `json:"name" binding:"required,min=2,max=200"`
	Description string  `json:"description"`
	Address     string  `json:"address" binding:"required"`
	LogoURL     *string `json:"logo_url,omitempty"`
}

// PlaceOrderRequest is the body for POST /restaurant/:id/orders.
//
// Delivery coordinates may arrive either as flat delivery_lat/delivery_lng or as
// a nested delivery_location {lat,lng} object (the mobile app sends the latter).
// Use DeliveryCoords() to read the normalized pair regardless of which the client
// sent. When neither is present the order falls back to the flat DeliveryFeeKobo.
type PlaceOrderRequest struct {
	Items           []OrderItemInput `json:"items" binding:"required,min=1"`
	DeliveryAddress string           `json:"delivery_address" binding:"required"`
	// IdempotencyKey is read from the `Idempotency-Key` HEADER by the handler
	// (the client convention across every money route). The body field is a
	// fallback only — hence no binding:"required" here, so a header-only client
	// no longer 400s on bind.
	IdempotencyKey string `json:"idempotency_key"`

	// TipKobo is an optional customer tip (whole kobo) paid 100% to the rider at
	// settlement. It is escrowed with the order total. Negative values are clamped
	// to 0 by PlaceOrder (never trusted from the client for money math).
	TipKobo int64 `json:"tip_kobo,omitempty"`

	DeliveryLat      *float64 `json:"delivery_lat,omitempty"`
	DeliveryLng      *float64 `json:"delivery_lng,omitempty"`
	DeliveryLocation *LatLng  `json:"delivery_location,omitempty"`
}

// LatLng is a nested coordinate object accepted on delivery requests.
type LatLng struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

// DeliveryCoords returns the normalized delivery coordinates and whether both were
// supplied. Flat delivery_lat/delivery_lng take precedence; otherwise the nested
// delivery_location object is used.
func (r PlaceOrderRequest) DeliveryCoords() (lat, lng float64, ok bool) {
	if r.DeliveryLat != nil && r.DeliveryLng != nil {
		return *r.DeliveryLat, *r.DeliveryLng, true
	}
	if r.DeliveryLocation != nil {
		return r.DeliveryLocation.Lat, r.DeliveryLocation.Lng, true
	}
	return 0, 0, false
}

// OrderItemInput is one line item in the order request.
//
// The mobile client sends the menu-item id as `item_id`; the DB column and the
// canonical Order line are `menu_item_id`. We accept BOTH json tags and normalize
// via MenuItem() so the client field name (`item_id`) works without a client change
// while `menu_item_id` remains accepted for any other caller.
type OrderItemInput struct {
	MenuItemID string `json:"menu_item_id"`
	ItemID     string `json:"item_id"`
	// Quantity is accepted as either `quantity` (canonical) or `qty` (mobile client).
	Quantity int `json:"quantity"`
	Qty      int `json:"qty"`
	// ModifierIDs are the chosen menu_modifiers for this line (e.g. a size + extras).
	// Validated against the item's modifier groups at PlaceOrder; each adds a per-unit
	// price delta. Empty is valid only when the item has no required groups.
	ModifierIDs []string `json:"modifier_ids,omitempty"`
}

// MenuItem returns the normalized menu-item id regardless of which json field the
// client sent (`menu_item_id` preferred, `item_id` fallback).
func (i OrderItemInput) MenuItem() string {
	if i.MenuItemID != "" {
		return i.MenuItemID
	}
	return i.ItemID
}

// QtyOf returns the normalized quantity (`quantity` preferred, `qty` fallback).
func (i OrderItemInput) QtyOf() int {
	if i.Quantity > 0 {
		return i.Quantity
	}
	return i.Qty
}
