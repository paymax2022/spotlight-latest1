package doctor

import (
	"context"
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
)

// dashboard_metrics_live_db_test.go — the live-DB guard for the two doctor tiles
// that were reading doctor_appointments, a table NO booking path inserts into
// (the patient app books into public.appointments). Without a real Postgres the
// reads look correct and simply always answer zero, which is exactly how this
// shipped. Runs only with TEST_DATABASE_URL set; owns and removes every row it
// writes, with fresh uuids, so concurrent live-DB runs cannot see each other.

func metricsDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping doctor dashboard metrics live-DB tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// metricsService builds the service around the reads under test. The dashboard
// projects the wallet, so it needs a real ledger service; tiers and redis are
// collaborators this read never touches, and nil is their supported value.
// Defined here, not in the composition task, because dashboardTimezone is already
// a Service method in the first test this file runs.
func metricsService(pool *pgxpool.Pool) *Service {
	return NewService(pool, ledger.NewService(ledger.NewRepository(pool), nil), nil, nil)
}

type metricsFixture struct {
	pool       *pgxpool.Pool
	doctorUser string
	doctorRow  string
	patient    string
}

// newMetricsFixture seeds the state an approved, published doctor actually leaves
// behind (same shape as presence_directory_projection_live_db_test.go's helper)
// plus one patient with a profile. It deliberately does NOT create a
// doctor_availability row: the no-row default is part of the contract.
func newMetricsFixture(t *testing.T, pool *pgxpool.Pool) *metricsFixture {
	t.Helper()
	ctx := context.Background()
	f := &metricsFixture{pool: pool, doctorUser: uuid.NewString(), doctorRow: uuid.NewString(), patient: uuid.NewString()}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("fixture %q: %v", sql, err)
		}
	}
	exec(`INSERT INTO auth.users (id) VALUES ($1),($2)`, f.doctorUser, f.patient)
	// `handle_new_user()` fires AFTER INSERT ON auth.users and has already created the
	// profile row (20260401004207_create_user_profiles.sql:57), so this is an overwrite
	// of the fixture's identity, not an insert — a plain INSERT dies on the primary key.
	exec(`INSERT INTO user_profiles (id, email, full_name, age, gender)
	      VALUES ($1,$2,'Tunde Akinwale',34,'Male')
	      ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, full_name = EXCLUDED.full_name,
	                                     age = EXCLUDED.age, gender = EXCLUDED.gender`,
		f.patient, f.patient+"@patient.invalid")
	exec(`INSERT INTO doctor_profiles (user_id, name, specialty_id, fee_kobo, years_experience,
	                                   mdcn_number, verification, is_published, presence, is_online)
	      VALUES ($1,'Dr Ada Metrics','cardiology',750000,9,'MDCN/METRICS/1','approved',true,'offline',false)`, f.doctorUser)
	exec(`INSERT INTO doctors (id, user_id, name, specialty, consult_fee_kobo, is_available, is_online)
	      VALUES ($1,$2,'Dr Ada Metrics','cardiology',750000,true,false)`, f.doctorRow, f.doctorUser)
	t.Cleanup(func() {
		clean := context.WithoutCancel(context.Background())
		_, _ = pool.Exec(clean, `DELETE FROM doctor_reviews WHERE user_id = $1`, f.doctorUser)
		_, _ = pool.Exec(clean, `DELETE FROM appointments WHERE doctor_id = $1`, f.doctorRow)
		_, _ = pool.Exec(clean, `DELETE FROM settlements WHERE reference = $1`, "metrics-"+f.doctorUser)
		_, _ = pool.Exec(clean, `DELETE FROM doctor_availability WHERE user_id = $1`, f.doctorUser)
		_, _ = pool.Exec(clean, `DELETE FROM doctors WHERE id = $1`, f.doctorRow)
		_, _ = pool.Exec(clean, `DELETE FROM doctor_profiles WHERE user_id = $1`, f.doctorUser)
		_, _ = pool.Exec(clean, `DELETE FROM ledger_entries WHERE account_id IN
		         (SELECT id FROM ledger_accounts WHERE user_id = $1)`, f.doctorUser)
		_, _ = pool.Exec(clean, `DELETE FROM ledger_accounts WHERE user_id IN ($1,$2)`, f.doctorUser, f.patient)
		_, _ = pool.Exec(clean, `DELETE FROM user_profiles WHERE id = $2`, f.doctorUser, f.patient)
		_, _ = pool.Exec(clean, `DELETE FROM auth.users WHERE id IN ($1,$2)`, f.doctorUser, f.patient)
	})
	return f
}

