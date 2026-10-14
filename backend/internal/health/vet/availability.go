package healthvet

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	healthscheduling "spotlight/backend/internal/health/scheduling"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"net/http"
	"spotlight/backend/go-common/ginutil"
)

// Vet availability: a vet's weekly working windows (one per visit type), the
// time they are off, and the bookable slots computed from both. Slots are never
// stored. A slot is offered only when no blocking appointment or time off covers
// it, using the same blocking states as booking, so the two cannot disagree.

// slotMinutes is the length of every bookable slot.
const slotMinutes = 30

// AvailabilityDaysMax is the furthest ahead availability is computed.
const AvailabilityDaysMax = 14

// ErrNoVetProfile is returned to a signed-in user who has no vet provider row.
var ErrNoVetProfile = errors.New("vet: no vet profile for this account")

// HoursWindow is one working window, in the shape the provider screen uses. Type
// is lower-case (tele | home | clinic) in JSON and stored upper-case.
type HoursWindow struct {
	ID      string `json:"id"`
	Day     string `json:"day"`   // Mon … Sun
	Start   string `json:"start"` // HH:MM
	End     string `json:"end"`   // HH:MM (24:00 allowed)
	Type    string `json:"type"`
	Enabled bool   `json:"enabled"`
}

// AvailabilitySlot is one bookable start time.
type AvailabilitySlot struct {
	ID        string `json:"id"`
	Start     string `json:"start"` // RFC3339, UTC
	Label     string `json:"label"` // HH:MM in the clinic's calendar
	Type      string `json:"type"`
	Available bool   `json:"available"`
}

// AvailabilityDay is one day of bookable slots, in the clinic's calendar.
type AvailabilityDay struct {
	Date  string             `json:"date"`  // YYYY-MM-DD
	Label string             `json:"label"` // "Fri 16 Oct"
	Slots []AvailabilitySlot `json:"slots"`
}

// hoursRow is a validated window as stored.
type hoursRow struct {
	weekday    int
	start, end int // minutes from midnight; end may be 1440
	dbType     string
	enabled    bool
}

// busyInterval is time a slot cannot use: a blocking appointment or time off.
type busyInterval struct{ start, end time.Time }

var hhmm = regexp.MustCompile(`^([01][0-9]|2[0-3]):([0-5][0-9])$`)

var dayToWeekday = map[string]int{"Sun": 0, "Mon": 1, "Tue": 2, "Wed": 3, "Thu": 4, "Fri": 5, "Sat": 6}

var weekdayToDay = [7]string{"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"}

var typeToDB = map[string]string{"tele": "TELE", "home": "HOME", "clinic": "CLINIC"}
var dbToType = map[string]string{"TELE": "tele", "HOME": "home", "CLINIC": "clinic"}

// parseClock reads HH:MM as minutes from midnight. "24:00" is accepted only as an
// end time, so a window can run to the end of the day.
func parseClock(s string, allowMidnightEnd bool) (int, error) {
	if allowMidnightEnd && s == "24:00" {
		return 1440, nil
	}
	m := hhmm.FindStringSubmatch(s)
	if m == nil {
		return 0, fmt.Errorf("Times must be HH:MM, for example 09:00")
	}
	h, _ := strconv.Atoi(m[1])
	mi, _ := strconv.Atoi(m[2])
	return h*60 + mi, nil
}

// validateHours checks and converts the owner's windows. Messages are shown to the
// owner. Enabled windows may not overlap on the same day, whatever their type: a
// vet cannot be in two places at once.
func validateHours(in []HoursWindow) ([]hoursRow, error) {
	rows := make([]hoursRow, 0, len(in))
	for _, w := range in {
		wd, ok := dayToWeekday[w.Day]
		if !ok {
			return nil, errors.New("Choose a day of the week for each window")
		}
		dbType, ok := typeToDB[strings.ToLower(w.Type)]
		if !ok {
			return nil, errors.New("Each window needs a visit type: tele, home or clinic")
		}
		start, err := parseClock(w.Start, false)
		if err != nil {
			return nil, err
		}
		end, err := parseClock(w.End, true)
		if err != nil {
			return nil, err
		}
		if end <= start {
			return nil, fmt.Errorf("A window on %s must end after it starts", w.Day)
		}
		if end-start < slotMinutes {
			return nil, fmt.Errorf("A window on %s must be at least %d minutes long", w.Day, slotMinutes)
		}
		rows = append(rows, hoursRow{weekday: wd, start: start, end: end, dbType: dbType, enabled: w.Enabled})
	}
	for wd := 0; wd < 7; wd++ {
		var day []hoursRow
		for _, r := range rows {
			if r.weekday == wd && r.enabled {
				day = append(day, r)
			}
		}
		sort.Slice(day, func(i, j int) bool { return day[i].start < day[j].start })
		for i := 1; i < len(day); i++ {
			if day[i].start < day[i-1].end {
				return nil, fmt.Errorf("Working hours on %s overlap", weekdayToDay[wd])
			}
		}
	}
	return rows, nil
}

