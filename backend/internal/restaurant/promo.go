package restaurant

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ErrPromoInvalid is returned when a supplied promo code cannot be applied (unknown,
// inactive, outside its window, subtotal below the minimum, or usage limit reached).
// It is a client error — the PlaceOrder handler maps it to HTTP 422.
var ErrPromoInvalid = errors.New("restaurant: promo code cannot be applied")

// PromoKind is how the discount is computed.
type PromoKind string

const (
	PromoPercent      PromoKind = "percent"       // ValueBp basis points off the subtotal (capped by MaxDiscountKobo)
	PromoFixed        PromoKind = "fixed"         // AmountKobo off the subtotal
	PromoFreeDelivery PromoKind = "free_delivery" // discount == the delivery fee (waives delivery)
)

// PromoFunder is who bears the discount at settlement.
type PromoFunder string

const (
	FunderPlatform   PromoFunder = "platform"
	FunderRestaurant PromoFunder = "restaurant"
)

// Promo is a discount code. RestaurantID is nil for a platform-wide promo.
type Promo struct {
	ID              string      `json:"id"`
	RestaurantID    *string     `json:"restaurant_id,omitempty"`
	Code            string      `json:"code"`
	Funder          PromoFunder `json:"funder"`
	Kind            PromoKind   `json:"kind"`
	ValueBp         int         `json:"value_bp"`
	AmountKobo      int64       `json:"amount_kobo"`
	MinSubtotalKobo int64       `json:"min_subtotal_kobo"`
	MaxDiscountKobo *int64      `json:"max_discount_kobo,omitempty"`
	StartsAt        *time.Time  `json:"starts_at,omitempty"`
	EndsAt          *time.Time  `json:"ends_at,omitempty"`
	UsageLimit      *int        `json:"usage_limit,omitempty"`
	PerUserLimit    *int        `json:"per_user_limit,omitempty"`
	Active          bool        `json:"active"`
}

// computeDiscount is the PURE discount math: given a promo and the (post-modifier)
// item subtotal, it returns the kobo to take off. Returns 0 when the subtotal is below
// the promo's minimum. The result is always clamped to [0, subtotal] so a discount can
// never exceed the items (which would push the escrowed total below delivery+tip) nor
// go negative. No clock, no DB — window/usage checks live in promoWindowOK + the
// redemption counts.
func computeDiscount(p Promo, subtotalKobo int64) int64 {
	if subtotalKobo <= 0 || subtotalKobo < p.MinSubtotalKobo {
		return 0
	}
	var d int64
	switch p.Kind {
	case PromoPercent:
		// value_bp is basis points (1000 = 10%); integer math floors the discount.
		d = subtotalKobo * int64(p.ValueBp) / 10000
		if p.MaxDiscountKobo != nil && d > *p.MaxDiscountKobo {
			d = *p.MaxDiscountKobo
		}
	case PromoFixed:
		d = p.AmountKobo
	default:
		return 0
	}
	if d > subtotalKobo {
		d = subtotalKobo
	}
	if d < 0 {
		d = 0
	}
	return d
}

// promoWindowOK is the PURE eligibility check that does not need the DB: the promo must
// be active and, if a window is set, `now` must be within [StartsAt, EndsAt].
func promoWindowOK(p Promo, now time.Time) bool {
	if !p.Active {
		return false
	}
	if p.StartsAt != nil && now.Before(*p.StartsAt) {
		return false
	}
	if p.EndsAt != nil && now.After(*p.EndsAt) {
		return false
	}
	return true
}

// loadPromoForOrder resolves a promo code usable for this restaurant: either a promo
// scoped to the restaurant, or a platform-wide one (restaurant_id IS NULL). Matching is
// case-insensitive. Returns ErrPromoInvalid when no such code exists.
func (s *Service) loadPromoForOrder(ctx context.Context, restaurantID, code string) (Promo, error) {
	const q = `
		SELECT id, restaurant_id, code, funder, kind, value_bp, amount_kobo,
		       min_subtotal_kobo, max_discount_kobo, starts_at, ends_at,
		       usage_limit, per_user_limit, active
		FROM restaurant_promos
		WHERE lower(code) = lower($1)
		  AND (restaurant_id = $2 OR restaurant_id IS NULL)
		ORDER BY restaurant_id NULLS LAST   -- prefer a restaurant-specific code over a platform-wide one
		LIMIT 1`
	var p Promo
	var funder, kind string
	if err := s.db.QueryRow(ctx, q, code, restaurantID).Scan(
		&p.ID, &p.RestaurantID, &p.Code, &funder, &kind, &p.ValueBp, &p.AmountKobo,
		&p.MinSubtotalKobo, &p.MaxDiscountKobo, &p.StartsAt, &p.EndsAt,
		&p.UsageLimit, &p.PerUserLimit, &p.Active,
	); err != nil {
		return Promo{}, fmt.Errorf("%w: unknown code", ErrPromoInvalid)
	}
	p.Funder = PromoFunder(funder)
	p.Kind = PromoKind(kind)
	return p, nil
}

// promoUsageOK checks the redemption-count limits (total and per-user). Best-effort:
// the counts are read outside the escrow tx, so a burst of concurrent orders could
// marginally exceed a limit — acceptable for a promo (a low-stakes business cap, not a
// money-safety invariant). The UNIQUE(order_id) on redemptions still prevents any
// single order from being counted twice.
func (s *Service) promoUsageOK(ctx context.Context, promoID, userID string, p Promo) (bool, error) {
	if p.UsageLimit != nil {
		var total int
		if err := s.db.QueryRow(ctx, `SELECT count(*) FROM restaurant_promo_redemptions WHERE promo_id=$1`, promoID).Scan(&total); err != nil {
			return false, err
		}
		if total >= *p.UsageLimit {
			return false, nil
		}
	}
	if p.PerUserLimit != nil {
		var mine int
		if err := s.db.QueryRow(ctx, `SELECT count(*) FROM restaurant_promo_redemptions WHERE promo_id=$1 AND user_id=$2`, promoID, userID).Scan(&mine); err != nil {
			return false, err
		}
		if mine >= *p.PerUserLimit {
			return false, nil
		}
	}
	return true, nil
}

// appliedPromo is the resolved outcome of applying a promo code to an order: the
// discount kobo and the funder snapshot that the settlement split will honor.
type appliedPromo struct {
	PromoID      string
	Funder       PromoFunder
	DiscountKobo int64
}

// resolvePromo validates a promo code against this restaurant + subtotal + user at
// `now` and returns the discount to apply. Returns ErrPromoInvalid (wrapped) when the
// code is unknown, out of window, under the minimum, or at its usage cap. A zero
// discount (e.g. a percent promo on a tiny order rounding to 0) is treated as invalid
// so the caller never records a no-op redemption.
func (s *Service) resolvePromo(ctx context.Context, restaurantID, userID, code string, subtotalKobo, deliveryKobo int64, now time.Time) (appliedPromo, error) {
	p, err := s.loadPromoForOrder(ctx, restaurantID, code)
	if err != nil {
		return appliedPromo{}, err
	}
	if !promoWindowOK(p, now) {
		return appliedPromo{}, fmt.Errorf("%w: not active", ErrPromoInvalid)
	}
	if subtotalKobo < p.MinSubtotalKobo {
		return appliedPromo{}, fmt.Errorf("%w: order below minimum of %d kobo", ErrPromoInvalid, p.MinSubtotalKobo)
	}
	ok, err := s.promoUsageOK(ctx, p.ID, userID, p)
	if err != nil {
		return appliedPromo{}, err
	}
	if !ok {
		return appliedPromo{}, fmt.Errorf("%w: usage limit reached", ErrPromoInvalid)
	}
	// free_delivery waives the delivery fee (the discount equals it); every other kind
	// discounts the item subtotal via computeDiscount. The discount still flows through
	// the same settlement mechanism (borne by the funder), so the rider/restaurant are
	// still paid for the delivery when the platform funds the waiver.
	var discount int64
	if p.Kind == PromoFreeDelivery {
		discount = deliveryKobo
	} else {
		discount = computeDiscount(p, subtotalKobo)
	}
	if discount <= 0 {
		return appliedPromo{}, fmt.Errorf("%w: no discount for this order", ErrPromoInvalid)
	}
	return appliedPromo{PromoID: p.ID, Funder: p.Funder, DiscountKobo: discount}, nil
}

// reservePromoRedemption is the AUTHORITATIVE usage-limit check. It claims this order's
// slot on the promo in ONE short transaction: lock the promo row, count the redemptions
// that are by then committed, and — if there is room — write this order's redemption.
//
// The lock is what makes the limit real. promoUsageOK (used earlier, to size the
// discount) reads the counts on the pool with nothing locked, and a count-and-compare at
// READ COMMITTED is not a constraint: N concurrent placements each see only committed
// rows plus their own, so all N pass and all N commit — every one of them redeeming a
// usage_limit=1 code. That was tolerable while no discount was ever applied; now the
// counter gates real money (a platform-funded code spends the platform's settlement leg
// on every redemption), so it has to actually hold. SELECT ... FOR UPDATE serializes
// concurrent redeemers of the SAME promo; committing publishes this redemption to the
// next waiter. Different promos never contend.
//
// TRANSACTION SCOPE IS LOAD-BEARING. This runs in its own short tx that commits before
// settlement.Escrow is called, and it must stay that way. An earlier shape took this
// lock on the ORDER's transaction and held it across Escrow — but Escrow needs a second
// pool connection, so every in-flight order pinned two, and at concurrency ≥ half the
// pool every connection was held by an order tx waiting for a connection that could
// never free. That is a deadlock of the whole order path, not a slowdown.
//
// The reservation is still taken BEFORE the escrow, so a loser of the limit race is
// rejected with no money to unwind. The cost of the split is that the redemption is no
// longer atomic with the order row: a crash between here and the order insert leaves a
// reservation pointing at an order that will never exist, burning one allowance. Every
// non-crash failure path calls releasePromoReservationSafe to give it back, and one
// stranded allowance is a far better failure than a deadlocked order path.
func (s *Service) reservePromoRedemption(ctx context.Context, promoID, orderID, userID string, discountKobo int64) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("restaurant: begin promo reservation: %w", err)
	}
	defer tx.Rollback(ctx)

	var usageLimit, perUserLimit *int
	if err := tx.QueryRow(ctx,
		`SELECT usage_limit, per_user_limit FROM restaurant_promos WHERE id=$1 FOR UPDATE`, promoID).
		Scan(&usageLimit, &perUserLimit); err != nil {
		// Deleted between resolution and here — treat as unusable, not as a 500.
		return fmt.Errorf("%w: promo is no longer available", ErrPromoInvalid)
	}
	if usageLimit != nil {
		var total int
		if err := tx.QueryRow(ctx,
			`SELECT count(*) FROM restaurant_promo_redemptions WHERE promo_id=$1`, promoID).Scan(&total); err != nil {
			return err
		}
		if total >= *usageLimit {
			return fmt.Errorf("%w: usage limit reached", ErrPromoInvalid)
		}
	}
	if perUserLimit != nil {
		var mine int
		if err := tx.QueryRow(ctx,
			`SELECT count(*) FROM restaurant_promo_redemptions WHERE promo_id=$1 AND user_id=$2`, promoID, userID).Scan(&mine); err != nil {
			return err
		}
		if mine >= *perUserLimit {
			return fmt.Errorf("%w: per-user limit reached", ErrPromoInvalid)
		}
	}
	// Claim the slot while still holding the lock, so the next waiter counts it.
	// ON CONFLICT (order_id) DO NOTHING is defensive: orderID is a fresh UUID here.
	if _, err := tx.Exec(ctx,
		`INSERT INTO restaurant_promo_redemptions (id, promo_id, order_id, user_id, discount_kobo)
		 VALUES ($1,$2,$3,$4,$5) ON CONFLICT (order_id) DO NOTHING`,
		uuid.New().String(), promoID, orderID, userID, discountKobo); err != nil {
		return fmt.Errorf("restaurant: record promo redemption: %w", err)
	}
	return tx.Commit(ctx)
}

