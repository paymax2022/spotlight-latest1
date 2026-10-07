package restaurant

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/fsm"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/provider/disbursement"
)

// The food-delivery settlement percentages. They are declared ONCE here because two
// places must agree on them exactly: settleOrder, which hands them to
// settlement.Split, and the placement-time promo bound (promoFunderCapKobo), which
// has to know how much of the gross each leg is worth before anything is escrowed.
// With no rider assigned the rider share folds into the provider (90/10) so the
// escrow is still fully released — see settleOrder.
const (
	splitProviderPct = 0.80
	splitPlatformPct = 0.10
	splitRiderPct    = 0.10
	// splitProviderPctNoRider is splitProviderPct + splitRiderPct.
	splitProviderPctNoRider = 0.90
	// keyStatus is the JSON/audit-map key for an order-status value.
	keyStatus = "status"
	// keyReason is the notification/audit-map key for a human-readable reason.
	keyReason = "reason"
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
	// EnforceCheckoutDebitLimit is the customer-purchase gate. It is identical to
	// the above for Tier 1+, and only for Tier 0 admits a capped allowance so a
	// customer funded by the card rail is not blocked at escrow (ADR-043).
	// Merchant withdrawals deliberately keep EnforceWalletDebitLimit — cash out is
	// never relaxed.
	EnforceCheckoutDebitLimit(ctx context.Context, userID string, amountKobo int64) error
}

// ErrTierGateUnwired is returned by every restaurant money path when the Service was
// built WITHOUT a TierLimiter. A nil gate is a deployment misconfiguration, not a
// dev-mode bypass: CLAUDE.md's iron rule requires every money mutation to pass a
// fail-closed tier check, so "no gate wired" must mean "no money moves" rather than
// "all limits are unlimited". See docs/adr/ADR-033-restaurant-escrow-tier-gate.md.
var ErrTierGateUnwired = errors.New("restaurant: money path requires a tier gate (WithTiers not wired)")

// ErrOrderMissingIdem is returned when PlaceOrder is called without an Idempotency-Key.
// The HTTP handlers reject an empty key before reaching the service; this is the
// service-layer backstop for direct callers. Mirrors ErrWithdrawMissingIdem.
var ErrOrderMissingIdem = errors.New("restaurant: Idempotency-Key required to place an order")

// ErrExternalAmountMismatch is returned by PlaceOrderPaystackFunded when the
// freshly-recomputed order total no longer matches the amount the caller
// already verified as paid via Paystack (a price, promo, or availability
// change between the payment intent and this call). Returned BEFORE any
// escrow or order-row write, so the caller's only remaining duty is to
// reverse the external charge — see PlaceOrderPaystackFunded's doc comment.
var ErrExternalAmountMismatch = errors.New("restaurant: verified payment amount no longer matches the order total")

// Order-rejection sentinels. priceOrder refuses carts with plain, client-facing
// reasons — a closed or nonexistent restaurant, an item that is gone or 86'd, a
// cart under the house minimum, a bad scheduled slot, a malformed line. Until
// they carried sentinels every one of them fell through to the handler's
// default 500, so a customer ordering from a closed store saw "internal server
// error" instead of "restaurant closed" — the wave-5 prod probe (B4) read that
// as broken order placement when placement was in fact correctly refusing.
// Each sentinel wraps via %w at the produce site so errors.Is still resolves
// the HTTP status while the message keeps the specifics (which id, which item,
// what minimum). escrowErrStatus maps them: not-found → 404, state rejections
// (closed / unavailable / under-minimum) → 422, malformed input → 400.
var (
	ErrRestaurantNotFound   = errors.New("restaurant: not found")
	ErrRestaurantClosed     = errors.New("restaurant: currently closed")
	ErrMenuItemNotFound     = errors.New("restaurant: menu item not found")
	ErrMenuItemUnavailable  = errors.New("restaurant: menu item not available")
	ErrBelowMinOrder        = errors.New("restaurant: below minimum order")
	ErrOrderInvalid         = errors.New("restaurant: invalid order")
	ErrScheduledSlotInvalid = errors.New("restaurant: invalid scheduled slot")
)

// Service manages restaurants, menus, and orders.
type Service struct {
	db            *pgxpool.Pool
	settlement    *settlement.Service
	ledger        *ledger.Service // money path for payout-run disbursement (nil → payouts disabled)
	geocoder      AddressGeocoder
	distancer     RouteDistancer      // optional; nil → haversine straight-line distance
	feeRepo       *DeliveryConfigRepo // distance-based delivery-fee config (nil-safe → defaults)
	notifier      Notifier            // nil-safe via s.notify; defaults to LogNotifier
	rt            *Realtime           // optional; nil → no WS fan-out
	commission    CommissionRecorder  // optional; nil ⇒ realized-profit recording is a no-op
	tiers         TierLimiter         // REQUIRED; fail-closed gate on order escrow + withdrawal debit
	withdrawalsOn bool                // FEATURE_RESTAURANT_WITHDRAWALS_ENABLED
	// moderationOn gates the listing-review requirement in discovery
	// (FEATURE_FOODHUB_MODERATION). OFF by default: with it off, discovery serves
	// exactly what it served before listing review existed (PRD §1.4).
	moderationOn bool
	disburser    WithdrawalDisburser // optional; nil ⇒ NoopDisburser (default sandbox)
	// externalRefunder reverses a Paystack-funded (EscrowExternal) order's
	// escrow correctly — see ExternalRefunder's doc comment. nil ⇒ such a
	// refund logs for manual reconciliation instead of running incorrectly.
	externalRefunder ExternalRefunder
	disbursement     provider.DisbursementProvider // optional; nil ⇒ no account verification on bank-account add
	// audit is the durable audit sink order transitions write through
	// (recordOrderEvent). nil ⇒ transition events stay unwritten — the
	// transition itself is unaffected either way.
	audit OrderAuditor
}

// OrderAuditor is the nil-safe seam into the shared durable audit sink
// (services.AuditService satisfies this signature — the app-wiring auditSink).
// Modeled as a LOCAL interface (mirrors CommissionRecorder / Notifier /
// ExternalRefunder) so restaurant never imports the services package at
// compile time.
type OrderAuditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// WithAudit attaches the durable audit sink used by recordOrderEvent so every
// order FSM transition lands in audit_logs (E2E-X-030). Nil is accepted and
// leaves recordOrderEvent a no-op — audit must never gate a transition.
func (s *Service) WithAudit(a OrderAuditor) *Service {
	s.audit = a
	return s
}

// ExternalRefunder is the nil-safe seam restaurant.Service uses to correctly
// unwind a Paystack-funded (EscrowExternal) order's escrow — the ACTUAL
// external refund plus the matching ledger-side reversal — wherever
// refundEscrowOnce would otherwise call settlement.Refund. Refund itself now
// refuses (settlement.ErrWrongRefundMethod) on an externally-funded
// settlement rather than wrongly wallet-crediting it (a real defect found
// while porting this same Paystack-checkout pattern to ride-hailing — see
// that error's doc comment for the full account); this seam is what makes
// the refund actually succeed instead of merely failing safely.
// Modeled as a local interface (mirrors CommissionRecorder / TierLimiter) so
// restaurant never imports paystackcheckout or any provider package.
type ExternalRefunder interface {
	// RefundExternalSettlement reverses settlementID, which MUST be an
	// EscrowExternal-funded row. orderID lets the adapter resolve the
	// Paystack reference it needs for the real gateway refund (the intents
	// table is keyed by order, not by settlement id). reason is a short
	// machine tag for logging/audit.
	RefundExternalSettlement(ctx context.Context, orderID, settlementID, reason string) error
}

// SetExternalRefunder injects the Paystack-refund seam (app-wiring,
// post-construction). Nil is accepted: a nil seam means an externally-funded
// refund is logged loudly for manual reconciliation rather than run
// incorrectly — fail closed, not fail wrong.
func (s *Service) SetExternalRefunder(r ExternalRefunder) { s.externalRefunder = r }

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

// WithDisbursementProvider attaches a bank-disbursement provider (e.g., Paystack)
// for real-time account verification when merchants add bank accounts. nil-safe:
// if no provider is attached, account verification is skipped (is_verified stays false).
func (s *Service) WithDisbursementProvider(p provider.DisbursementProvider) *Service {
	s.disbursement = p
	return s
}

