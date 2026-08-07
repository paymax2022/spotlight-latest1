package restaurant

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

// ── Discovery / reads ─────────────────────────────────────────────────────────

// ListOpenRestaurants returns the discovery list of open restaurants.
func (s *Service) ListOpenRestaurants(ctx context.Context) ([]Restaurant, error) {
	const q = `SELECT id, owner_id, name, COALESCE(description,''), address, logo_url, is_open, rating, COALESCE(cuisine,''), created_at
	           FROM restaurants WHERE is_open = TRUE ORDER BY created_at DESC`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Restaurant
	for rows.Next() {
		var r Restaurant
		if err := rows.Scan(&r.ID, &r.OwnerID, &r.Name, &r.Description, &r.Address, &r.LogoURL, &r.IsOpen, &r.Rating, &r.Cuisine, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// RestaurantDetail is a restaurant plus its categorized menu.
type RestaurantDetail struct {
	Restaurant Restaurant     `json:"restaurant"`
	Categories []MenuCategory `json:"categories"`
}

// GetRestaurantDetail returns a restaurant and its menu (categories + items).
func (s *Service) GetRestaurantDetail(ctx context.Context, restaurantID string) (*RestaurantDetail, error) {
	var r Restaurant
	const qr = `SELECT id, owner_id, name, COALESCE(description,''), address, logo_url, is_open, created_at
	            FROM restaurants WHERE id=$1`
	if err := s.db.QueryRow(ctx, qr, restaurantID).Scan(&r.ID, &r.OwnerID, &r.Name, &r.Description, &r.Address, &r.LogoURL, &r.IsOpen, &r.CreatedAt); err != nil {
		return nil, fmt.Errorf("restaurant: not found")
	}

	cats := map[string]*MenuCategory{}
	var order []string
	const qc = `SELECT id, restaurant_id, name FROM menu_categories WHERE restaurant_id=$1 ORDER BY created_at`
	crows, err := s.db.Query(ctx, qc, restaurantID)
	if err != nil {
		return nil, err
	}
	for crows.Next() {
		var c MenuCategory
		if err := crows.Scan(&c.ID, &c.RestaurantID, &c.Name); err != nil {
			crows.Close()
			return nil, err
		}
		cats[c.ID] = &c
		order = append(order, c.ID)
	}
	crows.Close()
	if err := crows.Err(); err != nil {
		return nil, err
	}

	const qi = `SELECT id, category_id, restaurant_id, name, COALESCE(description,''), price_kobo, image_url, is_available, dietary_tags
	            FROM menu_items WHERE restaurant_id=$1 ORDER BY created_at`
	irows, err := s.db.Query(ctx, qi, restaurantID)
	if err != nil {
		return nil, err
	}
	defer irows.Close()
	for irows.Next() {
		var it MenuItem
		var catID *string
		if err := irows.Scan(&it.ID, &catID, &it.RestaurantID, &it.Name, &it.Description, &it.PriceKobo, &it.ImageURL, &it.IsAvailable, &it.DietaryTags); err != nil {
			return nil, err
		}
		if catID != nil {
			it.CategoryID = *catID
			if c, ok := cats[*catID]; ok {
				c.Items = append(c.Items, it)
			}
		}
	}
	if err := irows.Err(); err != nil {
		return nil, err
	}

	detail := &RestaurantDetail{Restaurant: r}
	for _, id := range order {
		detail.Categories = append(detail.Categories, *cats[id])
	}
	return detail, nil
}

// GetOrder returns a single order with items, scoped to its three participants.
func (s *Service) GetOrder(ctx context.Context, orderID, userID string) (*Order, error) {
	ok, _, err := s.isParticipant(ctx, orderID, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, fmt.Errorf("restaurant: not a participant of this order")
	}
	var o Order
	const q = `SELECT id, customer_id, restaurant_id, rider_id, subtotal_kobo, delivery_kobo, tip_kobo, discount_kobo, total_kobo,
	                  status, idempotency_key, COALESCE(settlement_id::text,''), delivery_address,
	                  COALESCE(dispatch_status,'none'), delivery_code, created_at
	           FROM orders WHERE id=$1`
	if err := s.db.QueryRow(ctx, q, orderID).Scan(&o.ID, &o.CustomerID, &o.RestaurantID, &o.RiderID,
		&o.SubtotalKobo, &o.DeliveryKobo, &o.TipKobo, &o.DiscountKobo, &o.TotalKobo, &o.Status, &o.IdempotencyKey, &o.SettlementID,
		&o.DeliveryAddress, &o.DispatchStatus, &o.DeliveryCode, &o.CreatedAt); err != nil {
		return nil, fmt.Errorf("restaurant: order not found")
	}
	items, err := s.loadOrderItems(ctx, orderID)
	if err != nil {
		return nil, err
	}
	o.Items = items
	return &o, nil
}

func (s *Service) loadOrderItems(ctx context.Context, orderID string) ([]OrderItem, error) {
	const q = `SELECT id, order_id, menu_item_id, name, price_kobo, quantity, subtotal_kobo
	           FROM order_items WHERE order_id=$1 ORDER BY created_at`
	rows, err := s.db.Query(ctx, q, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OrderItem
	for rows.Next() {
		var it OrderItem
		if err := rows.Scan(&it.ID, &it.OrderID, &it.MenuItemID, &it.Name, &it.PriceKobo, &it.Quantity, &it.SubtotalKobo); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Hydrate each line's chosen-modifier snapshot (and the derived per-unit surcharge)
	// so order reads reflect exactly what was ordered and priced.
	for i := range out {
		mods, err := s.loadOrderItemModifiers(ctx, out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].Modifiers = mods
		var delta int64
		for _, m := range mods {
			delta += m.PriceDeltaKobo
		}
		out[i].ModifiersKobo = delta
	}
	return out, nil
}

// loadOrderItemModifiers returns the immutable chosen-modifier snapshot for one line.
func (s *Service) loadOrderItemModifiers(ctx context.Context, orderItemID string) ([]OrderItemModifier, error) {
	const q = `SELECT modifier_id, name, price_delta_kobo
	           FROM order_item_modifiers WHERE order_item_id=$1 ORDER BY created_at`
	rows, err := s.db.Query(ctx, q, orderItemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OrderItemModifier
	for rows.Next() {
		var m OrderItemModifier
		if err := rows.Scan(&m.ModifierID, &m.Name, &m.PriceDeltaKobo); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ListOrders returns orders scoped by role relative to the authenticated user:
//
//	customer   → orders the user placed
//	restaurant → the queue for restaurants the user owns
//	rider      → orders assigned to the user as rider
func (s *Service) ListOrders(ctx context.Context, userID, role string) ([]Order, error) {
	var q string
	switch role {
	case "customer":
		q = `SELECT id, customer_id, restaurant_id, rider_id, subtotal_kobo, delivery_kobo, tip_kobo, discount_kobo, total_kobo,
		            status, idempotency_key, COALESCE(settlement_id::text,''), delivery_address,
		            COALESCE(dispatch_status,'none'), delivery_code, created_at
		     FROM orders WHERE customer_id=$1 ORDER BY created_at DESC`
	case "restaurant":
		q = `SELECT o.id, o.customer_id, o.restaurant_id, o.rider_id, o.subtotal_kobo, o.delivery_kobo, o.tip_kobo, o.discount_kobo, o.total_kobo,
		            o.status, o.idempotency_key, COALESCE(o.settlement_id::text,''), o.delivery_address,
		            COALESCE(o.dispatch_status,'none'), o.delivery_code, o.created_at
		     FROM orders o JOIN restaurants r ON r.id = o.restaurant_id
		     WHERE r.owner_id=$1 ORDER BY o.created_at DESC`
	case "rider":
		q = `SELECT id, customer_id, restaurant_id, rider_id, subtotal_kobo, delivery_kobo, tip_kobo, discount_kobo, total_kobo,
		            status, idempotency_key, COALESCE(settlement_id::text,''), delivery_address,
		            COALESCE(dispatch_status,'none'), delivery_code, created_at
		     FROM orders WHERE rider_id=$1 ORDER BY created_at DESC`
	default:
		return nil, fmt.Errorf("restaurant: invalid role %q (want customer|restaurant|rider)", role)
	}
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Order
	for rows.Next() {
		var o Order
		if err := rows.Scan(&o.ID, &o.CustomerID, &o.RestaurantID, &o.RiderID, &o.SubtotalKobo,
			&o.DeliveryKobo, &o.TipKobo, &o.DiscountKobo, &o.TotalKobo, &o.Status, &o.IdempotencyKey, &o.SettlementID,
			&o.DeliveryAddress, &o.DispatchStatus, &o.DeliveryCode, &o.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// ── Menu management (owner only) ──────────────────────────────────────────────

func (s *Service) assertOwner(ctx context.Context, restaurantID, userID string) error {
	var ownerID string
	if err := s.db.QueryRow(ctx, `SELECT owner_id FROM restaurants WHERE id=$1`, restaurantID).Scan(&ownerID); err != nil {
		return fmt.Errorf("restaurant: not found")
	}
	if ownerID != userID {
		return fmt.Errorf("restaurant: only the owner may manage the menu")
	}
	return nil
}

// CreateCategory adds a menu category (owner only).
func (s *Service) CreateCategory(ctx context.Context, restaurantID, userID, name string) (*MenuCategory, error) {
	if err := s.assertOwner(ctx, restaurantID, userID); err != nil {
		return nil, err
	}
	c := &MenuCategory{ID: uuid.New().String(), RestaurantID: restaurantID, Name: name}
	if _, err := s.db.Exec(ctx, `INSERT INTO menu_categories (id, restaurant_id, name) VALUES ($1,$2,$3)`,
		c.ID, c.RestaurantID, c.Name); err != nil {
		return nil, err
	}
	return c, nil
}

// CreateItemRequest is the body for adding a menu item.
type CreateItemRequest struct {
	CategoryID  string   `json:"category_id" binding:"required"`
	Name        string   `json:"name" binding:"required,min=1,max=200"`
	Description string   `json:"description"`
	PriceKobo   int64    `json:"price_kobo" binding:"required,min=0"`
	ImageURL    *string  `json:"image_url,omitempty"`
	DietaryTags []string `json:"dietary_tags,omitempty"`
}

// CreateItem adds a menu item (owner only).
func (s *Service) CreateItem(ctx context.Context, restaurantID, userID string, req CreateItemRequest) (*MenuItem, error) {
	if err := s.assertOwner(ctx, restaurantID, userID); err != nil {
		return nil, err
	}
	if err := validateItemPriceKobo(req.PriceKobo); err != nil {
		return nil, err
	}
	it := &MenuItem{
		ID:           uuid.New().String(),
		CategoryID:   req.CategoryID,
		RestaurantID: restaurantID,
		Name:         req.Name,
		Description:  req.Description,
		PriceKobo:    req.PriceKobo,
		ImageURL:     req.ImageURL,
		IsAvailable:  true,
		DietaryTags:  normalizeDietaryTags(req.DietaryTags),
	}
	if _, err := s.db.Exec(ctx,
		`INSERT INTO menu_items (id, restaurant_id, category_id, name, description, price_kobo, image_url, is_available, dietary_tags)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8)`,
		it.ID, it.RestaurantID, it.CategoryID, it.Name, it.Description, it.PriceKobo, it.ImageURL, it.DietaryTags); err != nil {
		return nil, err
	}
	return it, nil
}

// UpdateItemRequest changes price and/or availability (86 an item).
type UpdateItemRequest struct {
	PriceKobo   *int64    `json:"price_kobo,omitempty"`
	IsAvailable *bool     `json:"is_available,omitempty"`
	DietaryTags *[]string `json:"dietary_tags,omitempty"`
}

// UpdateItem updates an item's price/availability/dietary tags (owner only).
func (s *Service) UpdateItem(ctx context.Context, restaurantID, userID, itemID string, req UpdateItemRequest) (*MenuItem, error) {
	if err := s.assertOwner(ctx, restaurantID, userID); err != nil {
		return nil, err
	}
	if req.PriceKobo != nil {
		if err := validateItemPriceKobo(*req.PriceKobo); err != nil {
			return nil, err
		}
		if _, err := s.db.Exec(ctx, `UPDATE menu_items SET price_kobo=$1 WHERE id=$2 AND restaurant_id=$3`,
			*req.PriceKobo, itemID, restaurantID); err != nil {
			return nil, err
		}
	}
	if req.IsAvailable != nil {
		if _, err := s.db.Exec(ctx, `UPDATE menu_items SET is_available=$1 WHERE id=$2 AND restaurant_id=$3`,
			*req.IsAvailable, itemID, restaurantID); err != nil {
			return nil, err
		}
	}
	if req.DietaryTags != nil {
		if _, err := s.db.Exec(ctx, `UPDATE menu_items SET dietary_tags=$1 WHERE id=$2 AND restaurant_id=$3`,
			normalizeDietaryTags(*req.DietaryTags), itemID, restaurantID); err != nil {
			return nil, err
		}
	}
	var it MenuItem
	var catID *string
	const q = `SELECT id, category_id, restaurant_id, name, COALESCE(description,''), price_kobo, image_url, is_available, dietary_tags
	           FROM menu_items WHERE id=$1 AND restaurant_id=$2`
	if err := s.db.QueryRow(ctx, q, itemID, restaurantID).Scan(&it.ID, &catID, &it.RestaurantID, &it.Name,
		&it.Description, &it.PriceKobo, &it.ImageURL, &it.IsAvailable, &it.DietaryTags); err != nil {
		return nil, fmt.Errorf("restaurant: menu item not found")
	}
	if catID != nil {
		it.CategoryID = *catID
	}
	return &it, nil
}

// ── Store management (owner only) ─────────────────────────────────────────────

// ListMyRestaurants returns every store owned by the caller (the merchant's own
// stores), newest first. Used by the merchant app to load the store to manage.
func (s *Service) ListMyRestaurants(ctx context.Context, ownerID string) ([]Restaurant, error) {
	const q = `SELECT id, owner_id, name, COALESCE(description,''), address, logo_url, is_open, created_at
	           FROM restaurants WHERE owner_id=$1 ORDER BY created_at DESC`
	rows, err := s.db.Query(ctx, q, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Restaurant{}
	for rows.Next() {
		var r Restaurant
		if err := rows.Scan(&r.ID, &r.OwnerID, &r.Name, &r.Description, &r.Address, &r.LogoURL, &r.IsOpen, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// getRestaurantCore returns the core restaurant row (no menu) — used by the
// store-management mutations to echo the updated store back to the merchant.
func (s *Service) getRestaurantCore(ctx context.Context, restaurantID string) (*Restaurant, error) {
	var r Restaurant
	const q = `SELECT id, owner_id, name, COALESCE(description,''), address, logo_url, is_open, created_at
	           FROM restaurants WHERE id=$1`
	if err := s.db.QueryRow(ctx, q, restaurantID).Scan(&r.ID, &r.OwnerID, &r.Name, &r.Description,
		&r.Address, &r.LogoURL, &r.IsOpen, &r.CreatedAt); err != nil {
		return nil, fmt.Errorf("restaurant: not found")
	}
	return &r, nil
}

// UpdateRestaurantRequest is a partial update of the store profile. Nil fields are
// left unchanged (COALESCE), so a merchant can edit one field at a time.
type UpdateRestaurantRequest struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
	Address     *string `json:"address,omitempty"`
	LogoURL     *string `json:"logo_url,omitempty"`
}

// UpdateRestaurant lets the owner edit their store's name/description/address/logo.
// Changing the address re-geocodes the pin (best-effort, mirrors CreateRestaurant).
func (s *Service) UpdateRestaurant(ctx context.Context, restaurantID, userID string, req UpdateRestaurantRequest) (*Restaurant, error) {
	if err := s.assertOwner(ctx, restaurantID, userID); err != nil {
		return nil, err
	}
	if req.Name != nil && *req.Name == "" {
		return nil, fmt.Errorf("restaurant: name cannot be empty")
	}
	const q = `UPDATE restaurants
	              SET name        = COALESCE($2, name),
	                  description = COALESCE($3, description),
	                  address     = COALESCE($4, address),
	                  logo_url    = COALESCE($5, logo_url),
	                  updated_at  = NOW()
	            WHERE id = $1`
	if _, err := s.db.Exec(ctx, q, restaurantID, req.Name, req.Description, req.Address, req.LogoURL); err != nil {
		return nil, err
	}
	// Re-geocode when the address changed so "near me" stays correct. A geocode
	// failure never fails the update — the pin can be refreshed later.
	if req.Address != nil && *req.Address != "" && s.geocoder != nil {
		if lat, lng, plus, gerr := s.geocoder.Geocode(ctx, *req.Address); gerr == nil {
			_, _ = s.db.Exec(ctx,
				`UPDATE restaurants SET geo_lat=$2, geo_lng=$3, plus_code=$4, updated_at=NOW() WHERE id=$1`,
				restaurantID, lat, lng, plus)
		}
	}
	return s.getRestaurantCore(ctx, restaurantID)
}

// SetAvailability is the merchant's operational open/closed switch (business
// hours / pausing new orders). Eligibility/KYC gating is handled upstream by the
// merchant-onboarding engine — reaching this endpoint requires owning the store.
func (s *Service) SetAvailability(ctx context.Context, restaurantID, userID string, isOpen bool) (*Restaurant, error) {
	if err := s.assertOwner(ctx, restaurantID, userID); err != nil {
		return nil, err
	}
	if _, err := s.db.Exec(ctx, `UPDATE restaurants SET is_open=$2, updated_at=NOW() WHERE id=$1`,
		restaurantID, isOpen); err != nil {
		return nil, err
	}
	return s.getRestaurantCore(ctx, restaurantID)
}

// DeleteItem removes a menu item (owner only).
func (s *Service) DeleteItem(ctx context.Context, restaurantID, userID, itemID string) error {
	if err := s.assertOwner(ctx, restaurantID, userID); err != nil {
		return err
	}
	ct, err := s.db.Exec(ctx, `DELETE FROM menu_items WHERE id=$1 AND restaurant_id=$2`, itemID, restaurantID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("restaurant: menu item not found")
	}
	return nil
}

// DeleteCategory removes an empty menu category (owner only). A category that
// still has items is blocked to avoid orphaning them — the merchant removes or
// re-homes the items first.
func (s *Service) DeleteCategory(ctx context.Context, restaurantID, userID, categoryID string) error {
	if err := s.assertOwner(ctx, restaurantID, userID); err != nil {
		return err
	}
	var itemCount int
	if err := s.db.QueryRow(ctx,
		`SELECT count(*) FROM menu_items WHERE category_id=$1 AND restaurant_id=$2`,
		categoryID, restaurantID).Scan(&itemCount); err != nil {
		return err
	}
	if itemCount > 0 {
		return fmt.Errorf("restaurant: remove the category's items before deleting it")
	}
	ct, err := s.db.Exec(ctx, `DELETE FROM menu_categories WHERE id=$1 AND restaurant_id=$2`, categoryID, restaurantID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("restaurant: menu category not found")
	}
	return nil
}

// ── Rider / delivery lifecycle ────────────────────────────────────────────────

// AssignRider sets the rider candidate on an order (restaurant owner only). The
// candidate must accept before becoming the order's rider_id.
func (s *Service) AssignRider(ctx context.Context, orderID, actorID, candidateID string) error {
	_, owner, _, err := s.orderParties(ctx, orderID)
	if err != nil {
		return err
	}
	if actorID != owner {
		return fmt.Errorf("restaurant: only the restaurant may assign a rider")
	}
	if candidateID == "" {
		return fmt.Errorf("restaurant: rider id required")
	}
	if _, err := s.db.Exec(ctx, `UPDATE orders SET rider_candidate_id=$1 WHERE id=$2`, candidateID, orderID); err != nil {
		return err
	}
	s.notify(ctx, Notification{UserID: candidateID, Event: EventOrderAssigned, Title: "Delivery offer",
		Body: "You have a new delivery offer.", Data: map[string]any{"order_id": orderID}})
	return nil
}

// AcceptDelivery lets an offered rider claim an order, becoming its rider. With
// auto-dispatch, an order is offered to several riders at once; the first to
// accept wins. The row is locked (FOR UPDATE) so concurrent accepts can't
// double-assign. Honors the legacy single rider_candidate_id too.
func (s *Service) AcceptDelivery(ctx context.Context, orderID, riderID string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("restaurant: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var candidate *string
	var existingRider *string
	if err := tx.QueryRow(ctx, `SELECT rider_candidate_id, rider_id FROM orders WHERE id=$1 FOR UPDATE`, orderID).
		Scan(&candidate, &existingRider); err != nil {
		return fmt.Errorf("restaurant: order not found")
	}
	if existingRider != nil {
		return fmt.Errorf("restaurant: order already has a rider")
	}

	// The rider must have an open auto-dispatch offer, or be the legacy candidate.
	var offered bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM restaurant_delivery_offers
		                 WHERE order_id=$1 AND rider_id=$2 AND status='offered')`,
		orderID, riderID).Scan(&offered); err != nil {
		return fmt.Errorf("restaurant: check offer: %w", err)
	}
	if !offered && (candidate == nil || *candidate != riderID) {
		return fmt.Errorf("restaurant: you are not an offered rider for this order")
	}

	if _, err := tx.Exec(ctx, `UPDATE orders SET rider_id=$1, dispatch_status='assigned', assigned_at=COALESCE(assigned_at, now()) WHERE id=$2`, riderID, orderID); err != nil {
		return err
	}
	// Mark this rider's offer accepted; expire the rest so they drop off other
	// riders' offer lists.
	if _, err := tx.Exec(ctx,
		`UPDATE restaurant_delivery_offers SET status='accepted', responded_at=now()
		 WHERE order_id=$1 AND rider_id=$2`, orderID, riderID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE restaurant_delivery_offers SET status='expired', responded_at=now()
		 WHERE order_id=$1 AND rider_id<>$2 AND status='offered'`, orderID, riderID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("restaurant: commit accept: %w", err)
	}

	customer, owner, _, _ := s.orderParties(ctx, orderID)
	if customer != "" {
		s.notify(ctx, Notification{UserID: customer, Event: EventOrderAccepted, Title: "Rider assigned",
			Body: "A rider is handling your delivery.", Data: map[string]any{"order_id": orderID}})
	}
	if owner != "" {
		s.notify(ctx, Notification{UserID: owner, Event: EventOrderAccepted, Title: "Rider accepted",
			Body: "A rider accepted the delivery.", Data: map[string]any{"order_id": orderID}})
	}
	s.broadcastStatus(orderID, OrderStatus("rider_accepted"))
	return nil
}

// PostLocation records the assigned rider's current position and fans it out to
// the order's participants. Only the assigned rider may post.
func (s *Service) PostLocation(ctx context.Context, orderID, riderID string, lat, lng float64) error {
	_, _, rider, err := s.orderParties(ctx, orderID)
	if err != nil {
		return err
	}
	if rider == "" || rider != riderID {
		return fmt.Errorf("restaurant: only the assigned rider may post location")
	}
	if _, err := s.db.Exec(ctx,
		`INSERT INTO restaurant_rider_locations (id, order_id, rider_id, lat, lng)
		 VALUES ($1,$2,$3,$4,$5)`,
		uuid.New().String(), orderID, riderID, lat, lng); err != nil {
		return err
	}
	s.broadcastLocation(orderID, lat, lng)
	return nil
}

// RiderOffers lists deliveries auto-dispatched (offered) to a rider but not yet
// claimed by anyone. Reads the multi-candidate offers table — the rider may be
// one of several riders an order was offered to; the first to accept wins.
// Falls back to the legacy single rider_candidate_id for backward compatibility.
func (s *Service) RiderOffers(ctx context.Context, riderID string) ([]Order, error) {
	const q = `SELECT o.id, o.customer_id, o.restaurant_id, o.rider_id, o.subtotal_kobo, o.delivery_kobo, o.tip_kobo, o.discount_kobo, o.total_kobo,
	                  o.status, o.idempotency_key, COALESCE(o.settlement_id::text,''), o.delivery_address,
	                  COALESCE(o.dispatch_status,'none'), o.delivery_code, o.created_at
	           FROM orders o
	           WHERE o.rider_id IS NULL
	             AND o.status NOT IN ('delivered','cancelled')
	             AND (
	               EXISTS (SELECT 1 FROM restaurant_delivery_offers off
	                        WHERE off.order_id = o.id AND off.rider_id = $1 AND off.status = 'offered')
	               OR o.rider_candidate_id = $1
	             )
	           ORDER BY o.created_at DESC`
	orders, err := s.queryOrders(ctx, q, riderID)
	if err != nil {
		return nil, err
	}
	// PII minimization (SEC-009): an OFFERED rider hasn't committed yet, so they see only
	// the approximate area — the full delivery address is revealed once they accept (via
	// RiderActive / GetOrder as the assigned rider).
	for i := range orders {
		orders[i].DeliveryAddress = maskDeliveryAddress(orders[i].DeliveryAddress)
	}
	return orders, nil
}

// RiderActive lists the rider's in-progress deliveries (accepted, not terminal).
func (s *Service) RiderActive(ctx context.Context, riderID string) ([]Order, error) {
	const q = `SELECT id, customer_id, restaurant_id, rider_id, subtotal_kobo, delivery_kobo, tip_kobo, discount_kobo, total_kobo,
	                  status, idempotency_key, COALESCE(settlement_id::text,''), delivery_address,
	                  COALESCE(dispatch_status,'none'), delivery_code, created_at
	           FROM orders WHERE rider_id=$1 AND status NOT IN ('delivered','cancelled')
	           ORDER BY created_at DESC`
	return s.queryOrders(ctx, q, riderID)
}

func (s *Service) queryOrders(ctx context.Context, q string, arg string) ([]Order, error) {
	rows, err := s.db.Query(ctx, q, arg)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Order
	for rows.Next() {
		var o Order
		if err := rows.Scan(&o.ID, &o.CustomerID, &o.RestaurantID, &o.RiderID, &o.SubtotalKobo,
			&o.DeliveryKobo, &o.TipKobo, &o.DiscountKobo, &o.TotalKobo, &o.Status, &o.IdempotencyKey, &o.SettlementID,
			&o.DeliveryAddress, &o.DispatchStatus, &o.DeliveryCode, &o.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}
