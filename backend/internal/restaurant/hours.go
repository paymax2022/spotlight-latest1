package restaurant

import (
	"context"
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
//
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