// bookLocal inserts one appointment at `minutes` past midnight on the doctor's
// local day `dayOffset`, in wall-clock `zone`. The timestamp is built with the
// SAME AT TIME ZONE expression the repository reads with, so the fixture needs no
// Go zone database either, and the two cannot drift apart.
func (f *metricsFixture) bookLocal(t *testing.T, zone, status string, dayOffset, minutes int) (id, ref string) {
	t.Helper()
	const q = `
		INSERT INTO appointments (patient_id, doctor_id, scheduled_at, status, notes, fee_kobo,
		                          idempotency_key, consultation_type, ref)
		VALUES ($1,$2,
		        (((CURRENT_TIMESTAMP AT TIME ZONE $6::text)::date + $3::int)
		           + INTERVAL '1 minute' * $4::int) AT TIME ZONE $6::text,
		        $5,'headache for a week',750000,$7,'video',$8)
		RETURNING id::text`
	key := uuid.NewString()
	ref = "TM-" + strings.ToUpper(key[7:13])
	if err := f.pool.QueryRow(context.Background(), q, f.patient, f.doctorRow,
		dayOffset, minutes, status, zone, "metrics-"+key, ref).Scan(&id); err != nil {
		t.Fatalf("book %s %d/%d: %v", status, dayOffset, minutes, err)
	}
	return id, ref
}

// Karachi is UTC+5 with no DST, so a 00:30 local slot sits on the PREVIOUS UTC day.
// A UTC-day implementation returns {today 09:00, tomorrow 00:30} here — same count,
// different rows — which is why the assertions name the refs, not just the length.
func TestLiveDB_DashboardCountsAndQueueUseTheDoctorsLocalDay(t *testing.T) {
	pool := metricsDB(t)
	f := newMetricsFixture(t, pool)
	ctx := context.Background()
	if _, err := pool.Exec(ctx,
		`INSERT INTO doctor_availability (user_id, timezone) VALUES ($1,'Asia/Karachi')`, f.doctorUser); err != nil {
		t.Fatalf("availability: %v", err)
	}
	_, yestLate := f.bookLocal(t, "Asia/Karachi", "confirmed", -1, 23*60+30)
	_, todayLate := f.bookLocal(t, "Asia/Karachi", "booked", 0, 30)
	_, todayNine := f.bookLocal(t, "Asia/Karachi", "completed", 0, 9*60)
	_, tomorrowLate := f.bookLocal(t, "Asia/Karachi", "booked", 1, 30)
	_, cancelled := f.bookLocal(t, "Asia/Karachi", "cancelled", 0, 11*60)

	tz, err := metricsService(pool).dashboardTimezone(ctx, f.doctorUser)
	if err != nil {
		t.Fatalf("timezone: %v", err)
	}
	if tz != "Asia/Karachi" {
		t.Fatalf("timezone = %q, want Asia/Karachi", tz)
	}
	agg, err := NewRepository(pool).dashboardAggregates(ctx, f.doctorUser, tz)
	if err != nil {
		t.Fatalf("aggregates: %v", err)
	}
	if agg.TodaysCount != 2 {
		t.Errorf("TodaysCount = %d, want 2 (cancelled excluded, completed included)", agg.TodaysCount)
	}
	if agg.ConsultsThisMonth != 1 {
		t.Errorf("ConsultsThisMonth = %d, want 1", agg.ConsultsThisMonth)
	}
	// UpcomingCount is deliberately NOT asserted here: today's 00:30 row is ahead of
	// or behind CURRENT_TIMESTAMP depending on when the suite runs, so any expected
	// value would be a clock coincidence. TestLiveDB_DashboardUpcomingSkipsPastAnd-
	// FinishedRows pins it with rows that are unambiguously past or future.

	queue, err := NewRepository(pool).todayQueue(ctx, f.doctorUser, tz, agg.Today)
	if err != nil {
		t.Fatalf("todayQueue: %v", err)
	}
	// bookLocal returns the REF as its second value, and the refs are what the
	// assertions name — a uuid would prove the row exists but not which one.
	refs := make([]string, len(queue))
	for i, q := range queue {
		refs[i] = q.Ref
	}
	// Order is ascending by slot, and exactly the two local-today rows.
	if got, want := strings.Join(refs, ","), todayLate+","+todayNine; got != want {
		t.Errorf("queue refs = %q, want %q (ascending by slot)", got, want)
	}
	for _, gone := range []string{yestLate, tomorrowLate, cancelled} {
		if strings.Contains(strings.Join(refs, ","), gone) {
			t.Errorf("queue leaked %s", gone)
		}
	}
}