// ComputeSlots turns working windows and busy time into bookable days for the
// next `days` calendar days in loc. Slots start on the hour grid of each window
// and must end inside it; a slot already in the past or overlapping busy time is
// left out. Days without any slot are omitted.
func ComputeSlots(providerID string, hours []hoursRow, busy []busyInterval, now time.Time, days int, loc *time.Location) []AvailabilityDay {
	out := []AvailabilityDay{}
	if days < 1 {
		return out
	}
	if days > AvailabilityDaysMax {
		days = AvailabilityDaysMax
	}
	local := now.In(loc)
	for i := 0; i < days; i++ {
		date := time.Date(local.Year(), local.Month(), local.Day()+i, 0, 0, 0, 0, loc)
		var slots []AvailabilitySlot
		for _, r := range hours {
			if !r.enabled || r.weekday != int(date.Weekday()) {
				continue
			}
			for m := r.start; m+slotMinutes <= r.end; m += slotMinutes {
				st := time.Date(date.Year(), date.Month(), date.Day(), 0, m, 0, 0, loc)
				en := st.Add(slotMinutes * time.Minute)
				if !st.After(now) || busyOverlaps(busy, st, en) {
					continue
				}
				slots = append(slots, AvailabilitySlot{
					ID:        providerID + ":" + st.UTC().Format(time.RFC3339) + ":" + dbToType[r.dbType],
					Start:     st.UTC().Format(time.RFC3339),
					Label:     st.Format("15:04"),
					Type:      dbToType[r.dbType],
					Available: true,
				})
			}
		}
		if len(slots) == 0 {
			continue
		}
		sort.Slice(slots, func(a, b int) bool { return slots[a].Start < slots[b].Start })
		out = append(out, AvailabilityDay{
			Date:  date.Format("2006-01-02"),
			Label: date.Format("Mon 2 Jan"),
			Slots: slots,
		})
	}
	return out
}

func busyOverlaps(busy []busyInterval, st, en time.Time) bool {
	for _, b := range busy {
		if slotsOverlap(st, en, b.start, b.end) {
			return true
		}
	}
	return false
}

// slotsOverlap is half-open: back-to-back intervals do not overlap.
func slotsOverlap(aStart, aEnd, bStart, bEnd time.Time) bool {
	return aStart.Before(bEnd) && bStart.Before(aEnd)
}

// VetAvailability returns a listed vet's bookable days. An unlisted or missing vet
// is ErrVetNotFound.
func (s *Service) VetAvailability(ctx context.Context, vetID string, days int, now time.Time) ([]AvailabilityDay, error) {
	if _, err := s.GetVetListing(ctx, vetID); err != nil {
		return nil, err
	}
	hours, err := s.loadHours(ctx, vetID)
	if err != nil {
		return nil, err
	}
	to := now.AddDate(0, 0, days+1)
	busy, err := s.loadBusy(ctx, vetID, now, to)
	if err != nil {
		return nil, err
	}
	return ComputeSlots(vetID, hours, busy, now, days, petLocal), nil
}