// WithModeration enables the listing-review gate in discovery.
// Off by default and deliberately so: every existing restaurant is backfilled
// APPROVED, so turning it on changes nothing for them, but a NEW restaurant
// starts DRAFT and stays out of discovery until a reviewer approves it. That is
// the intended behaviour and the reason it ships dark.
func (s *Service) WithModeration(enabled bool) *Service {
	s.moderationOn = enabled
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
	if !validGeoPointPair(req.GeoLat, req.GeoLng) {
		return nil, errors.New("restaurant: invalid coordinates")
	}
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
	if err != nil {
		return r, err
	}

	// A pin the owner confirmed on the map (mobile's AddressAutocompleteInput)
	// beats the best-effort geocode of the free-text address below — it is the
	// exact spot the owner picked, not a rooftop-centroid guess. Skip the
	// auto-geocode entirely when one was supplied.
	if req.GeoLat != nil && req.GeoLng != nil {
		r.GeoLat, r.GeoLng = req.GeoLat, req.GeoLng
		_, _ = s.db.Exec(ctx,
			`UPDATE restaurants SET geo_lat=$2, geo_lng=$3, plus_code=$4, updated_at=NOW() WHERE id=$1`,
			r.ID, *req.GeoLat, *req.GeoLng, req.PlusCode)
		return r, nil
	}

	// Best-effort: geocode the address to a pin so "near me" works. The UPDATE
	// fires the merchant_locations sync trigger. A geocode failure never fails
	// restaurant creation (the pin can be set later via /maps/locations).
	if s.geocoder != nil && r.Address != "" {
		if lat, lng, plus, gerr := s.geocoder.Geocode(ctx, r.Address); gerr == nil {
			_, _ = s.db.Exec(ctx,
				`UPDATE restaurants SET geo_lat=$2, geo_lng=$3, plus_code=$4, updated_at=NOW() WHERE id=$1`,
				r.ID, lat, lng, plus)
		}
	}
	return r, nil
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
		return nil, errors.New("restaurant: not found")
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
// itemWithRest pairs a validated, priced order line with the restaurant it
// belongs to (multi-restaurant cart support). Package-level so orderPricing
// can carry it out of priceOrder.
type itemWithRest struct {
	item   OrderItem
	restID string
}

// orderPricing is the complete, read-only price quote for a cart: every
// value placeOrder needs to actually persist and settle the order, plus
// Total — the exact amount that will be escrowed, wallet-funded or
// externally-funded either way. Computing it touches no money and reserves
// nothing (the promo check it runs is a pure eligibility read; the promo
// SLOT is only reserved later, in placeOrder itself, right before escrow).
// See QuoteOrder for the one caller outside placeOrder that needs this.
type orderPricing struct {
	primaryRestaurantID string
	ownerID             string
	scheduledFor        *time.Time
	itemsWithRest       []itemWithRest
	subtotal            int64
	deliveryKobo        int64
	breakdown           *DeliveryFeeBreakdown
	distanceMeters      *float64
	etaMinutes          *float64
	surgeKobo           int64
	serviceFeeKobo      int64
	tipKobo             int64
	discountKobo        int64
	promoID             *string
	promoFunder         *string
	packageCount        int
	packagingKobo       int64
	total               int64
}

// priceOrder computes orderPricing for a cart against CURRENT DB state
// (menu prices, restaurant hours/pricing config, promo eligibility, delivery
// config). Extracted out of placeOrder so QuoteOrder (a pre-payment price
// check) and placeOrder (the actual placement) always run the EXACT same
// pricing logic — two independently-maintained copies of this arithmetic
// would drift, which is exactly the kind of gap a money-safety review would
// (rightly) flag. See placeOrder for the phases that follow pricing: tier
// gate, promo slot reservation, escrow, persistence — none of which belong
// here, because a caller that only wants a quote (QuoteOrder) must trigger
// NONE of them.
func (s *Service) priceOrder(ctx context.Context, restaurantID, customerID string, req PlaceOrderRequest) (*orderPricing, error) {
	// Collect unique restaurants from items (or use the route's restaurantID as fallback).
	// This enables multi-restaurant orders while maintaining backward compatibility.
	restaurantMap := make(map[string]bool)
	for _, input := range req.Items {
		rid := input.RestaurantOf(restaurantID)
		restaurantMap[rid] = true
	}
	if len(restaurantMap) == 0 {
		return nil, fmt.Errorf("%w: no valid restaurants in order", ErrOrderInvalid)
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
	// service_fee_bp / surge_bp are the platform's pricing knobs (SetPricingConfig).
	// Read here, at order time, so the order is priced by the config in force when it
	// was placed — a later ops change must never reprice an order retroactively.
	var pricingCfg PricingConfig
	// Per-pack takeaway packaging price, owner-set. Read at order time with the rest
	// of the pricing config, so a later change never reprices a placed order.
	var packagingFeePerPackKobo int64
	if err := s.db.QueryRow(ctx,
		`SELECT is_open, owner_id, geo_lat, geo_lng, COALESCE(service_fee_bp,0), COALESCE(surge_bp,0), COALESCE(packaging_fee_kobo,0) FROM restaurants WHERE id=$1`,
		primaryRestaurantID).
		Scan(&isOpen, &ownerID, &rLat, &rLng, &pricingCfg.ServiceFeeBp, &pricingCfg.SurgeBp, &packagingFeePerPackKobo); err != nil {
		return nil, fmt.Errorf("%w (%s)", ErrRestaurantNotFound, primaryRestaurantID)
	}

	// A scheduled order books a FUTURE slot, so it is gated on that slot falling inside
	// the restaurant's weekly hours (SG-001/002) rather than on the restaurant being open
	// at this instant — people schedule precisely when the place is shut. Validated here,
	// before any money moves, so an impossible slot never reaches the escrow.
	scheduledFor, serr := s.resolveScheduledFor(ctx, primaryRestaurantID, req.ScheduledFor, time.Now())
	if serr != nil {
		return nil, serr
	}
	// "Open right now" therefore only gates IMMEDIATE orders. For a scheduled one, whether
	// the kitchen is open when the slot arrives is settled by ActivateScheduledOrders,
	// which releases it into the live queue or auto-cancels AND REFUNDS it (SG-002).
	if !isOpen && scheduledFor == nil {
		return nil, fmt.Errorf("%w (%s)", ErrRestaurantClosed, primaryRestaurantID)
	}

	// Verify secondary restaurants (if multi-restaurant) are also open — same rule.
	for rid := range restaurantMap {
		if rid == primaryRestaurantID {
			continue
		}
		var secondOpen bool
		if err := s.db.QueryRow(ctx, `SELECT is_open FROM restaurants WHERE id=$1`, rid).Scan(&secondOpen); err != nil {
			return nil, fmt.Errorf("%w (%s)", ErrRestaurantNotFound, rid)
		}
		if !secondOpen && scheduledFor == nil {
			return nil, fmt.Errorf("%w (%s)", ErrRestaurantClosed, rid)
		}
	}

	var itemsWithRest []itemWithRest
	var subtotal int64
	for _, input := range req.Items {
		restID := input.RestaurantOf(restaurantID)
		var mi MenuItem
		const qMI = `SELECT id, restaurant_id, name, price_kobo, is_available FROM menu_items WHERE id=$1 AND restaurant_id=$2`
		if err := s.db.QueryRow(ctx, qMI, input.MenuItemID, restID).Scan(&mi.ID, &mi.RestaurantID, &mi.Name, &mi.PriceKobo, &mi.IsAvailable); err != nil {
			return nil, fmt.Errorf("%w (%s in restaurant %s)", ErrMenuItemNotFound, input.MenuItemID, restID)
		}
		if !mi.IsAvailable {
			return nil, fmt.Errorf("%w (%s)", ErrMenuItemUnavailable, mi.Name)
		}
		// Sanity-bound the line before it is multiplied. Quantity was only bounded below
		// (>= 1), and the pricing that follows multiplies before it divides — see
		// maxLineQuantity. order_items.quantity is a Postgres INT, but that constraint
		// only fires on the INSERT, long after the escrow debit is posted.
		if input.Quantity > maxLineQuantity {
			return nil, fmt.Errorf("%w: quantity %d for '%s' exceeds the per-line maximum of %d", ErrOrderInvalid, input.Quantity, mi.Name, maxLineQuantity)
		}

		// Chosen modifiers price the line. resolveLineModifiers is fail-closed against
		// the item's OWN groups: an unknown or 86'd option, a duplicate, or a group whose
		// min/max (or `required`) is violated rejects the order — before any money moves.
		// That matters both ways round: an unpriced add-on is money the restaurant never
		// gets, and a required "Size" left unchosen is an order the kitchen cannot make.
		// The groups are loaded per line rather than once per menu item because the same
		// item may legitimately appear twice in a cart with different options; the extra
		// reads are bounded by the cart size and happen before the escrow.
		groups, gerr := s.loadItemModifierGroups(ctx, mi.ID)
		if gerr != nil {
			return nil, fmt.Errorf("restaurant: load modifiers for '%s': %w", mi.Name, gerr)
		}
		chosen, modifiersKobo, merr := resolveLineModifiers(groups, input.ModifierIDs)
		if merr != nil {
			return nil, merr
		}
		// modifiersKobo is a PER-UNIT surcharge, so it multiplies with the quantity —
		// two burgers with extra cheese are charged for two lots of cheese.
		lineTotal := (mi.PriceKobo + modifiersKobo) * int64(input.Quantity)
		snapshot := make([]OrderItemModifier, 0, len(chosen))
		for _, m := range chosen {
			snapshot = append(snapshot, OrderItemModifier{
				ModifierID: m.ID, Name: m.Name, PriceDeltaKobo: m.PriceDeltaKobo,
			})
		}
		itemsWithRest = append(itemsWithRest, itemWithRest{
			item: OrderItem{
				ID:            uuid.New().String(),
				MenuItemID:    mi.ID,
				Name:          mi.Name,
				PriceKobo:     mi.PriceKobo,
				Quantity:      input.Quantity,
				ModifiersKobo: modifiersKobo,
				Modifiers:     snapshot,
				SubtotalKobo:  lineTotal,
			},
			restID: restID,
		})
		subtotal += lineTotal
	}

	// Aggregate sanity bound: many bounded lines can still add up past what the
	// basis-point pricing below can multiply without overflowing int64. Checked once
	// here so every derived amount (surge, service fee, percentage discount, total) is
	// computed on a subtotal that is known to be safe.
	if subtotal > maxOrderSubtotalKobo {
		return nil, fmt.Errorf("%w: cart subtotal %d kobo exceeds the maximum order value of %d kobo", ErrOrderInvalid, subtotal, maxOrderSubtotalKobo)
	}

	// Min-order gate (CT-007): an undersized cart is rejected BEFORE escrow —
	// no money moves for an order the restaurant would refuse.
	var minOrderKobo int64
	if err := s.db.QueryRow(ctx, `SELECT COALESCE(min_order_kobo,0) FROM restaurants WHERE id=$1`, restaurantID).Scan(&minOrderKobo); err == nil && minOrderKobo > 0 && subtotal < minOrderKobo {
		return nil, fmt.Errorf("%w: cart subtotal %d kobo, restaurant minimum %d kobo", ErrBelowMinOrder, subtotal, minOrderKobo)
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

	// Platform pricing knobs, applied to the item subtotal in a fixed order because the
	// service fee prices what the customer is actually charged for food:
	//	surge       inflates the item subtotal (peak dynamic pricing). It is food revenue,
	//	            so it sits INSIDE the settlement gross and splits 80/10/10 like any
	//	            other item money — the restaurant shares in it.
	//	service fee is a 100%-PLATFORM leg (settlement.Split.ServiceFeeKobo, the mirror of
	//	            a rider tip). It rides on TOP of the percentages, so the restaurant and
	//	            the rider take no cut of it and it never inflates their shares. It is
	//	            charged on the surged item subtotal — the price the customer sees.
	// applyBp floors, so neither can round UP past its exact basis-point fraction.
	surgeKobo := applyBp(subtotal, pricingCfg.SurgeBp)
	itemsKobo := subtotal + surgeKobo
	serviceFeeKobo := applyBp(itemsKobo, pricingCfg.ServiceFeeBp)

	// Rider tip: escrowed WITH the order total and paid 100% to the rider at
	// settlement (settlement.Split.TipKobo). This is the ONE client-supplied amount on
	// the order, so it is bounded on both sides before it can reach the escrow debit:
	//   - negative is clamped to 0 (never a discount; also violates orders_tip_kobo_nonneg);
	//   - it may not exceed the order's own value, which rejects fat-finger/hostile
	//     amounts up front and keeps `total` far from int64 overflow.
	tipKobo := max(req.TipKobo, 0)
	if tipKobo > itemsKobo+deliveryKobo {
		return nil, fmt.Errorf("%w: tip of %d kobo exceeds the order value of %d kobo", ErrOrderInvalid, tipKobo, itemsKobo+deliveryKobo)
	}

	// Promo discount. `grossKobo` is the value the 80/10/10 percentages price (surged
	// items + delivery, before any discount, and excluding both the tip and the service
	// fee, which are fixed legs on top) — the same `gross` settlement.Settle reconstructs
	// at release time.
	// A supplied code is resolved BEFORE anything is escrowed and FAILS the order when it
	// cannot be applied (ErrPromoInvalid → 422). Silently ignoring a bad code — what this
	// path did while resolvePromo went uncalled — charges the customer the undiscounted
	// price they never agreed to, which is the worse failure by far.
	// The surge is INSIDE the gross, so a percentage promo discounts the surged price the
	// customer is actually quoted (and min_subtotal_kobo gates on it too). The service fee
	// is OUTSIDE it: a discount is never taken off the platform's fixed fee.
	// KNOWN SCOPING LIMIT on a multi-restaurant cart: the code is resolved against the
	// PRIMARY restaurant and discounts the whole cart's subtotal, and the discount lands
	// on the primary owner's leg. That follows the module's existing single-provider
	// settlement (orders.restaurant_id is the only payee) rather than adding a second
	// unmodelled behaviour — but a restaurant-scoped code will discount another
	// restaurant's items. Per-restaurant promo scoping needs per-restaurant settlement
	// first.
	grossKobo := itemsKobo + deliveryKobo
	var discountKobo int64
	var promoID, promoFunder *string
	if code := strings.TrimSpace(req.PromoCode); code != "" {
		ap, perr := s.resolvePromo(ctx, primaryRestaurantID, customerID, code, itemsKobo, deliveryKobo, time.Now())
		if perr != nil {
			return nil, perr
		}
		// Fail closed on a discount the declared funder's settlement leg cannot bear:
		// escrowing it would produce an order that can NEVER settle (Settle rejects a
		// negative leg), stranding the customer's money in escrow.
		if ferr := assertDiscountFundable(ap, grossKobo); ferr != nil {
			return nil, ferr
		}
		discountKobo = ap.DiscountKobo
		pid, funder := ap.PromoID, string(ap.Funder)
		promoID, promoFunder = &pid, &funder
	}

	// Mandatory takeaway packaging: one fee per pack the customer arranged their food
	// into. The pack count is a customer choice (they may add packs beyond what the
	// packing rules require), so it arrives from the client and PackagingKobo clamps
	// it to [1, total portions] before it can price anything — a client number never
	// reaches the escrow debit unbounded.
	// Checkout has ALWAYS shown this line and added it to the total it displays, but
	// nothing server-side ever charged it, so the customer was shown one number and
	// billed another. Pricing it here closes that gap.
	totalPortions := 0
	for _, it := range itemsWithRest {
		totalPortions += it.item.Quantity
	}
	packageCount, packagingKobo := PackagingKobo(req.PackageCount, totalPortions, packagingFeePerPackKobo)

	// What the customer actually pays and what is escrowed: the discounted gross plus the
	// three fixed legs that ride on top of the percentages. settlement.Settle reverses
	// exactly this at release (base = total − tip − serviceFee − providerFee;
	// gross = base + discount).
	total := grossKobo - discountKobo + serviceFeeKobo + tipKobo + packagingKobo

	return &orderPricing{
		primaryRestaurantID: primaryRestaurantID,
		ownerID:             ownerID,
		scheduledFor:        scheduledFor,
		itemsWithRest:       itemsWithRest,
		subtotal:            subtotal,
		deliveryKobo:        deliveryKobo,
		breakdown:           breakdown,
		distanceMeters:      distanceMeters,
		etaMinutes:          etaMinutes,
		surgeKobo:           surgeKobo,
		serviceFeeKobo:      serviceFeeKobo,
		tipKobo:             tipKobo,
		discountKobo:        discountKobo,
		promoID:             promoID,
		promoFunder:         promoFunder,
		packageCount:        packageCount,
		packagingKobo:       packagingKobo,
		total:               total,
	}, nil
}

// QuoteOrder computes the exact price of a cart from CURRENT menu/promo/
// delivery-config state — the SAME computation placeOrder itself uses to
// price the order it actually places (see priceOrder) — without moving any
// money, reserving any promo slot, or writing anything.
// This exists for a caller that must know the exact amount to charge BEFORE
// it can collect payment (a Paystack-checkout initiate step: Paystack needs
// an amount up front). It is advisory to that caller only: placeOrder (run
// AFTER payment is verified, via PlaceOrderPaystackFunded) independently
// recomputes this same total from whatever DB state exists AT THAT LATER
// MOMENT and cross-checks it against what was actually verified as paid
// (ErrExternalAmountMismatch) — so a price/availability/promo change between
// this quote and the eventual placement is caught there, not trusted here.
func (s *Service) QuoteOrder(ctx context.Context, restaurantID, customerID string, req PlaceOrderRequest) (int64, error) {
	pricing, err := s.priceOrder(ctx, restaurantID, customerID, req)
	if err != nil {
		return 0, err
	}
	return pricing.total, nil
}

// placeOrder is the shared implementation behind PlaceOrder (wallet-funded,
// KYC-tier-gated) and PlaceOrderPaystackFunded (funded by an
// ALREADY-VERIFIED external Paystack charge, never wallet-gated — see that
// function's doc comment for why, and settlement.EscrowExternal for the
// ledger side). `external` is NEVER settable by client input on any
// HTTP-facing request DTO — see the two exported wrappers below.
// verifiedAmountKobo is ignored when external is false. When external is
// true it is the amount the caller already verified Paystack collected for
// this order, and is cross-checked against the total this function computes
// itself from current DB state (menu prices, promo, availability) — see the
// check right after `total` is computed. This function trusts NO caller
// claim about the total; it only trusts a caller's claim about what was
// actually collected, and then requires that to match its own math.
func (s *Service) placeOrder(ctx context.Context, restaurantID, customerID string, req PlaceOrderRequest, external bool, verifiedAmountKobo int64) (*Order, error) {
	// A retry of an order this customer already placed under the same
	// Idempotency-Key returns the canonical order and moves no money.
	// This MUST run before the tier gate below. The gate measures today's spend by
	// summing the customer's wallet DEBIT entries, which on a replay already include
	// THIS order's own escrow debit — so re-gating a replay counts the request
	// against itself and refuses it with "daily limit exceeded" even though the
	// money already moved and the order exists. The caller would see a hard
	// rejection for an order that succeeded, and might re-order under a fresh key
	// and pay twice. Same ordering as RequestWithdrawal, which resolves its
	// idempotency key before calling EnforceWalletDebitLimit.
	// It must equally run before PROMO resolution, for the same shape of reason: the
	// promo checks are stateful and time-dependent, so replaying an order whose
	// redemption already committed fails its OWN usage_limit/per_user_limit (the counts
	// now include the first attempt) and 422s an order that exists and is escrowed. A
	// promo whose window closed between the two attempts does the same.
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

	// Price the cart against current DB state — menu prices, restaurant hours/pricing
	// config, promo eligibility, delivery config. See priceOrder: this is the SAME
	// computation QuoteOrder runs for a pre-payment price check, so the two can never
	// drift apart.
	pricing, err := s.priceOrder(ctx, restaurantID, customerID, req)
	if err != nil {
		return nil, err
	}
	primaryRestaurantID := pricing.primaryRestaurantID
	ownerID := pricing.ownerID
	scheduledFor := pricing.scheduledFor
	itemsWithRest := pricing.itemsWithRest
	subtotal := pricing.subtotal
	deliveryKobo := pricing.deliveryKobo
	breakdown := pricing.breakdown
	distanceMeters := pricing.distanceMeters
	etaMinutes := pricing.etaMinutes
	surgeKobo := pricing.surgeKobo
	serviceFeeKobo := pricing.serviceFeeKobo
	tipKobo := pricing.tipKobo
	discountKobo := pricing.discountKobo
	promoID := pricing.promoID
	promoFunder := pricing.promoFunder
	packageCount := pricing.packageCount
	packagingKobo := pricing.packagingKobo
	total := pricing.total

	// External-funding amount cross-check — BEFORE anything writes (same placement
	// principle as the tier gate below): the caller already verified Paystack collected
	// verifiedAmountKobo for this order at intent-creation time, from a price quoted
	// against the DB state at THAT moment. Menu prices, promo eligibility, and item
	// availability can all change between quoting and this call, so this function never
	// trusts that quote — it recomputes `total` itself from current state (above) and
	// requires it to match exactly what was actually collected. A mismatch aborts with
	// no escrow and no order row; the caller's only remaining duty is to reverse the
	// external charge (see PlaceOrderPaystackFunded's doc comment) since there is no
	// wallet leg here to unwind.
	if external && total != verifiedAmountKobo {
		return nil, ErrExternalAmountMismatch
	}

	orderID := uuid.New().String()
	ref := "order:" + orderID

	// The rest of PlaceOrder runs as phases that each hold AT MOST ONE pool connection,
	// and never overlap. This is a hard requirement, not tidiness: keeping the
	// order transaction open across settlement.Escrow deadlocks, because Escrow
	// needs a SECOND connection of its own (ledger.Debit, then the settlements
	// insert). Once concurrency reached half the pool size every connection was
	// pinned by an order tx while every tx waited for a connection that could
	// never come free — reproducible with pool_max_conns=4 and 8 concurrent
	// orders (goroutines parked in puddle.Pool.acquire inside Escrow).
	//	0. tier gate                 (reads only — nothing to unwind)
	//	1. reserve the promo slot    (short tx: FOR UPDATE + count + redemption insert)
	//	2. escrow                     (its own connection)
	//	3. insert the order           (its own tx)
	// Anything added here that needs the DB while `tx` is open must go ON `tx`.

	// The Escrow below DEBITS the customer's wallet, so placing an order owes
	// CLAUDE.md's iron rule #4 a fail-closed tier check (Tier 0 has no wallet;
	// capped tiers have a daily debit ceiling). Enforced on `total` — subtotal +
	// delivery + tip — the whole amount leaving the wallet.
	// Placement is deliberate:
	//   - AFTER the free validations so a refused cart never costs a tier lookup;
	//   - BEFORE anything that writes, so a tier rejection leaves no ledger entry,
	//     no settlement/order row, and no promo redemption (a burned single-use
	//     slot would be spent on an order never allowed).
	// A nil gate is refused (ErrTierGateUnwired), never "unlimited".
	// Skipped when external is true: a Paystack-funded order never touches the
	// wallet (settlement.EscrowExternal), so the daily-wallet-debit limit has
	// nothing to price — see PlaceOrderPaystackFunded.
	if !external {
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
		// Without this, gating the escrow would have broken settlement.Escrow's documented
		// crash-recovery property: the money would sit in escrow with no order attached,
		// invisible to the reconciler (which joins orders) and with no path to a refund.
		escrowed, err := s.escrowCommittedFor(ctx, req.IdempotencyKey, customerID)
		if err != nil {
			return nil, err
		}
		if !escrowed {
			if err := s.tiers.EnforceCheckoutDebitLimit(ctx, customerID, total); err != nil {
				// Wrapped, not replaced: handlers match tiers.ErrWalletDisabled /
				// tiers.ErrDailyLimitExceeded with errors.Is to pick the HTTP status.
				return nil, fmt.Errorf("restaurant: order escrow tier gate: %w", err)
			}
		}
	}

	// Phase 1 — reserve the promo slot. The lock is held only for the length of this
	// short transaction, and committing it is what publishes the redemption to the next
	// waiter. Still BEFORE the escrow, so a loser of the limit race is rejected with
	// nothing to unwind, which was the point of taking the lock early in the first place.
	if promoID != nil {
		if rerr := s.reservePromoRedemption(ctx, *promoID, orderID, customerID, discountKobo); rerr != nil {
			return nil, rerr
		}
	}

	// Phase 2 — escrow. Full amount: 80% restaurant, 10% rider, 10% platform (the tip
	// rides on top of that split — the percentages price total − tip). If this fails the
	// reservation above is released, so a declined card does not burn the customer's
	// promo allowance.
	// external routes this to EscrowExternal, which posts DR provider-clearing / CR
	// escrow instead of debiting the customer's wallet — the money already left the
	// customer via an already-verified Paystack charge, so there is no wallet leg to
	// post here. Everything downstream (order/items insert, Settle, disputes,
	// reconciliation) reads the same settlements row shape either way.
	var sett *settlement.Settlement
	if external {
		sett, err = s.settlement.EscrowExternal(ctx, customerID, ref, req.IdempotencyKey, "food_delivery", total)
	} else {
		sett, err = s.settlement.Escrow(ctx, customerID, ref, req.IdempotencyKey, "food_delivery", total)
	}
	if err != nil {
		s.releasePromoReservationSafe(ctx, promoID, orderID)
		return nil, fmt.Errorf("restaurant: escrow payment: %w", err)
	}

	// Phase 3 — persist the order.
	tx, err := s.db.Begin(ctx)
	if err != nil {
		s.releasePromoReservationSafe(ctx, promoID, orderID)
		return nil, fmt.Errorf("restaurant: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	order := &Order{
		ID:               orderID,
		CustomerID:       customerID,
		RestaurantID:     restaurantID,
		SubtotalKobo:     subtotal,
		DeliveryKobo:     deliveryKobo,
		SurgeKobo:        surgeKobo,
		ServiceFeeKobo:   serviceFeeKobo,
		PackagingFeeKobo: packagingKobo,
		PackageCount:     packageCount,
		TipKobo:          tipKobo,
		DiscountKobo:     discountKobo,
		PromoID:          promoID,
		PromoFunder:      promoFunder,
		TotalKobo:        total,
		// Free text from the client, so it is normalized rather than trusted: control
		// characters stripped, whitespace runs collapsed, length capped (CT-009). It
		// reaches the kitchen's screen and the rider's app, both of which render it.
		SpecialInstructions: sanitizeInstructions(req.SpecialInstructions),
		ScheduledFor:        scheduledFor,
		Status:              OrderPending,
		IdempotencyKey:      req.IdempotencyKey,
		SettlementID:        sett.ID,
		DeliveryAddress:     req.DeliveryAddress,
		DistanceMeters:      distanceMeters,
		EtaMinutes:          etaMinutes,
		DeliveryBreakdown:   breakdown,
		CreatedAt:           time.Now(),
	}

	// delivery_breakdown is a NOT NULL jsonb column (default '{}'); marshal the
	// breakdown when present, else store an empty object.
	breakdownJSON := []byte("{}")
	if breakdown != nil {
		if bj, mErr := json.Marshal(breakdown); mErr == nil {
			breakdownJSON = bj
		}
	}

	const insertOrder = `
		INSERT INTO orders (id, customer_id, restaurant_id, subtotal_kobo, delivery_kobo, surge_kobo, service_fee_kobo, tip_kobo, discount_kobo, promo_id, promo_funder, total_kobo, status, idempotency_key, settlement_id, delivery_address, distance_meters, eta_minutes, delivery_breakdown, special_instructions, scheduled_for, packaging_fee_kobo, package_count)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := tx.Exec(ctx, insertOrder,
		order.ID, order.CustomerID, primaryRestaurantID,
		order.SubtotalKobo, order.DeliveryKobo, order.SurgeKobo, order.ServiceFeeKobo, order.TipKobo,
		order.DiscountKobo, order.PromoID, order.PromoFunder, order.TotalKobo,
		order.IdempotencyKey, order.SettlementID, order.DeliveryAddress,
		order.DistanceMeters, order.EtaMinutes, breakdownJSON,
		nullIfEmpty(order.SpecialInstructions), order.ScheduledFor,
		order.PackagingFeeKobo, order.PackageCount,
	)
	if err != nil {
		s.releasePromoReservationSafe(ctx, promoID, orderID)
		return nil, fmt.Errorf("restaurant: insert order: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Idempotent replay that raced the fast path at the top of this function: an
		// order with this Idempotency-Key was committed by a concurrent request while
		// we were mid-flight (the escrow debit was deduped on the same key, so no
		// second debit was posted). Return the canonical existing order instead of
		// failing on the UNIQUE constraint with a 500.
		// This attempt's promo reservation is keyed to ITS orderID, which will never
		// exist — release it so the losing racer does not burn a second slot off the
		// campaign.
		_ = tx.Rollback(ctx)
		s.releasePromoReservationSafe(ctx, promoID, orderID)
		return s.getOrderByIdempotencyKey(ctx, order.IdempotencyKey, customerID)
	}

	// The promo redemption was already written in phase 1, keyed to this orderID, so
	// there is nothing to insert here — the order row it points at now exists.

	const insertItem = `INSERT INTO order_items (id, order_id, menu_item_id, name, price_kobo, quantity, subtotal_kobo) VALUES ($1,$2,$3,$4,$5,$6,$7)`
	const insertRestMapping = `INSERT INTO order_restaurant_items (id, order_id, order_item_id, restaurant_id) VALUES ($1,$2,$3,$4)`
	const insertItemModifier = `INSERT INTO order_item_modifiers (id, order_item_id, modifier_id, name, price_delta_kobo) VALUES ($1,$2,$3,$4,$5)`
	for _, iwr := range itemsWithRest {
		iwr.item.OrderID = order.ID
		if _, err := tx.Exec(ctx, insertItem,
			iwr.item.ID, iwr.item.OrderID, iwr.item.MenuItemID,
			iwr.item.Name, iwr.item.PriceKobo, iwr.item.Quantity, iwr.item.SubtotalKobo,
		); err != nil {
			s.releasePromoReservationSafe(ctx, promoID, orderID)
			return nil, fmt.Errorf("restaurant: insert order item: %w", err)
		}
		// Snapshot the chosen options onto the line. This is what makes the line's price
		// reproducible: order_item_modifiers stores the NAME and DELTA as they were at
		// order time, so a later menu edit (re-price an extra, rename it, 86 it) can never
		// rewrite what this customer was charged. It is also the read model — GetOrder
		// derives OrderItem.ModifiersKobo by summing these rows, so without them a paid-for
		// modifier is invisible to the customer, the kitchen and any dispute.
		for _, m := range iwr.item.Modifiers {
			if _, err := tx.Exec(ctx, insertItemModifier,
				uuid.New().String(), iwr.item.ID, m.ModifierID, m.Name, m.PriceDeltaKobo,
			); err != nil {
				return nil, fmt.Errorf("restaurant: insert order item modifier: %w", err)
			}
		}
		// Map this item to its source restaurant (enables split-kitchen workflow).
		if _, err := tx.Exec(ctx, insertRestMapping,
			uuid.New().String(), order.ID, iwr.item.ID, iwr.restID,
		); err != nil {
			s.releasePromoReservationSafe(ctx, promoID, orderID)
			return nil, fmt.Errorf("restaurant: insert order restaurant mapping: %w", err)
		}
		order.Items = append(order.Items, iwr.item)
	}
	if err := tx.Commit(ctx); err != nil {
		s.releasePromoReservationSafe(ctx, promoID, orderID)
		return nil, err
	}

	s.notify(ctx, Notification{
		UserID: ownerID,
		Event:  EventOrderPlaced,
		Title:  "New order received",
		Body:   "You have a new food order to confirm.",
		Data:   map[string]any{"order_id": order.ID, "total_kobo": order.TotalKobo},
	})
	s.broadcastStatus(order.ID, OrderPending) //nolint:contextcheck // WS publish outlives the request by design
	return order, nil
}

// PlaceOrder places a wallet-funded order, gated by the customer's KYC tier
// (see placeOrder's tier-gate block). This is the only path reachable from
// client-controlled input — no HTTP request DTO has a field that can select
// the external path below.
func (s *Service) PlaceOrder(ctx context.Context, restaurantID, customerID string, req PlaceOrderRequest) (*Order, error) {
	return s.placeOrder(ctx, restaurantID, customerID, req, false, 0)
}

// PlaceOrderPaystackFunded places an order funded by an external payment rail
// (Paystack card/bank-transfer) instead of the customer's wallet — no
// KYC-tier gate applies, because no wallet debit occurs (see
// settlement.EscrowExternal and placeOrder's tier-gate skip).
// The caller MUST have already verified, server-side, that a completed
// Paystack charge exists for reference and that it collected exactly
// verifiedAmountKobo — this function trusts that verification unconditionally
// and performs none of its own against the gateway. It DOES, however,
// independently recompute the order total from current DB state and requires
// it to equal verifiedAmountKobo (see placeOrder's cross-check) — it never
// trusts a caller's claim about what the order should cost, only about what
// was actually collected. On ErrExternalAmountMismatch, no escrow and no
// order row were written; the caller must reverse the external charge.
// Must only ever be invoked from a server-initiated flow (a Paystack
// initiate/verify/webhook handler) that itself carries no client-settable
// "skip KYC" switch — never from a handler that lets request input choose
// between this and PlaceOrder.
func (s *Service) PlaceOrderPaystackFunded(ctx context.Context, restaurantID, customerID string, req PlaceOrderRequest, verifiedAmountKobo int64) (*Order, error) {
	return s.placeOrder(ctx, restaurantID, customerID, req, true, verifiedAmountKobo)
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
		return nil, errors.New("restaurant: order not found for idempotency key")
	}
	return o, nil
}

func (s *Service) orderParties(ctx context.Context, orderID string) (customer, owner, rider string, err error) {
	var restaurantID string
	var riderPtr *string
	const q = `SELECT customer_id, restaurant_id, rider_id FROM orders WHERE id=$1`
	if err = s.db.QueryRow(ctx, q, orderID).Scan(&customer, &restaurantID, &riderPtr); err != nil {
		return "", "", "", errors.New("restaurant: order not found")
	}
	if err = s.db.QueryRow(ctx, `SELECT owner_id FROM restaurants WHERE id=$1`, restaurantID).Scan(&owner); err != nil {
		return "", "", "", errors.New("restaurant: restaurant not found")
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

// maskPODCodes strips the handoff codes the viewer does NOT own. delivery_code
// belongs to the customer (the rider types it at the door); pickup_code belongs
// to the restaurant (the rider types it at the counter). Serializing either to
// a rider — or to merely-offered riders — lets them read the code and confirm
// their own handoff, self-driving the order to `delivered` and releasing
// escrow without any real pickup or delivery.
func maskPODCodes(o *Order, viewerRole string) {
	switch viewerRole {
	case "customer":
		o.PickupCode = nil
	case "restaurant":
		o.DeliveryCode = nil
	default: // rider, offered rider, anyone else
		o.DeliveryCode = nil
		o.PickupCode = nil
	}
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
	return s.transitionInternal(ctx, orderID, actorID, newStatus)
}

// transitionInternal performs the guarded lifecycle transition and its side effects
// (settlement on delivered, auto-dispatch on ready, notifications). Authorization is
// assumed to have ALREADY been checked, or the caller is a trusted internal path such
// as ConfirmHandoff (after it verifies the delivery-code POD). It is the ONLY place
// `delivered` may be set.
// actorID is the transitioning user (owner on confirm/prepare/ready, rider on
// picked_up/delivered); it is recorded as the audit actor on the emitted
// transition event — may be "" for system-driven re-drives, which audits as a
// NULL actor rather than a wrong one.
func (s *Service) transitionInternal(ctx context.Context, orderID, actorID string, newStatus OrderStatus) error {
	var order Order
	// settlement_id is a NULLABLE column; COALESCE to '' so a settlement-less order
	// (e.g. one created outside the escrow path) scans cleanly instead of erroring —
	// which the previous `settlement_id` scan into a string masked as "order not
	// found". Mirrors the COALESCE(settlement_id::text,'') pattern in delivery.go.
	const q = `SELECT id, restaurant_id, status, COALESCE(settlement_id::text,'') FROM orders WHERE id=$1`
	if err := s.db.QueryRow(ctx, q, orderID).Scan(&order.ID, &order.RestaurantID, &order.Status, &order.SettlementID); err != nil {
		return errors.New("restaurant: order not found")
	}

	if !canTransition(order.Status, newStatus) {
		return fmt.Errorf("restaurant: cannot move order from %s to %s", order.Status, newStatus)
	}

	if _, err := s.db.Exec(ctx, `UPDATE orders SET status=$1 WHERE id=$2`, string(newStatus), orderID); err != nil {
		return err
	}

	// Persist the transition audit event (best-effort — never fails the
	// transition). order.Status is the state read above, i.e. the FROM side.
	s.recordOrderEvent(ctx, orderID, actorID, order.Status, newStatus)

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
		// The pickup code proves the rider actually collected the food from THIS
		// restaurant — generated as soon as the order is ready, independent of
		// whether a rider is assigned yet, so the restaurant has it in hand the
		// moment a rider shows up. The status UPDATE above is not transactional
		// with this, so — like the dispatch call right below — a generation
		// hiccup must not roll back the already-committed ready transition;
		// DispatchOrder retries it (it's idempotent) on every dispatch/redispatch.
		if _, cerr := s.ensurePickupCode(ctx, orderID); cerr != nil {
			s.notify(ctx, Notification{UserID: "", Event: EventPickupCodeErr,
				Title: "Pickup code error", Body: cerr.Error(),
				Data: map[string]any{"order_id": orderID}})
		}
		var assigned *string
		_ = s.db.QueryRow(ctx, `SELECT rider_id FROM orders WHERE id=$1`, orderID).Scan(&assigned)
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
	s.broadcastStatus(orderID, newStatus) //nolint:contextcheck // WS publish outlives the request by design
	return nil
}

// orderTransitions is the order lifecycle's legal-move table. Too late to
// reject once cooking — cancel (with refund) is the only exit from preparing
// on. delivered / cancelled / rejected / dispatch_failed / delivery_failed
// are terminal (no entry = no outgoing moves).
var orderTransitions = fsm.Table[OrderStatus]{
	OrderPending:   fsm.Set(OrderConfirmed, OrderCancelled, OrderRejected),
	OrderConfirmed: fsm.Set(OrderPreparing, OrderCancelled, OrderRejected),
	OrderPreparing: fsm.Set(OrderReady, OrderCancelled),
	OrderReady:     fsm.Set(OrderPickedUp, OrderCancelled, OrderDispatchFailed),
	OrderPickedUp:  fsm.Set(OrderDelivered, OrderDeliveryFailed),
}

// canTransition guards the order lifecycle. Returns true for legal forward
// moves (and the cancel terminal). Pure logic — unit-tested.
func canTransition(from, to OrderStatus) bool {
	return orderTransitions.Can(from, to)
}

// CommissionRecorder is the nil-safe seam into the central Commission & Profit
// module (§ profit registry). app-wiring injects a thin adapter over the finance
// commission service; when the commission feature is off (or no recorder is wired)
// the field is nil and recording is a silent no-op. Modeled as a LOCAL interface so
// restaurant never imports the commission package at compile time (mirrors the
// Notifier / AddressGeocoder seams) — the adapter, which lives in app-wiring,
// discards the returned earning row and surfaces only the error.
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
// A promo discount (orders.discount_kobo) went the other way: it was taken OFF the
// escrowed total, so Settle adds it back to recover the pre-discount gross and charges
// it wholly to the leg that funded it (orders.promo_funder) — the other two parties
// settle as if the customer had paid full price.
// IDEMPOTENT: it drives settlement.Settle, which is guarded WHERE the settlement
// row is 'escrowed' (a duplicate no-ops with a "cannot settle" error) and posts
// every ledger leg with ON CONFLICT (idempotency_key) DO NOTHING. Re-driving this
// after a partial crash therefore converges to exactly one payout. Shared by the
// live UpdateStatus(delivered) path and the crash-recovery reconciler.
func (s *Service) settleOrder(ctx context.Context, orderID, restaurantID, settlementID string) error {
	var riderID *string
	var promoFunder *string
	var tipKobo, discountKobo, serviceFeeKobo, packagingKobo, orderTotal int64
	// Fail closed on a read error: a silent scan failure would settle the order as
	// rider-less (90/10, no rider payout) on what may be a perfectly good delivery.
	if err := s.db.QueryRow(ctx,
		`SELECT rider_id, COALESCE(tip_kobo,0), COALESCE(discount_kobo,0), COALESCE(service_fee_kobo,0), COALESCE(packaging_fee_kobo,0), promo_funder, total_kobo FROM orders WHERE id=$1`, orderID).
		Scan(&riderID, &tipKobo, &discountKobo, &serviceFeeKobo, &packagingKobo, &promoFunder, &orderTotal); err != nil {
		return fmt.Errorf("restaurant: load order for settlement: %w", err)
	}
	// The tip and the discount are both properties of the ESCROW, but they are read off
	// the order row — so honor them only when the escrow actually covers the order they
	// belong to. The two can diverge: if PlaceOrder crashes between Escrow and the order
	// insert, a retry on the same Idempotency-Key re-uses the FIRST attempt's escrow row
	// (ON CONFLICT DO NOTHING) while inserting the SECOND attempt's amounts. A replay that
	// raised the tip would pay the rider out of the restaurant's share, or wedge the
	// settlement forever once it exceeds the escrow (Settle rejects tip > total); a
	// discount read against the wrong escrow reconstructs the WRONG gross, over-paying
	// every percentage leg from money that was never collected.
	// Fail safe for both: drop the extra legs and settle the escrow on the bare
	// percentages. That is always fully releasable (gross == base == the escrowed total,
	// no leg can go negative) — value is conserved, it is simply apportioned as if the
	// order carried neither.
	if tipKobo > 0 || discountKobo > 0 || serviceFeeKobo > 0 || packagingKobo > 0 {
		var escrowedKobo int64
		if err := s.db.QueryRow(ctx,
			`SELECT total_kobo FROM settlements WHERE id=$1`, settlementID).Scan(&escrowedKobo); err != nil {
			return fmt.Errorf("restaurant: load escrow for settlement: %w", err)
		}
		if escrowedKobo != orderTotal {
			log.Printf("[restaurant] order %s: escrowed %d != order total %d — dropping the %d kobo tip, %d kobo discount and %d kobo service-fee legs from the split",
				orderID, escrowedKobo, orderTotal, tipKobo, discountKobo, serviceFeeKobo)
			tipKobo = 0
			discountKobo = 0
			serviceFeeKobo = 0
			packagingKobo = 0
		}
	}
	var ownerID string
	_ = s.db.QueryRow(ctx, `SELECT owner_id FROM restaurants WHERE id=$1`, restaurantID).Scan(&ownerID)
	split := settlement.Split{
		ProviderID:  ownerID,
		ProviderPct: splitProviderPct,
		PlatformPct: splitPlatformPct,
		RiderID:     riderID,
		RiderPct:    splitRiderPct,
		// The tip was escrowed with the order total at placement; Settle pays it 100%
		// to the rider on top of the percentage split (which prices total − tip, so
		// neither the restaurant nor the platform takes a cut of it).
		TipKobo: tipKobo,
		// The promo discount was already taken OFF the escrowed total at placement, so
		// Settle adds it back to reconstruct the pre-discount gross the percentages
		// price, then charges it to whichever leg funded it. promo_funder is the
		// snapshot taken at placement, NOT a re-read of the promo — an owner editing
		// (or an admin re-funding) the promo afterwards must never retroactively move
		// who paid for an order that already settled its terms.
		DiscountKobo:             discountKobo,
		DiscountFundedByPlatform: promoFunder != nil && *promoFunder == string(FunderPlatform),
		// Takeaway packaging was escrowed on top of the gross at placement and is paid
		// 100% to the RESTAURANT — the provider-side mirror of the tip and the service
		// fee. The restaurant buys the packs, so it is a pass-through cost and neither
		// the platform nor the rider takes a cut of it.
		ProviderFeeKobo: packagingKobo,
		// The platform service fee was escrowed on top of the gross at placement and is
		// paid 100% to the platform — the mirror of the tip. Like the tip it sits OUTSIDE
		// the percentages, so neither the restaurant nor the rider takes a cut of it, and
		// it never inflates the gross their shares are computed from.
		ServiceFeeKobo: serviceFeeKobo,
	}
	if riderID == nil {
		split.ProviderPct = splitProviderPctNoRider
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

	// Record realized Spotlight profit in the central Commission & Profit registry
	// (shared by UpdateStatus-delivered and the crash-recovery re-drive). Best-effort
	// + idempotent: order id doubles as source ref / idempotency key. gross is the
	// same basis as the 10% platform cut — tip and service fee come off (fixed
	// pass-through legs), discount goes back on (percentages price pre-discount).
	// KNOWN LIMITATION: RecordFor takes only a gross, so the service-fee leg and a
	// platform-funded discount cannot be expressed — under/over-recording
	// respectively. The LEDGER remains source of truth; this is an analytics row.
	// A recorder failure is logged and swallowed — it must never fail the settle.
	var grossKobo int64
	var customerID string
	_ = s.db.QueryRow(ctx, `SELECT total_kobo, customer_id FROM orders WHERE id=$1`, orderID).Scan(&grossKobo, &customerID)
	grossKobo = grossKobo - split.TipKobo - split.ServiceFeeKobo + split.DiscountKobo
	s.recordCommissionSafe(ctx, "Lifestyle", "Restaurant", "", grossKobo, orderID, &customerID)

	// This rider has just been paid, so their wallet is at its high-water mark — the best
	// moment to discharge any tip they owe back from an upheld dispute on an EARLIER
	// delivery (ADR-031). Best-effort and non-fatal: the settlement above is already
	// committed, and anything not recoverable now stays queued for the next payout.
	if riderID != nil {
		s.recoverRiderTipDebts(ctx, *riderID)
	}
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
	defer func() { _ = tx.Rollback(ctx) }()

	var status, settlementID string
	// COALESCE the nullable settlement_id so a settlement-less order scans cleanly
	// (see transitionInternal / delivery.go) rather than masking the scan error as
	// "order not found".
	if err := tx.QueryRow(ctx,
		`SELECT status, COALESCE(settlement_id::text,'') FROM orders WHERE id=$1 FOR UPDATE`, orderID).
		Scan(&status, &settlementID); err != nil {
		return errors.New("restaurant: order not found")
	}
	if status == string(OrderCancelled) {
		return tx.Commit(ctx) // already cancelled — idempotent no-op
	}
	if status == string(OrderPickedUp) || status == string(OrderDelivered) {
		return errors.New("restaurant: cannot cancel an order that is already picked up or delivered")
	}
	// Give any promo redemption back: the order is refunded in full, so the code was
	// never really consumed. Without this a single-use campaign dies the first time
	// anyone places-and-cancels at zero cost to themselves. Done BEFORE the refund so
	// the window between the money moving and this tx committing stays as small as
	// possible.
	if err := releasePromoRedemption(ctx, tx, orderID); err != nil {
		return fmt.Errorf("restaurant: release promo redemption: %w", err)
	}
	// Refund the escrow before committing the cancel so an order is never marked
	// cancelled without the money being returned. An escrow a previous attempt already
	// refunded counts as success, so a retry after a mid-flight crash can finish
	// cancelling the order rather than wedging on it forever. A settlement-less order
	// (no escrow attached) has nothing to refund — real orders always carry a settlement
	// from CreateOrder, so that case only guards non-standard rows.
	if err := s.refundEscrowOnce(ctx, orderID, settlementID, "order_cancelled"); err != nil {
		return fmt.Errorf("restaurant: refund order: %w", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE orders SET status='cancelled' WHERE id=$1`, orderID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}

	// Persist the transition audit event (best-effort). `status` above is the
	// state the order was locked in — the FROM side. Centralised here so every
	// caller of the cancel path (UpdateStatus, CancelOrder, the unaccepted-order
	// sweep) is covered without each recording separately.
	s.recordOrderEvent(ctx, orderID, actorID, OrderStatus(status), OrderCancelled)

	customer, _, rider, _ := s.orderParties(ctx, orderID)
	if customer != "" && customer != actorID {
		s.notify(ctx, Notification{UserID: customer, Event: EventOrderCancelled, Title: "Order cancelled", Body: "Your order was cancelled and refunded.", Data: map[string]any{"order_id": orderID}})
	}
	if rider != "" && rider != actorID {
		s.notify(ctx, Notification{UserID: rider, Event: EventOrderCancelled, Title: "Order cancelled", Body: "An assigned order was cancelled.", Data: map[string]any{"order_id": orderID}})
	}
	s.broadcastStatus(orderID, OrderCancelled) //nolint:contextcheck // WS publish outlives the request by design
	return nil
}

// refundEscrowOnce refunds an order's escrow, treating an escrow that is ALREADY
// refunded as success.
// Both closing paths (cancelAndRefund, refundAndClose) refund on the pool and then do
// more work on their own tx before committing the terminal status. If the process dies
// in between, the money is back with the customer but the order is still `pending` — and
// every retry then hits settlement.Refund's "cannot refund — current status is refunded"
// and aborts BEFORE the status flip, so the order can never be closed. It stays
// advanceable: an owner can run it to `delivered`, where Settle rejects the refunded
// settlement but the status flip has already committed, leaving the customer refunded
// AND fed with nobody paid and no alert.
// Refund is non-double-refunding but it is not a no-op, which is what the callers'
// "idempotent" comments assumed. Making the already-refunded case a success is what
// actually lets the retry converge. A settlement in any other non-refundable state
// (notably `settled`) still fails loudly — that is a genuine conflict, not a replay.
// orderID is needed only for the external-funding branch: a Paystack-funded
// order's settlement.Refund call now returns settlement.ErrWrongRefundMethod
// (that function refuses to wallet-credit money that never came from the
// wallet — see its doc comment for the incident this fixed), and reversing
// it correctly means calling the injected ExternalRefunder, which resolves
// the Paystack reference by ORDER id, not settlement id.
func (s *Service) refundEscrowOnce(ctx context.Context, orderID, settlementID, reason string) error {
	if settlementID == "" {
		return nil // no escrow attached (non-standard row) — nothing to return
	}
	var status string
	if err := s.db.QueryRow(ctx, `SELECT status FROM settlements WHERE id=$1`, settlementID).Scan(&status); err != nil {
		return fmt.Errorf("restaurant: load escrow to refund: %w", err)
	}
	if status == string(settlement.StatusRefunded) {
		return nil // a previous attempt already returned the money; finish closing the order
	}
	err := s.settlement.Refund(ctx, settlementID, reason)
	if errors.Is(err, settlement.ErrWrongRefundMethod) {
		if s.externalRefunder == nil {
			log.Printf("[restaurant] cannot refund Paystack-funded settlement=%s order=%s (reason=%s): no ExternalRefunder wired — needs manual reconciliation", settlementID, orderID, reason)
			return fmt.Errorf("restaurant: externally-funded order refund not available: %w", err)
		}
		return s.externalRefunder.RefundExternalSettlement(ctx, orderID, settlementID, reason)
	}
	return err
}

// recordOrderEvent records an order's status transition in the durable audit
// log (audit_logs via the shared services.AuditService — see WithAudit).
// Used by order FSM transitions (accept, reject, dispatch, delivery-fail,
// reassign, etc.) for audit/analytics. Best-effort and non-fatal: a nil sink
// or a sink error can never fail a status transition — the orders row and the
// ledger remain the records of truth (E2E-X-030: previously a TODO no-op, so
// transitions wrote zero audit rows). The action names the terminal state
// ("order.status.confirmed" etc.) and metadata carries {from,to}.
func (s *Service) recordOrderEvent(ctx context.Context, orderID, actorID string, fromStatus, toStatus OrderStatus) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actorID, "", "order.status."+string(toStatus), "restaurant", "order", orderID,
		map[string]any{keyStatus: string(fromStatus)},
		map[string]any{keyStatus: string(toStatus), "from": string(fromStatus), "to": string(toStatus)},
		"", "", "info")
}

// refundAndClose handles the money-path return of escrowed order funds to the customer
// and updates the order to a terminal refunded state (rejected/dispatch_failed/cancelled).
// It posts a balanced ledger reversal and emits audit events.
func (s *Service) refundAndClose(ctx context.Context, orderID, actorID string, toStatus OrderStatus, reason string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("restaurant: begin refund tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var status, settlementID string
	if err := tx.QueryRow(ctx,
		`SELECT status, COALESCE(settlement_id::text,'') FROM orders WHERE id=$1 FOR UPDATE`, orderID).
		Scan(&status, &settlementID); err != nil {
		return errors.New("restaurant: order not found")
	}
	if status == string(toStatus) {
		return tx.Commit(ctx) // already closed in this state — idempotent no-op
	}
	// Refunded in full ⇒ the promo was never consumed; give the redemption back so a
	// rejected / undeliverable order does not burn the customer's allowance or the
	// campaign's cap (mirrors cancelAndRefund). Done BEFORE the refund so the window
	// between the money moving and this tx committing stays as small as possible.
	if err := releasePromoRedemption(ctx, tx, orderID); err != nil {
		return fmt.Errorf("restaurant: release promo redemption: %w", err)
	}
	// Refund the escrow BEFORE committing the terminal status so an order is never
	// closed without the money returned (mirrors cancelAndRefund). An escrow a previous
	// attempt already refunded counts as success, so a retry after a mid-flight crash
	// can finish closing the order instead of wedging on it forever.
	if err := s.refundEscrowOnce(ctx, orderID, settlementID, string(toStatus)+":"+reason); err != nil {
		return fmt.Errorf("restaurant: refund order: %w", err)
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
			Data: map[string]any{"order_id": orderID, keyStatus: string(toStatus), keyReason: reason}})
	}
	if rider != "" && rider != actorID {
		s.notify(ctx, Notification{UserID: rider, Event: EventOrderCancelled, Title: "Order closed",
			Body: "An assigned order was closed.", Data: map[string]any{"order_id": orderID}})
	}
	s.broadcastStatus(orderID, toStatus) //nolint:contextcheck // WS publish outlives the request by design
	return nil
}

