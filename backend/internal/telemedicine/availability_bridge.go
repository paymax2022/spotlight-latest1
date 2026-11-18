package telemedicine

// availability_bridge.go — the doctor's published schedule, as bookable slots.
//
// The schedule screen writes ONE row: `doctor_availability`, whose `working_days`
// is [{day:"mon",enabled:true,startTime:"09:00",endTime:"17:00"}] beside a consult
// length and a gap between consults. GetAvailability looked for `doctor_availability
// _slots` instead — a table no writer in this repository touches — so every doctor
// fell through to synthSlots, and a published Monday-to-Friday day looked exactly
// like a doctor who never opened the screen.
//
// Slots are therefore DERIVED on read and never stored, the way
// internal/health/vet/availability.go does it: the schedule is the fact, the
// calendar is a projection of it, and a projection cannot go stale.
//
// Everything zone-dependent is Postgres's job (`now() AT TIME ZONE zone`, and the
// booking instants converted the same way), which is how internal/doctor already
// answers the doctor's local day. So `localNow` and the booked intervals here are
// naive wall-clock values read off that column, and the expansion never asks what
// timezone it is in.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// availabilityWindowDays is the picker's horizon — the same 5 days synthSlots
// covered, so bridging the schedule does not also change how far ahead a
// patient can look.
const availabilityWindowDays = 5

// defaultZone is the availability row's own default (internal/doctor
// UpsertAvailability writes it for a doctor who never picked a zone).
const defaultZone = "Africa/Lagos"

// clockWindow is one half-open wall-clock interval, `from` inclusive and `to`
// exclusive, both minutes from local midnight, on one weekday.
type clockWindow struct {
	weekday time.Weekday
	from    int
	to      int
}

// wallInterval is a stretch of the doctor's local day already taken.
type wallInterval struct{ start, end time.Time }

var weekdayNumbers = map[string]time.Weekday{
	"sun": time.Sunday, "mon": time.Monday, "tue": time.Tuesday, "wed": time.Wednesday,
	"thu": time.Thursday, "fri": time.Friday, "sat": time.Saturday,
}

// parseClockWindows reads the JSONB the schedule screen published —
// `working_days` or `breaks`, which share the day/start/end shape.
//
// `enabled:false` is a day off, and a window that ends where it starts offers
// nothing, so both are dropped. A bad value is an error rather than a silent
// skip: a truncated column must not quietly shrink the calendar the doctor
// believes they published.
func parseClockWindows(raw []byte, label string) ([]clockWindow, error) {
	if len(bytes.TrimSpace(raw)) == 0 || string(bytes.TrimSpace(raw)) == "null" {
		return nil, nil
	}
	var rows []struct {
		Day       string `json:"day"`
		Enabled   bool   `json:"enabled"`
		StartTime string `json:"startTime"`
		EndTime   string `json:"endTime"`
	}
	if err := json.Unmarshal(raw, &rows); err != nil {
		return nil, fmt.Errorf("telemedicine: %s column is not the published array: %w", label, err)
	}
	out := make([]clockWindow, 0, len(rows))
	for _, r := range rows {
		wd, ok := weekdayNumbers[r.Day]
		if !ok {
			return nil, fmt.Errorf("telemedicine: %s has day %q, want mon…sun", label, r.Day)
		}
		if !r.Enabled {
			continue
		}
		from, err := clockMinutes(r.StartTime)
		if err != nil {
			return nil, fmt.Errorf("telemedicine: %s on %s: %w", label, r.Day, err)
		}
		to, err := clockMinutes(r.EndTime)
		if err != nil {
			return nil, fmt.Errorf("telemedicine: %s on %s: %w", label, r.Day, err)
		}
		if to <= from {
			continue
		}
		out = append(out, clockWindow{weekday: wd, from: from, to: to})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].weekday != out[j].weekday {
			return out[i].weekday < out[j].weekday
		}
		return out[i].from < out[j].from
	})
	return out, nil
}

