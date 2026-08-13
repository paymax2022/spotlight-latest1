package restaurant

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/provider/disbursement"
)

// lagosTZ is the delivery locale used to decide the night-fee window. Loaded once;
// if the tzdata is unavailable the service falls back to the process-local zone.
var lagosTZ = func() *time.Location {
	if loc, err := time.LoadLocation("Africa/Lagos"); err == nil {
		return loc
	}
	return time.Local
}()

// AddressGeocoder resolves a typed address to a pin + Plus Code. Satisfied by
// maps.LocationGeocoder (the provider-agnostic MapService). Optional: when nil,
// restaurants are created without coordinates (a pin can be set later via the
// MapService /locations endpoint).
type AddressGeocoder interface {
	Geocode(ctx context.Context, address string) (lat, lng float64, plusCode string, err error)
}

// RouteDistancer returns real driving distance (km) + ETA (minutes) between two
// pins. Satisfied by maps.LocationGeocoder (Google Distance Matrix when
// configured). Optional: when nil or erroring, the delivery fee falls back to
// straight-line haversine distance.
type RouteDistancer interface {
	RouteDistanceKmEta(ctx context.Context, oLat, oLng, dLat, dLng float64) (km, etaMin float64, err error)
}

// TierLimiter is the fail-closed KYC-tier / daily-spend gate on restaurant money moves
// (order escrow + merchant withdrawals). Modeled as a local interface so the money-path
// code depends on the behaviour, not on finance/tiers.
type TierLimiter interface {
	EnforceWalletDebitLimit(ctx context.Context, userID string, amountKobo int64) error
}

// ErrTierGateUnwired is returned by every restaurant money path when the Service was
// built WITHOUT a TierLimiter. A nil gate is a deployment misconfiguration, not a
// dev-mode bypass: CLAUDE.md's iron rule requires every money mutation to pass a
// fail-closed tier check, so "no gate wired" must mean "no money moves" rather than
// "all limits are unlimited". See docs/adr/ADR-030-restaurant-escrow-tier-gate.md.
var ErrTierGateUnwired = errors.New("restaurant: money path requires a tier gate (WithTiers not wired)")

// ErrOrderMissingIdem is returned when PlaceOrder is called without an Idempotency-Key.
// The HTTP handlers reject an empty key before reaching the service; this is the
// service-layer backstop for direct callers. Mirrors ErrWithdrawMissingIdem.
var ErrOrderMissingIdem = errors.New("restaurant: Idempotency-Key required to place an order")

// Service manages restaurants, menus, and orders.
type Service struct {
	db          *pgxpool.Pool
	settlement  *settlement.Service
	ledger      *ledger.Service // money path for payout-run disbursement (nil → payouts disabled)
	geocoder    AddressGeocoder
	distancer   RouteDistancer      // optional; nil → haversine straight-line distance
	feeRepo     *DeliveryConfigRepo // distance-based delivery-fee config (nil-safe → defaults)
	notifier    Notifier            // nil-safe via s.notify; defaults to LogNotifier
	rt          *Realtime           // optional; nil → no WS fan-out
	commission  CommissionRecorder  // optional; nil ⇒ realized-profit recording is a no-op
	tiers       TierLimiter         // REQUIRED; fail-closed gate on order escrow + withdrawal debit
	withdrawalsOn bool              // FEATURE_RESTAURANT_WITHDRAWALS_ENABLED
	disburser   WithdrawalDisburser // optional; nil ⇒ NoopDisburser (default sandbox)
}

func NewService(db *pgxpool.Pool, settlement *settlement.Service) *Service {
	return &Service{db: db, settlement: settlement, notifier: LogNotifier{}, feeRepo: NewDeliveryConfigRepo(db)}
}

// WithLedger attaches the finance ledger used by the payout-run disbursement
// subsystem (BuildRun/ProcessRun). Without it, payout runs are disabled (the
// service returns an error rather than moving money through a shadow path).
func (s *Service) WithLedger(l *ledger.Service) *Service {
	s.ledger = l
	return s
}

// WithRealtime attaches the WS fan-out used to push status/location/chat updates
// to an order's connected participants. nil-safe (fan-out becomes a no-op).
func (s *Service) WithRealtime(rt *Realtime) *Service {
	s.rt = rt
	return s
}

// WithGeocoder attaches an address geocoder so new restaurants get a pin
// (geo_lat/geo_lng + plus_code) automatically, which syncs into merchant_locations.
func (s *Service) WithGeocoder(g AddressGeocoder) *Service {
	s.geocoder = g
	return s
}

// WithDistancer attaches a routing-distance provider (Google Distance Matrix) so
// delivery fees use real driving distance + ETA instead of straight-line.
func (s *Service) WithDistancer(d RouteDistancer) *Service {
	s.distancer = d
	return s
}

// WithTiers attaches the fail-closed KYC-tier gate used for wallet debits (order
// escrow + merchant withdrawals). REQUIRED for every money path in this module:
// without it PlaceOrder and RequestWithdrawal both refuse with ErrTierGateUnwired.
func (s *Service) WithTiers(t TierLimiter) *Service {
	s.tiers = t
	return s
}

// WithCommission attaches an optional profit-recording sink (app-wiring injects
// a thin adapter over the finance commission service).
func (s *Service) WithCommission(c CommissionRecorder) *Service {
	s.commission = c
	return s
}

// WithDisbursementRegistry wires the provider disbursement registry so merchant
// withdrawals are routed through a real payment provider (Paystack, Monnify, etc.)
// instead of the default NoopDisburser (sandbox mode). nil-safe: if no registry
// is attached, withdrawals default to NoopDisburser (funds stay reserved).
func (s *Service) WithDisbursementRegistry(reg *disbursement.Registry) *Service {
	if reg != nil {
		s.disburser = NewRegistryDisburser(reg)
	}
	return s
}