// Notifier delivers an order/chat notification to a user. The default
// LogNotifier just logs; inject a real implementation (push/in-app, backed by
// the notifications queue) via Service.SetNotifier. This seam keeps the
// restaurant service testable and prevents a hard dependency on asynq — when
// the queue is unavailable the module still functions (notifications are
// no-op/logged rather than failing the request).
type Notifier interface {
	Notify(ctx context.Context, n Notification) error
}

// Notification is the message delivered to one recipient.
type Notification struct {
	UserID string
	Event  string
	Title  string
	Body   string
	Data   map[string]any
}

// LogNotifier is the no-op default — it logs rather than delivering.
type LogNotifier struct{}

func (LogNotifier) Notify(ctx context.Context, n Notification) error {
	log.Printf("[restaurant] notify user=%s event=%s: %s", n.UserID, n.Event, n.Title)
	return nil
}

// NotifierFunc adapts a function to the Notifier interface.
type NotifierFunc func(ctx context.Context, n Notification) error

func (f NotifierFunc) Notify(ctx context.Context, n Notification) error { return f(ctx, n) }

// notify is a panic-safe, best-effort wrapper. Notification delivery never
// fails the surrounding money/order operation.
func (s *Service) notify(ctx context.Context, n Notification) {
	if s.notifier == nil {
		return
	}
	if err := s.notifier.Notify(ctx, n); err != nil {
		log.Printf("[restaurant] notify failed user=%s event=%s: %v", n.UserID, n.Event, err)
	}
}