// releasePromoReservationSafe gives a reservation back when the order it was claimed for
// does not get created (escrow declined, insert failed, idempotent replay). Best-effort
// and never returns: the caller is already on a failure path and returning its own error,
// and a promo allowance is campaign bookkeeping, not money. A leaked reservation costs
// one redemption slot; failing the caller's error with this one would hide why the order
// actually failed.
func (s *Service) releasePromoReservationSafe(ctx context.Context, promoID *string, orderID string) {
	if promoID == nil {
		return
	}
	if _, err := s.db.Exec(ctx,
		`DELETE FROM restaurant_promo_redemptions WHERE order_id=$1`, orderID); err != nil {
		log.Printf("[restaurant] could not release promo reservation for abandoned order %s (promo %s): %v — one redemption slot is stranded",
			orderID, *promoID, err)
	}
}

// releasePromoRedemption gives a promo redemption back when an order is cancelled or
// refunded before delivery. Without it a single-use campaign can be killed for free:
// place an order with the code, cancel immediately (full refund, zero cost), and the
// redemption row keeps counting against usage_limit forever. It also stops a
// restaurant-initiated cancellation from silently burning a customer's per-user
// allowance. Runs on the caller's tx so it commits with the cancellation itself.
//
// This is NOT a ledger record — redemptions are campaign bookkeeping, so deleting the
// row is the correct way to un-consume it; the money movement is reversed separately by
// settlement.Refund, which posts its own balanced entries and rewrites nothing.
func releasePromoRedemption(ctx context.Context, tx pgx.Tx, orderID string) error {
	_, err := tx.Exec(ctx, `DELETE FROM restaurant_promo_redemptions WHERE order_id=$1`, orderID)
	return err
}

