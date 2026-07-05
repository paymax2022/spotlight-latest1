package ari

import (
	"context"
	"fmt"
	"time"
)

// Allotment is the narrow interface the SB0 reservation saga consumes to perform
// the row-locked allotment decrement at book time (and release on cancel/no-show).
// SB0 depends on THIS interface, not the concrete service, so the booking saga can
// call into ari-svc without importing its repository internals.
type Allotment interface {
	// AllotmentDecrement row-locks every night of the stay for the room type and
	// rejects with ErrOversellBlocked unless every night has enough free allotment
	// and is sellable. On success it increments sold by rooms atomically.
	AllotmentDecrement(ctx context.Context, roomTypeID string, dr DateRange, rooms int) error
	// AllotmentRelease returns rooms to inventory (cancel / no-show re-open).
	AllotmentRelease(ctx context.Context, roomTypeID string, dr DateRange, rooms int) error
}

// Service is the Availability/Rates/Inventory engine for the direct rail. It owns
// the rate/availability calendars, restrictions, promotions, the derived-rate
// cascade, bulk date-range edits, and the row-locked allotment decrement. Object-
// level authZ (the hotelier owns the property) is checked by the extranet layer; the
// SB0 saga calls AllotmentDecrement after its own ownership/state gates.
type Service struct {
	repo *Repository
}

// NewService constructs the ARI service.
func NewService(repo *Repository) *Service { return &Service{repo: repo} }

// Compile-time assertion that Service satisfies the SB0-facing interface.
var _ Allotment = (*Service)(nil)

// AllotmentDecrement implements Allotment — the oversell-impossible book leg.
func (s *Service) AllotmentDecrement(ctx context.Context, roomTypeID string, dr DateRange, rooms int) error {
	if s.repo == nil {
		return ErrNilPool
	}
	_, err := s.repo.DecrementAllotment(ctx, roomTypeID, dr, rooms)
	return err
}

// AllotmentRelease implements Allotment — the cancel/no-show re-open leg.
func (s *Service) AllotmentRelease(ctx context.Context, roomTypeID string, dr DateRange, rooms int) error {
	if s.repo == nil {
		return ErrNilPool
	}
	return s.repo.ReleaseAllotment(ctx, roomTypeID, dr, rooms)
}

// --- calendar reads ---

// RateCalendar returns the rate-day grid for a plan over [from,to].
func (s *Service) RateCalendar(ctx context.Context, ratePlanID, from, to string) ([]RateDay, error) {
	if err := validRange(from, to); err != nil {
		return nil, err
	}
	return s.repo.ListRateDays(ctx, ratePlanID, from, to)
}

// AvailabilityCalendar returns the availability-day grid for a room type over [from,to].
func (s *Service) AvailabilityCalendar(ctx context.Context, roomTypeID, from, to string) ([]AvailabilityDay, error) {
	if err := validRange(from, to); err != nil {
		return nil, err
	}
	return s.repo.ListAvailabilityDays(ctx, roomTypeID, from, to)
}

// --- single-cell writes ---

// SetRateDay upserts one rate-calendar cell.
func (s *Service) SetRateDay(ctx context.Context, d RateDay) error {
	if d.RatePlanID == "" || d.Date == "" {
		return fmt.Errorf("ari: rate day requires rate_plan_id + date")
	}
	if d.PriceKobo < 0 {
		return fmt.Errorf("ari: price_kobo must be >= 0")
	}
	return s.repo.UpsertRateDay(ctx, d)
}

// SetAvailabilityDay upserts one availability-calendar cell (opens inventory).
func (s *Service) SetAvailabilityDay(ctx context.Context, d AvailabilityDay) error {
	if d.RoomTypeID == "" || d.Date == "" {
		return fmt.Errorf("ari: availability day requires room_type_id + date")
	}
	if d.Allotment < 0 {
		return fmt.Errorf("ari: allotment must be >= 0")
	}
	return s.repo.UpsertAvailabilityDay(ctx, d)
}

