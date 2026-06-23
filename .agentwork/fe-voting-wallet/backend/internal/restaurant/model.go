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
	OrderPending    OrderStatus = "pending"
	OrderConfirmed  OrderStatus = "confirmed"
	OrderPreparing  OrderStatus = "preparing"
	OrderReady      OrderStatus = "ready"
	OrderPickedUp   OrderStatus = "picked_up"
	OrderDelivered  OrderStatus = "delivered"
	OrderCancelled  OrderStatus = "cancelled"
)

// DeliveryFeeKobo is the flat delivery charge added to every order.
const DeliveryFeeKobo int64 = 50000 // ₦500

// Order is a customer's food delivery order.
type Order struct {
	ID             string      `json:"id"`
	CustomerID     string      `json:"customer_id"`
	RestaurantID   string      `json:"restaurant_id"`
	RiderID        *string     `json:"rider_id,omitempty"`
	Items          []OrderItem `json:"items"`
	SubtotalKobo   int64       `json:"subtotal_kobo"`
	DeliveryKobo   int64       `json:"delivery_kobo"`
	TotalKobo      int64       `json:"total_kobo"`
	Status         OrderStatus `json:"status"`
	IdempotencyKey string      `json:"idempotency_key"`
	SettlementID   string      `json:"settlement_id"`
	DeliveryAddress string     `json:"delivery_address"`
	CreatedAt      time.Time   `json:"created_at"`
}

// OrderItem is one line in an order.
type OrderItem struct {
	ID           string `json:"id"`
	OrderID      string `json:"order_id"`
	MenuItemID   string `json:"menu_item_id"`
	Name         string `json:"name"`
	PriceKobo    int64  `json:"price_kobo"`
	Quantity     int    `json:"quantity"`
	SubtotalKobo int64  `json:"subtotal_kobo"`
}

// CreateRestaurantRequest is the body for POST /restaurant.
type CreateRestaurantRequest struct {
	Name        string  `json:"name" binding:"required,min=2,max=200"`
	Description string  `json:"description"`
	Address     string  `json:"address" binding:"required"`
	LogoURL     *string `json:"logo_url,omitempty"`
}

// PlaceOrderRequest is the body for POST /restaurant/:id/orders.
type PlaceOrderRequest struct {
	Items           []OrderItemInput `json:"items" binding:"required,min=1"`
	DeliveryAddress string           `json:"delivery_address" binding:"required"`
	IdempotencyKey  string           `json:"idempotency_key" binding:"required"`
}

// OrderItemInput is one line item in the order request.
type OrderItemInput struct {
	MenuItemID string `json:"menu_item_id" binding:"required"`
	Quantity   int    `json:"quantity" binding:"required,min=1"`
}
