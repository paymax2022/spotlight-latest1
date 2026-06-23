package restaurant

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"spotlight/backend/internal/finance/settlement"
)

// AddressGeocoder resolves a typed address to a pin + Plus Code. Satisfied by
// maps.LocationGeocoder (the provider-agnostic MapService). Optional: when nil,
// restaurants are created without coordinates (a pin can be set later via the
// MapService /locations endpoint).
type AddressGeocoder interface {
	Geocode(ctx context.Context, address string) (lat, lng float64, plusCode string, err error)
}

// Service manages restaurants, menus, and orders.
type Service struct {
	db         *pgxpool.Pool
	settlement *settlement.Service
	geocoder   AddressGeocoder
}

func NewService(db *pgxpool.Pool, settlement *settlement.Service) *Service {
	return &Service{db: db, settlement: settlement}
}

// WithGeocoder attaches an address geocoder so new restaurants get a pin
// (geo_lat/geo_lng + plus_code) automatically, which syncs into merchant_locations.
func (s *Service) WithGeocoder(g AddressGeocoder) *Service {
	s.geocoder = g
	return s
}

// CreateRestaurant registers a new restaurant.
func (s *Service) CreateRestaurant(ctx context.Context, ownerID string, req CreateRestaurantRequest) (*Restaurant, error) {
	r := &Restaurant{
		ID:          uuid.New().String(),
		OwnerID:     ownerID,
		Name:        req.Name,
		Description: req.Description,
		Address:     req.Address,
		LogoURL:     req.LogoURL,
		IsOpen:      false,
		CreatedAt:   time.Now(),
	}
	const q = `INSERT INTO restaurants (id, owner_id, name, description, address, logo_url, is_open) VALUES ($1,$2,$3,$4,$5,$6,false)`
	_, err := s.db.Exec(ctx, q, r.ID, r.OwnerID, r.Name, r.Description, r.Address, r.LogoURL)

	// Best-effort: geocode the address to a pin so "near me" works. The UPDATE
	// fires the merchant_locations sync trigger. A geocode failure never fails
	// restaurant creation (the pin can be set later via /maps/locations).
	if err == nil && s.geocoder != nil && r.Address != "" {
		if lat, lng, plus, gerr := s.geocoder.Geocode(ctx, r.Address); gerr == nil {
			_, _ = s.db.Exec(ctx,
				`UPDATE restaurants SET geo_lat=$2, geo_lng=$3, plus_code=$4, updated_at=NOW() WHERE id=$1`,
				r.ID, lat, lng, plus)
		}
	}
	return r, err
}

