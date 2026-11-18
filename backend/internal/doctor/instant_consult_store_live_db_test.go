package doctor

// instant_consult_store_live_db_test.go — one store for the instant-consult decision.
//
// Two screens ask the doctor the same question and two columns answer it:
//
//	app/(doctor)/availability.tsx:110  "Instant consults"
//	      -> PUT /availability -> doctor_availability.accepts_instant
//	app/(doctor)/settings.tsx:99       "Auto-accept instant consults"
//	      -> PUT /settings     -> doctor_settings.auto_accept_instant
//
// Only the first is read for behaviour: GetScheduleSettings projects it onto
// `appointmentOnly` (service_tail2.go), which is what decides whether patients
// may start an on-demand consult. Nothing consumes the settings column, yet
// app/(doctor)/(tabs)/index.tsx:85 renders the dashboard presence label off
// `settings.autoAcceptInstant`. So a doctor who switches instant consults OFF on
// the availability screen keeps being told "Accepting instant" on their own
// dashboard, and a doctor who uses the settings toggle changes nothing at all.
//
// These tests pin the fix: doctor_availability.accepts_instant is the single
// store, and /settings reads and writes that same value. The settings column
// stays in the table (no destructive migration) but is no longer consulted.
//
// Runs only with TEST_DATABASE_URL set; owns and removes its fixture.

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// newInstantDoctor seeds the auth.users row the FKs need plus a settings row, and
// cleans all three tables afterwards.
func newInstantDoctor(t *testing.T, autoAcceptInstant bool) (pool *pgxpool.Pool, userID string) {
	t.Helper()
	pool = livePool(t)
	ctx := context.Background()
	userID = uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2)`,
		userID, userID+"@instantstore.invalid"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO doctor_settings (user_id, auto_accept_instant) VALUES ($1,$2)`,
		userID, autoAcceptInstant); err != nil {
		t.Fatalf("seed doctor_settings: %v", err)
	}
	t.Cleanup(func() {
		cctx := context.WithoutCancel(ctx)
		for _, q := range []string{
			`DELETE FROM doctor_availability WHERE user_id=$1`,
			`DELETE FROM doctor_settings WHERE user_id=$1`,
			`DELETE FROM auth.users WHERE id=$1`,
		} {
			if _, err := pool.Exec(cctx, q, userID); err != nil {
				t.Logf("cleanup %q: %v", truncate(q), err)
			}
		}
	})
	return pool, userID
}

// The availability row is the store, so the disagreeing pair is the bug: the
// settings read must answer what the schedule read projects onto appointmentOnly.
func TestGetSettings_InstantAnsweredFromTheAvailabilityRow(t *testing.T) {
	pool, userID := newInstantDoctor(t, true)
	seedAvailabilityRow(t, pool, userID, false, false)

	s, err := NewService(pool, nil, nil, nil).GetSettings(context.Background(), userID)
	if err != nil {
		t.Fatalf("GET /settings: %v", err)
	}
	if s.AutoAcceptInstant {
		t.Error("autoAcceptInstant = true while doctor_availability.accepts_instant is false — " +
			"the availability screen switched instant consults off and the settings screen still says they are on")
	}
}

// The write has to land in the same column the read comes from, otherwise the
// settings toggle stays a no-op on the plane that actually decides consults.
func TestUpdateSettings_InstantWriteMovesTheAvailabilityRow(t *testing.T) {
	pool, userID := newInstantDoctor(t, true)
	seedAvailabilityRow(t, pool, userID, true, false)

	off := false
	if _, err := NewService(pool, nil, nil, nil).UpdateSettings(context.Background(), userID,
		UpdateSettingsRequest{AutoAcceptInstant: &off}); err != nil {
		t.Fatalf("PUT /settings: %v", err)
	}

	a, err := NewService(pool, nil, nil, nil).GetAvailability(context.Background(), userID)
	if err != nil {
		t.Fatalf("GET /availability: %v", err)
	}
	if a.AcceptsInstant {
		t.Error("doctor_availability.accepts_instant still true after the settings toggle turned it off — " +
			"the write went to the settings column, which nothing reads, so the schedule is unchanged",
		)
	}
}