// computeDeliveryFee prices a delivery using real driving distance + ETA when a
// routing provider is available, falling back to straight-line haversine.
func (s *Service) computeDeliveryFee(ctx context.Context, rLat, rLng, dLat, dLng float64, night, weather bool, cfg DeliveryFeeConfig) DeliveryFeeBreakdown {
	if s.distancer != nil {
		if km, eta, err := s.distancer.RouteDistanceKmEta(ctx, rLat, rLng, dLat, dLng); err == nil && km > 0 {
			return ComputeDeliveryFeeFromRoute(km, eta, night, weather, cfg)
		}
	}
	return ComputeDeliveryFee(HaversineKm(rLat, rLng, dLat, dLng), night, weather, cfg)
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

// DeliveryQuote is the previewed fee for a prospective order. FlatFallback is true
// when distance pricing could not be applied (missing restaurant pin or delivery
// coords) and the flat DeliveryFeeKobo would be charged instead.
type DeliveryQuote struct {
	DeliveryFeeKobo int64                 `json:"delivery_fee_kobo"`
	FlatFallback    bool                  `json:"flat_fallback"`
	Breakdown       *DeliveryFeeBreakdown `json:"breakdown,omitempty"`
}

// QuoteDelivery previews the delivery fee for a destination, without placing an
// order. nightOverride/weatherOverride force the respective surcharge flags when
// non-nil (the app may pass them; otherwise night is derived from the Lagos clock
// and weather defaults off). Falls back to the flat fee when coords are missing.
func (s *Service) QuoteDelivery(ctx context.Context, restaurantID string, dLat, dLng float64, nightOverride, weatherOverride *bool) (*DeliveryQuote, error) {
	var rLat, rLng *float64
	if err := s.db.QueryRow(ctx, `SELECT geo_lat, geo_lng FROM restaurants WHERE id=$1`, restaurantID).Scan(&rLat, &rLng); err != nil {
		return nil, fmt.Errorf("restaurant: not found")
	}
	if rLat == nil || rLng == nil {
		return &DeliveryQuote{DeliveryFeeKobo: DeliveryFeeKobo, FlatFallback: true}, nil
	}
	cfg := s.feeRepo.LoadDeliveryConfig(ctx, restaurantID)
	night := IsNightAt(time.Now().In(lagosTZ).Hour(), cfg)
	if nightOverride != nil {
		night = *nightOverride
	}
	weather := false
	if weatherOverride != nil {
		weather = *weatherOverride
	}
	b := s.computeDeliveryFee(ctx, *rLat, *rLng, dLat, dLng, night, weather, cfg)
	return &DeliveryQuote{DeliveryFeeKobo: b.TotalKobo, Breakdown: &b}, nil
}

// GetDeliveryConfig returns the stored/effective delivery-fee config for the admin
// console (per-restaurant when restaurantID set, else the global default).
func (s *Service) GetDeliveryConfig(ctx context.Context, restaurantID *string) (*DeliveryConfigRow, error) {
	return s.feeRepo.GetDeliveryConfig(ctx, restaurantID)
}

// SetDeliveryConfig upserts the delivery-fee config (global when restaurantID nil).
func (s *Service) SetDeliveryConfig(ctx context.Context, restaurantID *string, cfg DeliveryFeeConfig, active bool) (*DeliveryConfigRow, error) {
	return s.feeRepo.UpsertDeliveryConfig(ctx, restaurantID, cfg, active)
}

// PlaceOrder validates items, computes totals, escrows payment, and creates the order.
// Supports multi-restaurant orders when items include restaurant_id; falls back to
// single-restaurant mode when all items use the route's restaurantID.
func (s *Service) PlaceOrder(ctx context.Context, restaurantID, customerID string, req PlaceOrderRequest) (*Order, error) {
	// ── Fast idempotent-replay path ───────────────────────────────────────────
	// A retry of an order this customer already placed under the same
	// Idempotency-Key returns the canonical order and moves no money.
	//
	// This MUST run before the tier gate below. The gate measures today's spend by
	// summing the customer's wallet DEBIT entries, which on a replay already include
	// THIS order's own escrow debit — so re-gating a replay counts the request
	// against itself and refuses it with "daily limit exceeded" even though the
	// money already moved and the order exists. The caller would see a hard
	// rejection for an order that succeeded, and might re-order under a fresh key
	// and pay twice. Same ordering as RequestWithdrawal, which resolves its
	// idempotency key before calling EnforceWalletDebitLimit.
	//
	// The post-INSERT ON CONFLICT branch below stays as the concurrent-race
	// backstop for two requests that pass this check simultaneously.
	if req.IdempotencyKey == "" {
		// Defence in depth: both HTTP handlers already reject an empty key. Without
		// this, a direct service caller would hit the lookup below with '' — a legal,
		// globally UNIQUE value in orders.idempotency_key — and silently receive their
		// previous ''-keyed order instead of placing a new one.
		return nil, ErrOrderMissingIdem
	}
	existing, err := s.findOrderByIdempotencyKey(ctx, req.IdempotencyKey, customerID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}

	// Collect unique restaurants from items (or use the route's restaurantID as fallback).
	// This enables multi-restaurant orders while maintaining backward compatibility.
	restaurantMap := make(map[string]bool)
	for _, input := range req.Items {
		rid := input.RestaurantOf(restaurantID)
		restaurantMap[rid] = true
	}
	if len(restaurantMap) == 0 {
		return nil, fmt.Errorf("restaurant: no valid restaurants in order")
	}

	// For multi-restaurant orders, use the first one as the "primary" for backward compat
	// (stored in orders.restaurant_id). For single-restaurant, it's the only one.
	primaryRestaurantID := restaurantID
	for rid := range restaurantMap {
		if primaryRestaurantID == "" {
			primaryRestaurantID = rid
		}
		break
	}

	// Verify all restaurants are open; grab their pins for distance-based pricing.
	// Multi-restaurant: use the first/primary restaurant's pin for delivery fee.
	var isOpen bool
	var ownerID string
	var rLat, rLng *float64
	if err := s.db.QueryRow(ctx, `SELECT is_open, owner_id, geo_lat, geo_lng FROM restaurants WHERE id=$1`, primaryRestaurantID).Scan(&isOpen, &ownerID, &rLat, &rLng); err != nil {
		return nil, fmt.Errorf("restaurant: primary restaurant not found")
	}
	if !isOpen {
		return nil, fmt.Errorf("restaurant: primary restaurant is currently closed")
	}

	// Verify secondary restaurants (if multi-restaurant) are also open.
	for rid := range restaurantMap {
		if rid == primaryRestaurantID {
			continue
		}
		var secondOpen bool
		if err := s.db.QueryRow(ctx, `SELECT is_open FROM restaurants WHERE id=$1`, rid).Scan(&secondOpen); err != nil {
			return nil, fmt.Errorf("restaurant: restaurant %s not found", rid)
		}
		if !secondOpen {
			return nil, fmt.Errorf("restaurant: restaurant %s is currently closed", rid)
		}
	}

	// Fetch and validate menu items; group by restaurant for downstream processing.
	type itemWithRest struct {
		item       OrderItem
		restID     string
	}
	var itemsWithRest []itemWithRest
	var subtotal int64
	for _, input := range req.Items {
		restID := input.RestaurantOf(restaurantID)
		var mi MenuItem
		const qMI = `SELECT id, restaurant_id, name, price_kobo, is_available FROM menu_items WHERE id=$1 AND restaurant_id=$2`
		if err := s.db.QueryRow(ctx, qMI, input.MenuItemID, restID).Scan(&mi.ID, &mi.RestaurantID, &mi.Name, &mi.PriceKobo, &mi.IsAvailable); err != nil {
			return nil, fmt.Errorf("restaurant: menu item %s not found in restaurant %s", input.MenuItemID, restID)
		}
		if !mi.IsAvailable {
			return nil, fmt.Errorf("restaurant: menu item '%s' is not available", mi.Name)
		}
		lineTotal := mi.PriceKobo * int64(input.Quantity)
		itemsWithRest = append(itemsWithRest, itemWithRest{
			item: OrderItem{
				ID:           uuid.New().String(),
				MenuItemID:   mi.ID,
				Name:         mi.Name,
				PriceKobo:    mi.PriceKobo,
				Quantity:     input.Quantity,
				SubtotalKobo: lineTotal,
			},
			restID: restID,
		})
		subtotal += lineTotal
	}

	// Min-order gate (CT-007): an undersized cart is rejected BEFORE escrow —
	// no money moves for an order the restaurant would refuse.
	var minOrderKobo int64
	if err := s.db.QueryRow(ctx, `SELECT COALESCE(min_order_kobo,0) FROM restaurants WHERE id=$1`, restaurantID).Scan(&minOrderKobo); err == nil && minOrderKobo > 0 && subtotal < minOrderKobo {
		return nil, fmt.Errorf("restaurant: cart subtotal %d kobo is below the restaurant's minimum order of %d kobo", subtotal, minOrderKobo)
	}

	// Delivery fee: distance-based when BOTH the restaurant pin AND the delivery
	// coordinates are available; otherwise fall back to the flat DeliveryFeeKobo
	// (back-compat for clients that don't send coords yet).
	deliveryKobo := DeliveryFeeKobo
	var breakdown *DeliveryFeeBreakdown
	var distanceMeters, etaMinutes *float64
	if dLat, dLng, ok := req.DeliveryCoords(); ok && rLat != nil && rLng != nil {
		cfg := s.feeRepo.LoadDeliveryConfig(ctx, restaurantID)
		night := IsNightAt(time.Now().In(lagosTZ).Hour(), cfg)
		b := s.computeDeliveryFee(ctx, *rLat, *rLng, dLat, dLng, night, false /* weather: no live feed in v1 */, cfg)
		deliveryKobo = b.TotalKobo
		breakdown = &b
		dm := math.Round(b.DistanceKm*1000*10) / 10 // numeric(10,1) meters
		em := b.EtaMinutes
		distanceMeters = &dm
		etaMinutes = &em
	}

	// Rider tip: escrowed WITH the order total and paid 100% to the rider at
	// settlement (settlement.Split.TipKobo). This is the ONE client-supplied amount on
	// the order, so it is bounded on both sides before it can reach the escrow debit:
	//   - negative is clamped to 0 (never a discount; also violates orders_tip_kobo_nonneg);
	//   - it may not exceed the order's own value, which rejects fat-finger/hostile
	//     amounts up front and keeps `total` far from int64 overflow.
	tipKobo := req.TipKobo
	if tipKobo < 0 {
		tipKobo = 0
	}
	if tipKobo > subtotal+deliveryKobo {
		return nil, fmt.Errorf("restaurant: tip of %d kobo exceeds the order value of %d kobo", tipKobo, subtotal+deliveryKobo)
	}

	total := subtotal + deliveryKobo + tipKobo
	orderID := uuid.New().String()
	ref := "order:" + orderID

	// ── Fail-closed tier / daily-limit gate on the escrow debit ────────────────
	// The Escrow below DEBITS the customer's wallet, so placing an order is a wallet
	// debit like any other and owes CLAUDE.md's iron rule #4 a fail-closed tier check:
	// a Tier 0 customer has no wallet at all, and every capped tier has a daily debit
	// ceiling that this order must fit under. The check and the debit read the same
	// rows — tiers sums today's user_wallet DEBIT entries, which is exactly what the
	// escrow posts — so the cap prices food orders alongside transfers and withdrawals
	// instead of leaving food as an uncapped side door out of the wallet.
	//
	// Enforced on `total` — subtotal + delivery + tip — because that is the whole
	// amount leaving the customer's wallet. Gating only the food subtotal would let
	// the delivery fee and tip escape the cap.
	//
	// Placement is deliberate:
	//   - AFTER the free validations (closed restaurant, unknown/unavailable item,
	//     min-order, tip bound) so each keeps returning its own specific error, and
	//     so a cart that would be refused anyway never costs a tier lookup;
	//   - IMMEDIATELY BEFORE settlement.Escrow, with nothing between them, so a
	//     rejected order leaves behind no ledger entry, no settlement row, and no
	//     order row. Nothing to reverse, because nothing was written.
	//
	// A nil gate is refused rather than treated as "unlimited" — see ErrTierGateUnwired.
	// This stays unconditional: a deployment with no gate must not place orders at all.
	if s.tiers == nil {
		return nil, ErrTierGateUnwired
	}

	// The limit itself is skipped when this key's escrow ALREADY committed. That
	// happens when a prior attempt posted the escrow and then died before the order
	// row landed — an item deleted mid-flight, a commit timeout, a pod restart. The
	// fast path at the top of this function cannot see that case (there is no order
	// row), but the wallet debit is already posted, so re-authorising it here would
	// count it against the customer a second time and refuse the very retry that
	// heals the stranded escrow. settlement.Escrow is idempotent on this key and will
	// post no second debit, so there is nothing left for the gate to authorise.
	//
	// Without this, gating the escrow would have broken settlement.Escrow's documented
	// crash-recovery property: the money would sit in escrow with no order attached,
	// invisible to the reconciler (which joins orders) and with no path to a refund.
	escrowed, err := s.escrowCommittedFor(ctx, req.IdempotencyKey, customerID)
	if err != nil {
		return nil, err
	}
	if !escrowed {
		if err := s.tiers.EnforceWalletDebitLimit(ctx, customerID, total); err != nil {
			// Wrapped, not replaced: handlers match tiers.ErrWalletDisabled /
			// tiers.ErrDailyLimitExceeded with errors.Is to pick the HTTP status.
			return nil, fmt.Errorf("restaurant: order escrow tier gate: %w", err)
		}
	}

	// Escrow full amount: 80% restaurant, 10% rider, 10% platform (the tip rides on
	// top of that split — the percentages price total − tip).
	sett, err := s.settlement.Escrow(ctx, customerID, ref, req.IdempotencyKey, "food_delivery", total)
	if err != nil {
		return nil, fmt.Errorf("restaurant: escrow payment: %w", err)
	}

	order := &Order{
		ID:                orderID,
		CustomerID:        customerID,
		RestaurantID:      restaurantID,
		SubtotalKobo:      subtotal,
		DeliveryKobo:      deliveryKobo,
		TipKobo:           tipKobo,
		TotalKobo:         total,
		Status:            OrderPending,
		IdempotencyKey:    req.IdempotencyKey,
		SettlementID:      sett.ID,
		DeliveryAddress:   req.DeliveryAddress,
		DistanceMeters:    distanceMeters,
		EtaMinutes:        etaMinutes,
		DeliveryBreakdown: breakdown,
		CreatedAt:         time.Now(),
	}

	// delivery_breakdown is a NOT NULL jsonb column (default '{}'); marshal the
	// breakdown when present, else store an empty object.
	breakdownJSON := []byte("{}")
	if breakdown != nil {
		if bj, mErr := json.Marshal(breakdown); mErr == nil {
			breakdownJSON = bj
		}
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("restaurant: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	const insertOrder = `
		INSERT INTO orders (id, customer_id, restaurant_id, subtotal_kobo, delivery_kobo, tip_kobo, total_kobo, status, idempotency_key, settlement_id, delivery_address, distance_meters, eta_minutes, delivery_breakdown)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,$10,$11,$12,$13)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := tx.Exec(ctx, insertOrder,
		order.ID, order.CustomerID, primaryRestaurantID,
		order.SubtotalKobo, order.DeliveryKobo, order.TipKobo, order.TotalKobo,
		order.IdempotencyKey, order.SettlementID, order.DeliveryAddress,
		order.DistanceMeters, order.EtaMinutes, breakdownJSON,
	)
	if err != nil {
		return nil, fmt.Errorf("restaurant: insert order: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Idempotent replay that raced the fast path at the top of this function: an
		// order with this Idempotency-Key was committed by a concurrent request while
		// we were mid-flight (the escrow debit was deduped on the same key, so no
		// second debit was posted). Return the canonical existing order instead of
		// failing on the UNIQUE constraint with a 500.
		_ = tx.Rollback(ctx)
		return s.getOrderByIdempotencyKey(ctx, order.IdempotencyKey, customerID)
	}

	// Insert order items and their restaurant mappings (multi-restaurant support).
	const insertItem = `INSERT INTO order_items (id, order_id, menu_item_id, name, price_kobo, quantity, subtotal_kobo) VALUES ($1,$2,$3,$4,$5,$6,$7)`
	const insertRestMapping = `INSERT INTO order_restaurant_items (id, order_id, order_item_id, restaurant_id) VALUES ($1,$2,$3,$4)`
	for _, iwr := range itemsWithRest {
		iwr.item.OrderID = order.ID
		if _, err := tx.Exec(ctx, insertItem,
			iwr.item.ID, iwr.item.OrderID, iwr.item.MenuItemID,
			iwr.item.Name, iwr.item.PriceKobo, iwr.item.Quantity, iwr.item.SubtotalKobo,
		); err != nil {
			return nil, fmt.Errorf("restaurant: insert order item: %w", err)
		}
		// Map this item to its source restaurant (enables split-kitchen workflow).
		if _, err := tx.Exec(ctx, insertRestMapping,
			uuid.New().String(), order.ID, iwr.item.ID, iwr.restID,
		); err != nil {
			return nil, fmt.Errorf("restaurant: insert order restaurant mapping: %w", err)
		}
		order.Items = append(order.Items, iwr.item)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	// Notify the restaurant owner of the new order; broadcast over the order WS.
	s.notify(ctx, Notification{
		UserID: ownerID,
		Event:  EventOrderPlaced,
		Title:  "New order received",
		Body:   "You have a new food order to confirm.",
		Data:   map[string]any{"order_id": order.ID, "total_kobo": order.TotalKobo},
	})
	s.broadcastStatus(order.ID, OrderPending)
	return order, nil
}

// OrderParties is the exported form of orderParties, used to wire the Realtime
// participant resolver from the app package.
func (s *Service) OrderParties(ctx context.Context, orderID string) (customer, owner, rider string, err error) {
	return s.orderParties(ctx, orderID)
}

// orderParties returns the three participant user-ids for an order: the
// customer, the restaurant owner, and the assigned rider (rider may be empty).
// findOrderByIdempotencyKey resolves the order this customer previously created under
// the given Idempotency-Key. It returns (nil, nil) when there is no such order, and a
// real error ONLY when the lookup itself failed — a transient pool error must not be
// mistaken for a miss, or the caller would fall through and re-gate an order that
// already exists.
//
// Scoped to the CALLING customer, not to the stored row's customer: Idempotency-Keys
// are client-chosen, so resolving one to whichever order happens to hold it would let
// any caller read a stranger's order by replaying their key. A key that exists but
// belongs to someone else is a miss here.
func (s *Service) findOrderByIdempotencyKey(ctx context.Context, idemKey, customerID string) (*Order, error) {
	var id string
	err := s.db.QueryRow(ctx,
		`SELECT id FROM orders WHERE idempotency_key=$1 AND customer_id=$2`, idemKey, customerID).
		Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("restaurant: resolve order for idempotency key: %w", err)
	}
	return s.GetOrder(ctx, id, customerID)
}

// escrowCommittedFor reports whether this customer already has a committed escrow for
// the given Idempotency-Key. Used to tell "a fresh order" apart from "a retry whose
// wallet debit already posted", which must not be charged against the tier limit twice.
func (s *Service) escrowCommittedFor(ctx context.Context, idemKey, customerID string) (bool, error) {
	var exists bool
	if err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM settlements WHERE idempotency_key=$1 AND payer_id=$2)`,
		idemKey, customerID).Scan(&exists); err != nil {
		// Fail closed: if we cannot tell whether the escrow already posted, do not
		// guess. Refusing here leaves a retryable error and moves no money.
		return false, fmt.Errorf("restaurant: resolve existing escrow: %w", err)
	}
	return exists, nil
}

// getOrderByIdempotencyKey is findOrderByIdempotencyKey for the post-INSERT conflict
// branch, where a miss genuinely IS an error (the UNIQUE violation told us a row exists,
// so failing to resolve it means the row belongs to another customer).
func (s *Service) getOrderByIdempotencyKey(ctx context.Context, idemKey, customerID string) (*Order, error) {
	o, err := s.findOrderByIdempotencyKey(ctx, idemKey, customerID)
	if err != nil {
		return nil, err
	}
	if o == nil {
		return nil, fmt.Errorf("restaurant: order not found for idempotency key")
	}
	return o, nil
}

func (s *Service) orderParties(ctx context.Context, orderID string) (customer, owner, rider string, err error) {
	var restaurantID string
	var riderPtr *string
	const q = `SELECT customer_id, restaurant_id, rider_id FROM orders WHERE id=$1`
	if err = s.db.QueryRow(ctx, q, orderID).Scan(&customer, &restaurantID, &riderPtr); err != nil {
		return "", "", "", fmt.Errorf("restaurant: order not found")
	}
	if err = s.db.QueryRow(ctx, `SELECT owner_id FROM restaurants WHERE id=$1`, restaurantID).Scan(&owner); err != nil {
		return "", "", "", fmt.Errorf("restaurant: restaurant not found")
	}
	if riderPtr != nil {
		rider = *riderPtr
	}
	return customer, owner, rider, nil
}

// isParticipant reports whether userID is the customer, owner, or assigned rider.
func (s *Service) isParticipant(ctx context.Context, orderID, userID string) (bool, string, error) {
	customer, owner, rider, err := s.orderParties(ctx, orderID)
	if err != nil {
		return false, "", err
	}
	switch userID {
	case customer:
		return true, "customer", nil
	case owner:
		return true, "restaurant", nil
	case rider:
		if rider != "" {
			return true, "rider", nil
		}
	}
	return false, "", nil
}

// UpdateStatus advances an order's status. Restaurant owner confirms/prepares;
// rider marks picked_up/delivered; last step triggers settlement.
// UpdateStatus is the authorized public entry for owner/rider-driven status changes.
// It resolves the order's parties, enforces object-level authorization by role (only
// the order's own owner/rider/customer, each on the transitions their role owns),
// routes cancellation through the refunding cancelAndRefund path, and forbids
// `delivered` (which must go through ConfirmHandoff's proof-of-delivery gate). The
// actual guarded transition + side effects are delegated to transitionInternal.
func (s *Service) UpdateStatus(ctx context.Context, orderID, actorID string, newStatus OrderStatus) error {
	customer, owner, rider, err := s.orderParties(ctx, orderID)
	if err != nil {
		return err
	}
	if aerr := authorizeStatusChange(actorID, customer, owner, rider, newStatus); aerr != nil {
		return aerr
	}
	if newStatus == OrderCancelled {
		return s.cancelAndRefund(ctx, orderID, actorID)
	}
	return s.transitionInternal(ctx, orderID, newStatus)
}

// transitionInternal performs the guarded lifecycle transition and its side effects
// (settlement on delivered, auto-dispatch on ready, notifications). Authorization is
// assumed to have ALREADY been checked, or the caller is a trusted internal path such
// as ConfirmHandoff (after it verifies the delivery-code POD). It is the ONLY place
// `delivered` may be set.
func (s *Service) transitionInternal(ctx context.Context, orderID string, newStatus OrderStatus) error {
	var order Order
	// settlement_id is a NULLABLE column; COALESCE to '' so a settlement-less order
	// (e.g. one created outside the escrow path) scans cleanly instead of erroring —
	// which the previous `settlement_id` scan into a string masked as "order not
	// found". Mirrors the COALESCE(settlement_id::text,'') pattern in delivery.go.
	const q = `SELECT id, restaurant_id, status, COALESCE(settlement_id::text,'') FROM orders WHERE id=$1`
	if err := s.db.QueryRow(ctx, q, orderID).Scan(&order.ID, &order.RestaurantID, &order.Status, &order.SettlementID); err != nil {
		return fmt.Errorf("restaurant: order not found")
	}

	if !canTransition(order.Status, newStatus) {
		return fmt.Errorf("restaurant: cannot move order from %s to %s", order.Status, newStatus)
	}

	if _, err := s.db.Exec(ctx, `UPDATE orders SET status=$1 WHERE id=$2`, string(newStatus), orderID); err != nil {
		return err
	}

	// On delivery, settle: 80% restaurant owner, 10% rider (stubbed to owner if no rider), 10% platform.
	if newStatus == OrderDelivered {
		if err := s.settleOrder(ctx, orderID, order.RestaurantID, order.SettlementID); err != nil {
			return fmt.Errorf("restaurant: settle order: %w", err)
		}
	}

	// When the restaurant marks the order ready, auto-dispatch to nearby
	// available riders (unless one is already assigned). This is precisely what
	// "ready for pickup" activates — rider sourcing, no manual assignment.
	if newStatus == OrderReady {
		var assigned *string
		s.db.QueryRow(ctx, `SELECT rider_id FROM orders WHERE id=$1`, orderID).Scan(&assigned)
		if assigned == nil {
			if derr := s.DispatchOrder(ctx, orderID); derr != nil {
				// A dispatch hiccup must not roll back the ready transition; the
				// restaurant can re-trigger dispatch. Surface it to logs via notify.
				s.notify(ctx, Notification{UserID: "", Event: EventOrderNoRiders,
					Title: "Dispatch error", Body: derr.Error(),
					Data: map[string]any{"order_id": orderID}})
			}
		}
	}

	// Notify the relevant party and broadcast over the order WS channel.
	customer, _, rider, _ := s.orderParties(ctx, orderID)
	switch newStatus {
	case OrderConfirmed:
		s.notify(ctx, Notification{UserID: customer, Event: EventOrderConfirmed, Title: "Order confirmed", Body: "The restaurant confirmed your order.", Data: map[string]any{"order_id": orderID}})
	case OrderPreparing:
		s.notify(ctx, Notification{UserID: customer, Event: EventOrderPreparing, Title: "Order being prepared", Body: "Your food is being prepared.", Data: map[string]any{"order_id": orderID}})
	case OrderReady:
		s.notify(ctx, Notification{UserID: customer, Event: EventOrderReady, Title: "Order ready", Body: "Your order is ready for pickup.", Data: map[string]any{"order_id": orderID}})
		if rider != "" {
			s.notify(ctx, Notification{UserID: rider, Event: EventOrderReady, Title: "Order ready for pickup", Body: "The order is ready — head to the restaurant.", Data: map[string]any{"order_id": orderID}})
		}
	case OrderPickedUp:
		s.notify(ctx, Notification{UserID: customer, Event: EventOrderPickedUp, Title: "Order picked up", Body: "Your order is on the way.", Data: map[string]any{"order_id": orderID}})
	case OrderDelivered:
		s.notify(ctx, Notification{UserID: customer, Event: EventOrderDelivered, Title: "Order delivered", Body: "Enjoy your meal!", Data: map[string]any{"order_id": orderID}})
	}
	s.broadcastStatus(orderID, newStatus)
	return nil
}

// canTransition guards the order lifecycle. Returns true for legal forward
// moves (and the cancel terminal). Pure logic — unit-tested.
func canTransition(from, to OrderStatus) bool {
	if from == to {
		return false
	}
	switch from {
	case OrderPending:
		return to == OrderConfirmed || to == OrderCancelled || to == OrderRejected
	case OrderConfirmed:
		return to == OrderPreparing || to == OrderCancelled || to == OrderRejected
	case OrderPreparing:
		// Too late to reject once cooking — cancel (with refund) is the only exit.
		return to == OrderReady || to == OrderCancelled
	case OrderReady:
		return to == OrderPickedUp || to == OrderCancelled || to == OrderDispatchFailed
	case OrderPickedUp:
		return to == OrderDelivered || to == OrderDeliveryFailed
	default:
		// delivered / cancelled / rejected / dispatch_failed / delivery_failed are terminal.
		return false
	}
}

// CommissionRecorder is the nil-safe seam into the central Commission & Profit
// module (§ profit registry). app-wiring injects a thin adapter over the finance
// commission service; when the commission feature is off (or no recorder is wired)
// the field is nil and recording is a silent no-op. Modeled as a LOCAL interface so
// restaurant never imports the commission package at compile time (mirrors the
// Notifier / AddressGeocoder seams) — the adapter, which lives in app-wiring,
// discards the returned earning row and surfaces only the error.
//
// This records realized profit ONLY; it never moves money. Restaurant's own money
// movements (the 80/10/10 settlement split into owner/rider/platform wallets) are
// unchanged, and the injected recorder is deliberately constructed WITHOUT a ledger
// so RecordFor never re-posts to the ledger (no double count of the commission
// revenue account) — it appends the immutable earning row used by profit reports.
type CommissionRecorder interface {
	RecordFor(ctx context.Context, category, service, subtype string, grossKobo int64,
		sourceModule, sourceRef string, userID *string, idempotencyKey string) error
}

// SetCommissionRecorder injects the central profit-recording seam (app-wiring,
// post-construction). Nil is accepted and disables recording.
func (s *Service) SetCommissionRecorder(cr CommissionRecorder) { s.commission = cr }

// recordCommissionSafe records realized Spotlight profit for a settled food order.
// It is best-effort and MUST NEVER affect the caller's outcome: a nil recorder is a
// no-op, and any error is logged and swallowed so a profit-registry failure can
// never fail or reverse the order settlement / payout. The recorded breakdown is
// resolved server-side from the central rate card; the order id doubles as the
// source ref + idempotency key so retries and the crash-recovery reconciler never
// double-count.
func (s *Service) recordCommissionSafe(ctx context.Context, category, service, subtype string, grossKobo int64,
	sourceRef string, userID *string) {
	if s.commission == nil || grossKobo <= 0 {
		return
	}
	if err := s.commission.RecordFor(ctx, category, service, subtype, grossKobo,
		"restaurant", sourceRef, userID, sourceRef); err != nil {
		log.Printf("[restaurant] commission record (source=%s gross=%d) failed, continuing: %v", sourceRef, grossKobo, err)
	}
}

// settleOrder releases an order's escrow with the standard split: 80% restaurant
// owner / 10% rider / 10% platform, folding the rider share back into the
// restaurant (90/10) when no rider is assigned so escrow is fully released.
// A customer tip (orders.tip_kobo, escrowed with the total at placement) rides on
// top of that split and is paid 100% to the rider — the percentages price the
// non-tip base (total − tip), so a tip never inflates the restaurant or platform cut.
//
// IDEMPOTENT: it drives settlement.Settle, which is guarded WHERE the settlement
// row is 'escrowed' (a duplicate no-ops with a "cannot settle" error) and posts
// every ledger leg with ON CONFLICT (idempotency_key) DO NOTHING. Re-driving this
// after a partial crash therefore converges to exactly one payout. Shared by the
// live UpdateStatus(delivered) path and the crash-recovery reconciler.
func (s *Service) settleOrder(ctx context.Context, orderID, restaurantID, settlementID string) error {
	var riderID *string
	var tipKobo, orderTotal int64
	// Fail closed on a read error: a silent scan failure would settle the order as
	// rider-less (90/10, no rider payout) on what may be a perfectly good delivery.
	if err := s.db.QueryRow(ctx,
		`SELECT rider_id, COALESCE(tip_kobo,0), total_kobo FROM orders WHERE id=$1`, orderID).
		Scan(&riderID, &tipKobo, &orderTotal); err != nil {
		return fmt.Errorf("restaurant: load order for settlement: %w", err)
	}
	// The tip is a leg of the ESCROW, but it is read off the order row — so pay it only
	// when the escrow actually covers the order it belongs to. The two can diverge: if
	// PlaceOrder crashes between Escrow and the order insert, a retry on the same
	// Idempotency-Key re-uses the FIRST attempt's escrow row (ON CONFLICT DO NOTHING)
	// while inserting the SECOND attempt's amounts — a replay that raised the tip would
	// otherwise pay the rider a tip out of the restaurant's share, and one that raised it
	// past the escrow would wedge the settlement forever (Settle rejects tip > total).
	// Fail safe: drop the tip leg, keeping the escrow fully released via the percentages.
	if tipKobo > 0 {
		var escrowedKobo int64
		if err := s.db.QueryRow(ctx,
			`SELECT total_kobo FROM settlements WHERE id=$1`, settlementID).Scan(&escrowedKobo); err != nil {
			return fmt.Errorf("restaurant: load escrow for settlement: %w", err)
		}
		if escrowedKobo != orderTotal {
			log.Printf("[restaurant] order %s: escrowed %d != order total %d — dropping the %d kobo tip leg from the split",
				orderID, escrowedKobo, orderTotal, tipKobo)
			tipKobo = 0
		}
	}
	var ownerID string
	s.db.QueryRow(ctx, `SELECT owner_id FROM restaurants WHERE id=$1`, restaurantID).Scan(&ownerID)
	split := settlement.Split{
		ProviderID:  ownerID,
		ProviderPct: 0.80,
		PlatformPct: 0.10,
		RiderID:     riderID,
		RiderPct:    0.10,
		// The tip was escrowed with the order total at placement; Settle pays it 100%
		// to the rider on top of the percentage split (which prices total − tip, so
		// neither the restaurant nor the platform takes a cut of it).
		TipKobo: tipKobo,
	}
	if riderID == nil {
		split.ProviderPct = 0.90
		split.RiderPct = 0
		// No rider ⇒ no payee for the tip (Split.Validate rejects a tip without a
		// rider). Unreachable via the live flow — ConfirmHandoff is the only path to
		// `delivered` and it requires the assigned rider — but the crash-recovery
		// reconciler can re-drive a rider-less delivered row. Drop the tip leg so the
		// escrow is still fully released rather than stranding money in escrow. Be
		// precise about what that means: with no tip leg the percentages price the
		// WHOLE escrowed total, so the orphaned tip is released 90% to the restaurant
		// and 10% to the platform. Logged loudly because it is money landing somewhere
		// the customer did not intend — ops should reconcile it.
		if tipKobo > 0 {
			log.Printf("[restaurant] order %s settled with NO rider — orphaned tip %d kobo released 90/10 to restaurant/platform", orderID, tipKobo)
		}
		split.TipKobo = 0
	}
	if err := s.settlement.Settle(ctx, settlementID, split); err != nil {
		return err
	}

	// Record realized Spotlight profit into the central Commission & Profit registry.
	// This is the food-delivery settlement point (shared by the live UpdateStatus
	// (delivered) path and the crash-recovery reconciler re-drive). Best-effort +
	// idempotent: the order id doubles as source ref + idempotency key, so retries /
	// reconciliation never double-count. gross = the order value the platform actually
	// prices (total_kobo = food subtotal + delivery fee + tip, LESS the tip leg that
	// was paid straight through to the rider) — the SAME basis restaurant's own 10%
	// platform cut is computed on (the escrow split above applies its PlatformPct to
	// total − TipKobo). Recording the tip as realized profit would overstate earnings
	// on money the platform never took a cut of. A recorder failure is logged and
	// swallowed — it must NEVER fail the settlement above (restaurant's own settle
	// already posted the platform cut to the ledger; this appends the earning row
	// only). userID is the paying customer.
	var grossKobo int64
	var customerID string
	s.db.QueryRow(ctx, `SELECT total_kobo, customer_id FROM orders WHERE id=$1`, orderID).Scan(&grossKobo, &customerID)
	grossKobo -= split.TipKobo
	s.recordCommissionSafe(ctx, "Lifestyle", "Restaurant", "", grossKobo, orderID, &customerID)
	return nil
}

// CancelOrder refunds the customer if the order has not yet been picked up.
// CancelOrder is the authorized public cancel entry (DELETE endpoint). Only the order's
// customer or the restaurant owner may cancel; the money move is delegated to the single
// guarded cancelAndRefund path shared with the `cancelled` status transition.
func (s *Service) CancelOrder(ctx context.Context, orderID, actorID string) error {
	customer, owner, rider, err := s.orderParties(ctx, orderID)
	if err != nil {
		return err
	}
	if aerr := authorizeCancel(actorID, customer, owner, rider); aerr != nil {
		return aerr
	}
	return s.cancelAndRefund(ctx, orderID, actorID)
}

// cancelAndRefund is the single guarded cancellation path used by BOTH the DELETE cancel
// endpoint and a `cancelled` status transition — this is what fixes the money defect
// where a status-PATCH cancel left the escrow stranded (it now always refunds). It locks
// the order row FOR UPDATE so a concurrent pickup/transition cannot race it, refunds the
// escrow (idempotent on the settlement status), marks the order cancelled, then notifies.
// Idempotent: re-cancelling an already-cancelled order is a no-op.
func (s *Service) cancelAndRefund(ctx context.Context, orderID, actorID string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("restaurant: begin cancel tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var status, settlementID string
	// COALESCE the nullable settlement_id so a settlement-less order scans cleanly
	// (see transitionInternal / delivery.go) rather than masking the scan error as
	// "order not found".
	if err := tx.QueryRow(ctx,
		`SELECT status, COALESCE(settlement_id::text,'') FROM orders WHERE id=$1 FOR UPDATE`, orderID).
		Scan(&status, &settlementID); err != nil {
		return fmt.Errorf("restaurant: order not found")
	}
	if status == string(OrderCancelled) {
		return tx.Commit(ctx) // already cancelled — idempotent no-op
	}
	if status == string(OrderPickedUp) || status == string(OrderDelivered) {
		return fmt.Errorf("restaurant: cannot cancel an order that is already picked up or delivered")
	}
	// Refund the escrow before committing the cancel so an order is never marked
	// cancelled without the money being returned. Refund is idempotent on the
	// settlement status, so a retry after a mid-flight failure does not double-refund.
	// A settlement-less order (no escrow attached) has nothing to refund — real
	// orders always carry a settlement from CreateOrder, so this only guards
	// non-standard rows.
	if settlementID != "" {
		if err := s.settlement.Refund(ctx, settlementID, "order_cancelled"); err != nil {
			return fmt.Errorf("restaurant: refund order: %w", err)
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE orders SET status='cancelled' WHERE id=$1`, orderID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}

	// Notify the customer + rider (if assigned) and broadcast cancellation.
	customer, _, rider, _ := s.orderParties(ctx, orderID)
	if customer != "" && customer != actorID {
		s.notify(ctx, Notification{UserID: customer, Event: EventOrderCancelled, Title: "Order cancelled", Body: "Your order was cancelled and refunded.", Data: map[string]any{"order_id": orderID}})
	}
	if rider != "" && rider != actorID {
		s.notify(ctx, Notification{UserID: rider, Event: EventOrderCancelled, Title: "Order cancelled", Body: "An assigned order was cancelled.", Data: map[string]any{"order_id": orderID}})
	}
	s.broadcastStatus(orderID, OrderCancelled)
	return nil
}

// recordOrderEvent records an order's status transition in the audit log (best-effort).
// Used by order FSM transitions (accept, reject, dispatch, delivery-fail, reassign, etc.)
// for audit/analytics. Failures are silent to prevent status transitions from failing.
func (s *Service) recordOrderEvent(ctx context.Context, orderID, actorID string, fromStatus, toStatus OrderStatus) {
	// TODO: implement order event audit logging when audit infrastructure is wired.
	// For now, this is a no-op stub that allows callers to record events.
}

// refundAndClose handles the money-path return of escrowed order funds to the customer
// and updates the order to a terminal refunded state (rejected/dispatch_failed/cancelled).
// It posts a balanced ledger reversal and emits audit events.
func (s *Service) refundAndClose(ctx context.Context, orderID, actorID string, toStatus OrderStatus, reason string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("restaurant: begin refund tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var status, settlementID string
	if err := tx.QueryRow(ctx,
		`SELECT status, COALESCE(settlement_id::text,'') FROM orders WHERE id=$1 FOR UPDATE`, orderID).
		Scan(&status, &settlementID); err != nil {
		return fmt.Errorf("restaurant: order not found")
	}
	if status == string(toStatus) {
		return tx.Commit(ctx) // already closed in this state — idempotent no-op
	}
	// Refund the escrow BEFORE committing the terminal status so an order is never
	// closed without the money returned (mirrors cancelAndRefund). Refund is
	// idempotent on the settlement status, so a retry cannot double-refund.
	if settlementID != "" {
		if err := s.settlement.Refund(ctx, settlementID, string(toStatus)+":"+reason); err != nil {
			return fmt.Errorf("restaurant: refund order: %w", err)
		}
	}
	if _, err := tx.Exec(ctx,
		`UPDATE orders SET status=$2, status_reason=$3 WHERE id=$1`,
		orderID, string(toStatus), reason); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}

	s.recordOrderEvent(ctx, orderID, actorID, OrderStatus(status), toStatus)
	customer, _, rider, _ := s.orderParties(ctx, orderID)
	if customer != "" && customer != actorID {
		s.notify(ctx, Notification{UserID: customer, Event: EventOrderCancelled, Title: "Order refunded",
			Body: "Your order could not be fulfilled and has been refunded.",
			Data: map[string]any{"order_id": orderID, "status": string(toStatus), "reason": reason}})
	}
	if rider != "" && rider != actorID {
		s.notify(ctx, Notification{UserID: rider, Event: EventOrderCancelled, Title: "Order closed",
			Body: "An assigned order was closed.", Data: map[string]any{"order_id": orderID}})
	}
	s.broadcastStatus(orderID, toStatus)
	return nil
}