// SetNotifier injects a real notifier (defaults to LogNotifier).
func (s *Service) SetNotifier(n Notifier) *Service {
	if n != nil {
		s.notifier = n
	}
	return s
}

// Event names emitted by the restaurant module.
const (
	EventOrderPlaced    = "restaurant.order.placed"
	EventOrderConfirmed = "restaurant.order.confirmed"
	EventOrderPreparing = "restaurant.order.preparing"
	EventOrderReady     = "restaurant.order.ready"
	EventOrderPickedUp  = "restaurant.order.picked_up"
	EventOrderDelivered = "restaurant.order.delivered"
	EventOrderCancelled = "restaurant.order.cancelled"
	EventOrderAssigned  = "restaurant.order.assigned"
	EventOrderAccepted  = "restaurant.order.accepted"
	EventOrderDispatch  = "restaurant.order.dispatch"          // offered to available riders
	EventOrderNoRiders  = "restaurant.order.no_riders"         // dispatch found no available riders
	EventOrderHandoff   = "restaurant.order.handoff"           // delivered + handed off (code confirmed)
	EventPickupCodeErr  = "restaurant.order.pickup_code_error" // failed to generate/persist the pickup code
	EventNewMessage     = "restaurant.chat.message"
	// EventOnboardingDecision — Admin ops-console onboarding decision (approve/reject) delivered to the owner.
	EventOnboardingDecision = "restaurant.onboarding.decision"
	// EventPayoutDisbursed — Payout run disbursed to a restaurant owner / rider wallet.
	EventPayoutDisbursed = "restaurant.payout.disbursed"
	// EventWithdrawalRequested — Merchant wallet→bank withdrawal lifecycle (money-path audit events).
	EventWithdrawalRequested = "restaurant.withdrawal.requested" // funds reserved, handed to disburser
	EventWithdrawalPaid      = "restaurant.withdrawal.paid"      // provider confirmed the payout landed
	EventWithdrawalReversed  = "restaurant.withdrawal.reversed"  // provider failed → funds returned to wallet
)