// --- bulk date-range edit ---

// BulkEditRates applies a bulk edit to a rate plan's rate calendar for every date
// in the range. Existing cells are merged (unset fields preserved); new cells are
// created from the current cell or sensible defaults.
func (s *Service) BulkEditRates(ctx context.Context, ratePlanID string, e BulkEdit) (int, error) {
	dates, err := expandDates(e.DateFrom, e.DateTo)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, day := range dates {
		cur, gerr := s.repo.GetRateDay(ctx, ratePlanID, day)
		if gerr != nil {
			cur = RateDay{RatePlanID: ratePlanID, Date: day, Currency: "NGN", MinLOS: 1}
		}
		applyRateEdit(&cur, e)
		cur.RatePlanID = ratePlanID
		cur.Date = day
		if err := s.repo.UpsertRateDay(ctx, cur); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

// BulkEditAvailability applies a bulk edit to a room type's availability calendar.
// It only ever sets allotment / stop_sell; sold is owned by the booking saga.
func (s *Service) BulkEditAvailability(ctx context.Context, roomTypeID string, e BulkEdit) (int, error) {
	dates, err := expandDates(e.DateFrom, e.DateTo)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, day := range dates {
		cur := AvailabilityDay{RoomTypeID: roomTypeID, Date: day}
		// Preserve sold by reading the existing row (UpsertAvailabilityDay does not
		// write sold, but allotment must not be set below sold — DB CHECK guards it).
		if existing, lerr := s.repo.ListAvailabilityDays(ctx, roomTypeID, day, day); lerr == nil && len(existing) == 1 {
			cur = existing[0]
		}
		if e.Allotment != nil {
			cur.Allotment = *e.Allotment
		}
		if e.StopSell != nil {
			cur.StopSell = *e.StopSell
		}
		if err := s.repo.UpsertAvailabilityDay(ctx, cur); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

// --- restrictions ---

// SetRestrictions applies min/max LOS + CTA/CTD + stop_sell to a rate plan's
// calendar over a range (a thin wrapper over BulkEditRates).
func (s *Service) SetRestrictions(ctx context.Context, ratePlanID string, e BulkEdit) (int, error) {
	return s.BulkEditRates(ctx, ratePlanID, e)
}

// --- derived / linked rates ---

// ApplyDerivedRate computes a child plan's rate calendar from its parent's over a
// range using a rule cascade (parent price + AdjustBps + FixedKobo, floored). E.g.
// non-refundable = BAR - 10% (AdjustBps -1000); breakfast = room-only + fixed
// (FixedKobo). This is rule-driven and idempotent: re-running re-derives the cells.
func (s *Service) ApplyDerivedRate(ctx context.Context, rule DerivedRateRule, from, to string) (int, error) {
	if rule.ParentRatePlanID == "" || rule.ChildRatePlanID == "" {
		return 0, fmt.Errorf("ari: derived rate requires parent + child rate_plan_id")
	}
	parent, err := s.repo.ListRateDays(ctx, rule.ParentRatePlanID, from, to)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, p := range parent {
		price := deriveKobo(p.PriceKobo, rule.AdjustBps, rule.FixedKobo, rule.FloorKobo)
		child := RateDay{
			RatePlanID: rule.ChildRatePlanID,
			Date:       p.Date,
			PriceKobo:  price,
			Currency:   p.Currency,
			MinLOS:     p.MinLOS,
			MaxLOS:     p.MaxLOS,
			CTA:        p.CTA,
			CTD:        p.CTD,
			StopSell:   p.StopSell,
		}
		if err := s.repo.UpsertRateDay(ctx, child); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

// --- promotions ---

// CreatePromotion validates + inserts a promotion.
func (s *Service) CreatePromotion(ctx context.Context, p Promotion) (string, error) {
	if p.PropertyID == "" || p.Name == "" {
		return "", fmt.Errorf("ari: promotion requires property_id + name")
	}
	if err := validRange(p.DateFrom, p.DateTo); err != nil {
		return "", err
	}
	if p.DiscountBps < 0 || p.DiscountBps > 10000 {
		return "", fmt.Errorf("ari: discount_bps out of range")
	}
	return s.repo.CreatePromotion(ctx, p)
}

// ListPromotions returns a property's promotions.
func (s *Service) ListPromotions(ctx context.Context, propertyID string) ([]Promotion, error) {
	return s.repo.ListPromotions(ctx, propertyID)
}

// SetPromotionActive toggles a promotion (object-scoped to property by caller).
func (s *Service) SetPromotionActive(ctx context.Context, promotionID, propertyID string, active bool) error {
	return s.repo.SetPromotionActive(ctx, promotionID, propertyID, active)
}

// --- object-scope resolvers (used by extranet authZ) ---

// PropertyOfRatePlan resolves a rate plan's owning property.
func (s *Service) PropertyOfRatePlan(ctx context.Context, ratePlanID string) (string, error) {
	return s.repo.PropertyIDForRatePlan(ctx, ratePlanID)
}

// PropertyOfRoomType resolves a room type's owning property.
func (s *Service) PropertyOfRoomType(ctx context.Context, roomTypeID string) (string, error) {
	return s.repo.PropertyIDForRoomType(ctx, roomTypeID)
}

// --- helpers ---

// applyRateEdit merges set fields of a BulkEdit into a rate-day cell.
func applyRateEdit(d *RateDay, e BulkEdit) {
	if e.PriceKobo != nil {
		d.PriceKobo = *e.PriceKobo
	}
	if e.Currency != nil {
		d.Currency = *e.Currency
	}
	if e.MinLOS != nil {
		d.MinLOS = *e.MinLOS
	}
	if e.MaxLOS != nil {
		d.MaxLOS = *e.MaxLOS
	}
	if e.CTA != nil {
		d.CTA = *e.CTA
	}
	if e.CTD != nil {
		d.CTD = *e.CTD
	}
	if e.StopSell != nil {
		d.StopSell = *e.StopSell
	}
	if d.Currency == "" {
		d.Currency = "NGN"
	}
	if d.MinLOS < 1 {
		d.MinLOS = 1
	}
}

// deriveKobo applies a percentage (bps) + fixed adjustment to a parent price,
// floored at floorKobo (>= 0). Rounding is half-up on the bps leg.
func deriveKobo(parentKobo int64, adjustBps int, fixedKobo, floorKobo int64) int64 {
	v := parentKobo
	if adjustBps != 0 {
		// v * (10000 + adjustBps) / 10000, half-up.
		num := v*int64(10000+adjustBps) + 5000
		v = num / 10000
	}
	v += fixedKobo
	if v < floorKobo {
		v = floorKobo
	}
	if v < 0 {
		v = 0
	}
	return v
}

// expandDates returns every YYYY-MM-DD in [from,to] inclusive.
func expandDates(from, to string) ([]string, error) {
	if err := validRange(from, to); err != nil {
		return nil, err
	}
	a, _ := parseDate(from)
	b, _ := parseDate(to)
	var out []string
	for d := a; !d.After(b); d = d.AddDate(0, 0, 1) {
		out = append(out, d.Format("2006-01-02"))
	}
	return out, nil
}

// validRange validates two YYYY-MM-DD dates with from <= to.
func validRange(from, to string) error {
	a, err := parseDate(from)
	if err != nil {
		return fmt.Errorf("%w: bad from date %q", ErrBadRange, from)
	}
	b, err := parseDate(to)
	if err != nil {
		return fmt.Errorf("%w: bad to date %q", ErrBadRange, to)
	}
	if b.Before(a) {
		return fmt.Errorf("%w: to before from", ErrBadRange)
	}
	// Guard against unbounded bulk edits.
	if b.Sub(a) > 800*24*time.Hour {
		return fmt.Errorf("%w: range too large (max ~2 years)", ErrBadRange)
	}
	return nil
}