// Both surfaces must agree on whatever they show, on both values and in both
// directions — the store is one, not whichever screen wrote last.
func TestInstantConsultStore_BothReadsAgree(t *testing.T) {
	for _, instant := range []bool{true, false} {
		instant := instant
		pool, userID := newInstantDoctor(t, !instant)

		if _, err := pool.Exec(context.Background(),
			`INSERT INTO doctor_availability (user_id, accepts_instant) VALUES ($1,$2)
			 ON CONFLICT (user_id) DO UPDATE SET accepts_instant = EXCLUDED.accepts_instant`,
			userID, instant); err != nil {
			t.Fatalf("seed accepts_instant=%v: %v", instant, err)
		}

		svc := NewService(pool, nil, nil, nil)
		s, err := svc.GetSettings(context.Background(), userID)
		if err != nil {
			t.Fatalf("GET /settings: %v", err)
		}
		a, err := svc.GetAvailability(context.Background(), userID)
		if err != nil {
			t.Fatalf("GET /availability: %v", err)
		}
		if s.AutoAcceptInstant != a.AcceptsInstant {
			t.Errorf("accepts_instant=%v: settings says %v, availability says %v — two answers to one question",
				instant, s.AutoAcceptInstant, a.AcceptsInstant)
		}
		if s.AutoAcceptInstant != instant {
			t.Errorf("accepts_instant=%v: the settings read answered %v", instant, s.AutoAcceptInstant)
		}
	}
}

// A settings write that says nothing about instant consults must not move the
// column — this is a partial update, not a full overwrite.
func TestUpdateSettings_InstantAbsentFromTheWrite_LeavesTheAvailabilityRow(t *testing.T) {
	pool, userID := newInstantDoctor(t, false)
	seedAvailabilityRow(t, pool, userID, true, false)

	push := false
	if _, err := NewService(pool, nil, nil, nil).UpdateSettings(context.Background(), userID,
		UpdateSettingsRequest{PushEnabled: &push}); err != nil {
		t.Fatalf("PUT /settings: %v", err)
	}

	a, err := NewService(pool, nil, nil, nil).GetAvailability(context.Background(), userID)
	if err != nil {
		t.Fatalf("GET /availability: %v", err)
	}
	if !a.AcceptsInstant {
		t.Error("a settings save that carried no autoAcceptInstant turned instant consults off on the schedule")
	}
	s, err := NewService(pool, nil, nil, nil).GetSettings(context.Background(), userID)
	if err != nil {
		t.Fatalf("GET /settings: %v", err)
	}
	if !s.AutoAcceptInstant {
		t.Error("the same save also flipped the settings read — an absent field must be preserved")
	}
	if s.PushEnabled {
		t.Error("pushEnabled=false in the body was not applied")
	}
}

// A fresh doctor has no availability row. GetAvailability synthesizes one that
// accepts instant consults, so /settings has to agree with it rather than answer
// the column default and put the two screens on opposite sides.
func TestGetSettings_NoAvailabilityRow_AnswersWhatTheScheduleShows(t *testing.T) {
	pool, userID := newInstantDoctor(t, false)

	svc := NewService(pool, nil, nil, nil)
	s, err := svc.GetSettings(context.Background(), userID)
	if err != nil {
		t.Fatalf("GET /settings: %v", err)
	}
	a, err := svc.GetAvailability(context.Background(), userID)
	if err != nil {
		t.Fatalf("GET /availability: %v", err)
	}
	if s.AutoAcceptInstant != a.AcceptsInstant {
		t.Errorf("fresh doctor: settings says %v, the synthesized schedule says %v",
			s.AutoAcceptInstant, a.AcceptsInstant)
	}
}

// Flipping the flag from the settings screen for a doctor who has never saved an
// availability row has to persist, not land on a row that isn't there.
func TestUpdateSettings_InstantForDoctorWithNoAvailabilityRow_Persists(t *testing.T) {
	pool, userID := newInstantDoctor(t, false)

	on := true
	if _, err := NewService(pool, nil, nil, nil).UpdateSettings(context.Background(), userID,
		UpdateSettingsRequest{AutoAcceptInstant: &on}); err != nil {
		t.Fatalf("PUT /settings for a doctor with no availability row: %v", err)
	}

	s, err := NewService(pool, nil, nil, nil).GetSettings(context.Background(), userID)
	if err != nil {
		t.Fatalf("GET /settings: %v", err)
	}
	if !s.AutoAcceptInstant {
		t.Error("instant consults switched on from the settings screen read back off — the write had nowhere to go")
	}
}
