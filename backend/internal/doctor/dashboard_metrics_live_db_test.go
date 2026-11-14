package doctor

import (
	"context"
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

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
// plus one patient with a profile. The profile row is what the zone read looks at,
// so the no-row fallback is exercised by its own test, not by this fixture.
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
	tag, err := pool.Exec(ctx,
		`UPDATE doctor_profiles SET timezone = 'Asia/Karachi' WHERE user_id = $1`, f.doctorUser)
	if err != nil {
		t.Fatalf("karachi: %v", err)
	}
	if tag.RowsAffected() != 1 {
		t.Fatalf("karachi: the fixture's doctor_profiles row was not updated — the read would fall back to " +
			"Africa/Lagos and this test would prove nothing")
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

// The fallback branch of dashboardTimezone. Without this, a doctor_profiles read that
// turned ErrNotFound into a hard error would still pass every other test here — they all
// run against a fixture that HAS a profile row.
func TestLiveDB_DashboardTimezoneFallsBackWithoutAProfileRow(t *testing.T) {
	pool := metricsDB(t)
	ctx := context.Background()
	userID := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id) VALUES ($1)`, userID); err != nil {
		t.Fatalf("auth user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(context.Background()),
			`DELETE FROM user_profiles WHERE id = $1`, userID)
		_, _ = pool.Exec(context.WithoutCancel(context.Background()),
			`DELETE FROM auth.users WHERE id = $1`, userID)
	})
	tz, err := metricsService(pool).dashboardTimezone(ctx, userID)
	if err != nil {
		t.Fatalf("dashboardTimezone for a doctor with no profile row: %v", err)
	}
	if tz != defaultDoctorTimezone {
		t.Errorf("timezone = %q, want %q", tz, defaultDoctorTimezone)
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

// The UI vocabulary's clock form, per spec D8: "09:00 AM", never "09:00" and never "9 AM".
var clock12 = regexp.MustCompile(`^\d{2}:\d{2} (AM|PM)$`)

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
	// Decoded and asserted, not merely unmarshalled: `to_char(..., 'HH12:MI AM')` is the
	// only thing standing between this column and a 24-hour `HH24:MI`, and the client
	// renders the string verbatim.
	if !clock12.MatchString(got.SlotTime) {
		t.Errorf("slotTime = %q, want HH:MM AM/PM", got.SlotTime)
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

// escrow writes a settlement row and links it to the appointment the way
// telemedicine.BookAppointment + settlement.Escrow leave them. The idempotency key
// is held in a variable because the UPDATE below has to select the row the INSERT
// just created — a second uuid.NewString() there would match nothing and silently
// leave settlement_id NULL, which reads back as "no consult money" rather than an
// error. One reference per fixture (cleanup deletes by reference), many keys.
// Production writes reference = "appointment:"+apptID (telemedicine/service.go:509);
// this fixture deliberately does not copy that shape, because a per-appointment
// reference would break the single cleanup DELETE that keys on the shared one.
// Nothing in the projection reads `reference`, so the difference is inert — if a
// future read ever does key on it, this helper stops being a safe substitute for
// the real escrow path and says so here.
// settledAt is the row's settlements.settled_at, and the ZERO time.Time means
// "not settled". Passing a date rather than a bool is what lets one fixture row
// sit in a previous calendar month, and that row is the only thing the month
// FILTER on ThisMonthKobo can be falsified by.
func (f *metricsFixture) escrow(t *testing.T, apptID, status string, totalKobo, providerKobo, platformFeeKobo int64, settledAt time.Time, moduleType string) {
	t.Helper()
	ctx := context.Background()
	key := "metrics-" + uuid.NewString()
	// The zero time.Time must reach Postgres as SQL NULL, not as 0001-01-01, so the
	// column stays an `any` holding either a time.Time or an untyped nil. It is not
	// the string "now()" either — CAST rejects that as invalid datetime input.
	var settledCol any
	if !settledAt.IsZero() {
		settledCol = settledAt
	}
	// moduleType is a parameter, not the literal 'telemedicine', so one call site can
	// prove the read's module filter bites. settlements.module_type is plain text with
	// no CHECK and no FK (verified against the live catalog), so any label inserts.
	if _, err := f.pool.Exec(ctx, `
		INSERT INTO settlements (reference, module_type, payer_id, total_kobo, fee_kobo, provider_kobo,
		                         status, settled_at, idempotency_key)
		VALUES ($1,$8,$2,$3,0,$4,$5,$6,$7)`,
		"metrics-"+f.doctorUser, f.patient, totalKobo, providerKobo, status, settledCol, key, moduleType); err != nil {
		t.Fatalf("insert settlement (%s): %v", status, err)
	}
	if _, err := f.pool.Exec(ctx, `
		UPDATE appointments
		   SET settlement_id = (SELECT id FROM settlements WHERE idempotency_key = $2),
		       platform_fee_kobo = $3
		 WHERE id = $1`, apptID, key, platformFeeKobo); err != nil {
		t.Fatalf("link settlement (%s): %v", status, err)
	}
}

// A refund is not revenue and not pending; another module's settlement is not
// consult money even for the same doctor; an appointment whose settlement was never
// written contributes nothing.
func TestLiveDB_DashboardConsultRevenue(t *testing.T) {
	pool := metricsDB(t)
	f := newMetricsFixture(t, pool)
	ctx := context.Background()
	tz := defaultDoctorTimezone

	settledID, _ := f.bookLocal(t, tz, "completed", -3, 10*60)
	f.escrow(t, settledID, "settled", 200000, 170001, 0, time.Now().UTC(), "telemedicine")
	escrowedID, _ := f.bookLocal(t, tz, "booked", 1, 10*60)
	// provider_kobo here is deliberately NOT the 0 a real escrowed row carries
	// (Settle writes it in the same tx that flips status to 'settled', so no live
	// row is ever both unsettled and paid): leave it 0 and deleting `st.status =
	// 'settled'` from settledQ is green. It is equally deliberately NOT the number
	// escrowedQ projects for this row — ComputeLegs(200000, fee 2000) is 168300,
	// so this sits one kobo above it — because that one kobo is what makes
	// "make the two reads symmetric: sum provider_kobo and drop the projection"
	// change the reported figure instead of matching the test's own `want`. The
	// settled row is guarded from the other side: 170001 is NOT 0.85 × (200000 − 0)
	// = 170000, so settledQ cannot be replaced by a re-derivation either. Paid and
	// projected are different numbers on both rows, so neither read can collapse
	// into the other.
	f.escrow(t, escrowedID, "escrowed", 200000, 168301, 2000, time.Time{}, "telemedicine")
	refundedID, _ := f.bookLocal(t, tz, "cancelled", -5, 10*60)
	f.escrow(t, refundedID, "refunded", 300000, 0, 0, time.Time{}, "telemedicine")
	// The rows that make BOTH module predicates load-bearing. One label is not
	// enough, because the two reads filter on different statuses: a settled
	// non-telemedicine row can only ever be excluded by settledQ's predicate, and
	// an escrowed one only by escrowedQ's. Each therefore needs its own row, both
	// with money in the column that read sums — otherwise deleting either filter
	// stays green. What the two filters buy is defence, not a live leak: the reads
	// are gated by `JOIN appointments a ON a.settlement_id = st.id`, and only
	// telemedicine ever writes appointments.settlement_id, so a restaurant payout
	// cannot reach a consult sum whatever its label. The way this filter can
	// actually hurt runs the other way and is quieter — a genuine consult
	// settlement stored with a different module_type (a mislabel, or a new health
	// vertical reusing appointments) contributes 0 to all three money columns
	// forever. These rows pin that trade-off so it stays a decision rather than an
	// accident. `settlements.module_type` is plain text with no CHECK and no FK
	// (verified against the live catalog), so 'restaurant' inserts; locally only
	// 'telemedicine' exists today, so ambient data could never have proven either
	// filter on its own.
	otherID, _ := f.bookLocal(t, tz, "completed", -2, 10*60)
	f.escrow(t, otherID, "settled", 400000, 320000, 0, time.Now().UTC(), "restaurant")
	otherEscrowID, _ := f.bookLocal(t, tz, "booked", 3, 10*60)
	f.escrow(t, otherEscrowID, "escrowed", 400000, 0, 0, time.Time{}, "restaurant")
	// The row that makes the month FILTER on ThisMonthKobo falsifiable. Every
	// other settled telemedicine row above settles at now(), so without this one
	// ThisMonthKobo is arithmetically the same figure as LifetimeKobo and the
	// whole FILTER — including the `$2` timezone parameter, which appears nowhere
	// else in settledQ — can be deleted or pointed at another date column and
	// nothing notices. Settled one calendar month back, and with a provider_kobo
	// of 90000 where the projection for its own total would be 76500, it is
	// counted by LifetimeKobo and excluded by ThisMonthKobo. Its escrowed_at is
	// the column default now() (NOT NULL DEFAULT now(), verified live), which is
	// what turns a `settled_at` → `escrowed_at` swap in the FILTER into a wrong
	// number rather than a different way of saying the same thing.
	prevMonthID, _ := f.bookLocal(t, tz, "completed", -40, 10*60)
	f.escrow(t, prevMonthID, "settled", 90000, 90000, 0,
		time.Now().UTC().AddDate(0, -1, 0), "telemedicine")

	rev, err := NewRepository(pool).consultRevenue(ctx, f.doctorUser, tz)
	if err != nil {
		t.Fatalf("consultRevenue: %v", err)
	}
	if rev.LifetimeKobo != 260001 {
		t.Errorf("LifetimeKobo = %d, want 260001 (both settled telemedicine rows' provider_kobo, 170001 + 90000)", rev.LifetimeKobo)
	}
	// Only the row settled now is this month's; the 90000 one settled last month.
	if rev.ThisMonthKobo != 170001 {
		t.Errorf("ThisMonthKobo = %d, want 170001", rev.ThisMonthKobo)
	}
	// The month tile must not be the lifetime tile wearing a different label. This
	// inequality is the assertion the fixture used to make unfalsifiable, and it
	// names the two mutations it now catches: deleting the month FILTER wholesale
	// (ThisMonthKobo becomes SUM(provider_kobo) = LifetimeKobo = 260001), and
	// swapping st.settled_at for st.escrowed_at inside it (escrowed_at is
	// NOT NULL DEFAULT now() on every row this helper writes, including the one
	// settled last month, so the swap sums it into "this month" — the same
	// 260001). Both also break the line above; this one says which of the two
	// mistakes it is, and it is the only assertion that proves the doctor's
	// timezone reaches the money read at all, since `$2` appears nowhere else in
	// settledQ.
	if rev.ThisMonthKobo == rev.LifetimeKobo {
		t.Errorf("ThisMonthKobo == LifetimeKobo == %d — the month FILTER is not excluding the row settled last month", rev.ThisMonthKobo)
	}
	want, err := pendingConsultKobo(200000, 2000)
	if err != nil {
		t.Fatalf("expected pending: %v", err)
	}
	if rev.PendingKobo != want {
		t.Errorf("PendingKobo = %d, want %d (ComputeLegs for the same row)", rev.PendingKobo, want)
	}

	// A second doctor's own settlement must not land in this doctor's figures.
	// `other` is a whole second fixture — its own doctor, its own patient uuid —
	// so this probes the `d.user_id = $1` scoping, not any patient sharing.
	other := newMetricsFixture(t, pool)
	otherAppt, _ := other.bookLocal(t, tz, "completed", -1, 9*60)
	other.escrow(t, otherAppt, "settled", 900000, 765000, 0, time.Now().UTC(), "telemedicine")
	// Booked, not completed: the escrowed read is the one this row must not reach.
	otherPending, _ := other.bookLocal(t, tz, "booked", 2, 9*60)
	other.escrow(t, otherPending, "escrowed", 500000, 0, 0, time.Time{}, "telemedicine")
	rev2, err := NewRepository(pool).consultRevenue(ctx, f.doctorUser, tz)
	if err != nil {
		t.Fatalf("consultRevenue after second doctor: %v", err)
	}
	if rev2.LifetimeKobo != rev.LifetimeKobo {
		t.Errorf("LifetimeKobo moved to %d — the settled read is not scoped to the doctor", rev2.LifetimeKobo)
	}
	// The settled probe above cannot protect escrowedQ: an unscoped escrowed read
	// would add 425000 to PendingKobo, so PendingKobo needs its own assertion.
	if rev2.PendingKobo != rev.PendingKobo {
		t.Errorf("PendingKobo moved to %d, want %d — the escrowed read is not scoped to the doctor",
			rev2.PendingKobo, rev.PendingKobo)
	}

	// A contract, not a money guard: consultRevenue reads settlements and writes
	// only the three kobo columns of DashboardRevenue — ConsultsThisMonth is the
	// service's, filled from dashboardAggregates by GetDashboard, because counting
	// consults belongs to the count read and not to a money projection. It is
	// asserted so that a future merge of the two reads into one query shows up
	// here rather than as a tile nobody questions.
	if rev.ConsultsThisMonth != 0 {
		t.Errorf("ConsultsThisMonth = %d, want 0 — the service fills it from the aggregates", rev.ConsultsThisMonth)
	}
}

// A value Postgres will not accept as a zone name must degrade to the default, not
// 500 the dashboard. This is reachable through the live API: PUT /schedule/timezone
// stores its body verbatim (service_ops.go:365 validates nothing but the empty
// string), and every date expression in this plan hands that column to
// `AT TIME ZONE`. 'Mars/Olympus_Mons' is the name Postgres itself rejects with
// SQLSTATE 22023, so the assertion below is the same server decision the read
// makes — which is why usableTimezone probes the expression instead of consulting
// pg_timezone_names (where valid fixed offsets like "-05" are simply absent).
func TestLiveDB_DashboardTimezonePoisonedZoneDegrades(t *testing.T) {
	pool := metricsDB(t)
	f := newMetricsFixture(t, pool)
	ctx := context.Background()

	// One consult on today's local date, so the aggregate read has something to
	// count once the zone resolves. There is no error to check at this call site:
	// bookLocal returns (id, ref) and t.Fatalf's on a failed insert itself.
	f.bookLocal(t, defaultDoctorTimezone, "completed", 0, 10*60)
	res, err := pool.Exec(ctx,
		`UPDATE doctor_profiles SET timezone = 'Mars/Olympus_Mons' WHERE user_id = $1`, f.doctorUser)
	if err != nil {
		t.Fatalf("poison timezone: %v", err)
	}
	if res.RowsAffected() != 1 {
		t.Fatalf("poison timezone matched %d rows, want 1 — the fixture created no profile row", res.RowsAffected())
	}

	tz, err := metricsService(pool).dashboardTimezone(ctx, f.doctorUser)
	if err != nil {
		t.Fatalf("dashboardTimezone with a poisoned zone: %v — a bad zone must degrade, not fail the read", err)
	}
	if tz != defaultDoctorTimezone {
		t.Errorf("dashboardTimezone = %q, want %q", tz, defaultDoctorTimezone)
	}

	// The point of the fallback: the aggregate that uses it still answers, instead
	// of raising 22023 through every date predicate in the query.
	agg, err := NewRepository(pool).dashboardAggregates(ctx, f.doctorUser, tz)
	if err != nil {
		t.Fatalf("dashboardAggregates with a poisoned zone: %v", err)
	}
	if agg.TodaysCount != 1 {
		t.Errorf("TodaysCount = %d, want 1", agg.TodaysCount)
	}

	// A zone Postgres accepts but pg_timezone_names does not list must survive —
	// otherwise the guard silently overwrites a doctor's real fixed-offset setting.
	if _, err := pool.Exec(ctx,
		`UPDATE doctor_profiles SET timezone = '-05' WHERE user_id = $1`, f.doctorUser); err != nil {
		t.Fatalf("set fixed offset: %v", err)
	}
	tzOffset, err := metricsService(pool).dashboardTimezone(ctx, f.doctorUser)
	if err != nil {
		t.Fatalf("dashboardTimezone for a fixed offset: %v", err)
	}
	if tzOffset != "-05" {
		t.Errorf("dashboardTimezone = %q, want the doctor's own '-05' — a catalog lookup would have downgraded this", tzOffset)
	}

	// The likeliest accidental value is not a bogus zone but a real one with the
	// whitespace a paste or a picker leaves behind, and this server rejects the
	// padded name exactly as hard as 'Mars/Olympus_Mons' (verified live: `AT TIME
	// ZONE 'Africa/Lagos '` raises 22023). usableTimezone trims before probing and
	// returns the trimmed value, so the doctor keeps Asia/Karachi instead of
	// silently degrading to Lagos — and the value the reads interpolate is one
	// Postgres accepts.
	if _, err := pool.Exec(ctx,
		`UPDATE doctor_profiles SET timezone = 'Asia/Karachi ' WHERE user_id = $1`, f.doctorUser); err != nil {
		t.Fatalf("set padded zone: %v", err)
	}
	tzPadded, err := metricsService(pool).dashboardTimezone(ctx, f.doctorUser)
	if err != nil {
		t.Fatalf("dashboardTimezone for a padded zone: %v", err)
	}
	if tzPadded != "Asia/Karachi" {
		t.Errorf("dashboardTimezone = %q, want %q — a trailing space must not cost the doctor their zone",
			tzPadded, "Asia/Karachi")
	}
}

// The other half of the 22023 branch: an unrecognised zone degrades, everything
// else propagates. Written `if err != nil { return defaultDoctorTimezone, nil }`
// instead, this suite is entirely green — no fixture row and no stored value ever
// produces a non-22023 probe error — while a dead pool, a cancelled request
// context or a lost connection would silently project every doctor's tiles on
// Africa/Lagos, which spec D3a forbids ("a dead pool must not look like an unset
// timezone"). That promise is the comment at dashboard_metrics.go's probe; this is
// the assertion. A cancelled context is the cheapest real non-22023 error, and it
// needs no rows and no writes.
func TestLiveDB_DashboardTimezoneProbeErrorPropagates(t *testing.T) {
	repo := NewRepository(metricsDB(t))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	tz, err := repo.usableTimezone(ctx, "Asia/Karachi")
	if err == nil {
		t.Fatalf("usableTimezone swallowed a non-22023 error: tz=%q", tz)
	}
	if tz != "" {
		t.Errorf("usableTimezone returned %q alongside an error, want the empty string", tz)
	}
}
