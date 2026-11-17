package telemedicine_test

// availability_bridge_live_db_test.go — the schedule the doctor saved is the
// calendar the patient gets.
//
// Before this bridge GetAvailability could only answer two things: rows from
// `doctor_availability_slots`, which no writer in this repository creates, or
// `synthSlots` — a fixed 7-slot day (09:00 AM … 06:00 PM, every 90 minutes)
// whose availability mask is `(d+i)%3`. So the published `doctor_availability`
// row was read by the portal and by nothing else, and a doctor who saved
// 09:00–17:00 was offered to patients on the same half-hour grid as one who
// never opened the screen.
//
// 09:30 AM and 06:00 PM are the two labels these tests discriminate on: the
// first exists only on a 30-minute grid inside a published window, the second
// only in the default calendar. Skips unless TEST_DATABASE_URL is set; owns and
// removes its fixture.

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/telemedicine"
)

const wat = 3600 // Africa/Lagos is UTC+1 with no daylight saving

// seedPublishedWeek seeds every weekday 09:00–17:00 so the assertions do not
// depend on which day today is.
func seedPublishedWeek(t *testing.T, ctx context.Context, pool *pgxpool.Pool, doctorUserID string, duration, buffer int) {
	t.Helper()
	working := `[` +
		`{"day":"mon","enabled":true,"startTime":"09:00","endTime":"17:00"},` +
		`{"day":"tue","enabled":true,"startTime":"09:00","endTime":"17:00"},` +
		`{"day":"wed","enabled":true,"startTime":"09:00","endTime":"17:00"},` +
		`{"day":"thu","enabled":true,"startTime":"09:00","endTime":"17:00"},` +
		`{"day":"fri","enabled":true,"startTime":"09:00","endTime":"17:00"},` +
		`{"day":"sat","enabled":true,"startTime":"09:00","endTime":"17:00"},` +
		`{"day":"sun","enabled":true,"startTime":"09:00","endTime":"17:00"}` +
		`]`

	_, err := pool.Exec(ctx, `
		INSERT INTO doctor_availability
			(user_id, working_days, breaks, consult_duration_mins, buffer_mins, timezone)
		VALUES ($1::uuid, $2::jsonb, '[]'::jsonb, $3, $4, 'Africa/Lagos')`,
		doctorUserID, working, duration, buffer)
	if err != nil {
		t.Fatalf("seed doctor_availability: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM doctor_availability WHERE user_id=$1::uuid`, doctorUserID)
	})
}

func slotLabel(s telemedicine.Slot) string { return s.Date + " " + s.Time }

func TestLiveDB_PublishedHoursBecomeTheBookableCalendar(t *testing.T) {
	pool := uatFixesPool(t)
	ctx := context.Background()
	svc := testTelemedService(t, pool)
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	doctorID, doctorUserID, _ := seedApprovedDoctor(t, ctx, pool, led, 500_000)
	seedPublishedWeek(t, ctx, pool, doctorUserID, 30, 0)

	slots, err := svc.GetAvailability(ctx, doctorID)
	if err != nil {
		t.Fatalf("GetAvailability: %v", err)
	}

	byDate := map[string][]telemedicine.Slot{}
	for _, s := range slots {
		byDate[s.Date] = append(byDate[s.Date], s)
	}
	if len(byDate) == 0 {
		t.Fatal("a doctor with published hours got an empty calendar")
	}
	today := doctorToday(t, ctx, pool)
	for date, day := range byDate {
		// The read refuses slots that are already past, so today's own day
		// shrinks as the clock advances and its count is time-of-day
		// dependent. Every future day must carry the full 09:00–17:00
		// half-hour grid; today is checked for window membership only.
		if date <= today {
			for _, s := range day {
				if s.Time == "09:00 AM" || s.Time == "09:30 AM" {
					t.Errorf("%s offers %s after the clock passed it — past slots must be refused", slotLabel(s), s.Time)
				}
			}
			continue
		}
		if len(day) != 16 {
			t.Errorf("%s has %d slots, want the 16 a 09:00–17:00 day of 30-minute consults is: %v",
				date, len(day), dayLabels(day))
		}
	}
	// The whole calendar runs 09:00 → 16:30 (the last consult ending at 17:00).
	// Nothing outside the window may appear, and half of the 09:30s the default
	// calendar never offers must be here.
	seen := map[string]bool{}
	for _, s := range slots {
		seen[s.Time] = true
		if s.Time == "06:00 PM" {
			t.Errorf("%s offers the default calendar's 06:00 PM — the window closes at 17:00", slotLabel(s))
		}
	}
	for _, want := range []string{"09:00 AM", "09:30 AM", "04:30 PM"} {
		if !seen[want] {
			t.Errorf("no %s slot, want the grid inside the doctor's own window; times = %v", want, keys(seen))
		}
	}
}

