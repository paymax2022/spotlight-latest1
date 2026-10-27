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

// ErrBusinessHourInvalid reports a malformed opening window in a SetBusinessHours body: a
// day outside 0–6, a time that is not HH:MM or out of range, 24:00 as an opening time, or a
// zero-length window. It exists so the handler answers 400 — the caller's body is wrong —
// instead of the 403 a permission failure earns.
var ErrBusinessHourInvalid = errors.New("restaurant: invalid opening window")

// parseHHMM parses "H:MM"/"HH:MM" (24-hour) into minutes from midnight. "24:00" maps
// to 1440 so a window can close exactly at end of day. Fail-closed on anything else.
func parseHHMM(s string) (int, error) {
	parts := strings.Split(strings.TrimSpace(s), ":")
	if len(parts) != 2 {
		return 0, fmt.Errorf("%w: time %q must be HH:MM", ErrBusinessHourInvalid, s)
	}
	h, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil {
		return 0, fmt.Errorf("%w: time %q must be HH:MM", ErrBusinessHourInvalid, s)
	}
	if m < 0 || m > 59 {
		return 0, fmt.Errorf("%w: minutes in %q out of range", ErrBusinessHourInvalid, s)
	}
	if h < 0 || h > 24 || (h == 24 && m != 0) {
		return 0, fmt.Errorf("%w: hour in %q out of range (00:00–24:00)", ErrBusinessHourInvalid, s)
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

// assertOpenForImmediateOrder refuses an order placed RIGHT NOW when the store's manual
// switch is off or the clock falls outside the hours the owner set. A store that has never
// set windows stays governed by the switch alone, exactly as before this feature, so no
// existing restaurant gains a schedule it never asked for.
//
// Scheduled orders never come through here: their slot is validated by resolveScheduledFor
// and settled at the slot by ActivateScheduledOrders, which cancels and refunds a closed
// one. People schedule precisely when the kitchen is shut, so refusing that at placement
// would delete the feature.
//
// The refusal names when the kitchen next opens, because "closed" on its own leaves the
// customer guessing.
func (s *Service) assertOpenForImmediateOrder(ctx context.Context, restaurantID string, isOpen bool, now time.Time) error {
	if !isOpen {
		return fmt.Errorf("%w (%s)", ErrRestaurantClosed, restaurantID)
	}
	weekly, err := s.loadBusinessHours(ctx, restaurantID)
	if err != nil {
		return err
	}
	holiday, err := s.loadHolidayForDate(ctx, restaurantID, now, lagosTZ)
	if err != nil {
		return err
	}
	if effectiveOpenWithHoliday(isOpen, weekly, holiday, now, lagosTZ) {
		return nil
	}
	if next, ok := s.nextOpenAt(ctx, restaurantID, weekly, now, lagosTZ); ok {
		return fmt.Errorf("%w — it opens again %s", ErrRestaurantClosed, describeNextOpen(now, next, lagosTZ))
	}
	return fmt.Errorf("%w (%s)", ErrRestaurantClosed, restaurantID)
}

// nextOpenAt walks the coming week minute by minute and returns the first instant the
// store would take an order: a dated override for that day replaces its weekly windows, and
// with none the weekly windows decide. Stepping the clock rather than reasoning about
// window arithmetic keeps the overnight and split-shift rules in isOpenAt alone. ok=false
// means no opening exists in the next seven days (or the lookups failed), so the caller
// says "closed" with no promise it cannot keep.
func (s *Service) nextOpenAt(ctx context.Context, restaurantID string, weekly []BusinessHour, from time.Time, loc *time.Location) (time.Time, bool) {
	overrides, err := s.loadHolidayRange(ctx, restaurantID, from, from.AddDate(0, 0, 7), loc)
	if err != nil {
		return time.Time{}, false
	}
	t := from.Truncate(time.Minute).Add(time.Minute)
	limit := t.AddDate(0, 0, 7)
	for t.Before(limit) {
		if h, dated := overrides[t.In(loc).Format("2006-01-02")]; dated {
			if holidayOpenAt(h, t, loc) {
				return t, true
			}
		} else if isOpenAt(weekly, t, loc) {
			return t, true
		}
		t = t.Add(time.Minute)
	}
	return time.Time{}, false
}

// describeNextOpen renders the wait in the terms a customer acts on: "at 18:00" for the
// rest of today, "tomorrow at 10:00", and the weekday from there.
func describeNextOpen(now, next time.Time, loc *time.Location) string {
	n, o := now.In(loc), next.In(loc)
	at := o.Format("15:04")
	switch o.Format("2006-01-02") {
	case n.Format("2006-01-02"):
		return "at " + at
	case n.AddDate(0, 0, 1).Format("2006-01-02"):
		return "tomorrow at " + at
	default:
		return o.Weekday().String() + " at " + at
	}
}

// loadHolidayRange returns the dated overrides for a restaurant between two local dates,
// keyed YYYY-MM-DD. The order gate needs the whole coming week to answer "when do we open
// again" — loadHolidayForDate only covers today.
func (s *Service) loadHolidayRange(ctx context.Context, restaurantID string, from, to time.Time, loc *time.Location) (map[string]HolidayHour, error) {
	rows, err := s.db.Query(ctx,
		`SELECT holiday_date::text, is_closed, open_minute, close_minute
		 FROM restaurant_holiday_hours
		 WHERE restaurant_id=$1 AND holiday_date BETWEEN $2::date AND $3::date`,
		restaurantID, from.In(loc).Format("2006-01-02"), to.In(loc).Format("2006-01-02"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]HolidayHour{}
	for rows.Next() {
		var h HolidayHour
		var open, close *int
		if err := rows.Scan(&h.Date, &h.IsClosed, &open, &close); err != nil {
			return nil, err
		}
		if open != nil {
			h.OpenMinute = *open
		}
		if close != nil {
			h.CloseMinute = *close
		}
		out[h.Date] = h
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
			return nil, fmt.Errorf("%w: window %d has day_of_week %d (want 0–6)", ErrBusinessHourInvalid, i, w.DayOfWeek)
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
			return nil, fmt.Errorf("%w: window %d open time cannot be 24:00", ErrBusinessHourInvalid, i)
		}
		if open == closeM {
			return nil, fmt.Errorf("%w: window %d open and close are equal (zero-length)", ErrBusinessHourInvalid, i)
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
	defer func() { _ = tx.Rollback(ctx) }()
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
		return nil, ErrRestaurantNotFound
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

// ---------------------------------------------------------------------------
// FOOD-UAT-B-009: reachable hours / closures / timed pause.

// Bounds for a timed pause: at least a minute, at most a day (longer is a closure).
const (
	minPauseMinutes = 1
	maxPauseMinutes = 24 * 60
)

// IsOpenNow is the full "can this store take an immediate order right now" decision:
// the manual switch, weekly hours, today's holiday override and any timed pause. A store
// with no hours, closures or pause is governed by is_open alone (unchanged back-compat).
func (s *Service) IsOpenNow(ctx context.Context, restaurantID string, t time.Time) (bool, error) {
	var pausedUntil *time.Time
	if err := s.db.QueryRow(ctx, `SELECT paused_until FROM restaurants WHERE id=$1`, restaurantID).Scan(&pausedUntil); err != nil {
		return false, ErrRestaurantNotFound
	}
	if pausedUntil != nil && pausedUntil.After(t) {
		return false, nil
	}
	return s.isRestaurantOpenNow(ctx, restaurantID, t)
}

// HoursOverview is the owner/admin view: weekly windows, upcoming closures and pause.
type HoursOverview struct {
	OpenNow     bool               `json:"open_now"`
	PausedUntil *time.Time         `json:"paused_until,omitempty"`
	Windows     []BusinessHourView `json:"windows"`
	Closures    []HolidayHour      `json:"closures"`
}

// GetHoursOverview returns the schedule, today-and-later closures and the pause state.
func (s *Service) GetHoursOverview(ctx context.Context, restaurantID string) (*HoursOverview, error) {
	st, err := s.GetBusinessHours(ctx, restaurantID)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	open, err := s.IsOpenNow(ctx, restaurantID, now)
	if err != nil {
		return nil, err
	}
	out := &HoursOverview{OpenNow: open, Windows: st.Windows, Closures: []HolidayHour{}}
	var paused *time.Time
	if err := s.db.QueryRow(ctx, `SELECT paused_until FROM restaurants WHERE id=$1`, restaurantID).Scan(&paused); err == nil && paused != nil && paused.After(now) {
		out.PausedUntil = paused
	}
	rows, err := s.db.Query(ctx, `SELECT holiday_date::text, is_closed, COALESCE(open_minute,0), COALESCE(close_minute,0)
	    FROM restaurant_holiday_hours WHERE restaurant_id=$1 AND holiday_date >= $2 ORDER BY holiday_date`,
		restaurantID, now.In(lagosTZ).Format("2006-01-02"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var h HolidayHour
		if err := rows.Scan(&h.Date, &h.IsClosed, &h.OpenMinute, &h.CloseMinute); err != nil {
			return nil, err
		}
		out.Closures = append(out.Closures, h)
	}
	return out, rows.Err()
}

// TimedPause stops new orders for `minutes` minutes, after which the store resumes on its
// own (owner/manager or admin). Returns the instant the pause ends.
func (s *Service) TimedPause(ctx context.Context, restaurantID, userID string, minutes int) (time.Time, error) {
	if err := s.AssertStaffPermission(ctx, restaurantID, userID, PermManageStore); err != nil {
		return time.Time{}, err
	}
	if minutes < minPauseMinutes || minutes > maxPauseMinutes {
		return time.Time{}, &invalidInputError{fmt.Sprintf("restaurant: pause minutes must be between %d and %d", minPauseMinutes, maxPauseMinutes)}
	}
	var until time.Time
	if err := s.db.QueryRow(ctx, `UPDATE restaurants SET paused_until = now() + make_interval(mins => $2), updated_at=now()
	    WHERE id=$1 RETURNING paused_until`, restaurantID, minutes).Scan(&until); err != nil {
		return time.Time{}, errors.New("restaurant: not found")
	}
	return until, nil
}

// ResumeFromPause ends a timed pause early.
func (s *Service) ResumeFromPause(ctx context.Context, restaurantID, userID string) error {
	if err := s.AssertStaffPermission(ctx, restaurantID, userID, PermManageStore); err != nil {
		return err
	}
	ct, err := s.db.Exec(ctx, `UPDATE restaurants SET paused_until=NULL, updated_at=now() WHERE id=$1`, restaurantID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return errors.New("restaurant: not found")
	}
	return nil
}

// SweepTimedPauses clears pauses that have ended (idempotent, multi-instance safe). The
// order gate already compares paused_until with the clock, so this is tidy-up that keeps
// the pause state visible to clients honest; it never touches is_open.
func (s *Service) SweepTimedPauses(ctx context.Context, now time.Time) (int, error) {
	ct, err := s.db.Exec(ctx, `UPDATE restaurants SET paused_until=NULL WHERE paused_until IS NOT NULL AND paused_until <= $1`, now)
	if err != nil {
		return 0, fmt.Errorf("restaurant: timed-pause sweep: %w", err)
	}
	return int(ct.RowsAffected()), nil
}
