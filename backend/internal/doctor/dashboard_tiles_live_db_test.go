package doctor

// dashboard_tiles_live_db_test.go — the four tiles on the doctor's own landing
// screen.
//
// `app/(doctor)/(tabs)/index.tsx` renders "Today's consults", "Upcoming",
// "Available" and "Satisfaction". The live normalizer in
// src/api/doctor.batch1.api.ts seeded the first, second and fourth with a
// literal 0, and because `0` is not nullish the `?? todays.length` / `?? 0`
// fallbacks beside them could never fire — so a doctor with three real bookings
// saw 0 / 0 / 0% next to a queue that listed those same bookings.
//
// The wire was the reason: GET /dashboard was composed only from
// appointmentStatusCounts (a GROUP BY status with no date anywhere), the unread
// count and the ledger balance. Nothing server-side answered "today", so the
// client had nothing honest to show.
//
// These tests pin the date-aware counts, the reference clock that makes them
// testable, the satisfaction projection over the reviews table the module
// already reads for /reputation, and the fact that the tile's day and the
// appointment list's `slotDate` are the SAME day — one zone, the one
// doctor_profiles.timezone holds since PR #1027, not the legacy
// doctor_availability.timezone the list used before this.
//
// Runs only with TEST_DATABASE_URL set; owns and removes its fixtures.

import (
	"context"
	"testing"
	"time"

	"spotlight/backend/internal/finance/ledger"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// The dashboard projects the wallet tile from the double-entry ledger, so the
// tests need one — the same construction service_integration_test.go uses.
func dashboardService(pool *pgxpool.Pool) *Service {
	return NewService(pool, ledger.NewService(ledger.NewRepository(pool), nil), nil, nil)
}

// dashboardNow is a fixed instant in the middle of a Lagos day, so a tile that
// means "the doctor's local today" is decidable without racing midnight.
var dashboardNow = time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC)

// seedBooking puts one row on the plane a real booking writes
// (public.appointments, keyed by doctors.id) and removes it again.
func seedBooking(t *testing.T, pool *pgxpool.Pool, f apptFixture, at, status string) string {
	t.Helper()
	id := uuid.NewString()
	_, err := pool.Exec(context.Background(),
		`INSERT INTO appointments
		     (id, patient_id, doctor_id, doctor_name, consultation_type,
		      scheduled_at, status, notes, fee_kobo, idempotency_key)
		 VALUES ($1,$2,$3,$4,'video',$5,$6,'Tile fixture',$7,$8)`,
		id, f.patientUser, f.doctorID, "Doctor A Abiaka", at, status, 200000, "idem_"+id)
	if err != nil {
		t.Fatalf("seed appointment at %s (%s): %v", at, status, err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(context.Background()),
			`DELETE FROM appointments WHERE id=$1`, id)
	})
	return id
}

// The doctor's local today is not UTC's. 2026-11-14T23:30Z is 00:30 on the 15th
// in Lagos (UTC+1) and still the 14th in New York (UTC-5), so the same five rows
// answer two different "today" counts — which is the only way to prove a zone is
// actually applied rather than merely present in the query.
func TestDashboardDayCounts_ZoneDecidesWhoseTodayItIs(t *testing.T) {
	f := newAppointmentFixture(t, lagosSlot)
	pool := livePool(t)
	ctx := context.Background()

	seedBooking(t, pool, f, "2026-11-14T23:30:00Z", "booked")    // Lagos 15th, New York 14th
	seedBooking(t, pool, f, "2026-11-15T08:00:00Z", "confirmed") // today everywhere, already past
	seedBooking(t, pool, f, "2026-11-15T19:00:00Z", "booked")    // today in both zones, upcoming
	seedBooking(t, pool, f, "2026-11-18T09:00:00Z", "booked")    // upcoming, not today
	seedBooking(t, pool, f, "2026-11-15T09:30:00Z", "cancelled") // today but not a consult
	seedBooking(t, pool, f, "2026-11-14T09:00:00Z", "completed") // past, not today

	for _, tc := range []struct {
		zone        string
		wantToday   int64
		wantUpcomin int64
		wantDate    string
	}{
		{"Africa/Lagos", 3, 2, "2026-11-15"},
		{"America/New_York", 2, 2, "2026-11-15"},
	} {
		days, err := NewRepository(pool).DashboardDayCounts(ctx, f.doctorUser, tc.zone, dashboardNow)
		if err != nil {
			t.Fatalf("DashboardDayCounts(%s): %v", tc.zone, err)
		}
		if days.Today != tc.wantToday {
			t.Errorf("%s: today = %d, want %d — a UTC day boundary would give 2 here", tc.zone, days.Today, tc.wantToday)
		}
		if days.Upcoming != tc.wantUpcomin {
			t.Errorf("%s: upcoming = %d, want %d (cancelled and completed must not count)", tc.zone, days.Upcoming, tc.wantUpcomin)
		}
		if days.Date != tc.wantDate {
			t.Errorf("%s: date = %q, want %q", tc.zone, days.Date, tc.wantDate)
		}
	}

	// The same instant is a different calendar day either side of Greenwich, which
	// is the only thing that makes the zone above more than decoration.
	edge := time.Date(2026, 11, 15, 2, 0, 0, 0, time.UTC)
	lagos, err := NewRepository(pool).DashboardDayCounts(ctx, f.doctorUser, "Africa/Lagos", edge)
	if err != nil {
		t.Fatalf("DashboardDayCounts Lagos edge: %v", err)
	}
	ny, err := NewRepository(pool).DashboardDayCounts(ctx, f.doctorUser, "America/New_York", edge)
	if err != nil {
		t.Fatalf("DashboardDayCounts New York edge: %v", err)
	}
	if lagos.Date != "2026-11-15" || ny.Date != "2026-11-14" {
		t.Errorf("dates = %q / %q, want 2026-11-15 in Lagos and 2026-11-14 in New York at 02:00Z", lagos.Date, ny.Date)
	}
}

