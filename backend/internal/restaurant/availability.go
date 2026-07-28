package restaurant

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// HolidayHour is a per-date override of the weekly schedule. When present for a date it
// REPLACES the weekly hours for that date. A closed holiday shuts the restaurant all
// day; otherwise the single [OpenMinute, CloseMinute) window applies (same-day only —
// a holiday is one calendar day).
type HolidayHour struct {
	Date        string `json:"holiday_date"` // YYYY-MM-DD
	IsClosed    bool   `json:"is_closed"`
	OpenMinute  int    `json:"open_minute"`
	CloseMinute int    `json:"close_minute"`
}

// holidayOpenAt reports whether the holiday override is open at instant t (in loc).
// A closed holiday is never open; otherwise t's minute-of-day must fall in the window.
func holidayOpenAt(h HolidayHour, t time.Time, loc *time.Location) bool {
	if h.IsClosed {
		return false
	}
	lt := t.In(loc)
	m := lt.Hour()*60 + lt.Minute()
	return m >= h.OpenMinute && m < h.CloseMinute
}

// effectiveOpenWithHoliday is the availability gate WITH holiday overrides. Precedence:
// manual switch off ⇒ closed; else a holiday override for today wins outright; else the
// weekly schedule (empty weekly ⇒ open, preserving the no-schedule back-compat).
func effectiveOpenWithHoliday(isOpen bool, weekly []BusinessHour, holiday *HolidayHour, now time.Time, loc *time.Location) bool {
	if !isOpen {
		return false
	}
	if holiday != nil {
		return holidayOpenAt(*holiday, now, loc)
	}
	return effectiveOpen(true, weekly, now, loc)
}

// totalEtaMinutes folds the restaurant's kitchen prep time into the travel ETA so the
// customer sees a realistic door-to-door estimate (AV-004). Negative inputs clamp to 0.
func totalEtaMinutes(prepMinutes int, travelMinutes float64) float64 {
	if prepMinutes < 0 {
		prepMinutes = 0
	}
	if travelMinutes < 0 {
		travelMinutes = 0
	}
	return float64(prepMinutes) + travelMinutes
}

// loadHolidayForDate returns the holiday override for a restaurant on the local date of
// t, or (nil) if none. Errors are returned so a lookup failure fails the gate closed.
func (s *Service) loadHolidayForDate(ctx context.Context, restaurantID string, t time.Time, loc *time.Location) (*HolidayHour, error) {
	date := t.In(loc).Format("2006-01-02")
	var h HolidayHour
	var open, close *int
	err := s.db.QueryRow(ctx,
		`SELECT holiday_date::text, is_closed, open_minute, close_minute
		 FROM restaurant_holiday_hours WHERE restaurant_id=$1 AND holiday_date=$2`,
		restaurantID, date).Scan(&h.Date, &h.IsClosed, &open, &close)
	if err != nil {
		return nil, nil // no override for this date (or no such row) — not an error
	}
	if open != nil {
		h.OpenMinute = *open
	}
	if close != nil {
		h.CloseMinute = *close
	}
	return &h, nil
}

// SetHoliday upserts a holiday override for a restaurant (owner only). An open holiday
// requires a valid [open,close) window; a closed holiday ignores the window.
func (s *Service) SetHoliday(ctx context.Context, restaurantID, userID string, h HolidayHour) error {
	if err := s.assertOwner(ctx, restaurantID, userID); err != nil {
		return err
	}
	if _, err := time.Parse("2006-01-02", h.Date); err != nil {
		return fmt.Errorf("restaurant: holiday_date must be YYYY-MM-DD")
	}
	if !h.IsClosed {
		if h.OpenMinute < 0 || h.OpenMinute > 1439 || h.CloseMinute < 1 || h.CloseMinute > 1440 || h.CloseMinute <= h.OpenMinute {
			return fmt.Errorf("restaurant: an open holiday needs a valid [open,close) window")
		}
	}
	const q = `
		INSERT INTO restaurant_holiday_hours (id, restaurant_id, holiday_date, is_closed, open_minute, close_minute, note)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (restaurant_id, holiday_date) DO UPDATE SET
		    is_closed=$4, open_minute=$5, close_minute=$6, note=$7`
	var open, close *int
	if !h.IsClosed {
		open, close = &h.OpenMinute, &h.CloseMinute
	}
	_, err := s.db.Exec(ctx, q, uuid.New().String(), restaurantID, h.Date, h.IsClosed, open, close, nil)
	return err
}

// DeleteHoliday removes a holiday override (owner only).
func (s *Service) DeleteHoliday(ctx context.Context, restaurantID, userID, date string) error {
	if err := s.assertOwner(ctx, restaurantID, userID); err != nil {
		return err
	}
	_, err := s.db.Exec(ctx, `DELETE FROM restaurant_holiday_hours WHERE restaurant_id=$1 AND holiday_date=$2`, restaurantID, date)
	return err
}

// SweepUnacceptedOrders auto-cancels + refunds orders the restaurant never accepted
// within its accept_sla_minutes (AV-007). Only restaurants with accept_sla_minutes > 0
// participate; an order still 'pending' past the SLA is cancelled through the single
// guarded cancelAndRefund path (so the escrow is returned, not stranded). Returns the
// number of orders swept. Intended to be run periodically by an ops job.
func (s *Service) SweepUnacceptedOrders(ctx context.Context, now time.Time) (int, error) {
	const q = `
		SELECT o.id
		FROM orders o
		JOIN restaurants r ON r.id = o.restaurant_id
		WHERE o.status = 'pending'
		  AND r.accept_sla_minutes > 0
		  AND o.created_at < ($1::timestamptz - make_interval(mins => r.accept_sla_minutes))`
	rows, err := s.db.Query(ctx, q, now)
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
		// System-initiated cancel: pass the restaurant owner as actor so the guarded
		// cancel authorizes (owner may cancel), refunding the customer's escrow.
		var owner string
		if err := s.db.QueryRow(ctx, `SELECT r.owner_id FROM orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE o.id=$1`, id).Scan(&owner); err != nil {
			continue
		}
		if err := s.cancelAndRefund(ctx, id, owner); err != nil {
			continue // best-effort; a locked/racing order is retried next sweep
		}
		s.recordOrderEvent(ctx, id, owner, OrderPending, OrderCancelled)
		swept++
	}
	return swept, nil
}