func clockMinutes(hhmm string) (int, error) {
	var h, m int
	if _, err := fmt.Sscanf(hhmm, "%d:%d", &h, &m); err != nil {
		return 0, fmt.Errorf("time %q is not HH:MM", hhmm)
	}
	if h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, fmt.Errorf("time %q is not a clock time", hhmm)
	}
	return h*60 + m, nil
}

// expandSlots projects the published windows onto the next `days` local days.
//
// A consult occupies `slotMins` and `bufferMins` separates it from the next one,
// so the grid steps slot + buffer while each slot still has to END inside its
// window — the rule internal/health/vet uses, with the doctor's own gap added.
// Times come out as "09:00 AM" because that is all the patient app can parse:
// features/telemedicine/pricing.ts `slotToISO` accepts only /^(\d{1,2}):(\d{2})
// \s*(AM|PM)$/, so a 24-hour label is an unbookable slot.
func expandSlots(doctorID string, hours, breaks []clockWindow, slotMins, bufferMins int,
	localNow time.Time, days int, booked []wallInterval) []Slot {
	if slotMins < 1 {
		slotMins = 30
	}
	if bufferMins < 0 {
		bufferMins = 0
	}
	step := slotMins + bufferMins

	out := []Slot{}
	base := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, time.UTC)
	nowMinutes := localNow.Hour()*60 + localNow.Minute()

	for d := 0; d < days; d++ {
		day := base.AddDate(0, 0, d)
		date := day.Format("2006-01-02")
		dayHours := windowsOn(hours, day.Weekday())
		dayBreaks := windowsOn(breaks, day.Weekday())
		seen := map[int]bool{}
		for _, w := range dayHours {
			for m := w.from; m+slotMins <= w.to; m += step {
				// Two published windows that overlap must not hand the picker the
				// same half hour twice.
				if seen[m] {
					continue
				}
				seen[m] = true
				if d == 0 && m <= nowMinutes {
					continue // already started, in the doctor's own clock
				}
				if overlapsAny(dayBreaks, m, m+slotMins) {
					continue
				}
				start := day.Add(time.Duration(m) * time.Minute)
				end := start.Add(time.Duration(slotMins) * time.Minute)
				available := true
				for _, b := range booked {
					if start.Before(b.end) && b.start.Before(end) {
						available = false
						break
					}
				}
				out = append(out, Slot{
					ID:        fmt.Sprintf("%s-%s-%d", doctorID, date, m),
					DoctorID:  doctorID,
					Date:      date,
					Time:      start.Format("03:04 PM"),
					Available: available,
				})
			}
		}
	}
	return out
}

func windowsOn(ws []clockWindow, day time.Weekday) []clockWindow {
	out := []clockWindow{}
	for _, w := range ws {
		if w.weekday == day {
			out = append(out, w)
		}
	}
	return out
}

// A window that ends exactly as a break starts is still bookable, so the
// comparison is strict at both ends.
func overlapsAny(ws []clockWindow, from, to int) bool {
	for _, w := range ws {
		if from < w.to && w.from < to {
			return true
		}
	}
	return false
}

// publishedSchedule is what the doctor's own row says about their day, in
// wall-clock terms, beside the zone that was used to read "today" from.
type publishedSchedule struct {
	hours      []clockWindow
	breaks     []clockWindow
	slotMins   int
	bufferMins int
}

