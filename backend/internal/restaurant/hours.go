package restaurant

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// BusinessHour is one opening window on one weekday. DayOfWeek follows Go's
// time.Weekday (0 = Sunday … 6 = Saturday). OpenMinute/CloseMinute are minutes from
// local midnight:
//   - OpenMinute in [0, 1439], CloseMinute in [1, 1440] (1440 = end of day).
//   - CloseMinute > OpenMinute → a same-day window [Open, Close).
//   - CloseMinute < OpenMinute → an OVERNIGHT window: [Open, 1440) on DayOfWeek plus
//     [0, Close) spilling into the following day (e.g. 18:00 → 02:00).
//   - CloseMinute == OpenMinute is disallowed at creation (zero-length / ambiguous).
//
// A day with no rows is closed. Multiple rows on the same weekday model split shifts
// (e.g. a lunch and a dinner window); the restaurant is open if ANY window matches.
type BusinessHour struct {
	DayOfWeek   int `json:"day_of_week"`
	OpenMinute  int `json:"open_minute"`
	CloseMinute int `json:"close_minute"`
}

// parseHHMM parses "H:MM"/"HH:MM" (24-hour) into minutes from midnight. "24:00" maps
// to 1440 so a window can close exactly at end of day. Fail-closed on anything else.
func parseHHMM(s string) (int, error) {
	parts := strings.Split(strings.TrimSpace(s), ":")
	if len(parts) != 2 {
		return 0, fmt.Errorf("restaurant: time %q must be HH:MM", s)
	}
	h, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil {
		return 0, fmt.Errorf("restaurant: time %q must be HH:MM", s)
	}
	if m < 0 || m > 59 {
		return 0, fmt.Errorf("restaurant: minutes in %q out of range", s)
	}
	if h < 0 || h > 24 || (h == 24 && m != 0) {
		return 0, fmt.Errorf("restaurant: hour in %q out of range (00:00–24:00)", s)
	}
	return h*60 + m, nil
}

// formatHHMM renders minutes-from-midnight back to "HH:MM" (1440 → "24:00").
func formatHHMM(min int) string {
	return fmt.Sprintf("%02d:%02d", min/60, min%60)
}

// windowContains reports whether minute-of-day m (on weekday wd) falls inside window h.
// It accounts for overnight windows by also matching a spill from the PREVIOUS day.
func (h BusinessHour) windowContains(wd, m int) bool {
	if h.CloseMinute > h.OpenMinute {
		// Same-day window [Open, Close).
		return wd == h.DayOfWeek && m >= h.OpenMinute && m < h.CloseMinute
	}
	// Overnight window: [Open, 1440) on the window's day, plus [0, Close) the next day.
	if wd == h.DayOfWeek && m >= h.OpenMinute {
		return true
	}
	prev := (h.DayOfWeek + 1) % 7 // the day AFTER the window's start day
	return wd == prev && m < h.CloseMinute
}

// isOpenAt reports whether a restaurant with the given weekly hours is open at instant
// t, evaluated in loc. An empty schedule returns false here — callers that want the
// "no hours defined ⇒ governed only by the manual switch" back-compat use effectiveOpen.
func isOpenAt(hours []BusinessHour, t time.Time, loc *time.Location) bool {
	lt := t.In(loc)
	wd := int(lt.Weekday())
	m := lt.Hour()*60 + lt.Minute()
	for _, h := range hours {
		if h.windowContains(wd, m) {
			return true
		}
	}
	return false
}

// effectiveOpen is the order-path gate: a restaurant accepts orders when its manual
// switch is on AND, IF it has defined business hours, the current time is within them.
// A restaurant with no hours rows is governed solely by isOpen (back-compat: every
// existing restaurant keeps working exactly as before this feature).
func effectiveOpen(isOpen bool, hours []BusinessHour, now time.Time, loc *time.Location) bool {
	if !isOpen {
		return false
	}
	if len(hours) == 0 {
		return true
	}
	return isOpenAt(hours, now, loc)
}

