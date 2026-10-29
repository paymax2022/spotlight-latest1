package top5events

// Buyer-side checkout quote and order history (migration 20271400000000 snapshot
// columns).
//
// Two customer-protection requirements live here:
//
//  1. A transparent total BEFORE the wallet is debited. The quote restates exactly
//     what reserveSeatTx will charge — same per-seat promo arithmetic, same
//     integer rounding — so the checkout screen cannot show one number and take
//     another. It is a read: it takes no lock and consumes no promo redemption.
//  2. A receipt that cannot be re-priced afterwards. event_orders carries the
//     unit price, discount, tier name and attendee it was sold at, so a later tier
//     edit by the organiser cannot rewrite what the buyer actually agreed to.
//     booking_ref groups the per-seat orders of one checkout into one receipt.

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// orderSelectBase is the order projection available on every database;
// orderSelectCommerce is appended only when the commerce flag is on. Both are
// consumed by scanOrder and the destination list below must stay in that order.
const (
	orderSelectBase = `o.id, COALESCE(o.card_reference,''), o.event_id, e.title, e.starts_at, o.buyer_id,
		COALESCE(up.full_name,''), o.status, COALESCE(o.payment_rail,'wallet'), o.idempotency_key,
		o.created_at, o.total_kobo`
	orderSelectCommerce = `, COALESCE(NULLIF(o.booking_ref,''), o.id::text), o.attendee_name, o.tier_name,
		o.promo_code, o.unit_price_kobo, o.discount_kobo, o.refunded_kobo`
)

func (s *Service) orderSelect() string {
	if s.commerceReads {
		return orderSelectBase + orderSelectCommerce
	}
	return orderSelectBase
}

// scanOrder scans one row of orderSelect; its destination list is that column list
// in order, with the commerce group appended only when the flag put it there.
func (s *Service) scanOrder(row rowScanner) (Order, error) {
	var (
		o     Order
		dests = []any{&o.ID, &o.Reference, &o.EventID, &o.EventTitle, &o.EventStartsAt, &o.BuyerID,
			&o.BuyerName, &o.Status, &o.PaymentRail, &o.IdempotencyKey, &o.CreatedAt, &o.TotalKobo}
	)
	if s.commerceReads {
		dests = append(dests, &o.BookingRef, &o.AttendeeName, &o.TierName, &o.PromoCode,
			&o.UnitPriceKobo, &o.DiscountKobo, &o.RefundedKobo)
	}
	if err := row.Scan(dests...); err != nil {
		return Order{}, err
	}
	if o.BookingRef == "" {
		o.BookingRef = o.ID // pre-commerce rows are their own booking
	}
	if o.UnitPriceKobo == 0 {
		o.UnitPriceKobo = o.TotalKobo
	}
	return o, nil
}

const orderFrom = ` FROM event_orders o
	JOIN events e ON e.id = o.event_id
	LEFT JOIN user_profiles up ON up.id = o.buyer_id `