// Object-level authorization for the order lifecycle. These are the ONLY sentinels the
// handler maps to HTTP 403 (everything else stays 400/404). Kept pure + table-testable:
// the DB-backed service resolves the order's parties, then defers the allow/deny
// decision to the functions below.
var (
	// ErrForbidden — the caller is not a party to this order (or not the party allowed
	// to make this specific transition). Object-level authZ failure.
	ErrForbidden = errors.New("restaurant: forbidden")
	// ErrDeliveredViaHandoff — `delivered` cannot be set through the generic status
	// endpoint; the assigned rider must use ConfirmHandoff, which enforces the
	// delivery-code proof-of-delivery. This closes the POD-bypass hole.
	ErrDeliveredViaHandoff = errors.New("restaurant: delivered can only be set via rider handoff (proof of delivery)")
	// ErrPickedUpViaPickupCode — `picked_up` cannot be set through the generic
	// status endpoint; the assigned rider must use ConfirmPickup, which enforces
	// the restaurant's pickup code. Closes the same class of POD bypass as
	// ErrDeliveredViaHandoff on the pickup leg.
	ErrPickedUpViaPickupCode = errors.New("restaurant: picked_up can only be set via rider pickup confirm (proof of pickup)")
)

type orderActorRole int

const (
	roleNone orderActorRole = iota
	roleOwner
	roleRider
	roleCustomer
)

