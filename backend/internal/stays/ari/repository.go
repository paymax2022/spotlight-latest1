package ari

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the parameterized data layer for the ARI engine (rate_day,
// availability_day, promotions). It NEVER mutates wallet balances. The allotment
// decrement is row-locked (SELECT ... FOR UPDATE) inside an explicit transaction —
// the oversell-impossible invariant lives HERE.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository constructs the ARI repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// --- rate day ---

// UpsertRateDay writes one rate-calendar cell (idempotent on the PK).
func (r *Repository) UpsertRateDay(ctx context.Context, d RateDay) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.stays_rate_day
			(rate_plan_id, date, price_kobo, currency, min_los, max_los, cta, ctd, stop_sell)
		VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (rate_plan_id, date) DO UPDATE SET
			price_kobo = EXCLUDED.price_kobo, currency = EXCLUDED.currency,
			min_los = EXCLUDED.min_los, max_los = EXCLUDED.max_los,
			cta = EXCLUDED.cta, ctd = EXCLUDED.ctd, stop_sell = EXCLUDED.stop_sell,
			updated_at = now()`,
		d.RatePlanID, d.Date, d.PriceKobo, orStr(d.Currency, "NGN"),
		maxInt(d.MinLOS, 1), maxInt(d.MaxLOS, 0), d.CTA, d.CTD, d.StopSell)
	if err != nil {
		return fmt.Errorf("ari: upsert rate day: %w", err)
	}
	return nil
}

// ListRateDays returns the rate calendar for a plan over [from,to] (inclusive).
func (r *Repository) ListRateDays(ctx context.Context, ratePlanID, from, to string) ([]RateDay, error) {
	rows, err := r.db.Query(ctx, `
		SELECT rate_plan_id, to_char(date,'YYYY-MM-DD'), price_kobo, currency,
		       min_los, max_los, cta, ctd, stop_sell, updated_at
		FROM public.stays_rate_day
		WHERE rate_plan_id = $1 AND date BETWEEN $2::date AND $3::date
		ORDER BY date`, ratePlanID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RateDay
	for rows.Next() {
		var d RateDay
		if err := rows.Scan(&d.RatePlanID, &d.Date, &d.PriceKobo, &d.Currency,
			&d.MinLOS, &d.MaxLOS, &d.CTA, &d.CTD, &d.StopSell, &d.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// GetRateDay returns one rate-calendar cell (or pgx.ErrNoRows).
func (r *Repository) GetRateDay(ctx context.Context, ratePlanID, date string) (RateDay, error) {
	var d RateDay
	err := r.db.QueryRow(ctx, `
		SELECT rate_plan_id, to_char(date,'YYYY-MM-DD'), price_kobo, currency,
		       min_los, max_los, cta, ctd, stop_sell, updated_at
		FROM public.stays_rate_day WHERE rate_plan_id = $1 AND date = $2::date`,
		ratePlanID, date).Scan(&d.RatePlanID, &d.Date, &d.PriceKobo, &d.Currency,
		&d.MinLOS, &d.MaxLOS, &d.CTA, &d.CTD, &d.StopSell, &d.UpdatedAt)
	return d, err
}

// --- availability day ---

// UpsertAvailabilityDay writes one availability-calendar cell (idempotent on PK).
// It never lowers allotment below sold (the DB CHECK enforces sold <= allotment).
func (r *Repository) UpsertAvailabilityDay(ctx context.Context, d AvailabilityDay) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.stays_availability_day
			(room_type_id, date, allotment, sold, stop_sell)
		VALUES ($1,$2::date,$3,$4,$5)
		ON CONFLICT (room_type_id, date) DO UPDATE SET
			allotment = EXCLUDED.allotment, stop_sell = EXCLUDED.stop_sell,
			updated_at = now()`,
		d.RoomTypeID, d.Date, maxInt(d.Allotment, 0), maxInt(d.Sold, 0), d.StopSell)
	if err != nil {
		return fmt.Errorf("ari: upsert availability day: %w", err)
	}
	return nil
}

