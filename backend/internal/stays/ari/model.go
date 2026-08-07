package ari

import (
	"errors"
	"time"
)

// Sentinel errors surfaced to handlers + the SB0 reservation saga.
var (
	// ErrOversellBlocked is returned by AllotmentDecrement when the requested rooms
	// exceed remaining allotment (allotment - sold) on any night, or a night is
	// stop-sell / has no availability row. This is the oversell-impossible invariant
	// (PRD §9); it is checked under a row lock so concurrent books cannot race.
	ErrOversellBlocked = errors.New("ari: OVERSELL_BLOCKED")
	// ErrBadRange is returned for an empty / inverted date range.
	ErrBadRange = errors.New("ari: invalid date range")
	// ErrNilPool guards a misconfigured service.
	ErrNilPool = errors.New("ari: nil pool")
)

// RateDay is one cell of the rate calendar: a rate plan's price + restrictions on a
// single date. Money is kobo (minor units). PK is (RatePlanID, Date).
type RateDay struct {
	RatePlanID string    `json:"rate_plan_id"`
	Date       string    `json:"date"` // YYYY-MM-DD (date-only)
	PriceKobo  int64     `json:"price_kobo"`
	Currency   string    `json:"currency"`
	MinLOS     int       `json:"min_los"`
	MaxLOS     int       `json:"max_los"` // 0 = unbounded
	CTA        bool      `json:"cta"`     // closed-to-arrival
	CTD        bool      `json:"ctd"`     // closed-to-departure
	StopSell   bool      `json:"stop_sell"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// AvailabilityDay is one cell of the availability calendar: a room type's allotment
// + sold count + stop-sell flag on a single date. The row-lock decrement target.
type AvailabilityDay struct {
	RoomTypeID string    `json:"room_type_id"`
	Date       string    `json:"date"`
	Allotment  int       `json:"allotment"`
	Sold       int       `json:"sold"`
	StopSell   bool      `json:"stop_sell"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// Remaining reports the bookable rooms left on this date.
func (a AvailabilityDay) Remaining() int {
	r := a.Allotment - a.Sold
	if r < 0 {
		return 0
	}
	return r
}

// Promotion is a rule-driven discount applied over a date range to one rate plan
// (or all of a property's plans when RatePlanID is empty). Discounts cascade in the
// derived-rate engine.
type Promotion struct {
	ID           string    `json:"id"`
	PropertyID   string    `json:"property_id"`
	RatePlanID   *string   `json:"rate_plan_id"` // nil = all plans
	Name         string    `json:"name"`
	PromoType    string    `json:"promo_type"` // PERCENT | FIXED | EARLY_BIRD | LAST_MINUTE | LOS
	DiscountBps  int       `json:"discount_bps"`
	DiscountKobo int64     `json:"discount_kobo"`
	MinLOS       int       `json:"min_los"`
	LeadDays     int       `json:"lead_days"`
	DateFrom     string    `json:"date_from"`
	DateTo       string    `json:"date_to"`
	Active       bool      `json:"active"`
	CreatedAt    time.Time `json:"created_at"`
}

// DateRange is an inclusive-start, exclusive-end stay range. Nights() are the dates
// a room is occupied (check-out date is not a night).
type DateRange struct {
	CheckIn  time.Time `json:"check_in"`
	CheckOut time.Time `json:"check_out"`
}

// Nights returns each occupied date (check-in .. check-out-1) as YYYY-MM-DD.
func (r DateRange) Nights() []string {
	var out []string
	if !r.CheckOut.After(r.CheckIn) {
		return out
	}
	d := r.CheckIn
	for d.Before(r.CheckOut) {
		out = append(out, d.Format("2006-01-02"))
		d = d.AddDate(0, 0, 1)
	}
	return out
}

// LOS is the length of stay (nights) for the range.
func (r DateRange) LOS() int { return len(r.Nights()) }

// DerivedRateRule defines a linked/derived rate cascade: a child rate plan whose
// per-date price is computed from a parent plan's per-date price by a percentage
// adjustment (bps; negative discounts, positive surcharges) and/or a fixed kobo
// adjustment. E.g. non-refundable = BAR - 10% (Bps -1000); breakfast = room-only +
// fixed (FixedKobo +N). Rules are applied left-to-right per date.
type DerivedRateRule struct {
	ParentRatePlanID string `json:"parent_rate_plan_id"`
	ChildRatePlanID  string `json:"child_rate_plan_id"`
	AdjustBps        int    `json:"adjust_bps"` // e.g. -1000 = parent - 10%
	FixedKobo        int64  `json:"fixed_kobo"` // additive fixed kobo (e.g. breakfast cost)
	FloorKobo        int64  `json:"floor_kobo"` // never price below this (>=0)
}

// BulkEdit is a date-range edit applied to every date in [DateFrom, DateTo] for a
// target rate plan (rates/restrictions) or room type (availability). Nil pointers
// mean "leave unchanged"; only set fields are written.
type BulkEdit struct {
	DateFrom string `json:"date_from" binding:"required"`
	DateTo   string `json:"date_to" binding:"required"`

	// Rate-plan-scoped fields (require RatePlanID on the request).
	PriceKobo *int64  `json:"price_kobo,omitempty"`
	Currency  *string `json:"currency,omitempty"`
	MinLOS    *int    `json:"min_los,omitempty"`
	MaxLOS    *int    `json:"max_los,omitempty"`
	CTA       *bool   `json:"cta,omitempty"`
	CTD       *bool   `json:"ctd,omitempty"`

	// Shared stop-sell (rate-day and/or availability-day depending on target).
	StopSell *bool `json:"stop_sell,omitempty"`

	// Room-type-scoped fields (require RoomTypeID on the request).
	Allotment *int `json:"allotment,omitempty"`
}