// classifyOrderActor resolves the caller's role for a specific order from that order's
// resolved parties. Precedence: restaurant owner, then the assigned rider, then the
// customer. An empty actor, or an actor matching none of the parties, is roleNone.
func classifyOrderActor(actorID, customer, owner, rider string) orderActorRole {
	switch {
	case actorID == "":
		return roleNone
	case actorID == owner:
		return roleOwner
	case rider != "" && actorID == rider:
		return roleRider
	case actorID == customer:
		return roleCustomer
	default:
		return roleNone
	}
}

// authorizeStatusChange decides whether actorID may drive the order to `to` via the
// generic status endpoint, given the order's parties. Only the order's own
// owner/rider/customer may act (object-level), and only on the transitions their role
// owns:
//   - owner:    confirmed, preparing, ready, cancelled
//   - rider:    picked_up
//   - customer: cancelled
//   - delivered: NEVER here — must go through ConfirmHandoff (POD).
//
// This does not check the FROM→TO edge validity — that stays the state-machine guard's
// job (canTransition); this only answers "may THIS caller attempt THIS target".
func authorizeStatusChange(actorID, customer, owner, rider string, to OrderStatus) error {
	if to == OrderDelivered {
		return ErrDeliveredViaHandoff
	}
	if to == OrderPickedUp {
		// Same POD bypass as delivered — ready→picked_up must go through
		// ConfirmPickup (the restaurant's pickup code proves the food actually
		// left the counter), not a bare status write by the rider.
		return ErrPickedUpViaPickupCode
	}
	role := classifyOrderActor(actorID, customer, owner, rider)
	switch to {
	case OrderConfirmed, OrderPreparing, OrderReady:
		if role == roleOwner {
			return nil
		}
	case OrderCancelled:
		if role == roleOwner || role == roleCustomer {
			return nil
		}
	}
	return ErrForbidden
}