// ListAvailabilityDays returns the availability calendar for a room type over a range.
func (r *Repository) ListAvailabilityDays(ctx context.Context, roomTypeID, from, to string) ([]AvailabilityDay, error) {
	rows, err := r.db.Query(ctx, `
		SELECT room_type_id, to_char(date,'YYYY-MM-DD'), allotment, sold, stop_sell, updated_at
		FROM public.stays_availability_day
		WHERE room_type_id = $1 AND date BETWEEN $2::date AND $3::date
		ORDER BY date`, roomTypeID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AvailabilityDay
	for rows.Next() {
		var d AvailabilityDay
		if err := rows.Scan(&d.RoomTypeID, &d.Date, &d.Allotment, &d.Sold, &d.StopSell, &d.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// SetStopSellRange flips stop_sell across a room type's availability calendar.
func (r *Repository) SetStopSellRange(ctx context.Context, roomTypeID, from, to string, stop bool) error {
	_, err := r.db.Exec(ctx, `
		UPDATE public.stays_availability_day SET stop_sell = $4, updated_at = now()
		WHERE room_type_id = $1 AND date BETWEEN $2::date AND $3::date`,
		roomTypeID, from, to, stop)
	return err
}

// DecrementResult reports the post-decrement remaining allotment per night.
type DecrementResult struct {
	Nights []string `json:"nights"`
}

// DecrementAllotment row-locks every night's availability row for the room type and
// rejects with ErrOversellBlocked unless EVERY night has (allotment - sold) >= rooms
// and is not stop-sell. On success it increments sold by rooms on each night atomically.
//
// The SELECT ... FOR UPDATE serialises concurrent books for the same room/date:
// the first transaction holds the row lock until commit, so a racing book sees the
// updated sold count and is correctly rejected — oversell is impossible (PRD §9).
// A missing availability row for any night is treated as zero allotment (rejected),
// so inventory must be explicitly opened before it can be sold.
func (r *Repository) DecrementAllotment(ctx context.Context, roomTypeID string, dr DateRange, rooms int) (DecrementResult, error) {
	nights := dr.Nights()
	if len(nights) == 0 {
		return DecrementResult{}, ErrBadRange
	}
	if rooms <= 0 {
		rooms = 1
	}
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return DecrementResult{}, fmt.Errorf("ari: begin decrement tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Lock + validate every night under FOR UPDATE before any write. Iterating one
	// night at a time keeps a deterministic lock order (ascending date) which avoids
	// deadlocks between two overlapping bookings.
	for _, n := range nights {
		var allotment, sold int
		var stop bool
		err := tx.QueryRow(ctx, `
			SELECT allotment, sold, stop_sell
			FROM public.stays_availability_day
			WHERE room_type_id = $1 AND date = $2::date
			FOR UPDATE`, roomTypeID, n).Scan(&allotment, &sold, &stop)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// No inventory opened for this night → cannot sell.
				return DecrementResult{}, fmt.Errorf("%w: no availability for %s on %s", ErrOversellBlocked, roomTypeID, n)
			}
			return DecrementResult{}, fmt.Errorf("ari: lock availability: %w", err)
		}
		if stop {
			return DecrementResult{}, fmt.Errorf("%w: stop-sell on %s", ErrOversellBlocked, n)
		}
		if allotment-sold < rooms {
			return DecrementResult{}, fmt.Errorf("%w: %d left on %s, need %d", ErrOversellBlocked, allotment-sold, n, rooms)
		}
	}
	// All nights validated under lock — apply the decrement. The CHECK (sold <=
	// allotment) is a belt-and-braces guard against any concurrent allotment drop.
	for _, n := range nights {
		if _, err := tx.Exec(ctx, `
			UPDATE public.stays_availability_day
			SET sold = sold + $3, updated_at = now()
			WHERE room_type_id = $1 AND date = $2::date`, roomTypeID, n, rooms); err != nil {
			return DecrementResult{}, fmt.Errorf("ari: apply decrement: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return DecrementResult{}, fmt.Errorf("ari: commit decrement: %w", err)
	}
	return DecrementResult{Nights: nights}, nil
}

// ReleaseAllotment returns rooms to inventory on each night (cancellation / no-show
// re-open). It is clamped at zero by the DB CHECK (sold >= 0). Missing rows are
// skipped (nothing to release).
func (r *Repository) ReleaseAllotment(ctx context.Context, roomTypeID string, dr DateRange, rooms int) error {
	nights := dr.Nights()
	if len(nights) == 0 {
		return ErrBadRange
	}
	if rooms <= 0 {
		rooms = 1
	}
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("ari: begin release tx: %w", err)
	}
	defer tx.Rollback(ctx)
	for _, n := range nights {
		if _, err := tx.Exec(ctx, `
			UPDATE public.stays_availability_day
			SET sold = GREATEST(sold - $3, 0), updated_at = now()
			WHERE room_type_id = $1 AND date = $2::date`, roomTypeID, n, rooms); err != nil {
			return fmt.Errorf("ari: apply release: %w", err)
		}
	}
	return tx.Commit(ctx)
}

// --- promotions ---

// CreatePromotion inserts a promotion.
func (r *Repository) CreatePromotion(ctx context.Context, p Promotion) (string, error) {
	var id string
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.stays_promotion
			(property_id, rate_plan_id, name, promo_type, discount_bps, discount_kobo,
			 min_los, lead_days, date_from, date_to, active)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10::date,$11)
		RETURNING id`,
		p.PropertyID, p.RatePlanID, p.Name, orStr(p.PromoType, "PERCENT"),
		p.DiscountBps, p.DiscountKobo, p.MinLOS, p.LeadDays, p.DateFrom, p.DateTo, p.Active,
	).Scan(&id)
	return id, err
}

// ListPromotions returns a property's promotions newest-first.
func (r *Repository) ListPromotions(ctx context.Context, propertyID string) ([]Promotion, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, property_id, rate_plan_id, name, promo_type, discount_bps, discount_kobo,
		       min_los, lead_days, to_char(date_from,'YYYY-MM-DD'), to_char(date_to,'YYYY-MM-DD'),
		       active, created_at
		FROM public.stays_promotion WHERE property_id = $1 ORDER BY created_at DESC`, propertyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Promotion
	for rows.Next() {
		var p Promotion
		if err := rows.Scan(&p.ID, &p.PropertyID, &p.RatePlanID, &p.Name, &p.PromoType,
			&p.DiscountBps, &p.DiscountKobo, &p.MinLOS, &p.LeadDays, &p.DateFrom, &p.DateTo,
			&p.Active, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// SetPromotionActive toggles a promotion (scoped to the property by the caller).
func (r *Repository) SetPromotionActive(ctx context.Context, promotionID, propertyID string, active bool) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.stays_promotion SET active = $3, updated_at = now()
		WHERE id = $1 AND property_id = $2`, promotionID, propertyID, active)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("ari: promotion %s not found for property", promotionID)
	}
	return nil
}

// ActivePromotionsForDate returns active promotions applicable to a rate plan on a
// given date (plan-specific or property-wide).
func (r *Repository) ActivePromotionsForDate(ctx context.Context, propertyID, ratePlanID, date string) ([]Promotion, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, property_id, rate_plan_id, name, promo_type, discount_bps, discount_kobo,
		       min_los, lead_days, to_char(date_from,'YYYY-MM-DD'), to_char(date_to,'YYYY-MM-DD'),
		       active, created_at
		FROM public.stays_promotion
		WHERE property_id = $1 AND active = true
		  AND (rate_plan_id IS NULL OR rate_plan_id = $2)
		  AND $3::date BETWEEN date_from AND date_to
		ORDER BY discount_bps DESC`, propertyID, ratePlanID, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Promotion
	for rows.Next() {
		var p Promotion
		if err := rows.Scan(&p.ID, &p.PropertyID, &p.RatePlanID, &p.Name, &p.PromoType,
			&p.DiscountBps, &p.DiscountKobo, &p.MinLOS, &p.LeadDays, &p.DateFrom, &p.DateTo,
			&p.Active, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// PropertyIDForRatePlan resolves the owning property of a rate plan (object-scope
// authZ uses this to confirm the hotelier owns the plan).
func (r *Repository) PropertyIDForRatePlan(ctx context.Context, ratePlanID string) (string, error) {
	var pid string
	err := r.db.QueryRow(ctx, `
		SELECT rt.property_id FROM public.stays_rate_plan rp
		JOIN public.stays_room_type rt ON rt.id = rp.room_type_id
		WHERE rp.id = $1`, ratePlanID).Scan(&pid)
	return pid, err
}

// PropertyIDForRoomType resolves the owning property of a room type.
func (r *Repository) PropertyIDForRoomType(ctx context.Context, roomTypeID string) (string, error) {
	var pid string
	err := r.db.QueryRow(ctx, `
		SELECT property_id FROM public.stays_room_type WHERE id = $1`, roomTypeID).Scan(&pid)
	return pid, err
}

// --- small helpers (package-local) ---

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func orStr(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

// parseDate parses a YYYY-MM-DD date (UTC midnight).
func parseDate(s string) (time.Time, error) {
	return time.Parse("2006-01-02", s)
}