// The day-boundary test above cannot pin UpcomingCount, because a slot inside
// today is ahead of or behind NOW depending on when the suite runs. These rows are
// never ambiguous: yesterday's are always past and tomorrow's always future, in
// any zone and at any run time.
func TestLiveDB_DashboardUpcomingSkipsPastAndFinishedRows(t *testing.T) {
	pool := metricsDB(t)
	f := newMetricsFixture(t, pool)
	ctx := context.Background()
	tz := defaultDoctorTimezone

	// Past, but with a status upcoming counts by.
	f.bookLocal(t, tz, "booked", -1, 23*60+30)
	f.bookLocal(t, tz, "confirmed", -1, 22*60)
	// Future and still open — the only two that should count.
	f.bookLocal(t, tz, "booked", 1, 30)
	f.bookLocal(t, tz, "confirmed", 1, 5*60+30)
	// Future but finished, so not upcoming.
	f.bookLocal(t, tz, "completed", 1, 10*60)
	f.bookLocal(t, tz, "cancelled", 1, 11*60)

	agg, err := NewRepository(pool).dashboardAggregates(ctx, f.doctorUser, tz)
	if err != nil {
		t.Fatalf("aggregates: %v", err)
	}
	if agg.UpcomingCount != 2 {
		t.Errorf("UpcomingCount = %d, want 2 (the two future booked/confirmed rows only)", agg.UpcomingCount)
	}
	if agg.TodaysCount != 0 {
		t.Errorf("TodaysCount = %d, want 0 — no row sits on the doctor's local today", agg.TodaysCount)
	}
}