// MyOrders lists the caller's own orders, newest first. EXPIRED reservations are
// left out: no money moved and the seat was released, so it is not an order the
// buyer holds.
func (s *Service) MyOrders(ctx context.Context, buyerID string, limit, offset int) ([]Order, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := s.db.Query(ctx, `SELECT `+s.orderSelect()+orderFrom+
		`WHERE o.buyer_id=$1 AND o.status <> 'EXPIRED' ORDER BY o.created_at DESC, o.id LIMIT $2 OFFSET $3`,
		buyerID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("events: my orders: %w", err)
	}
	defer rows.Close()

	out := []Order{}
	for rows.Next() {
		o, err := s.scanOrder(rows)
		if err != nil {
			return nil, fmt.Errorf("events: my orders scan: %w", err)
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// Booking is one checkout restated as a receipt: the seats bought together, the
// money actually collected, what has been refunded, and the platform's share of it.
// The money split is derived the same way settlement derives it (total * fee_bps /
// 10000), so the receipt, the organiser's earnings screen and the admin ledger all
// add up to the same collected amount.
type Booking struct {
	BookingRef       string  `json:"booking_ref"`
	EventID          string  `json:"event_id"`
	EventTitle       string  `json:"event_title"`
	Venue            string  `json:"venue,omitempty"`
	City             string  `json:"city,omitempty"`
	StartsAt         string  `json:"starts_at"`
	EventState       string  `json:"event_state"`
	Status           string  `json:"status"`
	Seats            int     `json:"seats"`
	SubtotalKobo     int64   `json:"subtotal_kobo"`
	DiscountKobo     int64   `json:"discount_kobo"`
	TotalKobo        int64   `json:"total_kobo"`
	RefundedKobo     int64   `json:"refunded_kobo"`
	PlatformFeeKobo  int64   `json:"platform_fee_kobo"`
	OrganiserNetKobo int64   `json:"organiser_net_kobo"`
	PromoCode        string  `json:"promo_code,omitempty"`
	RefundPolicy     string  `json:"refund_policy,omitempty"`
	FeeBps           int     `json:"fee_bps"`
	CreatedAt        string  `json:"created_at"`
	Orders           []Order `json:"orders,omitempty"`
}

// bookingGroupKey is the receipt grouping expression: the stored booking_ref, or an
// expired-forever legacy row's own id when no ref was recorded.
func (s *Service) bookingGroupKey() string {
	if s.commerceReads {
		return `COALESCE(NULLIF(o.booking_ref,''), o.id::text)`
	}
	return `o.id::text`
}

// bookingReceipt returns the receipt roll-up's select list and its GROUP BY clause,
// for the current flag combination. refunded_kobo is the amount the refund path
// recorded when there is one; for a refund issued before that column existed the
// whole order was returned, so its collected total is the honest figure — claiming
// 0 refunded on a REFUNDED order would understate what the buyer is owed.
func (s *Service) bookingReceipt() (selectCols, groupBy string) {
	refunded := `SUM(CASE WHEN o.status = 'REFUNDED' THEN o.total_kobo ELSE 0 END)`
	if s.commerceReads {
		refunded = `SUM(CASE WHEN o.refunded_kobo > 0 THEN o.refunded_kobo
		              WHEN o.status = 'REFUNDED' THEN o.total_kobo ELSE 0 END)`
	}
	cols := s.bookingGroupKey() + `, o.event_id, e.title, e.venue, e.state, e.starts_at, e.fee_bps,
		COUNT(*), SUM(o.total_kobo),
		` + refunded + `,
		MIN(o.created_at), string_agg(DISTINCT o.status, ',')`
	groupBy = `GROUP BY 1, o.event_id, e.title, e.venue, e.state, e.starts_at, e.fee_bps`
	if s.commerceReads {
		cols += `, SUM(o.unit_price_kobo), SUM(o.discount_kobo), COALESCE(MAX(NULLIF(o.promo_code,'')),''),
		e.city, e.refund_policy`
		groupBy += `, e.city, e.refund_policy`
	}
	return cols, groupBy
}

func (s *Service) scanBooking(row rowScanner) (Booking, error) {
	var (
		b         Booking
		startsAt  time.Time
		createdAt time.Time
		feeBps    int
		statusSet string
		dests     = []any{&b.BookingRef, &b.EventID, &b.EventTitle, &b.Venue, &b.EventState, &startsAt,
			&feeBps, &b.Seats, &b.TotalKobo, &b.RefundedKobo, &createdAt, &statusSet}
		subtotal, discount  int64
		promo, city, policy string
	)
	if s.commerceReads {
		dests = append(dests, &subtotal, &discount, &promo, &city, &policy)
	}
	if err := row.Scan(dests...); err != nil {
		return Booking{}, err
	}
	b.FeeBps = feeBps
	b.StartsAt = startsAt.Format(rfc3339)
	b.CreatedAt = createdAt.Format(rfc3339)
	b.Status = bookingStatus(statusSet, b.TotalKobo, b.RefundedKobo)
	b.PlatformFeeKobo = b.TotalKobo * int64(feeBps) / 10000
	b.OrganiserNetKobo = b.TotalKobo - b.PlatformFeeKobo
	if s.commerceReads {
		b.RefundPolicy, b.City, b.PromoCode = policy, city, promo
		b.DiscountKobo = discount
		// Pre-migration rows carry unit_price_kobo = 0 for the backfilled history;
		// the amount collected plus the discount that was taken is the restatable
		// subtotal, so a legacy receipt still foots.
		b.SubtotalKobo = subtotal
		if b.SubtotalKobo == 0 {
			b.SubtotalKobo = b.TotalKobo + b.DiscountKobo
		}
	} else {
		b.SubtotalKobo = b.TotalKobo
	}
	return b, nil
}

// bookingStatus names the money state of a whole booking. A mixed set (some seats
// refunded, some paid) is only "mixed" when the refund amounts do not tell the
// story — which is what refunded_kobo is for.
func bookingStatus(statusSet string, total, refunded int64) string {
	switch statusSet {
	case "PENDING":
		return "PENDING"
	case "PAID":
		return "PAID"
	case "REFUNDED":
		return "REFUNDED"
	case "EXPIRED":
		return "EXPIRED"
	}
	if refunded >= total && total > 0 {
		return "REFUNDED"
	}
	if refunded > 0 {
		return "PARTIALLY_REFUNDED"
	}
	return "MIXED"
}

// MyBookings is the buyer's order history, one row per checkout.
func (s *Service) MyBookings(ctx context.Context, buyerID string, limit, offset int) ([]Booking, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	cols, groupBy := s.bookingReceipt()
	rows, err := s.db.Query(ctx, `SELECT `+cols+orderFrom+
		`WHERE o.buyer_id=$1 AND o.status <> 'EXPIRED'
		 `+groupBy+`
		 ORDER BY MIN(o.created_at) DESC LIMIT $2 OFFSET $3`,
		buyerID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("events: my bookings: %w", err)
	}
	defer rows.Close()

	out := []Booking{}
	for rows.Next() {
		b, err := s.scanBooking(rows)
		if err != nil {
			return nil, fmt.Errorf("events: my bookings scan: %w", err)
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// Booking returns one of the caller's bookings with its seats, for the receipt
// screen. Ownership is enforced by the buyer_id predicate, never by the booking ref
// being unguessable — a ref read from a shared link must still not open someone
// else's receipt.
func (s *Service) Booking(ctx context.Context, buyerID, bookingRef string) (*Booking, error) {
	if bookingRef == "" {
		return nil, ErrValidation
	}
	cols, groupBy := s.bookingReceipt()
	row := s.db.QueryRow(ctx, `SELECT `+cols+orderFrom+
		`WHERE o.buyer_id=$1 AND `+s.bookingGroupKey()+`=$2 `+groupBy,
		buyerID, bookingRef)
	b, err := s.scanBooking(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("events: booking receipt: %w", err)
	}

	rows, err := s.db.Query(ctx, `SELECT `+s.orderSelect()+orderFrom+
		`WHERE o.buyer_id=$1 AND `+s.bookingGroupKey()+`=$2 ORDER BY o.created_at, o.id`,
		buyerID, bookingRef)
	if err != nil {
		return nil, fmt.Errorf("events: booking seats: %w", err)
	}
	defer rows.Close()

	b.Orders = []Order{}
	for rows.Next() {
		o, err := s.scanOrder(rows)
		if err != nil {
			return nil, fmt.Errorf("events: booking seats scan: %w", err)
		}
		b.Orders = append(b.Orders, o)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &b, nil
}

// Quote is the price a checkout will produce. Nothing here is charged: the numbers
// are the same arithmetic reserveSeatTx performs under the tier lock, computed
// without one, so a quote can be shown to a logged-out browser as well as to the
// buyer about to pay.
type Quote struct {
	EventID           string `json:"event_id"`
	EventTitle        string `json:"event_title"`
	EventState        string `json:"event_state"`
	Venue             string `json:"venue,omitempty"`
	City              string `json:"city,omitempty"`
	StartsAt          string `json:"starts_at"`
	TierID            string `json:"tier_id"`
	TierName          string `json:"tier_name"`
	Quantity          int    `json:"quantity"`
	UnitPriceKobo     int64  `json:"unit_price_kobo"`
	SubtotalKobo      int64  `json:"subtotal_kobo"`
	PromoCode         string `json:"promo_code,omitempty"`
	DiscountPerSeat   int64  `json:"discount_per_seat_kobo"`
	DiscountKobo      int64  `json:"discount_kobo"`
	TotalKobo         int64  `json:"total_kobo"`
	FeeBps            int    `json:"fee_bps"`
	PlatformFeeKobo   int64  `json:"platform_fee_kobo"`
	OrganiserNetKobo  int64  `json:"organiser_net_kobo"`
	Remaining         int    `json:"remaining_seats"`
	UnlimitedCapacity bool   `json:"unlimited_capacity"`
	RefundPolicy      string `json:"refund_policy,omitempty"`
	RefundCutoffHours int    `json:"refund_cutoff_hours,omitempty"`
	CheckinOpensMins  int    `json:"checkin_opens_minutes,omitempty"`
	CheckinClosesMins int    `json:"checkin_closes_minutes,omitempty"`
}

// Quote prices quantity seats of a tier for buyerID, with promo applied. buyerID may
// be empty (a logged-out preview); the per-user redemption limit is then simply not
// part of the preview, and the purchase path still enforces it.
func (s *Service) Quote(ctx context.Context, buyerID, eventID, tierID, promo string, quantity int) (*Quote, error) {
	if quantity < 1 || quantity > MaxTicketsPerOrder {
		return nil, fmt.Errorf("%w: events: quantity must be between 1 and %d", ErrValidation, MaxTicketsPerOrder)
	}
	ev, err := s.GetEvent(ctx, eventID)
	if err != nil {
		return nil, err
	}
	if ev.State != EventLive {
		return nil, fmt.Errorf("%w (state %s)", ErrNotPurchasable, ev.State)
	}
	var tier *TicketTier
	for i := range ev.Tiers {
		if ev.Tiers[i].ID == tierID {
			tier = &ev.Tiers[i]
			break
		}
	}
	if tier == nil {
		return nil, ErrNotFound
	}
	if !tier.Active {
		return nil, errors.New("events: tier inactive")
	}
	if tier.InviteOnly {
		return nil, ErrInviteOnly
	}
	now := time.Now()
	if (tier.SalesStartAt != nil && now.Before(*tier.SalesStartAt)) || (tier.SalesEndAt != nil && now.After(*tier.SalesEndAt)) {
		return nil, ErrTierNotOnSale
	}
	if tier.Capacity > 0 && tier.Sold >= tier.Capacity {
		return nil, ErrSoldOut
	}

	q := &Quote{
		EventID: ev.ID, EventTitle: ev.Title, EventState: string(ev.State), Venue: ev.Venue,
		City: ev.City, StartsAt: ev.StartsAt.Format(rfc3339), TierID: tier.ID, TierName: tier.Name,
		Quantity: quantity, UnitPriceKobo: tier.PriceKobo, SubtotalKobo: tier.PriceKobo * int64(quantity),
		FeeBps: ev.FeeBps, RefundPolicy: ev.RefundPolicy, RefundCutoffHours: ev.RefundCutoffHours,
		CheckinOpensMins: ev.CheckinOpensMinutes, CheckinClosesMins: ev.CheckinClosesMinutes,
	}
	if tier.Capacity > 0 {
		q.Remaining = tier.Capacity - tier.Sold
	} else {
		q.UnlimitedCapacity = true
	}
	if promo != "" {
		payable, err := s.quotePromoPayable(ctx, buyerID, eventID, tierID, promo, tier.PriceKobo)
		if err != nil {
			return nil, err
		}
		q.PromoCode = promo
		q.DiscountPerSeat = tier.PriceKobo - payable
		q.DiscountKobo = q.DiscountPerSeat * int64(quantity)
	}
	q.TotalKobo = q.SubtotalKobo - q.DiscountKobo
	q.PlatformFeeKobo = q.TotalKobo * int64(ev.FeeBps) / 10000
	q.OrganiserNetKobo = q.TotalKobo - q.PlatformFeeKobo
	return q, nil
}

// quotePromoPayable returns the per-seat price with the promo applied, applying the
// same eligibility rules reserveSeatTx does. It deliberately does NOT bump
// event_promo_codes.used and takes no FOR UPDATE: quoting is free, redeeming is not.
func (s *Service) quotePromoPayable(ctx context.Context, buyerID, eventID, tierID, code string, priceKobo int64) (int64, error) {
	var (
		pid                string
		pct, maxUses, used int
		promoTier          *string
		amountOff          *int64
		startsAt, endsAt   *time.Time
		perUser            int
	)
	err := s.db.QueryRow(ctx, `SELECT id, percent_off, max_uses, used, tier_id::text, amount_off_kobo, starts_at, ends_at, per_user_limit
		FROM event_promo_codes WHERE event_id=$1 AND code=$2 AND active=true`, eventID, code).
		Scan(&pid, &pct, &maxUses, &used, &promoTier, &amountOff, &startsAt, &endsAt, &perUser)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, fmt.Errorf("%w: unknown or inactive code", ErrPromoNotApplicable)
		}
		return 0, fmt.Errorf("events: quote promo: %w", err)
	}
	now := time.Now()
	if maxUses > 0 && used >= maxUses {
		return 0, fmt.Errorf("%w: code exhausted", ErrPromoNotApplicable)
	}
	if (startsAt != nil && now.Before(*startsAt)) || (endsAt != nil && now.After(*endsAt)) {
		return 0, fmt.Errorf("%w: outside validity window", ErrPromoNotApplicable)
	}
	if promoTier != nil && *promoTier != tierID {
		return 0, fmt.Errorf("%w: code is for a different tier", ErrPromoNotApplicable)
	}
	if perUser > 0 && buyerID != "" {
		var n int
		if err := s.db.QueryRow(ctx, `SELECT count(*) FROM event_promo_redemptions WHERE promo_id=$1 AND user_id=$2`, pid, buyerID).Scan(&n); err != nil {
			return 0, fmt.Errorf("events: quote promo per-user: %w", err)
		}
		if n >= perUser {
			return 0, fmt.Errorf("%w: per-user limit reached", ErrPromoNotApplicable)
		}
	}
	payable := priceKobo
	if amountOff != nil {
		payable = priceKobo - *amountOff
		if payable < 0 {
			payable = 0
		}
	} else {
		payable = priceKobo - (priceKobo*int64(pct))/100
	}
	return payable, nil
}