// PlaceOrder validates items, computes totals, escrows payment, and creates the order.
func (s *Service) PlaceOrder(ctx context.Context, restaurantID, customerID string, req PlaceOrderRequest) (*Order, error) {
	// Verify restaurant is open.
	var isOpen bool
	var ownerID string
	if err := s.db.QueryRow(ctx, `SELECT is_open, owner_id FROM restaurants WHERE id=$1`, restaurantID).Scan(&isOpen, &ownerID); err != nil {
		return nil, fmt.Errorf("restaurant: not found")
	}
	if !isOpen {
		return nil, fmt.Errorf("restaurant: restaurant is currently closed")
	}

	// Fetch and validate menu items.
	var items []OrderItem
	var subtotal int64
	for _, input := range req.Items {
		var mi MenuItem
		const qMI = `SELECT id, restaurant_id, name, price_kobo, is_available FROM menu_items WHERE id=$1 AND restaurant_id=$2`
		if err := s.db.QueryRow(ctx, qMI, input.MenuItemID, restaurantID).Scan(&mi.ID, &mi.RestaurantID, &mi.Name, &mi.PriceKobo, &mi.IsAvailable); err != nil {
			return nil, fmt.Errorf("restaurant: menu item %s not found", input.MenuItemID)
		}
		if !mi.IsAvailable {
			return nil, fmt.Errorf("restaurant: menu item '%s' is not available", mi.Name)
		}
		lineTotal := mi.PriceKobo * int64(input.Quantity)
		items = append(items, OrderItem{
			ID:           uuid.New().String(),
			MenuItemID:   mi.ID,
			Name:         mi.Name,
			PriceKobo:    mi.PriceKobo,
			Quantity:     input.Quantity,
			SubtotalKobo: lineTotal,
		})
		subtotal += lineTotal
	}

	total := subtotal + DeliveryFeeKobo
	orderID := uuid.New().String()
	ref := "order:" + orderID

	// Escrow full amount: 80% restaurant, 10% rider, 10% platform.
	sett, err := s.settlement.Escrow(ctx, customerID, ref, req.IdempotencyKey, "food_delivery", total)
	if err != nil {
		return nil, fmt.Errorf("restaurant: escrow payment: %w", err)
	}

	order := &Order{
		ID:              orderID,
		CustomerID:      customerID,
		RestaurantID:    restaurantID,
		SubtotalKobo:    subtotal,
		DeliveryKobo:    DeliveryFeeKobo,
		TotalKobo:       total,
		Status:          OrderPending,
		IdempotencyKey:  req.IdempotencyKey,
		SettlementID:    sett.ID,
		DeliveryAddress: req.DeliveryAddress,
		CreatedAt:       time.Now(),
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("restaurant: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	const insertOrder = `
		INSERT INTO orders (id, customer_id, restaurant_id, subtotal_kobo, delivery_kobo, total_kobo, status, idempotency_key, settlement_id, delivery_address)
		VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9)`
	if _, err := tx.Exec(ctx, insertOrder,
		order.ID, order.CustomerID, order.RestaurantID,
		order.SubtotalKobo, order.DeliveryKobo, order.TotalKobo,
		order.IdempotencyKey, order.SettlementID, order.DeliveryAddress,
	); err != nil {
		return nil, fmt.Errorf("restaurant: insert order: %w", err)
	}

	for i := range items {
		items[i].OrderID = order.ID
		const insertItem = `INSERT INTO order_items (id, order_id, menu_item_id, name, price_kobo, quantity, subtotal_kobo) VALUES ($1,$2,$3,$4,$5,$6,$7)`
		if _, err := tx.Exec(ctx, insertItem,
			items[i].ID, items[i].OrderID, items[i].MenuItemID,
			items[i].Name, items[i].PriceKobo, items[i].Quantity, items[i].SubtotalKobo,
		); err != nil {
			return nil, fmt.Errorf("restaurant: insert order item: %w", err)
		}
	}
	order.Items = items
	return order, tx.Commit(ctx)
}

// UpdateStatus advances an order's status. Restaurant owner confirms/prepares;
// rider marks picked_up/delivered; last step triggers settlement.
func (s *Service) UpdateStatus(ctx context.Context, orderID, actorID string, newStatus OrderStatus) error {
	var order Order
	const q = `SELECT id, restaurant_id, status, settlement_id FROM orders WHERE id=$1`
	if err := s.db.QueryRow(ctx, q, orderID).Scan(&order.ID, &order.RestaurantID, &order.Status, &order.SettlementID); err != nil {
		return fmt.Errorf("restaurant: order not found")
	}

	if _, err := s.db.Exec(ctx, `UPDATE orders SET status=$1 WHERE id=$2`, string(newStatus), orderID); err != nil {
		return err
	}

	// On delivery, settle: 80% restaurant owner, 10% rider (stubbed to owner if no rider), 10% platform.
	if newStatus == OrderDelivered {
		var riderID *string
		s.db.QueryRow(ctx, `SELECT rider_id FROM orders WHERE id=$1`, orderID).Scan(&riderID)
		var ownerID string
		s.db.QueryRow(ctx, `SELECT owner_id FROM restaurants WHERE id=$1`, order.RestaurantID).Scan(&ownerID)
		// Split must sum to 1.0. With a rider: 80% restaurant / 10% platform / 10%
		// rider. With NO rider, the 10% rider share folds back into the restaurant
		// (90% / 10%) so escrow is fully released and nothing is orphaned.
		split := settlement.Split{
			ProviderID:  ownerID,
			ProviderPct: 0.80,
			PlatformPct: 0.10,
			RiderID:     riderID,
			RiderPct:    0.10,
		}
		if riderID == nil {
			split.ProviderPct = 0.90
			split.RiderPct = 0
		}
		if err := s.settlement.Settle(ctx, order.SettlementID, split); err != nil {
			return fmt.Errorf("restaurant: settle order: %w", err)
		}
	}
	return nil
}

// CancelOrder refunds the customer if the order has not yet been picked up.
func (s *Service) CancelOrder(ctx context.Context, orderID, actorID string) error {
	var status, settlementID string
	if err := s.db.QueryRow(ctx, `SELECT status, settlement_id FROM orders WHERE id=$1`, orderID).Scan(&status, &settlementID); err != nil {
		return fmt.Errorf("restaurant: order not found")
	}
	if status == string(OrderPickedUp) || status == string(OrderDelivered) {
		return fmt.Errorf("restaurant: cannot cancel an order that is already picked up or delivered")
	}
	if err := s.settlement.Refund(ctx, settlementID, "order_cancelled"); err != nil {
		return fmt.Errorf("restaurant: refund order: %w", err)
	}
	_, err := s.db.Exec(ctx, `UPDATE orders SET status='cancelled' WHERE id=$1`, orderID)
	return err
}