// promoFunderCapKobo is the LARGEST discount the declared funder can actually bear on
// an order whose settlement gross is grossKobo.
//
// The escrow only ever holds what the customer paid (gross − discount) — there is no
// outside pot to draw a discount from, so it is funded by shrinking exactly ONE
// settlement leg (settlement.Split.DiscountFundedByPlatform picks which). Settle fails
// closed when that leg would go negative, which for an ALREADY-ESCROWED order means a
// settlement that can never complete and an escrow stranded forever. So the bound is
// checked at placement instead, before any money moves, and it is derived from the very
// same arithmetic Settle uses (int64(float64(gross)*pct)) so the two cannot drift:
//
//   - platform-funded   → it comes out of the platform leg, which is splitPlatformPct
//     of the gross;
//   - restaurant-funded → it falls out of the provider REMAINDER (total − platform −
//     rider), so the cap is the gross less the other two legs. The with-rider shape is
//     used because it is the tighter of the two and a rider can still be assigned after
//     placement (rider-less settles 90/10, a strictly looser bound).
func promoFunderCapKobo(funder PromoFunder, grossKobo int64) int64 {
	if grossKobo <= 0 {
		return 0
	}
	platformLeg := int64(float64(grossKobo) * splitPlatformPct)
	if funder == FunderPlatform {
		return platformLeg
	}
	riderLeg := int64(float64(grossKobo) * splitRiderPct)
	return grossKobo - platformLeg - riderLeg
}