// loadBusinessHours returns a restaurant's weekly windows, ordered by day then open
// time (a stable, client-friendly ordering).
func (s *Service) loadBusinessHours(ctx context.Context, restaurantID string) ([]BusinessHour, error) {
	const q = `SELECT day_of_week, open_minute, close_minute
	           FROM restaurant_business_hours WHERE restaurant_id=$1
	           ORDER BY day_of_week, open_minute`
	rows, err := s.db.Query(ctx, q, restaurantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BusinessHour
	for rows.Next() {
		var h BusinessHour
		if err := rows.Scan(&h.DayOfWeek, &h.OpenMinute, &h.CloseMinute); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

// BusinessHourInput is one window in a SetBusinessHours request, using friendly
// "HH:MM" strings (24-hour). close "24:00" is allowed (end of day).
type BusinessHourInput struct {
	DayOfWeek int    `json:"day_of_week"`
	Open      string `json:"open"`  // "HH:MM"
	Close     string `json:"close"` // "HH:MM"
}

// validateAndNormalize parses/validates the input windows into BusinessHour rows,
// fail-closed on any bad day/time. Overnight (close < open) is allowed; equal is not.
func validateAndNormalize(in []BusinessHourInput) ([]BusinessHour, error) {
	out := make([]BusinessHour, 0, len(in))
	for i, w := range in {
		if w.DayOfWeek < 0 || w.DayOfWeek > 6 {
			return nil, fmt.Errorf("restaurant: window %d has day_of_week %d (want 0–6)", i, w.DayOfWeek)
		}
		open, err := parseHHMM(w.Open)
		if err != nil {
			return nil, err
		}
		closeM, err := parseHHMM(w.Close)
		if err != nil {
			return nil, err
		}
		if open == 1440 {
			return nil, fmt.Errorf("restaurant: window %d open time cannot be 24:00", i)
		}
		if open == closeM {
			return nil, fmt.Errorf("restaurant: window %d open and close are equal (zero-length)", i)
		}
		out = append(out, BusinessHour{DayOfWeek: w.DayOfWeek, OpenMinute: open, CloseMinute: closeM})
	}
	return out, nil
}

// SetBusinessHours replaces a restaurant's ENTIRE weekly schedule (owner only) in one
// transaction — an idempotent PUT. Passing an empty list clears the schedule (the
// restaurant reverts to being governed solely by its is_open switch).
func (s *Service) SetBusinessHours(ctx context.Context, restaurantID, userID string, in []BusinessHourInput) ([]BusinessHour, error) {
	if err := s.AssertStaffPermission(ctx, restaurantID, userID, PermManageStore); err != nil {
		return nil, err
	}
	normalized, err := validateAndNormalize(in)
	if err != nil {
		return nil, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM restaurant_business_hours WHERE restaurant_id=$1`, restaurantID); err != nil {
		return nil, err
	}
	for _, h := range normalized {
		if _, err := tx.Exec(ctx,
			`INSERT INTO restaurant_business_hours (id, restaurant_id, day_of_week, open_minute, close_minute)
			 VALUES ($1,$2,$3,$4,$5)`,
			uuid.New().String(), restaurantID, h.DayOfWeek, h.OpenMinute, h.CloseMinute); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	sort.Slice(normalized, func(i, j int) bool {
		if normalized[i].DayOfWeek != normalized[j].DayOfWeek {
			return normalized[i].DayOfWeek < normalized[j].DayOfWeek
		}
		return normalized[i].OpenMinute < normalized[j].OpenMinute
	})
	return normalized, nil
}

// BusinessHoursStatus is the public view: the weekly windows (as HH:MM strings) plus
// whether the restaurant is open right now.
type BusinessHoursStatus struct {
	OpenNow bool               `json:"open_now"`
	Windows []BusinessHourView `json:"windows"`
}

// BusinessHourView is a client-facing window with HH:MM strings.
type BusinessHourView struct {
	DayOfWeek int    `json:"day_of_week"`
	Open      string `json:"open"`
	Close     string `json:"close"`
}

// GetBusinessHours returns the schedule + the computed open-now flag (which also
// honors the manual is_open switch, matching the order-path gate).
func (s *Service) GetBusinessHours(ctx context.Context, restaurantID string) (*BusinessHoursStatus, error) {
	hours, err := s.loadBusinessHours(ctx, restaurantID)
	if err != nil {
		return nil, err
	}
	var isOpen bool
	if err := s.db.QueryRow(ctx, `SELECT is_open FROM restaurants WHERE id=$1`, restaurantID).Scan(&isOpen); err != nil {
		return nil, fmt.Errorf("restaurant: not found")
	}
	views := make([]BusinessHourView, 0, len(hours))
	for _, h := range hours {
		views = append(views, BusinessHourView{DayOfWeek: h.DayOfWeek, Open: formatHHMM(h.OpenMinute), Close: formatHHMM(h.CloseMinute)})
	}
	return &BusinessHoursStatus{
		OpenNow: effectiveOpen(isOpen, hours, time.Now(), lagosTZ),
		Windows: views,
	}, nil
}

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
	if err := s.AssertStaffPermission(ctx, restaurantID, userID, PermManageStore); err != nil {
		return err
	}
	if _, err := time.Parse("2006-01-02", h.Date); err != nil {
		return errors.New("restaurant: holiday_date must be YYYY-MM-DD")
	}
	if !h.IsClosed {
		if h.OpenMinute < 0 || h.OpenMinute > 1439 || h.CloseMinute < 1 || h.CloseMinute > 1440 || h.CloseMinute <= h.OpenMinute {
			return errors.New("restaurant: an open holiday needs a valid [open,close) window")
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
	if err := s.AssertStaffPermission(ctx, restaurantID, userID, PermManageStore); err != nil {
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
// SCHEDULED orders are excluded. They sit 'pending' by design from placement until
// their slot — up to 7 days (scheduledHorizon) — so any sane accept_sla_minutes would
// cancel and refund every one of them within minutes of being booked, silently deleting
// the feature. The restaurant's clock to accept a scheduled order starts when
// ActivateScheduledOrders releases it and clears scheduled_for, which is exactly when
// this predicate starts matching it.
func (s *Service) SweepUnacceptedOrders(ctx context.Context, now time.Time) (int, error) {
	const q = `
		SELECT o.id
		FROM orders o
		JOIN restaurants r ON r.id = o.restaurant_id
		WHERE o.status = 'pending'
		  AND o.scheduled_for IS NULL
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
		// cancelAndRefund emits the transition audit event itself now — a second
		// recordOrderEvent here would double-write the same pending→cancelled row.
		swept++
	}
	return swept, nil
}