// A booking is not a hole in the doctor's calendar: the slot stays visible with
// available=false, which is what the read has always promised.
func TestLiveDB_ARealBookingMarksItsSlotTaken(t *testing.T) {
	pool := uatFixesPool(t)
	ctx := context.Background()
	svc := testTelemedService(t, pool)
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	doctorID, doctorUserID, patientID := seedApprovedDoctor(t, ctx, pool, led, 500_000)
	seedPublishedWeek(t, ctx, pool, doctorUserID, 30, 0)

	before, err := svc.GetAvailability(ctx, doctorID)
	if err != nil {
		t.Fatalf("GetAvailability before the booking: %v", err)
	}
	// A slot on a later day, so the "today is half gone" rule cannot be what
	// explains the difference.
	today := doctorToday(t, ctx, pool)
	picked := telemedicine.Slot{}
	for _, s := range before {
		if s.Date > today && s.Available {
			picked = s
			break
		}
	}
	if picked.ID == "" {
		t.Fatal("no future slot to book in the published calendar")
	}

	lagos := time.FixedZone("WAT", wat)
	// The exact inverse of the label expandSlots writes, in the doctor's zone.
	at, err := time.ParseInLocation("2006-01-02 03:04 PM", picked.Date+" "+picked.Time, lagos)
	if err != nil {
		t.Fatalf("slot %q %q is not a wall time the picker could send: %v", picked.Date, picked.Time, err)
	}

	apptID := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO appointments
			(id, patient_id, doctor_id, doctor_name, consultation_type,
			 scheduled_at, status, notes, fee_kobo, idempotency_key)
		VALUES ($1::uuid,$2::uuid,$3::uuid,'Dr Booked','video',$4,'booked','Bridge fixture',500000,$5)`,
		apptID, patientID, doctorID, at, "bridge-"+apptID); err != nil {
		t.Fatalf("seed booking: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM appointments WHERE id=$1::uuid`, apptID)
	})

	after, err := svc.GetAvailability(ctx, doctorID)
	if err != nil {
		t.Fatalf("GetAvailability after the booking: %v", err)
	}
	if len(after) != len(before) {
		t.Fatalf("the calendar went %d → %d slots, want the booking to mark one taken, not delete it",
			len(before), len(after))
	}
	for _, s := range after {
		if s.Date == picked.Date && s.Time == picked.Time {
			if s.Available {
				t.Errorf("%s still available, want it taken by the booking", slotLabel(s))
			}
			continue
		}
		if !s.Available {
			t.Errorf("%s came back unavailable, want only the booked slot masked", slotLabel(s))
		}
	}
}

// Nothing published still means the picker is never empty: the default calendar
// is untouched, which is the only thing synthSlots was ever for.
func TestLiveDB_NoPublishedScheduleKeepsTheDefaultCalendar(t *testing.T) {
	pool := uatFixesPool(t)
	ctx := context.Background()
	svc := testTelemedService(t, pool)
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	doctorID, _, _ := seedApprovedDoctor(t, ctx, pool, led, 500_000)

	slots, err := svc.GetAvailability(ctx, doctorID)
	if err != nil {
		t.Fatalf("GetAvailability: %v", err)
	}
	if len(slots) != 35 {
		t.Fatalf("len = %d, want the default 5 days × 7 slots", len(slots))
	}
	seen := map[string]bool{}
	for _, s := range slots {
		seen[s.Time] = true
	}
	if !seen["06:00 PM"] || seen["09:30 AM"] {
		t.Errorf("times = %v, want the default window, not a derived one", keys(seen))
	}
}

// A zone the app can write but this read must not choke on. doctor_profiles is
// the column PUT /schedule/timezone owns, so the calendar is cut on it — and a
// value Postgres cannot apply degrades to the module default instead of failing
// the patient's picker.
func TestLiveDB_TheCanonicalProfileZoneDecidesToday(t *testing.T) {
	pool := uatFixesPool(t)
	ctx := context.Background()
	svc := testTelemedService(t, pool)
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	doctorID, doctorUserID, _ := seedApprovedDoctor(t, ctx, pool, led, 500_000)
	seedPublishedWeek(t, ctx, pool, doctorUserID, 30, 0)

	// One profile row per test, and this fixture has none yet.
	profID := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO doctor_profiles (id, user_id, timezone) VALUES ($1::uuid,$2::uuid,$3)`,
		profID, doctorUserID, "Pacific/Kiritimati"); err != nil {
		t.Fatalf("seed doctor_profiles: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM doctor_profiles WHERE id=$1::uuid`, profID)
	})

	slots, err := svc.GetAvailability(ctx, doctorID)
	if err != nil {
		t.Fatalf("GetAvailability: %v", err)
	}
	if len(slots) == 0 {
		t.Fatal("empty calendar for a doctor whose zone is UTC+14")
	}
	// UTC+14 is the furthest ahead on earth: at any instant the local date is at
	// least the UTC date, and the calendar must start from THAT day.
	utc := time.Now().UTC().Format("2006-01-02")
	if slots[0].Date < utc {
		t.Errorf("first date = %s, want no earlier than the UTC date %s", slots[0].Date, utc)
	}
}

func doctorToday(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	var at time.Time
	if err := pool.QueryRow(ctx, `SELECT now() AT TIME ZONE 'Africa/Lagos'`).Scan(&at); err != nil {
		t.Fatalf("doctor's local now: %v", err)
	}
	return at.Format("2006-01-02")
}

func dayLabels(day []telemedicine.Slot) []string {
	out := make([]string, 0, len(day))
	for _, s := range day {
		out = append(out, s.Time)
	}
	return out
}

func keys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