// assertDiscountFundable rejects a resolved promo whose discount the declared funder
// cannot cover out of its settlement leg. Returns ErrPromoInvalid so the caller (and
// the handler's 422 mapping) treats it as the client error it is: the code is real, it
// simply cannot be applied to THIS order.
func assertDiscountFundable(ap appliedPromo, grossKobo int64) error {
	if maxKobo := promoFunderCapKobo(ap.Funder, grossKobo); ap.DiscountKobo > maxKobo {
		return fmt.Errorf("%w: a %s-funded discount of %d kobo exceeds the %d kobo that funder's settlement share can bear on this order",
			ErrPromoInvalid, ap.Funder, ap.DiscountKobo, maxKobo)
	}
	return nil
}

// CreatePromoRequest is the body for an owner creating a promo for their restaurant.
type CreatePromoRequest struct {
	Code            string     `json:"code" binding:"required,min=2,max=40"`
	Kind            PromoKind  `json:"kind" binding:"required"`
	ValueBp         int        `json:"value_bp"`
	AmountKobo      int64      `json:"amount_kobo"`
	MinSubtotalKobo int64      `json:"min_subtotal_kobo"`
	MaxDiscountKobo *int64     `json:"max_discount_kobo,omitempty"`
	StartsAt        *time.Time `json:"starts_at,omitempty"`
	EndsAt          *time.Time `json:"ends_at,omitempty"`
	UsageLimit      *int       `json:"usage_limit,omitempty"`
	PerUserLimit    *int       `json:"per_user_limit,omitempty"`
}

