package pharmacy

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct{ pool *pgxpool.Pool }

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

// ListProducts returns in-stock products, optionally filtered by category or full-text search.
func (s *Service) ListProducts(ctx context.Context, q ListProductsQuery) ([]Product, error) {
	if q.Limit <= 0 {
		q.Limit = 20
	}
	base := `SELECT id, name, category, price_kobo, unit, is_bestseller, is_essential, in_stock,
	                image_url, created_at
	         FROM pharmacy_products WHERE in_stock = TRUE`
	args := []any{}
	idx := 1

	if q.Category != "" {
		base += fmt.Sprintf(" AND category = $%d", idx)
		args = append(args, q.Category)
		idx++
	}
	if q.Search != "" {
		base += fmt.Sprintf(" AND name ILIKE $%d", idx)
		args = append(args, "%"+q.Search+"%")
		idx++
	}
	base += fmt.Sprintf(" ORDER BY is_bestseller DESC, created_at DESC LIMIT $%d OFFSET $%d", idx, idx+1)
	args = append(args, q.Limit, q.Offset)

	rows, err := s.pool.Query(ctx, base, args...)
	if err != nil {
		return nil, fmt.Errorf("pharmacy: list products: %w", err)
	}
	defer rows.Close()

	var products []Product
	for rows.Next() {
		var p Product
		if err := rows.Scan(&p.ID, &p.Name, &p.Category, &p.PriceKobo, &p.Unit,
			&p.IsBestseller, &p.IsEssential, &p.InStock, &p.ImageURL, &p.CreatedAt); err != nil {
			return nil, fmt.Errorf("pharmacy: scan product: %w", err)
		}
		products = append(products, p)
	}
	if products == nil {
		products = []Product{}
	}
	return products, nil
}

// GetCart returns all cart items (with product details) for the given user.
func (s *Service) GetCart(ctx context.Context, userID string) ([]CartItem, error) {
	const q = `
		SELECT ci.id, ci.user_id, ci.product_id, ci.quantity, ci.idempotency_key, ci.created_at,
		       p.id, p.name, p.category, p.price_kobo, p.unit, p.is_bestseller, p.is_essential,
		       p.in_stock, p.image_url, p.created_at
		FROM pharmacy_cart_items ci
		JOIN pharmacy_products p ON p.id = ci.product_id
		WHERE ci.user_id = $1
		ORDER BY ci.created_at ASC`

	rows, err := s.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("pharmacy: get cart: %w", err)
	}
	defer rows.Close()

	var items []CartItem
	for rows.Next() {
		var ci CartItem
		var prod Product
		if err := rows.Scan(
			&ci.ID, &ci.UserID, &ci.ProductID, &ci.Quantity, &ci.IdempotencyKey, &ci.CreatedAt,
			&prod.ID, &prod.Name, &prod.Category, &prod.PriceKobo, &prod.Unit,
			&prod.IsBestseller, &prod.IsEssential, &prod.InStock, &prod.ImageURL, &prod.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("pharmacy: scan cart item: %w", err)
		}
		ci.Product = &prod
		items = append(items, ci)
	}
	if items == nil {
		items = []CartItem{}
	}
	return items, nil
}

// AddToCart upserts a cart item (inserts or increments quantity).
func (s *Service) AddToCart(ctx context.Context, userID string, req AddToCartRequest) (CartItem, error) {
	qty := req.Quantity
	if qty <= 0 {
		qty = 1
	}
	idkey := &req.IdempotencyKey
	if req.IdempotencyKey == "" {
		idkey = nil
	}

	const q = `
		INSERT INTO pharmacy_cart_items (user_id, product_id, quantity, idempotency_key)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id, product_id) DO UPDATE
		    SET quantity = pharmacy_cart_items.quantity + EXCLUDED.quantity
		RETURNING id, user_id, product_id, quantity, idempotency_key, created_at`

	var ci CartItem
	if err := s.pool.QueryRow(ctx, q, userID, req.ProductID, qty, idkey).Scan(
		&ci.ID, &ci.UserID, &ci.ProductID, &ci.Quantity, &ci.IdempotencyKey, &ci.CreatedAt,
	); err != nil {
		return CartItem{}, fmt.Errorf("pharmacy: add to cart: %w", err)
	}
	return ci, nil
}

// UpdateCartItem sets the quantity for a specific cart item.
func (s *Service) UpdateCartItem(ctx context.Context, userID, productID string, quantity int) (CartItem, error) {
	const q = `
		UPDATE pharmacy_cart_items
		SET quantity = $3
		WHERE user_id = $1 AND product_id = $2
		RETURNING id, user_id, product_id, quantity, idempotency_key, created_at`

	var ci CartItem
	if err := s.pool.QueryRow(ctx, q, userID, productID, quantity).Scan(
		&ci.ID, &ci.UserID, &ci.ProductID, &ci.Quantity, &ci.IdempotencyKey, &ci.CreatedAt,
	); err != nil {
		return CartItem{}, fmt.Errorf("pharmacy: update cart item: %w", err)
	}
	return ci, nil
}

// RemoveFromCart deletes a cart item by product ID for this user.
func (s *Service) RemoveFromCart(ctx context.Context, userID, productID string) error {
	_, err := s.pool.Exec(ctx,
		"DELETE FROM pharmacy_cart_items WHERE user_id = $1 AND product_id = $2",
		userID, productID)
	if err != nil {
		return fmt.Errorf("pharmacy: remove from cart: %w", err)
	}
	return nil
}

// ClearCart removes all cart items for this user.
func (s *Service) ClearCart(ctx context.Context, userID string) error {
	_, err := s.pool.Exec(ctx, "DELETE FROM pharmacy_cart_items WHERE user_id = $1", userID)
	if err != nil {
		return fmt.Errorf("pharmacy: clear cart: %w", err)
	}
	return nil
}