// authorizeCancel decides whether actorID may cancel + refund the order — its customer
// or the restaurant owner (an admin path, if any, is separate). Riders and strangers
// may not.
func authorizeCancel(actorID, customer, owner, rider string) error {
	switch classifyOrderActor(actorID, customer, owner, rider) {
	case roleOwner, roleCustomer:
		return nil
	default:
		return ErrForbidden
	}
}

// A restaurant is UNCLAIMED when nobody can be identified as its merchant: no
// owner, or an owner with no active merchant profile. Such a shop can appear in
// discovery and take orders while no one can manage it and no payout has a
// destination.
// There are none today — the linking migration (20261213000000) gave all 1539
// owners a profile, and every restaurant has an owner_id. This exists so the
// state is DETECTABLE rather than silent: an admin-seeded or imported row would
// otherwise sit unmanaged with nothing surfacing it.

// UnclaimedRestaurant is a shop with no identifiable merchant behind it.
type UnclaimedRestaurant struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Address   string    `json:"address"`
	IsOpen    bool      `json:"is_open"`
	CreatedAt time.Time `json:"created_at"`
	// Reason distinguishes "no owner at all" from "owner has no merchant profile",
	// because the fix differs: assign an owner, versus link the one who is there.
	Reason string `json:"reason"`
}