// CreatePromo creates a promo scoped to the caller's restaurant. The funder is ALWAYS
// forced to 'restaurant' here: an owner may only fund discounts out of their own
// settlement share — a platform-funded (or platform-wide) promo would let a merchant
// spend platform money and must be created through an admin path instead.
func (s *Service) CreatePromo(ctx context.Context, restaurantID, userID string, req CreatePromoRequest) (*Promo, error) {
	if err := s.AssertStaffPermission(ctx, restaurantID, userID, PermManageStore); err != nil {
		return nil, err
	}
	switch req.Kind {
	case PromoPercent:
		if req.ValueBp < 1 || req.ValueBp > 10000 {
			return nil, fmt.Errorf("restaurant: percent promo needs value_bp in [1,10000]")
		}
	case PromoFixed:
		if req.AmountKobo < 1 {
			return nil, fmt.Errorf("restaurant: fixed promo needs amount_kobo >= 1")
		}
	case PromoFreeDelivery:
		// No value needed — the discount is the order's delivery fee at checkout.
	default:
		return nil, fmt.Errorf("restaurant: promo kind must be 'percent', 'fixed' or 'free_delivery'")
	}
	if req.MinSubtotalKobo < 0 || (req.MaxDiscountKobo != nil && *req.MaxDiscountKobo < 0) {
		return nil, fmt.Errorf("restaurant: promo amounts must be non-negative")
	}
	if req.StartsAt != nil && req.EndsAt != nil && req.EndsAt.Before(*req.StartsAt) {
		return nil, fmt.Errorf("restaurant: promo ends_at is before starts_at")
	}
	p := &Promo{
		ID: uuid.New().String(), RestaurantID: &restaurantID, Code: req.Code,
		Funder: FunderRestaurant, Kind: req.Kind, ValueBp: req.ValueBp, AmountKobo: req.AmountKobo,
		MinSubtotalKobo: req.MinSubtotalKobo, MaxDiscountKobo: req.MaxDiscountKobo,
		StartsAt: req.StartsAt, EndsAt: req.EndsAt,
		UsageLimit: req.UsageLimit, PerUserLimit: req.PerUserLimit, Active: true,
	}
	const q = `
		INSERT INTO restaurant_promos
		  (id, restaurant_id, code, funder, kind, value_bp, amount_kobo, min_subtotal_kobo,
		   max_discount_kobo, starts_at, ends_at, usage_limit, per_user_limit, active)
		VALUES ($1,$2,$3,'restaurant',$4,$5,$6,$7,$8,$9,$10,$11,$12,true)`
	if _, err := s.db.Exec(ctx, q,
		p.ID, restaurantID, p.Code, p.Kind, p.ValueBp, p.AmountKobo, p.MinSubtotalKobo,
		p.MaxDiscountKobo, p.StartsAt, p.EndsAt, p.UsageLimit, p.PerUserLimit,
	); err != nil {
		return nil, fmt.Errorf("restaurant: create promo (code may already exist): %w", err)
	}
	return p, nil
}
