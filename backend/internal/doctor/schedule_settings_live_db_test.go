package doctor

// schedule_settings_live_db_test.go — the schedule screen's two availability controls.
//
// app/(doctor)/schedule/settings.tsx renders `appointmentOnly` and
// `emergencyAvailable` off GET /schedule, and its emergency toggle writes
// doctor_availability.emergency_enabled through PUT /schedule/emergency. The read
// answered neither field, so the toggle snapped back to off on every refetch and
// the mode row kept saying "Instant consults enabled" to a doctor who turned it off.
//
// The other write is worse: the availability screen's PUT carries no
// emergencyEnabled — the field is not on the client's AvailabilitySchedule at all
// (src/types/doctor.ts) — and UpsertAvailability wrote ptr.Deref(nil, false) into
// that column on every save. So saving working hours silently switched emergency
// availability off for the doctor who had it on.
//
// Runs only with TEST_DATABASE_URL set; owns and removes its fixture.

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// newSchedDoctor seeds the auth.users row the FK needs, hands back the pool, and
// cleans both tables afterwards — so a test that adds an availability row still
// leaves nothing behind.
func newSchedDoctor(t *testing.T) (pool *pgxpool.Pool, userID string) {
	t.Helper()
	pool = livePool(t)
	ctx := context.Background()
	userID = uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2)`,
		userID, userID+"@schedsettings.invalid"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	t.Cleanup(func() {
		cctx := context.WithoutCancel(ctx)
		for _, q := range []string{
			`DELETE FROM doctor_availability WHERE user_id=$1`,
			`DELETE FROM auth.users WHERE id=$1`,
		} {
			if _, err := pool.Exec(cctx, q, userID); err != nil {
				t.Logf("cleanup %q: %v", truncate(q), err)
			}
		}
	})
	return pool, userID
}

func seedAvailabilityRow(t *testing.T, pool *pgxpool.Pool, userID string, acceptsInstant, emergencyEnabled bool) {
	t.Helper()
	_, err := pool.Exec(context.Background(),
		`INSERT INTO doctor_availability (user_id, accepts_instant, emergency_enabled) VALUES ($1,$2,$3)`,
		userID, acceptsInstant, emergencyEnabled)
	if err != nil {
		t.Fatalf("seed doctor_availability: %v", err)
	}
}

// The hours-only save the availability screen sends must leave the other
// control's column alone.
func TestUpsertAvailability_EmergencyAbsentFromTheSchedule_StaysAsStored(t *testing.T) {
	pool, userID := newSchedDoctor(t)
	seedAvailabilityRow(t, pool, userID, false, true)

	instant := true
	got, err := NewRepository(pool).UpsertAvailability(context.Background(), userID, AvailabilityScheduleInput{
		WorkingDays:    json.RawMessage(`[{"day":"mon","enabled":true,"startTime":"09:00","endTime":"17:00"}]`),
		AcceptsInstant: &instant,
	})
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if !got.EmergencyEnabled {
		t.Error("saving the working hours turned emergency availability off — the schedule sent no emergencyEnabled, so nothing should have moved that column")
	}
}

// The flip side: a schedule that does answer the field still sets it, so this is
// preservation of an omission, not a frozen column.
func TestUpsertAvailability_EmergencyExplicitlyOff_IsStoredOff(t *testing.T) {
	pool, userID := newSchedDoctor(t)
	seedAvailabilityRow(t, pool, userID, true, true)

	off := false
	got, err := NewRepository(pool).UpsertAvailability(context.Background(), userID, AvailabilityScheduleInput{
		EmergencyEnabled: &off,
	})
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if got.EmergencyEnabled {
		t.Error("an explicit emergencyEnabled=false must still switch the column off")
	}
}

// SetEmergencySchedule keeps the doctor's emergency windows in rules->'emergency'
// on this same row. The availability screen sends no rules, so an hours save used
// to blank the column and silently delete them.
func TestUpsertAvailability_RulesAbsentFromTheSchedule_KeepsTheEmergencyWindows(t *testing.T) {
	pool, userID := newSchedDoctor(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	if err := repo.SetEmergencySchedule(ctx, userID, true,
		json.RawMessage(`[{"day":"mon","startTime":"00:00","endTime":"23:59"}]`)); err != nil {
		t.Fatalf("PUT /schedule/emergency: %v", err)
	}

	if _, err := repo.UpsertAvailability(ctx, userID, AvailabilityScheduleInput{
		WorkingDays: json.RawMessage(`[{"day":"mon","enabled":true,"startTime":"09:00","endTime":"17:00"}]`),
	}); err != nil {
		t.Fatalf("upsert: %v", err)
	}

	got, err := repo.GetAvailability(ctx, userID)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if !strings.Contains(string(got.Rules), `"emergency"`) {
		t.Errorf("rules = %s after a schedule save — the emergency windows PUT /schedule/emergency wrote are gone", got.Rules)
	}
}

func TestGetScheduleSettings_AnswersTheModeTheAvailabilityRowHolds(t *testing.T) {
	pool, userID := newSchedDoctor(t)
	seedAvailabilityRow(t, pool, userID, false, true)

	res, err := NewService(pool, nil, nil, nil).GetScheduleSettings(context.Background(), userID)
	if err != nil {
		t.Fatalf("GET /schedule: %v", err)
	}
	w := wire(t, res)
	// settings.tsx:62 renders appointmentOnly ? 'Appointment-only mode' : 'Instant
	// consults enabled' — a missing key reads as the second label forever.
	appointmentOnly, ok := w["appointmentOnly"].(bool)
	if !ok {
		t.Fatalf("appointmentOnly is %#v — the schedule screen reads it as a boolean, so it must be on the wire", w["appointmentOnly"])
	}
	if !appointmentOnly {
		t.Error("appointmentOnly = false while accepts_instant is false — the row says appointment-only and the screen says instant consults are on")
	}
	// settings.tsx:52 feeds the toggle, which PUT /schedule/emergency just wrote.
	emergency, ok := w["emergencyAvailable"].(bool)
	if !ok {
		t.Fatalf("emergencyAvailable is %#v — the toggle renders off whatever the doctor enabled", w["emergencyAvailable"])
	}
	if !emergency {
		t.Error("emergencyAvailable = false while emergency_enabled is true — the toggle snaps back to off after every save")
	}
}

// recurring.tsx:40 computes the slot length as
// `Math.max(1, settings.schedule.consultDurationMins + settings.schedule.bufferMins)`
// with only `settings` guarded. With no `schedule` key that sum is NaN and the
// screen renders a NaN-long slot, so the availability row itself must ride along.
func TestGetScheduleSettings_CarriesTheScheduleItsScreensRead(t *testing.T) {
	pool, userID := newSchedDoctor(t)
	seedAvailabilityRow(t, pool, userID, true, false)

	res, err := NewService(pool, nil, nil, nil).GetScheduleSettings(context.Background(), userID)
	if err != nil {
		t.Fatalf("GET /schedule: %v", err)
	}
	w := wire(t, res)
	schedule, ok := w["schedule"].(map[string]any)
	if !ok {
		t.Fatalf("schedule is %#v — recurring.tsx reads settings.schedule.* off the same payload", w["schedule"])
	}
	if _, ok := schedule["consultDurationMins"].(float64); !ok {
		t.Errorf("schedule.consultDurationMins is %#v, want the stored number", schedule["consultDurationMins"])
	}
	if _, ok := schedule["bufferMins"].(float64); !ok {
		t.Errorf("schedule.bufferMins is %#v, want the stored number", schedule["bufferMins"])
	}
}

// A fresh doctor has no doctor_availability row. GET /availability synthesizes
// one; the schedule read now depends on that same answer and must not turn the
// missing row into an error the screen renders as "could not load".
func TestGetScheduleSettings_NoAvailabilityRow_StillAnswers(t *testing.T) {
	pool, userID := newSchedDoctor(t)

	res, err := NewService(pool, nil, nil, nil).GetScheduleSettings(context.Background(), userID)
	if err != nil {
		t.Fatalf("GET /schedule for a doctor with no availability row: %v", err)
	}
	w := wire(t, res)
	appointmentOnly, ok := w["appointmentOnly"].(bool)
	if !ok {
		t.Fatalf("appointmentOnly is %#v — a missing row answers the synthesized default, not nothing", w["appointmentOnly"])
	}
	if appointmentOnly {
		t.Error("appointmentOnly = true for a fresh doctor, whose synthesized schedule accepts instant consults")
	}
}