// UnclaimedRestaurants lists shops with no identifiable merchant.
// Deliberately DERIVED rather than stored as an `unclaimed` flag: a flag drifts
// the moment an owner is assigned or a profile is created, and a stale flag on
// this particular question would either hide a real orphan or accuse a working
// restaurant.
func (s *Service) UnclaimedRestaurants(ctx context.Context) ([]UnclaimedRestaurant, error) {
	const q = `
		SELECT r.id, r.name, r.address, r.is_open, r.created_at,
		       CASE WHEN r.owner_id IS NULL THEN 'no owner assigned'
		            ELSE 'owner has no merchant profile' END AS reason
		FROM restaurants r
		WHERE r.owner_id IS NULL
		   OR NOT EXISTS (
		     SELECT 1 FROM onb_merchant_profile p
		     WHERE p.user_id = r.owner_id
		       AND p.merchant_type_id = 'mt-restaurant'
		       AND p.status = 'ACTIVE'
		   )
		ORDER BY r.created_at DESC
		LIMIT 200`

	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []UnclaimedRestaurant{}
	for rows.Next() {
		var u UnclaimedRestaurant
		if err := rows.Scan(&u.ID, &u.Name, &u.Address, &u.IsOpen, &u.CreatedAt, &u.Reason); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// LinkLegacyOwners gives every restaurant owner without one an ACTIVE merchant
// profile, the RBAC role, and a link from their shops to that profile.
// The same statements the 20261213000000 migration runs, exposed as a callable
// job because the condition recurs: an imported or admin-created restaurant
// arrives with an owner who has never been through onboarding, and would
// otherwise be invisible to the merchant hub while trading normally.
// Idempotent — every statement is ON CONFLICT DO NOTHING or a no-op UPDATE — so
// running it twice links nothing twice. Returns how many profiles it created.
// Legacy profiles keep application_id NULL: nobody applied, and inventing an
// application would fabricate a review that never happened.
func (s *Service) LinkLegacyOwners(ctx context.Context) (int, error) {
	tag, err := s.db.Exec(ctx, `
		INSERT INTO onb_merchant_profile
		  (user_id, module_id, merchant_type_id, application_id, role_granted, status, workspace_route, activated_at)
		SELECT DISTINCT r.owner_id, 'mod-food', 'mt-restaurant', NULL::uuid, 'restaurant_merchant', 'ACTIVE',
		       '/merchant/restaurant', now()
		FROM restaurants r
		WHERE r.owner_id IS NOT NULL
		  AND EXISTS (SELECT 1 FROM public.platform_users u WHERE u.id = r.owner_id)
		ON CONFLICT (user_id, merchant_type_id) DO NOTHING`)
	if err != nil {
		return 0, err
	}
	created := int(tag.RowsAffected())

	// A profile without the role is a half grant: the hub shows the business while
	// permissioned routes refuse it.
	if _, err := s.db.Exec(ctx, `
		INSERT INTO user_roles (user_id, role_id, scope_type, scope_id, is_active)
		SELECT DISTINCT p.user_id, ro.id, 'global', NULL, true
		FROM onb_merchant_profile p
		JOIN roles ro ON ro.slug = 'restaurant_merchant' AND ro.is_active
		WHERE p.merchant_type_id = 'mt-restaurant' AND p.status = 'ACTIVE'
		ON CONFLICT (user_id, role_id, scope_type, scope_id) DO UPDATE SET is_active = true, updated_at = NOW()`); err != nil {
		return created, err
	}

	// Matched on user_id, so a shop can never be attributed to someone else's
	// merchant record.
	if _, err := s.db.Exec(ctx, `
		UPDATE restaurants r
		   SET owner_profile_id = p.id
		  FROM onb_merchant_profile p
		 WHERE p.user_id = r.owner_id
		   AND p.merchant_type_id = 'mt-restaurant'
		   AND p.status = 'ACTIVE'
		   AND r.owner_profile_id IS DISTINCT FROM p.id`); err != nil {
		return created, err
	}
	return created, nil
}

// dispatchStaleMinutes is how long an order may sit in dispatch_status='searching'
// (no rider sourced) before the stalled-dispatch sweeper fails + refunds it (DP-003).
const dispatchStaleMinutes = 20

// RejectOrder lets the restaurant owner decline an order before it is prepared, with a
// reason, refunding the customer (RM-003). Only the owner may reject, and only a
// pending/confirmed order (canTransition enforces the stage). Money moves through the
// single guarded refundAndClose path.
func (s *Service) RejectOrder(ctx context.Context, orderID, actorID, reason string) error {
	customer, owner, rider, err := s.orderParties(ctx, orderID)
	if err != nil {
		return err
	}
	if classifyOrderActor(actorID, customer, owner, rider) != roleOwner {
		return ErrForbidden
	}
	if reason == "" {
		return errors.New("restaurant: a reason is required to reject an order")
	}
	var status string
	if err := s.db.QueryRow(ctx, `SELECT status FROM orders WHERE id=$1`, orderID).Scan(&status); err != nil {
		return errors.New("restaurant: order not found")
	}
	if !canTransition(OrderStatus(status), OrderRejected) {
		return fmt.Errorf("restaurant: cannot reject an order that is %s", status)
	}
	return s.refundAndClose(ctx, orderID, actorID, OrderRejected, reason)
}

// MarkDispatchFailed fails + refunds an order for which no rider could be sourced
// (DP-003). Ops/system path (no per-user authz — mounted behind restaurant.admin.dispatch
// or called by the sweeper). Only a 'ready' order that was still searching qualifies.
func (s *Service) MarkDispatchFailed(ctx context.Context, orderID, reason string) error {
	if reason == "" {
		reason = "no_rider_available"
	}
	var status string
	if err := s.db.QueryRow(ctx, `SELECT status FROM orders WHERE id=$1`, orderID).Scan(&status); err != nil {
		return errors.New("restaurant: order not found")
	}
	if !canTransition(OrderStatus(status), OrderDispatchFailed) {
		return fmt.Errorf("restaurant: cannot fail dispatch from %s", status)
	}
	return s.refundAndClose(ctx, orderID, "", OrderDispatchFailed, reason)
}

// MarkDeliveryFailed records that the assigned rider could not complete the drop-off
// (customer unreachable / wrong address). Only the assigned rider may set it, and only
// from picked_up. NO auto-refund: the food is already with the rider, so resolution
// (refund vs re-attempt) goes through the dispute/cancel flow — this just marks the
// failure + reason for that resolution.
func (s *Service) MarkDeliveryFailed(ctx context.Context, orderID, riderID, reason string) error {
	customer, _, rider, err := s.orderParties(ctx, orderID)
	if err != nil {
		return err
	}
	if rider == "" || rider != riderID {
		return ErrForbidden
	}
	if reason == "" {
		return errors.New("restaurant: a reason is required to report a failed delivery")
	}
	var status string
	if err := s.db.QueryRow(ctx, `SELECT status FROM orders WHERE id=$1`, orderID).Scan(&status); err != nil {
		return errors.New("restaurant: order not found")
	}
	if !canTransition(OrderStatus(status), OrderDeliveryFailed) {
		return fmt.Errorf("restaurant: cannot report failed delivery from %s", status)
	}
	if _, err := s.db.Exec(ctx, `UPDATE orders SET status='delivery_failed', status_reason=$2 WHERE id=$1`, orderID, reason); err != nil {
		return err
	}
	s.recordOrderEvent(ctx, orderID, riderID, OrderStatus(status), OrderDeliveryFailed)
	if customer != "" {
		s.notify(ctx, Notification{UserID: customer, Event: EventOrderCancelled, Title: "Delivery problem",
			Body: "We couldn't complete your delivery — support will reach out.", Data: map[string]any{"order_id": orderID, keyReason: reason}})
	}
	s.broadcastStatus(orderID, OrderDeliveryFailed) //nolint:contextcheck // WS publish outlives the request by design
	return nil
}

// SweepStalledDispatch fails + refunds orders that have been searching for a rider
// longer than dispatchStaleMinutes with none found (DP-003 auto-path). Returns the
// count swept. Intended for a periodic ops job (mirrors SweepUnacceptedOrders).
func (s *Service) SweepStalledDispatch(ctx context.Context, now time.Time) (int, error) {
	const q = `
		SELECT id FROM orders
		WHERE status = 'ready'
		  AND rider_id IS NULL
		  AND COALESCE(dispatch_status,'none') = 'searching'
		  AND ready_at IS NOT NULL
		  AND ready_at < ($1::timestamptz - make_interval(mins => $2))`
	rows, err := s.db.Query(ctx, q, now, dispatchStaleMinutes)
	if err != nil {
		return 0, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	swept := 0
	for _, id := range ids {
		if err := s.MarkDispatchFailed(ctx, id, "no_rider_available"); err == nil {
			swept++
		}
	}
	return swept, nil
}