// The screen reads the tiles off the wire (counts.todaysAppointments /
// upcomingAppointments), so the dashboard payload has to carry them — and the
// date it counted, because "Today's queue" filters the same rows the tile counts.
func TestGetDashboard_AnswersTheTilesTheScreenReads(t *testing.T) {
	f := newAppointmentFixture(t, lagosSlot)
	pool := livePool(t)
	ctx := context.Background()
	seedProfile(t, pool, f.doctorUser)
	if _, err := pool.Exec(ctx, `UPDATE doctor_profiles SET timezone = 'Africa/Lagos' WHERE user_id = $1`,
		f.doctorUser); err != nil {
		t.Fatalf("set canonical zone: %v", err)
	}

	seedBooking(t, pool, f, "2026-11-15T08:00:00Z", "confirmed")
	seedBooking(t, pool, f, "2026-11-15T19:00:00Z", "booked")
	seedBooking(t, pool, f, "2026-11-18T09:00:00Z", "booked")
	seedBooking(t, pool, f, "2026-11-15T09:30:00Z", "cancelled")

	res, err := dashboardService(pool).GetDashboard(ctx, f.doctorUser, dashboardNow)
	if err != nil {
		t.Fatalf("GetDashboard: %v", err)
	}
	w := wire(t, res)
	if got, _ := w["todaysAppointments"].(float64); got != 2 {
		t.Errorf("todaysAppointments = %#v, want 2 — the normalizer used to answer a literal 0 here", w["todaysAppointments"])
	}
	if got, _ := w["upcomingAppointments"].(float64); got != 2 {
		t.Errorf("upcomingAppointments = %#v, want 2", w["upcomingAppointments"])
	}
	if got, _ := w["todayDate"].(string); got != "2026-11-15" {
		t.Errorf("todayDate = %#v, want %q — Today's queue filters slotDate against it", w["todayDate"], "2026-11-15")
	}
	// The status counts the pending tile already relies on must survive. Three
	// booked rows: the two seeded here plus the fixture's own.
	counts, ok := w["appointmentCounts"].(map[string]any)
	if !ok {
		t.Fatalf("appointmentCounts = %#v, want the status buckets", w["appointmentCounts"])
	}
	if counts["pending"] != float64(3) {
		t.Errorf("counts[pending] = %#v, want 3 booked rows awaiting a decision", counts["pending"])
	}
}