var isoDay = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// The client builds its date from `${slotDate}T00:00:00`, so a full timestamp
// here renders "Invalid Date" in the row; and status must be a ConsultStatus the
// badge knows. Asserted off the marshalled JSON because that is the contract —
// a Go field that happens to be right but serialises wrong is still broken.
func TestLiveDB_DashboardQueueRowWireShape(t *testing.T) {
	pool := metricsDB(t)
	f := newMetricsFixture(t, pool)
	tz := defaultDoctorTimezone
	f.bookLocal(t, tz, "booked", 0, 9*60)

	rows, err := NewRepository(pool).todayQueue(context.Background(), f.doctorUser, tz,
		mustToday(t, pool, f.doctorUser, tz))
	if err != nil {
		t.Fatalf("todayQueue: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("queue rows = %d, want 1", len(rows))
	}
	raw, err := json.Marshal(rows[0])
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got struct {
		SlotDate string `json:"slotDate"`
		SlotTime string `json:"slotTime"`
		Status   string `json:"status"`
		Patient  struct {
			Name   string `json:"name"`
			Gender string `json:"gender"`
			Age    int    `json:"age"`
		} `json:"patient"`
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !isoDay.MatchString(got.SlotDate) {
		t.Errorf("slotDate = %q, want YYYY-MM-DD", got.SlotDate)
	}
	if got.Status != "upcoming" {
		t.Errorf("status = %q, want 'upcoming' (booked renamed)", got.Status)
	}
	if got.Patient.Name != "Tunde Akinwale" || got.Patient.Age != 34 {
		t.Errorf("patient = %+v, want Tunde Akinwale / 34", got.Patient)
	}
	// Seeded as 'Male': the column is free text, the client type is a closed union.
	if got.Patient.Gender != "male" {
		t.Errorf("gender = %q, want 'male'", got.Patient.Gender)
	}
}

// 21 rows today: the tile counts them all, the list stays capped (spec D2a).
func TestLiveDB_DashboardCountsAreUncappedWhileTheQueueIsCapped(t *testing.T) {
	pool := metricsDB(t)
	f := newMetricsFixture(t, pool)
	tz := defaultDoctorTimezone
	for i := 0; i < dashboardQueueLimit+1; i++ {
		f.bookLocal(t, tz, "completed", 0, 8*60+i)
	}
	agg, err := NewRepository(pool).dashboardAggregates(context.Background(), f.doctorUser, tz)
	if err != nil {
		t.Fatalf("aggregates: %v", err)
	}
	if agg.TodaysCount != dashboardQueueLimit+1 {
		t.Errorf("TodaysCount = %d, want %d", agg.TodaysCount, dashboardQueueLimit+1)
	}
	rows, err := NewRepository(pool).todayQueue(context.Background(), f.doctorUser, tz, agg.Today)
	if err != nil {
		t.Fatalf("todayQueue: %v", err)
	}
	if len(rows) != dashboardQueueLimit {
		t.Errorf("queue rows = %d, want %d", len(rows), dashboardQueueLimit)
	}
}

// The join runs appointments → doctors → user_id. Getting that wrong is not a wrong
// number, it is another doctor's patient names appearing in your queue, so it gets
// its own case rather than hiding inside a count assertion.
func TestLiveDB_DashboardScopedToThisDoctor(t *testing.T) {
	pool := metricsDB(t)
	f := newMetricsFixture(t, pool)
	other := newMetricsFixture(t, pool)
	ctx := context.Background()
	tz := defaultDoctorTimezone

	mine, _ := f.bookLocal(t, tz, "booked", 0, 9*60)
	theirs, _ := other.bookLocal(t, tz, "completed", 0, 9*60)

	agg, err := NewRepository(pool).dashboardAggregates(ctx, f.doctorUser, tz)
	if err != nil {
		t.Fatalf("aggregates: %v", err)
	}
	if agg.TodaysCount != 1 {
		t.Errorf("TodaysCount = %d, want 1 — the second doctor's row must not count here", agg.TodaysCount)
	}
	rows, err := NewRepository(pool).todayQueue(ctx, f.doctorUser, tz, agg.Today)
	if err != nil {
		t.Fatalf("todayQueue: %v", err)
	}
	if len(rows) != 1 || rows[0].ID != mine {
		t.Errorf("queue = %+v, want exactly the one row %s", rows, mine)
	}
	for _, r := range rows {
		if r.ID == theirs {
			t.Errorf("queue leaked another doctor's appointment %s", theirs)
		}
	}
}

func mustToday(t *testing.T, pool *pgxpool.Pool, userID, tz string) string {
	t.Helper()
	agg, err := NewRepository(pool).dashboardAggregates(context.Background(), userID, tz)
	if err != nil {
		t.Fatalf("aggregates: %v", err)
	}
	return agg.Today
}
