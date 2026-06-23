package pharmacy

import "time"

// Product is a drug or health item listed in the marketplace.
type Product struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Category    string    `json:"category"`
	PriceKobo   int64     `json:"price_kobo"`
	Unit        string    `json:"unit"`
	IsBestseller bool     `json:"is_bestseller"`
	IsEssential bool      `json:"is_essential"`
	InStock     bool      `json:"in_stock"`
	ImageURL    *string   `json:"image_url,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

// CartItem represents a product in the user's shopping cart.
type CartItem struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	ProductID      string    `json:"product_id"`
	Quantity       int       `json:"quantity"`
	IdempotencyKey *string   `json:"idempotency_key,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
	Product        *Product  `json:"product,omitempty"`
}

// ─── Request types ────────────────────────────────────────────────────────────

// ListProductsQuery holds validated query params for the product list endpoint.
type ListProductsQuery struct {
	Category string `form:"category"`
	Search   string `form:"search"`
	Limit    int    `form:"limit,default=20"`
	Offset   int    `form:"offset,default=0"`
}

// AddToCartRequest is the body for POST /pharmacy/cart.
type AddToCartRequest struct {
	ProductID      string `json:"product_id" binding:"required"`
	Quantity       int    `json:"quantity,omitempty"`
	IdempotencyKey string `json:"idempotency_key"`
}

// UpdateCartItemRequest is the body for PATCH /pharmacy/cart/:product_id.
type UpdateCartItemRequest struct {
	Quantity int `json:"quantity" binding:"required,min=1"`
}