// publishedSlots bridges the appointment read onto the schedule write. It
// answers found=false when the doctor has published nothing at all — no row, or
// a row with no enabled window — which is the one case the default calendar is
// there for.
func (s *Service) publishedSlots(ctx context.Context, doctorID string) (sched publishedSchedule, userID, zone string, found bool, err error) {
	// The booking row's doctor is `doctors.id`; the schedule is keyed by the
	// auth id, and the zone that decides "today" is doctor_profiles.timezone —
	// the column PUT /schedule/timezone writes. doctor_availability.timezone is
	// the legacy one the app never writes, so it cannot be the reference here.
	var tz *string
	err = s.db.QueryRow(ctx, `
		SELECT d.user_id, p.timezone
		FROM doctors d
		LEFT JOIN doctor_profiles p ON p.user_id = d.user_id
		WHERE d.id = $1`, doctorID).Scan(&userID, &tz)
	if errors.Is(err, pgx.ErrNoRows) {
		return sched, "", "", false, nil
	}
	if err != nil {
		return sched, "", "", false, err
	}
	zone = defaultZone
	if tz != nil && *tz != "" {
		zone = *tz
	}
	if zone, err = s.usableZone(ctx, zone); err != nil {
		return sched, "", "", false, err
	}

	var workingRaw, breaksRaw []byte
	var duration, buffer *int
	err = s.db.QueryRow(ctx, `
		SELECT working_days, breaks, consult_duration_mins, buffer_mins
		FROM doctor_availability WHERE user_id = $1`, userID).
		Scan(&workingRaw, &breaksRaw, &duration, &buffer)
	if errors.Is(err, pgx.ErrNoRows) {
		return sched, userID, zone, false, nil
	}
	if err != nil {
		return sched, "", "", false, err
	}
	if sched.hours, err = parseClockWindows(workingRaw, "working_days"); err != nil {
		return sched, "", "", false, err
	}
	if len(sched.hours) == 0 {
		return sched, userID, zone, false, nil
	}
	if sched.breaks, err = parseClockWindows(breaksRaw, "breaks"); err != nil {
		return sched, "", "", false, err
	}
	sched.slotMins = derefOr(duration, 30)
	sched.bufferMins = derefOr(buffer, 0)
	return sched, userID, zone, true, nil
}

// usableZone keeps a stale or hand-written value out of the patient's way:
// Postgres answers 22023 for a zone it cannot apply, which is the stored value's
// mistake and degrades to the module default. Any other failure is ours.
func (s *Service) usableZone(ctx context.Context, zone string) (string, error) {
	var at time.Time
	err := s.db.QueryRow(ctx, `SELECT now() AT TIME ZONE $1::text`, zone).Scan(&at)
	if err == nil {
		return zone, nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "22023" {
		return defaultZone, nil
	}
	return "", err
}

// localNow is the doctor's wall clock — `AT TIME ZONE` hands back a timestamp
// without an offset, which is exactly the naive value expandSlots compares
// against.
func (s *Service) localNow(ctx context.Context, zone string) (time.Time, error) {
	var at time.Time
	if err := s.db.QueryRow(ctx, `SELECT now() AT TIME ZONE $1::text`, zone).Scan(&at); err != nil {
		return at, err
	}
	return at, nil
}

// bookedSlots are the doctor's live bookings, converted to the same wall clock.
// `appointments` records no duration of its own, so a booking occupies one
// consult length — the same figure the calendar is cut with.
func (s *Service) bookedSlots(ctx context.Context, userID, zone string, from time.Time, days, slotMins int) ([]wallInterval, error) {
	until := from.AddDate(0, 0, days)
	rows, err := s.db.Query(ctx, `
		SELECT a.scheduled_at AT TIME ZONE $2
		FROM appointments a
		JOIN doctors d ON d.id = a.doctor_id
		WHERE d.user_id = $1
		  AND a.status IN ('booked','confirmed')
		  AND a.scheduled_at >= $3::timestamp AT TIME ZONE $2
		  AND a.scheduled_at <  $4::timestamp AT TIME ZONE $2
		ORDER BY a.scheduled_at`,
		userID, zone, from.Format("2006-01-02"), until.Format("2006-01-02"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []wallInterval{}
	for rows.Next() {
		var at time.Time
		if err := rows.Scan(&at); err != nil {
			return nil, err
		}
		out = append(out, wallInterval{start: at, end: at.Add(time.Duration(slotMins) * time.Minute)})
	}
	return out, rows.Err()
}

func derefOr(v *int, fallback int) int {
	if v == nil {
		return fallback
	}
	return *v
}