// loadHours reads a provider's working windows.
func (s *Service) loadHours(ctx context.Context, providerID string) ([]hoursRow, error) {
	rows, err := s.db.Query(ctx, `
		SELECT weekday, start_minute, end_minute, visit_type, enabled
		FROM vet_weekly_hours WHERE provider_id = $1::uuid
		ORDER BY weekday, start_minute`, providerID)
	if err != nil {
		return nil, fmt.Errorf("vet: load hours: %w", err)
	}
	defer rows.Close()
	var out []hoursRow
	for rows.Next() {
		var r hoursRow
		if err := rows.Scan(&r.weekday, &r.start, &r.end, &r.dbType, &r.enabled); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// loadBusy reads the blocking appointments and time off that overlap [from, to).
func (s *Service) loadBusy(ctx context.Context, providerID string, from, to time.Time) ([]busyInterval, error) {
	var out []busyInterval
	apptRows, err := s.db.Query(ctx, `
		SELECT slot_start, slot_end FROM health_appointments
		WHERE provider_id = $1::uuid AND state = ANY($2)
		  AND slot_start < $4 AND slot_end > $3`,
		providerID, healthscheduling.BlockingStateList(), from, to)
	if err != nil {
		return nil, fmt.Errorf("vet: load bookings: %w", err)
	}
	for apptRows.Next() {
		var b busyInterval
		if err := apptRows.Scan(&b.start, &b.end); err != nil {
			apptRows.Close()
			return nil, err
		}
		out = append(out, b)
	}
	apptRows.Close()
	if err := apptRows.Err(); err != nil {
		return nil, err
	}
	blockRows, err := s.db.Query(ctx, `
		SELECT starts_at, ends_at FROM vet_availability_blocks
		WHERE provider_id = $1::uuid AND starts_at < $3 AND ends_at > $2`,
		providerID, from, to)
	if err != nil {
		return nil, fmt.Errorf("vet: load time off: %w", err)
	}
	defer blockRows.Close()
	for blockRows.Next() {
		var b busyInterval
		if err := blockRows.Scan(&b.start, &b.end); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, blockRows.Err()
}

// ownProviderID returns the caller's vet provider id, or ErrNoVetProfile.
func (s *Service) ownProviderID(ctx context.Context, ownerID string) (string, error) {
	var id string
	err := s.db.QueryRow(ctx, `
		SELECT id::text FROM health_providers
		WHERE owner_user_id = $1::uuid AND domain = 'VET' AND provider_type = 'vet'
		LIMIT 1`, ownerID).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrNoVetProfile
		}
		return "", fmt.Errorf("vet: own provider: %w", err)
	}
	return id, nil
}

// ProviderHours returns the caller's own working windows.
func (s *Service) ProviderHours(ctx context.Context, ownerID string) ([]HoursWindow, error) {
	if ownerID == "" {
		return nil, errors.New("vet: unauthenticated")
	}
	providerID, err := s.ownProviderID(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `
		SELECT id::text, weekday, start_minute, end_minute, visit_type, enabled
		FROM vet_weekly_hours WHERE provider_id = $1::uuid
		ORDER BY weekday, start_minute`, providerID)
	if err != nil {
		return nil, fmt.Errorf("vet: provider hours: %w", err)
	}
	defer rows.Close()
	out := []HoursWindow{}
	for rows.Next() {
		var (
			id      string
			wd, s0  int
			e0      int
			dbType  string
			enabled bool
		)
		if err := rows.Scan(&id, &wd, &s0, &e0, &dbType, &enabled); err != nil {
			return nil, err
		}
		out = append(out, HoursWindow{
			ID: id, Day: weekdayToDay[wd], Start: clockString(s0), End: clockString(e0),
			Type: dbToType[dbType], Enabled: enabled,
		})
	}
	return out, rows.Err()
}

// SaveProviderHours replaces the caller's working windows with the given set. It
// is all-or-nothing: the old windows are removed only when the new ones are valid
// and written in the same transaction.
func (s *Service) SaveProviderHours(ctx context.Context, ownerID string, in []HoursWindow) ([]HoursWindow, error) {
	if ownerID == "" {
		return nil, errors.New("vet: unauthenticated")
	}
	rows, err := validateHours(in)
	if err != nil {
		return nil, err
	}
	providerID, err := s.ownProviderID(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("vet: begin hours: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `DELETE FROM vet_weekly_hours WHERE provider_id = $1::uuid`, providerID); err != nil {
		return nil, fmt.Errorf("vet: clear hours: %w", err)
	}
	for _, r := range rows {
		if _, err := tx.Exec(ctx, `
			INSERT INTO vet_weekly_hours (provider_id, weekday, start_minute, end_minute, visit_type, enabled)
			VALUES ($1::uuid, $2, $3, $4, $5, $6)`,
			providerID, r.weekday, r.start, r.end, r.dbType, r.enabled); err != nil {
			return nil, fmt.Errorf("vet: write hours: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("vet: commit hours: %w", err)
	}
	s.audited(ownerID, "", "health.vet.availability.save", providerID, nil, map[string]any{"windows": len(rows)})
	return s.ProviderHours(ctx, ownerID)
}

// clockString renders minutes from midnight as HH:MM ("24:00" for 1440).
func clockString(m int) string {
	return fmt.Sprintf("%02d:%02d", m/60, m%60)
}

// VetAvailabilityHandler — GET /vets/:id/availability?days=14
func (h *Handler) VetAvailability(c *gin.Context) {
	if id := ginutil.UserID(c); id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	vetID, ok := uuidPathID(c, "id")
	if !ok {
		return
	}
	days := AvailabilityDaysMax
	if v := c.Query("days"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			days = n
		}
	}
	if days < 1 || days > AvailabilityDaysMax {
		days = AvailabilityDaysMax
	}
	out, err := h.svc.VetAvailability(c.Request.Context(), vetID, days, time.Now())
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, ErrVetNotFound) {
			status = http.StatusNotFound
		}
		failErr(c, status, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "days": out})
}

// ProviderAvailability — GET /provider/availability (the caller's own hours)
func (h *Handler) ProviderAvailability(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	blocks, err := h.svc.ProviderHours(c.Request.Context(), id)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, ErrNoVetProfile) {
			status = http.StatusNotFound
		}
		failErr(c, status, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "blocks": blocks})
}

// SaveProviderAvailability — PUT /provider/availability {blocks:[...]}
func (h *Handler) SaveProviderAvailability(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Blocks []HoursWindow `json:"blocks"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	// Validate here as well as in the service, so bad hours never reach a write.
	if _, err := validateHours(req.Blocks); err != nil {
		failErr(c, http.StatusUnprocessableEntity, err)
		return
	}
	blocks, err := h.svc.SaveProviderHours(c.Request.Context(), id, req.Blocks)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, ErrNoVetProfile) {
			status = http.StatusNotFound
		}
		failErr(c, status, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "blocks": blocks})
}