// Satisfaction is the fourth tile. /reputation already aggregates doctor_reviews
// with the moderation-hidden rows excluded, so the tile projects that same
// aggregate onto a percentage instead of answering zero.
func TestGetDashboard_SatisfactionFromRealReviews(t *testing.T) {
	f := newAppointmentFixture(t, lagosSlot)
	pool := livePool(t)
	ctx := context.Background()

	seed := []struct {
		rating any
		detail string
	}{
		{5, `{}`},
		{4, `{}`},
		{1, `{"moderation":{"hidden":true}}`},
		{nil, `{}`}, // a report with no score must not dilute the average
	}
	for _, s := range seed {
		if _, err := pool.Exec(ctx,
			`INSERT INTO doctor_reviews (user_id, rating, body, detail) VALUES ($1,$2,'fixture',$3::jsonb)`,
			f.doctorUser, s.rating, s.detail); err != nil {
			t.Fatalf("seed doctor_reviews: %v", err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM doctor_reviews WHERE user_id=$1`, f.doctorUser)
	})

	res, err := dashboardService(pool).GetDashboard(ctx, f.doctorUser, dashboardNow)
	if err != nil {
		t.Fatalf("GetDashboard: %v", err)
	}
	w := wire(t, res)
	if got, _ := w["satisfactionPct"].(float64); got != 90 {
		t.Errorf("satisfactionPct = %#v, want 90 (avg of 5 and 4 over 5) — a hidden review and a ratingless one are excluded", w["satisfactionPct"])
	}
}

// Zero reviews is an honest zero, not a failure: the screen must still get a
// dashboard.
func TestGetDashboard_WithoutReviewsIsZeroNotError(t *testing.T) {
	f := newAppointmentFixture(t, lagosSlot)
	res, err := dashboardService(livePool(t)).GetDashboard(context.Background(), f.doctorUser, dashboardNow)
	if err != nil {
		t.Fatalf("GetDashboard with no reviews: %v", err)
	}
	if got := wire(t, res)["satisfactionPct"]; got != float64(0) {
		t.Errorf("satisfactionPct = %#v, want 0", got)
	}
}

// One zone, one answer. PR #1027 made doctor_profiles.timezone the column the
// schedule screen writes and the schedule read answers; the appointment list was
// still formatting its slot from the legacy doctor_availability.timezone, so the
// tile's "today" and the queue's slotDate could name different days.
func TestEffectiveTimezone_AnswersTheProfileZone(t *testing.T) {
	f := newAppointmentFixture(t, lagosSlot)
	pool := livePool(t)
	ctx := context.Background()

	// The fixture's doctor_availability row holds Africa/Lagos; the doctor's own
	// choice lives on the profile.
	seedProfile(t, pool, f.doctorUser)
	if _, err := pool.Exec(ctx, `UPDATE doctor_profiles SET timezone = 'Asia/Tokyo' WHERE user_id = $1`,
		f.doctorUser); err != nil {
		t.Fatalf("set profile zone: %v", err)
	}

	got, err := NewRepository(pool).EffectiveTimezone(ctx, f.doctorUser)
	if err != nil {
		t.Fatalf("EffectiveTimezone: %v", err)
	}
	if got != "Asia/Tokyo" {
		t.Errorf("EffectiveTimezone = %q, want the profile's Asia/Tokyo over the legacy availability Africa/Lagos", got)
	}

	rows, err := NewRepository(pool).ListAppointments(ctx, f.doctorUser, "")
	if err != nil {
		t.Fatalf("ListAppointments: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("len = %d, want the fixture booking", len(rows))
	}
	w := wire(t, rows[0])
	// 2026-11-14T11:00Z is 12:00 PM in Lagos and 08:00 PM in Tokyo.
	if tm, _ := w["slotTime"].(string); tm != "08:00 PM" {
		t.Errorf("slotTime = %q, want %q — the list still formatted from doctor_availability.timezone", w["slotTime"], "08:00 PM")
	}
}

// A zone Postgres cannot apply must degrade to the default instead of turning the
// doctor's own list into a 22023 outage; the write path rejects such values now,
// but rows predate that gate.
func TestEffectiveTimezone_DegradesAZonePostgresCannotApply(t *testing.T) {
	f := newAppointmentFixture(t, lagosSlot)
	pool := livePool(t)
	ctx := context.Background()
	seedProfile(t, pool, f.doctorUser)
	if _, err := pool.Exec(ctx, `UPDATE doctor_profiles SET timezone = 'Mars/Olympus_Mons' WHERE user_id = $1`,
		f.doctorUser); err != nil {
		t.Fatalf("set junk zone: %v", err)
	}

	got, err := NewRepository(pool).EffectiveTimezone(ctx, f.doctorUser)
	if err != nil {
		t.Fatalf("EffectiveTimezone with a junk zone: %v, want the default, not an error", err)
	}
	if got != "Africa/Lagos" {
		t.Errorf("EffectiveTimezone = %q, want the Africa/Lagos default", got)
	}
	rows, err := NewRepository(pool).ListAppointments(ctx, f.doctorUser, "")
	if err != nil {
		t.Fatalf("ListAppointments with a junk zone = %v, want the list to still answer", err)
	}
	if len(rows) != 1 {
		t.Errorf("len = %d, want the fixture booking", len(rows))
	}
}
