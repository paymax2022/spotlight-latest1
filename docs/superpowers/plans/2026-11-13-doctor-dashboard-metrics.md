# Doctor Dashboard Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the five signed-in doctor dashboard tiles — today's consults, upcoming consults, available revenue, satisfaction %, today's queue — report the doctor's real bookings, money and reviews instead of hard-coded zeros.

**Architecture:** The two count tiles and the queue stop reading `doctor_appointments` (a table no booking path ever inserts into) and read `public.appointments` joined through `doctors.user_id` — the plane the patient app actually writes. Money stays a projection: `Available` keeps coming from the ledger wallet, and a new consult-revenue bucket is projected over `settlements`, deriving the escrowed leg with `settlement.ComputeLegs` rather than re-inventing the split. Satisfaction comes from the existing `GetReputation` read, with `null` meaning "no reviews yet". The React Native adapter, not the wire, derives presentation tokens (initials, avatar colour).

**Tech Stack:** Go 1.27.4, `pgx/v5` + `pgxpool`, gin; Postgres (Supabase) with SQL-side `AT TIME ZONE`; OpenAPI 3.0.3 contracts linted by Redocly; Expo Router + React Native + TanStack Query; `node --experimental-strip-types --test` for the client mapping.

**Spec:** [docs/superpowers/specs/2026-11-13-doctor-dashboard-metrics-design.md](../specs/2026-11-13-doctor-dashboard-metrics-design.md) — read it before starting. Decisions D1–D9 and the interface block are authoritative; this plan implements them, it does not re-decide them.

## Where the work happens

Everything is in the isolated worktree **`/private/tmp/spot-doctor-metrics`** on branch `feat/doctor-dashboard-metrics` (created from `origin/main` = `effe1b355`). Use absolute paths — the shell's cwd resets between commands.

This repo is driven by several sessions at once. `/Users/paymax/Documents/spotlight/main` is a **different, dirty working tree** holding other sessions' in-flight work: never `cd` there to edit, never `git stash`, never move `main`'s ref, and never read its dirty files as evidence of what `origin/main` contains. The neighbour's untracked files (`appointments_plane_live_db_test.go`, `handler_avatar_test.go`, `mdcn_discoverability_live_db_test.go`) are why this plan's helper names are all `metrics*`-prefixed and why the client module is `dashboardWire.ts`, not `mapping.ts`.

The worktree has **no `node_modules`** under `mobile-app/reactnative` (untracked, so not copied). Task 5 symlinks the main checkout's install for typechecking only.

## Global Constraints

- Go 1.27.4 (`backend/go.mod`), module path `spotlight/backend`. No new third-party dependency anywhere in this plan.
- Money is `int64` kobo across the wire. Never a float, never naira.
- `satisfactionPct` is nullable end-to-end (spec D6): `*float64` in Go, `number | null` in TS, `—` in the tile. `null` means "no reviews", `0` means "reviewed and hated".
- Date logic lives in SQL as `AT TIME ZONE $tz::text` (spec D3). No `time/tzdata` import, no `time.LoadLocation` anywhere — the container has no zone database and Go-side tz would be a silent 500.
- The doctor module reads money; it never posts to the ledger and never moves money. `settlement.ComputeLegs` is used as a pure function only.
- Scope fence (spec D1): do not touch `ListAppointments`, `GET /appointments`, appointment-requests, accept/reject, or `doctor.Appointment.SlotDate`'s type. The in-flight neighbour branch owns those.
- Copy rules for the wire (spec D8): `slotDate` is `YYYY-MM-DD`, `slotTime` is `"HH:MM AM/PM"`, `status` uses the UI vocabulary (`booked` → `upcoming`), `consultType` passes through verbatim including `in_person`.
- Tests that need Postgres gate on `TEST_DATABASE_URL` and skip without it. Local DSN is documented at [docs/maps/CI-ON-COWORK.md:16](../../maps/CI-ON-COWORK.md#L16); never paste a DSN or token into a commit, a PR body, or the conversation.
- Stage and commit in one command, by explicit path, one commit per logical change. Never `git add -A`. Never stage `next-env.d.ts` or the `node_modules` symlink.
- Every commit message here is multi-line, so pass it through a quoted heredoc (`git commit -m "$(cat <<'MSG' … MSG")`), never a bare double-quoted `-m`: zsh runs command substitutions inside double quotes, so one stray backtick executes instead of quoting and silently deletes the phrase from history.
- Publish means: push `feat/doctor-dashboard-metrics` with `git -c credential.helper='!gh auth git-credential' push -u origin feat/doctor-dashboard-metrics`, then open a PR. Never push `main`.

---

### Task 1: The booking-plane reads — today's counts and today's queue

The root cause of tiles 1, 2 and 5 is one query (`appointmentStatusCounts`, [backend/internal/doctor/repository_tail2.go:203](../../backend/internal/doctor/repository_tail2.go#L203)) reading `doctor_appointments`, which nothing inserts into. This task adds the reads against the real plane. It produces the Go types every later task consumes.

**Files:**
- Create: `backend/internal/doctor/dashboard_metrics.go`
- Create: `backend/internal/doctor/dashboard_metrics_live_db_test.go`
- Test: same file (`TestLiveDB_` prefix, `TEST_DATABASE_URL`-gated)

**Interfaces:**
- Consumes: `Repository.db *pgxpool.Pool` (existing); `Repository.GetProfile(ctx, userID) (*Profile, error)` returning `ErrNotFound` when the doctor has no `doctor_profiles` row (existing, [backend/internal/doctor/repository.go:32](../../backend/internal/doctor/repository.go#L32)). The profile row is also where the doctor's IANA timezone lives — `PUT /schedule/timezone` writes it (`repository_ops.go:409`), so it is the only timezone column any screen sets.
- Produces:
  - `type DashboardRevenue struct { PendingKobo, LifetimeKobo, ThisMonthKobo int64; ConsultsThisMonth int64 }`
  - `type DashboardMetrics struct { TodaysCount, UpcomingCount int64; SatisfactionPct *float64; RatingCount int64; Revenue DashboardRevenue; Timezone, Today string }` (exact fields below)
  - `type DashboardQueuePatient struct { ID, Name string; Age int; Gender string }`
  - `type DashboardQueueAppointment struct { ID, Ref string; Patient DashboardQueuePatient; ConsultType, Status, SlotDate, SlotTime string; FeeKobo int64; Reason string; IsHMO bool; CreatedAt string }`
  - `type dashboardCounters struct { TodaysCount, UpcomingCount, ConsultsThisMonth int64; Today string }`
  - `(s *Service) dashboardTimezone(ctx, userID) (string, error)`
  - `(r *Repository) dashboardAggregates(ctx, userID, tz string) (dashboardCounters, error)`
  - `(r *Repository) todayQueue(ctx, userID, tz, day string) ([]DashboardQueueAppointment, error)`
  - consts `defaultDoctorTimezone`, `dashboardQueueLimit`

- [ ] **Step 1: Write the failing live-DB test**

Create `backend/internal/doctor/dashboard_metrics_live_db_test.go`:

```go
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
```

- [ ] **Step 2: Run it and watch it fail to compile**

```bash
cd /private/tmp/spot-doctor-metrics/backend && go test ./internal/doctor/ -run TestLiveDB_Dashboard -count=1 2>&1 | tail -20
```

Expected: compile failures for `dashboardTimezone`, `dashboardAggregates` and `todayQueue` — the reads do not exist yet, so a compile error is the correct red. `metricsService`, `newMetricsFixture` and `bookLocal` are defined in this same file and must NOT appear in the error list; if they do, the helper block was pasted incompletely.

- [ ] **Step 3: Write the types, the timezone read and the two appointment reads**

Create `backend/internal/doctor/dashboard_metrics.go`:

```go
package doctor

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// dashboard_metrics.go — the reads behind the doctor landing tiles.
//
// The tiles used to project their appointment counts from doctor_appointments, a
// table the doctor module owns and reads but which NO booking path inserts into:
// patients book into public.appointments (internal/telemedicine BookAppointment).
// So every doctor, however busy, was told "0 today" and shown an empty queue, from
// a query that returned a perfectly healthy empty result set. The reads here go to
// the booking plane, scoped through doctors.user_id the way the patient-facing
// telemedicine reads already are.
//
// Money rule, unchanged from service_tail2.go: the wallet balance stays a ledger
// projection (Service.ledger.GetBalance). What is added is the CONSULT-revenue
// bucket — a projection over settlements — and its escrowed half is derived with
// settlement.ComputeLegs, the ONE definition of the split arithmetic. Re-deriving
// 85% in SQL, or multiplying settlement.fee_kobo by 0.85 in the client, is the
// float-math bug the settlement package warns about in its own comments.

// defaultDoctorTimezone mirrors the NOT NULL DEFAULT of both timezone columns —
// doctor_profiles.timezone (20260625000000_doctor_module.sql:60), which the read uses, and
// doctor_availability.timezone (same file, :165). It is the same literal the write path
// applies at repository.go:149 with strOrDefault(in.Timezone, "Africa/Lagos").
const defaultDoctorTimezone = "Africa/Lagos"

// dashboardQueueLimit caps the rows the dashboard renders. The count tile is
// deliberately uncapped (spec D2a): a 21-row day reports 21 and lists 20, rather
// than quietly telling the doctor the day held 20 consults.
const dashboardQueueLimit = 20

// DashboardRevenue is the consult-revenue projection behind the earnings tiles.
// Available money is NOT here — that is the wallet, which the ledger projects, and
// which includes non-consult money (spec D7).
type DashboardRevenue struct {
	PendingKobo       int64 `json:"pendingKobo"`
	LifetimeKobo      int64 `json:"lifetimeKobo"`
	ThisMonthKobo     int64 `json:"thisMonthKobo"`
	ConsultsThisMonth int64 `json:"consultsThisMonth"`
}

// DashboardMetrics is the five tiles' payload on GET /dashboard.
type DashboardMetrics struct {
	TodaysCount     int64            `json:"todaysCount"`
	UpcomingCount   int64            `json:"upcomingCount"`
	SatisfactionPct *float64         `json:"satisfactionPct"`
	RatingCount     int64            `json:"ratingCount"`
	Revenue         DashboardRevenue `json:"revenue"`
	Timezone        string           `json:"timezone"`
	Today           string           `json:"today"`
}

type DashboardQueuePatient struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Age    int    `json:"age"`
	Gender string `json:"gender"`
}

// DashboardQueueAppointment is one row of "Today's queue". It is its own type
// rather than a reuse of Appointment because Appointment.SlotDate is a *time.Time
// (model.go:100-ish) and the client contract wants a date plus a wall-clock time
// string; changing Appointment is the neighbour's in-flight territory (spec D1/D8).
type DashboardQueueAppointment struct {
	ID          string                  `json:"id"`
	Ref         string                  `json:"ref"`
	Patient     DashboardQueuePatient   `json:"patient"`
	ConsultType string                  `json:"consultType"`
	Status      string                  `json:"status"`
	SlotDate    string                  `json:"slotDate"`
	SlotTime    string                  `json:"slotTime"`
	FeeKobo     int64                   `json:"feeKobo"`
	Reason      string                  `json:"reason"`
	IsHMO       bool                    `json:"isHmo"`
	CreatedAt   string                  `json:"createdAt"`
}

// dashboardCounters is the aggregates row: three counts plus the doctor's local
// day, which todayQueue then takes as its date parameter so the tile and the list
// cannot disagree across a midnight boundary (spec D2).
type dashboardCounters struct {
	TodaysCount       int64
	UpcomingCount     int64
	ConsultsThisMonth int64
	Today             string
}

// dashboardTimezone resolves the zone every date expression uses, once, so all
// three reads price the same day. The source is doctor_profiles.timezone — the
// column `PUT /schedule/timezone` writes (service_ops.go:360 →
// repository_ops.go:409) and GET /doctor/profile reads back through this very
// GetProfile — NOT doctor_availability.timezone, which no screen ever sets (a
// doctor who chose Asia/Karachi would otherwise have every "today" predicate
// anchored to Lagos). `GET /schedule` is not a read-back of this column: its
// ScheduleSettings carries no timezone at the top level
// (handler_tail2.go:493-498), and the only zone that response could ever reach
// transitively is `doctor_availability.timezone`, a different column — see spec
// F5 for what that costs the screen that offers the picker. A doctor with no
// profile row at all is the default, not an error.
func (s *Service) dashboardTimezone(ctx context.Context, userID string) (string, error) {
	p, err := s.repo.GetProfile(ctx, userID)
	if errors.Is(err, ErrNotFound) {
		return defaultDoctorTimezone, nil
	}
	if err != nil {
		return "", fmt.Errorf("doctor: read profile timezone: %w", err)
	}
	if p.Timezone == "" {
		return defaultDoctorTimezone, nil
	}
	return p.Timezone, nil
}

// dashboardAggregates counts today's and upcoming consults and this month's
// completed consults, all on the doctor's local calendar. Pure read.
//
// `today` is a scalar subselect rather than a bare expression because the other
// three columns are aggregates: a non-aggregated to_char(...) next to COUNT(*) is
// not valid SQL, and the subselect keeps the whole row in one pass.
func (r *Repository) dashboardAggregates(ctx context.Context, userID, tz string) (dashboardCounters, error) {
	const q = `
		WITH scoped AS (
			SELECT a.status, a.scheduled_at,
			       (a.scheduled_at AT TIME ZONE $2::text)::date                 AS local_day,
			       to_char(a.scheduled_at AT TIME ZONE $2::text, 'YYYY-MM')     AS local_month
			FROM appointments a
			JOIN doctors d ON d.id = a.doctor_id
			WHERE d.user_id = $1
		)
		SELECT COUNT(*) FILTER (WHERE local_day = (CURRENT_TIMESTAMP AT TIME ZONE $2::text)::date
		                             AND status <> 'cancelled')::bigint,
		       COUNT(*) FILTER (WHERE scheduled_at > CURRENT_TIMESTAMP
		                             AND status IN ('booked','confirmed'))::bigint,
		       COUNT(*) FILTER (WHERE status = 'completed'
		                             AND local_month = to_char(CURRENT_TIMESTAMP AT TIME ZONE $2::text, 'YYYY-MM'))::bigint,
		       (SELECT to_char(CURRENT_TIMESTAMP AT TIME ZONE $2::text, 'YYYY-MM-DD'))
		FROM scoped`
	var out dashboardCounters
	if err := r.db.QueryRow(ctx, q, userID, tz).Scan(
		&out.TodaysCount, &out.UpcomingCount, &out.ConsultsThisMonth, &out.Today,
	); err != nil {
		return dashboardCounters{}, err
	}
	return out, nil
}

// todayQueue lists the doctor's consults for one local day, ascending, capped at
// dashboardQueueLimit. The status is renamed into the vocabulary the client's
// ConsultStatus type already speaks ('booked' → 'upcoming'), and consultType is
// passed through verbatim — a booking that says in_person must not be displayed as
// a chat (spec D8; the client draws a fallback icon, and F4 tracks widening the
// union properly).
func (r *Repository) todayQueue(ctx context.Context, userID, tz, day string) ([]DashboardQueueAppointment, error) {
	const q = `
		SELECT a.id::text,
		       COALESCE(a.ref, 'TM-' || upper(substr(replace(a.id::text, '-', ''), 1, 6))),
		       a.patient_id::text,
		       COALESCE(NULLIF(pu.full_name, ''), 'Patient'),
		       COALESCE(pu.age, 0),
		       CASE WHEN lower(COALESCE(pu.gender, '')) IN ('male','female')
		            THEN lower(pu.gender) ELSE 'other' END,
		       a.consultation_type,
		       CASE a.status WHEN 'booked' THEN 'upcoming' ELSE a.status END,
		       to_char(a.scheduled_at AT TIME ZONE $2::text, 'YYYY-MM-DD'),
		       to_char(a.scheduled_at AT TIME ZONE $2::text, 'HH12:MI AM'),
		       a.fee_kobo,
		       COALESCE(a.notes, ''),
		       a.created_at
		FROM appointments a
		JOIN doctors d ON d.id = a.doctor_id
		LEFT JOIN user_profiles pu ON pu.id = a.patient_id
		WHERE d.user_id = $1
		  AND a.status <> 'cancelled'
		  AND (a.scheduled_at AT TIME ZONE $2::text)::date = $3::date
		ORDER BY a.scheduled_at ASC
		LIMIT $4`
	rows, err := r.db.Query(ctx, q, userID, tz, day, dashboardQueueLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	// Non-nil even when empty: the client renders `[]`, never `undefined`.
	out := []DashboardQueueAppointment{}
	for rows.Next() {
		var a DashboardQueueAppointment
		var createdAt time.Time
		if err := rows.Scan(&a.ID, &a.Ref, &a.Patient.ID, &a.Patient.Name, &a.Patient.Age,
			&a.Patient.Gender, &a.ConsultType, &a.Status, &a.SlotDate, &a.SlotTime,
			&a.FeeKobo, &a.Reason, &createdAt); err != nil {
			return nil, err
		}
		// appointments carries no HMO coverage column at all, so the honest answer
		// is false — the badge stays off rather than guessing from the fee.
		a.IsHMO = false
		a.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		out = append(out, a)
	}
	return out, rows.Err()
}
```

That is the whole file for this task. `pendingConsultKobo`, the two split constants and
the `settlement` import all belong to Task 2, which is where they are first referenced —
adding them here would leave `dashboard_metrics.go` failing `go build` on unused imports
and undefined constants.

- [ ] **Step 4: Run the test again**

```bash
cd /private/tmp/spot-doctor-metrics/backend && go build ./... && go test ./internal/doctor/ -run TestLiveDB_Dashboard -count=1 -v 2>&1 | tail -25
```

Expected without a DB: `--- SKIP: TestLiveDB_DashboardCountsAndQueueUseTheDoctorsLocalDay` and `ok`. That is not a pass — do not stop here. Run it for real against the local dev database, taking the DSN from the value documented in `docs/maps/CI-ON-COWORK.md` (never echo it):

```bash
cd /private/tmp/spot-doctor-metrics/backend
set -a; . /dev/null; set +a
TEST_DATABASE_URL="$(awk '/TEST_DATABASE_URL=/{sub(/^.*TEST_DATABASE_URL=/,"");print;exit}' ../../Documents/spotlight/main/backend/.env 2>/dev/null)"
go test ./internal/doctor/ -run TestLiveDB_Dashboard -count=1 -v 2>&1 | tail -25
```

If no `TEST_DATABASE_URL` line exists in that file, ask the user for the local dev DSN rather than guessing one. Expected: `--- PASS`. If the container is unreachable (nothing listening on 54322), say so in the commit message body and continue — Tasks 2 and 3 add assertions that only a live run can settle, and the queue-order and local-day assertions are the ones most worth having proven before this ships.

- [ ] **Step 5: Vet, then commit**

```bash
cd /private/tmp/spot-doctor-metrics/backend && go vet ./internal/doctor/... && gofmt -l internal/doctor/
cd /private/tmp/spot-doctor-metrics && git add backend/internal/doctor/dashboard_metrics.go backend/internal/doctor/dashboard_metrics_live_db_test.go && git commit -m "feat(doctor): read the dashboard's counts and queue from the booking plane

doctor_appointments, which appointmentStatusCounts aggregates, has no insert
path — patients book into public.appointments. Every doctor's tiles therefore
answered 0 and the queue stayed empty no matter how busy they were."
```

`gofmt -l` must print nothing (it lists files needing formatting).

- [ ] **Step 6: Add the three assertions that pin shape and scoping, not just the numbers**

Append to `dashboard_metrics_live_db_test.go`:

```go
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
```

`8*60+i` for `dashboardQueueLimit+1` iterations spans 08:00–08:20, all inside one local day and strictly ascending, so the queue cap is what separates 21 from 20 — not the clock and not the ordering.

- [ ] **Step 7: Run the whole new file, then commit**

```bash
cd /private/tmp/spot-doctor-metrics/backend && go test ./internal/doctor/ -run TestLiveDB_Dashboard -count=1 -v 2>&1 | tail -30
cd /private/tmp/spot-doctor-metrics && git add backend/internal/doctor/dashboard_metrics_live_db_test.go && git commit -m "test(doctor): pin the queue row's wire shape and the count-vs-list cap"
```

Expected: six `--- PASS` lines — every `TestLiveDB_Dashboard*` defined so far (local-day, timezone fallback, upcoming, queue wire shape, count-vs-cap, scoping). (Or all `SKIP` with no DB, which must be recorded, not reported as green.)

---

### Task 2: Consult revenue — settled sums and escrowed legs

Tile 3 today reports the wallet balance for `availableKobo`, `lifetimeKobo` **and** `pendingKobo: 0`, so consult money is invisible. This task projects it.

**Files:**
- Modify: `backend/internal/doctor/dashboard_metrics.go` (append `consultRevenue` + the split consts)
- Modify: `backend/internal/doctor/dashboard_metrics_live_db_test.go` (append the revenue test)
- Create: `backend/internal/doctor/dashboard_metrics_test.go` (no-DB split algebra)

**Interfaces:**
- Consumes: `settlement.ComputeLegs(totalKobo int64, s settlement.Split) (settlement.SplitLegs, error)` ([backend/internal/finance/settlement/service.go:745](../../backend/internal/finance/settlement/service.go#L745)); `settlements`, `appointments`, `doctors` tables; the appointment `id` returned by `bookLocal`.
- Produces:
  - `(r *Repository) consultRevenue(ctx context.Context, userID, tz string) (DashboardRevenue, error)` — fills `PendingKobo`, `LifetimeKobo`, `ThisMonthKobo` and leaves `ConsultsThisMonth` zero (the service sets it from `dashboardAggregates`, so the number comes from one place).
  - consts `consultProviderPct = 0.85`, `consultPlatformPct = 0.15`
  - `pendingConsultKobo(totalKobo, platformFeeKobo int64) (int64, error)`

- [ ] **Step 1: Write the failing no-DB test for the split**

Create `backend/internal/doctor/dashboard_metrics_test.go`:

```go
package doctor

import (
	"math"
	"testing"

	"spotlight/backend/internal/finance/settlement"
)

// dashboard_metrics_test.go — the two pieces of dashboard arithmetic that need no
// database: what a doctor's share of an escrowed consult is, and how a rating
// becomes a satisfaction percentage.

func TestConsultSplitMirrorsTelemedicine(t *testing.T) {
	// The split telemedicine.CompleteAppointment pays (service.go:700-704) is the
	// money the doctor actually gets. If either side drifts, this fails.
	if consultProviderPct+consultPlatformPct != 1.0 {
		t.Fatalf("consult split %.2f + %.2f != 1.0", consultProviderPct, consultPlatformPct)
	}
	cases := []struct {
		name          string
		total, fee    int64
		wantProvider  int64
	}{
		// 200000 escrowed, no booking fee → 85% of it all.
		{"no booking fee", 200000, 0, 170000},
		// ADR-044: the 2000 platform booking fee is 100% platform and rides ON TOP,
		// so the doctor keeps 85% of the 198000 consult, not of the total.
		{"with booking fee", 200000, 2000, 168300},
		// Pre-ADR-044 rows escrowed the consult alone.
		{"legacy row", 750000, 0, 637500},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := pendingConsultKobo(c.total, c.fee)
			if err != nil {
				t.Fatalf("pendingConsultKobo: %v", err)
			}
			if got != c.wantProvider {
				t.Errorf("provider kobo = %d, want %d", got, c.wantProvider)
			}
			// Same answer from the shared definition, not a copy of it.
			legs, err := settlement.ComputeLegs(c.total, settlement.Split{
				ProviderPct: consultProviderPct, PlatformPct: consultPlatformPct, ServiceFeeKobo: c.fee,
			})
			if err != nil {
				t.Fatalf("ComputeLegs: %v", err)
			}
			if legs.ProviderKobo != got {
				t.Errorf("pendingConsultKobo %d disagrees with ComputeLegs %d", got, legs.ProviderKobo)
			}
		})
	}
}

func TestDashboardSatisfactionPct(t *testing.T) {
	cases := []struct {
		name string
		in   ReputationSummary
		want *float64
	}{
		// No reviews is NOT zero percent. The tile shows '—'; a 0 here would tell a
		// doctor their brand-new practice scores nothing.
		{"no reviews is nil", ReputationSummary{AverageRating: 0, ReviewCount: 0}, nil},
		{"4.8 of 5 is 96", ReputationSummary{AverageRating: 4.8, ReviewCount: 24}, ptr.Of(96.0)},
		{"4,5,5 rounds to 93", ReputationSummary{AverageRating: 4.6666666666666665, ReviewCount: 3}, ptr.Of(93.0)},
		{"perfect", ReputationSummary{AverageRating: 5, ReviewCount: 1}, ptr.Of(100.0)},
		{"one star is not nil", ReputationSummary{AverageRating: 1, ReviewCount: 2}, ptr.Of(20.0)},
		// The other half of the nil-vs-zero rule: reviews exist and every one is
		// zero stars. GetReputation's COALESCE(AVG,0) returns 0 for THIS too, so
		// only ReviewCount separates a hated practice from an unreviewed one — and
		// 0 must survive as 0, not collapse into the nil above it.
		{"zero stars with reviews is 0, not nil", ReputationSummary{AverageRating: 0, ReviewCount: 7}, ptr.Of(0.0)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := dashboardSatisfactionPct(c.in)
			if c.want == nil {
				if got != nil {
					t.Fatalf("got %v, want nil", *got)
				}
				return
			}
			if got == nil {
				t.Fatalf("got nil, want %v", *c.want)
			}
			if math.Abs(*got-*c.want) > 1e-9 {
				t.Errorf("got %v, want %v", *got, *c.want)
			}
		})
	}
}

// No local ptr helper: package doctor already imports
// spotlight/backend/go-common/ptr (repository.go:14 and six more), so declaring
// `func ptr` in this package is a redeclaration error. Import it and use ptr.Of.
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /private/tmp/spot-doctor-metrics/backend && go test ./internal/doctor/ -run 'TestConsultSplit|TestDashboardSatisfaction' -count=1 2>&1 | tail -15
```

Expected: compile failure — `undefined: consultProviderPct`, `undefined: pendingConsultKobo`, `undefined: dashboardSatisfactionPct`.

- [ ] **Step 3: Implement the split, satisfaction and the revenue read**

Three things happen in this step, in this order.

**1. Align the two stale timezone comments.** They are stale in the committed file only because the
fix dispatch said "the rest of the file stays as committed", so this lifts that constraint rather
than waiving the finding. Replace the `defaultDoctorTimezone` comment (`dashboard_metrics.go:27-29`)
with the plan's Task 1 text — it cites `doctor_profiles.timezone` at
`20260625000000_doctor_module.sql:60` as the column the read uses and `:165` for the availability one
(the file currently says `:164`, which is `emergency_enabled`), and it must not call
`repository.go:149` "the write path" for a doctor's choice. Then align `dashboardTimezone`'s comment
with the Task 1 block above, which now names `GET /doctor/profile` as the read-back, says plainly
that `GET /schedule` is not a read-back *of this column*, and qualifies that with "at the top level"
because the availability row that response may one day embed carries the other zone column. Neither
edit may change a line of executable code.

**2. Harden the zone this file resolves.** A read that interpolates a client-supplied string into
`AT TIME ZONE` fails the whole dashboard when that string is not a zone Postgres knows — see
`usableTimezone` below for why this is this PR's exposure and not a pre-existing one. In
`dashboard_metrics.go`, replace the last line of `dashboardTimezone` — currently

```go
	return p.Timezone, nil
```

with

```go
	return s.repo.usableTimezone(ctx, p.Timezone)
```

and add this function immediately after it, unchanged:

```go
// usableTimezone answers tz only if Postgres will accept it as a zone name, and
// the default otherwise. `AT TIME ZONE` raises SQLSTATE 22023 ("time zone … not
// recognized") for a name the server does not know, and every date expression in
// this file interpolates that parameter — so without this check one bad value in
// doctor_profiles.timezone turns the whole dashboard into a 500. The write path
// offers no protection: Service.SetTimezone (service_ops.go:365) stores whatever
// the client sends, with only an empty-string default. Before this PR the column
// was only ever selected or written, never handed to a date expression, so a bad
// value was inert; interpolating it into `AT TIME ZONE` is what makes it fatal.
//
// The probe has to be Postgres's own test rather than a catalog lookup, because
// `pg_timezone_names` is not what `AT TIME ZONE` accepts: the fixed offsets
// "-05" and "+05:30" are absent from that view yet valid as zones, so an EXISTS
// check would silently downgrade a doctor's real setting to Lagos.
func (r *Repository) usableTimezone(ctx context.Context, tz string) (string, error) {
	const probe = `SELECT to_char(CURRENT_TIMESTAMP AT TIME ZONE $1::text, 'YYYY-MM-DD')`
	var day string
	if err := r.db.QueryRow(ctx, probe, tz).Scan(&day); err != nil {
		// 22023 = invalid_parameter_value, which is what an unrecognised zone
		// raises. Anything else — a dead pool, a lost connection — is a real
		// failure and must surface rather than hide behind the default.
		if dbutil.SQLState(err) == "22023" {
			return defaultDoctorTimezone, nil
		}
		return "", fmt.Errorf("doctor: probe timezone %q: %w", tz, err)
	}
	return tz, nil
}
```

`dbutil.SQLState` is the repo's existing SQLSTATE extractor
(`go-common/dbutil/dbutil.go:26`, which unwraps the pgx error chain), so add
`"spotlight/backend/go-common/dbutil"` to this file's imports — it is first-party
code in this module, not a new dependency, and `internal/doctor` does not import it
yet. Do not import `pgconn` directly; the point of the helper is that callers do not.

**3. Append the revenue projection.** To `backend/internal/doctor/dashboard_metrics.go`:

```go
// consultProviderPct / consultPlatformPct mirror the split
// telemedicine.CompleteAppointment pays (internal/telemedicine/service.go:700-704)
// plus the ADR-044 booking fee. They are module-local, like crowdfunding's
// CreatorPayoutPct (internal/crowdfunding/service.go:232), because the doctor
// module only READS consult money — telemedicine still owns paying it.
// TestConsultSplitMirrorsTelemedicine is what keeps the two copies honest, and
// TestLiveDB_ConsultRevenueMatchesWhatSettleWillPay re-checks it against a row
// settled by the real money path.
const (
	consultProviderPct = 0.85
	consultPlatformPct = 0.15
)

// pendingConsultKobo is the escrowed leg of the consult split. It lives here rather
// than inline in consultRevenue because the live-DB test asserts against it
// directly — the test then proves the projection matches what settlement.ComputeLegs
// pays, instead of trusting a hand-computed literal.
func pendingConsultKobo(totalKobo, platformFeeKobo int64) (int64, error) {
	legs, err := settlement.ComputeLegs(totalKobo, settlement.Split{
		ProviderPct:    consultProviderPct,
		PlatformPct:    consultPlatformPct,
		ServiceFeeKobo: platformFeeKobo,
	})
	if err != nil {
		return 0, fmt.Errorf("doctor: project pending consult revenue: %w", err)
	}
	return legs.ProviderKobo, nil
}

// dashboardSatisfactionPct turns an average rating into the 0-100 the tile shows.
// ReviewCount 0 answers nil on purpose: GetReputation's COALESCE(AVG,0) cannot tell
// "nobody has reviewed you" apart from "everyone gave you zero", and the dashboard
// must not pretend to know.
func dashboardSatisfactionPct(rep ReputationSummary) *float64 {
	if rep.ReviewCount == 0 {
		return nil
	}
	pct := math.Round(rep.AverageRating / 5 * 100)
	return &pct
}

// consultRevenue projects the doctor's consult money out of settlements. Nothing is
// stored here — see the money rule at the top of this file.
//
// Settled rows already carry what the doctor was paid (Settle writes
// settlements.provider_kobo in the same tx that moves the money), so they sum
// directly. Escrowed rows carry 0 there, because nothing has moved yet: their
// projection runs the stored total through settlement.ComputeLegs, which is the
// expression Settle itself pays by — so the pending figure is the exact money the
// doctor will receive, not an estimate of it.
func (r *Repository) consultRevenue(ctx context.Context, userID, tz string) (DashboardRevenue, error) {
	const settledQ = `
		SELECT COALESCE(SUM(st.provider_kobo), 0)::bigint,
		       COALESCE(SUM(st.provider_kobo) FILTER (
		           WHERE st.settled_at IS NOT NULL
		                     AND to_char(st.settled_at AT TIME ZONE $2::text, 'YYYY-MM')
		                         = to_char(CURRENT_TIMESTAMP AT TIME ZONE $2::text, 'YYYY-MM')), 0)::bigint
		FROM settlements st
		JOIN appointments a ON a.settlement_id = st.id
		JOIN doctors d ON d.id = a.doctor_id
		WHERE d.user_id = $1 AND st.module_type = 'telemedicine' AND st.status = 'settled'`
	var out DashboardRevenue
	if err := r.db.QueryRow(ctx, settledQ, userID, tz).Scan(&out.LifetimeKobo, &out.ThisMonthKobo); err != nil {
		return DashboardRevenue{}, fmt.Errorf("doctor: project settled consult revenue: %w", err)
	}

	const escrowedQ = `
		SELECT st.total_kobo, COALESCE(a.platform_fee_kobo, 0)
		FROM settlements st
		JOIN appointments a ON a.settlement_id = st.id
		JOIN doctors d ON d.id = a.doctor_id
		WHERE d.user_id = $1 AND st.module_type = 'telemedicine' AND st.status = 'escrowed'`
	rows, err := r.db.Query(ctx, escrowedQ, userID)
	if err != nil {
		return DashboardRevenue{}, fmt.Errorf("doctor: read escrowed consult rows: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var total, platformFee int64
		if err := rows.Scan(&total, &platformFee); err != nil {
			return DashboardRevenue{}, err
		}
		kobo, err := pendingConsultKobo(total, platformFee)
		if err != nil {
			return DashboardRevenue{}, err
		}
		out.PendingKobo += kobo
	}
	if err := rows.Err(); err != nil {
		return DashboardRevenue{}, err
	}
	return out, nil
}
```

Three import changes for this file: add `"math"` (for `dashboardSatisfactionPct`), `"spotlight/backend/internal/finance/settlement"` (for `settlement.Split` / `ComputeLegs`) and `"spotlight/backend/go-common/dbutil"` (for `SQLState`, part 2 above). `pgx` itself is not named anywhere in this code — `rows.Next/Scan/Err` are method calls on the value `r.db.Query` returns — so do not add it. The `escrowedQ` query takes one parameter, so pass only `userID` — passing `tz` too would make pgx complain about an unbound parameter.

- [ ] **Step 4: Run the no-DB tests**

```bash
cd /private/tmp/spot-doctor-metrics/backend && go test ./internal/doctor/ -run 'TestConsultSplit|TestDashboardSatisfaction' -count=1 -v 2>&1 | tail -25
```

Expected: PASS for both, including all five satisfaction cases. These run with no database, so they run everywhere, including CI.

- [ ] **Step 5: Write the live-DB revenue test**

Append to `dashboard_metrics_live_db_test.go`:

```go
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
func (f *metricsFixture) escrow(t *testing.T, apptID, status string, totalKobo, providerKobo, platformFeeKobo int64, settled bool, moduleType string) {
	t.Helper()
	ctx := context.Background()
	key := "metrics-" + uuid.NewString()
	// An `any` holding an untyped nil reaches pgx as SQL NULL, which is exactly the
	// shape an unsettled row has. A time.Time when settled — not the string "now()",
	// which CAST would reject as invalid datetime input.
	var settledAt any
	if settled {
		settledAt = time.Now().UTC()
	}
	// moduleType is a parameter, not the literal 'telemedicine', so one call site can
	// prove the read's module filter bites. settlements.module_type is plain text with
	// no CHECK and no FK (verified against the live catalog), so any label inserts.
	if _, err := f.pool.Exec(ctx, `
		INSERT INTO settlements (reference, module_type, payer_id, total_kobo, fee_kobo, provider_kobo,
		                         status, settled_at, idempotency_key)
		VALUES ($1,$8,$2,$3,0,$4,$5,$6,$7)`,
		"metrics-"+f.doctorUser, f.patient, totalKobo, providerKobo, status, settledAt, key, moduleType); err != nil {
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
	f.escrow(t, settledID, "settled", 200000, 170000, 0, true, "telemedicine")
	escrowedID, _ := f.bookLocal(t, tz, "booked", 1, 10*60)
	// provider_kobo here is deliberately NOT the 0 a real escrowed row carries
	// (Settle writes it in the same tx that flips status to 'settled', so no live
	// row is ever both unsettled and paid). It is what makes `st.status =
	// 'settled'` in settledQ load-bearing: leave it 0 and that predicate can be
	// deleted with all three assertions below still green. The escrowed read never
	// looks at provider_kobo — only total_kobo and the fee — so PendingKobo is
	// unaffected by the value chosen here.
	f.escrow(t, escrowedID, "escrowed", 200000, 168300, 2000, false, "telemedicine")
	refundedID, _ := f.bookLocal(t, tz, "cancelled", -5, 10*60)
	f.escrow(t, refundedID, "refunded", 300000, 0, 0, false, "telemedicine")
	// The rows that make BOTH module predicates load-bearing. One label is not
	// enough, because the two reads filter on different statuses: a settled
	// non-telemedicine row can only ever be excluded by settledQ's predicate, and
	// an escrowed one only by escrowedQ's. Each therefore needs its own row, both
	// with money in the column that read sums — otherwise deleting either filter
	// stays green, and a restaurant or mobility payout to the same human starts
	// appearing in their consult earnings. `settlements.module_type` is plain text
	// with no CHECK and no FK (verified against the live catalog), so 'restaurant'
	// inserts; locally only 'telemedicine' exists today, so ambient data could
	// never have proven either filter on its own.
	otherID, _ := f.bookLocal(t, tz, "completed", -2, 10*60)
	f.escrow(t, otherID, "settled", 400000, 320000, 0, true, "restaurant")
	otherEscrowID, _ := f.bookLocal(t, tz, "booked", 3, 10*60)
	f.escrow(t, otherEscrowID, "escrowed", 400000, 0, 0, false, "restaurant")

	rev, err := NewRepository(pool).consultRevenue(ctx, f.doctorUser, tz)
	if err != nil {
		t.Fatalf("consultRevenue: %v", err)
	}
	if rev.LifetimeKobo != 170000 {
		t.Errorf("LifetimeKobo = %d, want 170000 (settled provider_kobo only)", rev.LifetimeKobo)
	}
	// Settle moves the money this month, so the settled row is also this month's.
	if rev.ThisMonthKobo != 170000 {
		t.Errorf("ThisMonthKobo = %d, want 170000", rev.ThisMonthKobo)
	}
	want, err := pendingConsultKobo(200000, 2000)
	if err != nil {
		t.Fatalf("expected pending: %v", err)
	}
	if rev.PendingKobo != want {
		t.Errorf("PendingKobo = %d, want %d (ComputeLegs for the same row)", rev.PendingKobo, want)
	}
	if rev.ConsultsThisMonth != 0 {
		t.Errorf("ConsultsThisMonth = %d, want 0 — the service fills it from the aggregates", rev.ConsultsThisMonth)
	}

	// A second doctor's own settlement must not land in this doctor's figures.
	// `other` is a whole second fixture — its own doctor, its own patient uuid —
	// so this probes the `d.user_id = $1` scoping, not any patient sharing.
	other := newMetricsFixture(t, pool)
	otherAppt, _ := other.bookLocal(t, tz, "completed", -1, 9*60)
	other.escrow(t, otherAppt, "settled", 900000, 765000, 0, true, "telemedicine")
	// Booked, not completed: the escrowed read is the one this row must not reach.
	otherPending, _ := other.bookLocal(t, tz, "booked", 2, 9*60)
	other.escrow(t, otherPending, "escrowed", 500000, 0, 0, false, "telemedicine")
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
	// count once the zone resolves.
	if _, err := f.bookLocal(t, defaultDoctorTimezone, "completed", 0, 10*60); err != nil {
		t.Fatalf("bookLocal: %v", err)
	}
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
}
```

- [ ] **Step 6: Run it**

```bash
cd /private/tmp/spot-doctor-metrics/backend && go test ./internal/doctor/ -run 'TestLiveDB_DashboardConsultRevenue|TestLiveDB_DashboardTimezonePoisonedZoneDegrades' -count=1 -v 2>&1 | tail -24
```

Expected: PASS for both with the DSN set (SKIP and a recorded "not actually run" without it). Before writing the guard, run this same command against the code as committed and record the red: `dashboardTimezone` returns the poisoned string and `dashboardAggregates` fails with `time zone "Mars/Olympus_Mons" not recognized` — that is the failure this test exists to prevent, and a test that was never seen red is not evidence.

- [ ] **Step 7: Commit**

```bash
cd /private/tmp/spot-doctor-metrics/backend && go build ./... && go vet ./internal/doctor/... && gofmt -l internal/doctor/
cd /private/tmp/spot-doctor-metrics && git add backend/internal/doctor/dashboard_metrics.go backend/internal/doctor/dashboard_metrics_test.go backend/internal/doctor/dashboard_metrics_live_db_test.go && git commit -m "feat(doctor): project consult revenue over settlements for the earnings tile

Pending money is derived with settlement.ComputeLegs rather than a re-typed 0.85
so the dashboard figure is the arithmetic Settle itself pays by. Settled money
sums provider_kobo, which Settle writes in the same tx that moves the balance."
```

---

### Task 3: Compose it into `GET /dashboard`

**Files:**
- Modify: `backend/internal/doctor/service_tail2.go:143-165` (`GetDashboard`)
- Modify: `backend/internal/doctor/handler_tail2.go:483-488` (`DashboardSummary`)
- Modify: `backend/internal/doctor/dashboard_metrics_live_db_test.go` (append)

**Interfaces:**
- Consumes: everything from Tasks 1-2; `s.repo.GetReputation` ([backend/internal/doctor/repository_account_tail.go:394](../../backend/internal/doctor/repository_account_tail.go#L394)); `s.ledger.GetBalance`.
- Produces: `GET /doctor/dashboard` now answers
  `{appointmentCounts, unreadNotifications, walletBalanceKobo, currency, metrics:{todaysCount,upcomingCount,satisfactionPct,ratingCount,revenue:{pendingKobo,lifetimeKobo,thisMonthKobo,consultsThisMonth},timezone,today},todaysAppointments:[…]}`.
  Task 4 documents this and Task 5 consumes it.

- [ ] **Step 1: Write the failing composition test**

Append to `dashboard_metrics_live_db_test.go`:

```go
func TestLiveDB_DashboardForABrandNewDoctor(t *testing.T) {
	pool := metricsDB(t)
	f := newMetricsFixture(t, pool)
	res, err := metricsService(pool).GetDashboard(context.Background(), f.doctorUser)
	if err != nil {
		t.Fatalf("GetDashboard: %v", err)
	}
	if res.Metrics.TodaysCount != 0 || res.Metrics.UpcomingCount != 0 {
		t.Errorf("counts = %d/%d, want 0/0", res.Metrics.TodaysCount, res.Metrics.UpcomingCount)
	}
	if res.Metrics.SatisfactionPct != nil {
		t.Errorf("SatisfactionPct = %v, want null for a doctor with no reviews", *res.Metrics.SatisfactionPct)
	}
	if res.Metrics.Timezone != defaultDoctorTimezone {
		t.Errorf("Timezone = %q, want the default %q", res.Metrics.Timezone, defaultDoctorTimezone)
	}
	if res.TodaysAppointments == nil || len(res.TodaysAppointments) != 0 {
		t.Errorf("TodaysAppointments = %v, want an empty non-nil slice", res.TodaysAppointments)
	}
	if res.WalletBalanceKobo != 0 {
		t.Errorf("WalletBalanceKobo = %d, want 0", res.WalletBalanceKobo)
	}
	// The old flat map still ships: pendingRequests reads it and is untouched here.
	if res.AppointmentCounts == nil {
		t.Error("AppointmentCounts must still be present")
	}
}

func TestLiveDB_DashboardReportsSeededNumbers(t *testing.T) {
	pool := metricsDB(t)
	f := newMetricsFixture(t, pool)
	ctx := context.Background()
	tz := defaultDoctorTimezone

	// Today's rows are both 'completed': a row inside today may sit before or after
	// CURRENT_TIMESTAMP depending on when the suite runs, so nothing today can be
	// allowed to feed UpcomingCount. The +2-day booked row is always future.
	f.bookLocal(t, tz, "completed", 0, 9*60)
	f.bookLocal(t, tz, "completed", 0, 14*60)
	f.bookLocal(t, tz, "booked", 2, 9*60)
	settledID, _ := f.bookLocal(t, tz, "completed", -1, 9*60)
	f.escrow(t, settledID, "settled", 200000, 170000, 0, true)
	for _, rating := range []int{4, 5, 5} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO doctor_reviews (user_id, rating) VALUES ($1,$2)`, f.doctorUser, rating); err != nil {
			t.Fatalf("review: %v", err)
		}
	}

	res, err := metricsService(pool).GetDashboard(ctx, f.doctorUser)
	if err != nil {
		t.Fatalf("GetDashboard: %v", err)
	}
	if res.Metrics.TodaysCount != 2 {
		t.Errorf("TodaysCount = %d, want 2", res.Metrics.TodaysCount)
	}
	if res.Metrics.UpcomingCount != 1 {
		t.Errorf("UpcomingCount = %d, want 1", res.Metrics.UpcomingCount)
	}
	if len(res.TodaysAppointments) != 2 {
		t.Errorf("queue rows = %d, want 2", len(res.TodaysAppointments))
	}
	if res.Metrics.Revenue.LifetimeKobo != 170000 {
		t.Errorf("Revenue.LifetimeKobo = %d, want 170000", res.Metrics.Revenue.LifetimeKobo)
	}
	if res.Metrics.Revenue.ConsultsThisMonth == 0 {
		t.Error("Revenue.ConsultsThisMonth = 0, want the completed-this-month count")
	}
	// 4,5,5 → avg 4.666 → 93.33 → 93. The scoping of the read is proven by the next
	// test, which adds a review for a DIFFERENT doctor and expects nothing to move.
	if res.Metrics.SatisfactionPct == nil || *res.Metrics.SatisfactionPct != 93 {
		t.Errorf("SatisfactionPct = %v, want 93", res.Metrics.SatisfactionPct)
	}
	if res.Metrics.RatingCount != 3 {
		t.Errorf("RatingCount = %d, want 3", res.Metrics.RatingCount)
	}
	// Two planes, two numbers: consult revenue is projected, the wallet is the
	// ledger's. A settled settlement does not move the wallet by itself here,
	// because this fixture wrote the settlement row directly and never posted the
	// journal pair.
	if res.WalletBalanceKobo != 0 {
		t.Errorf("WalletBalanceKobo = %d, want 0 — the dashboard must not blend the two", res.WalletBalanceKobo)
	}

	raw, err := json.Marshal(res)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !strings.Contains(string(raw), `"todaysCount":2`) {
		t.Errorf("payload missing todaysCount: %s", raw)
	}
	// The no-reviews case ships JSON null, not 0 — the client renders '—' from it.
	bare := newMetricsFixture(t, pool)
	braw, err := json.Marshal(mustDashboard(t, ctx, pool, bare.doctorUser))
	if err != nil {
		t.Fatalf("marshal bare: %v", err)
	}
	if !strings.Contains(string(braw), `"satisfactionPct":null`) {
		t.Errorf("bare dashboard payload missing a null satisfactionPct: %s", braw)
	}
}

// doctor_reviews.user_id is the REVIEWED doctor, so a one-star aimed at someone
// else must not touch this score. Same join discipline as the appointment reads.
func TestLiveDB_DashboardSatisfactionIgnoresOtherDoctors(t *testing.T) {
	pool := metricsDB(t)
	f := newMetricsFixture(t, pool)
	other := newMetricsFixture(t, pool)
	ctx := context.Background()

	review := func(userID string, rating int) {
		t.Helper()
		if _, err := pool.Exec(ctx,
			`INSERT INTO doctor_reviews (user_id, rating) VALUES ($1,$2)`, userID, rating); err != nil {
			t.Fatalf("review: %v", err)
		}
	}
	review(f.doctorUser, 5)
	review(f.doctorUser, 5)
	review(other.doctorUser, 1)

	res := mustDashboard(t, ctx, pool, f.doctorUser)
	if res.Metrics.RatingCount != 2 {
		t.Errorf("RatingCount = %d, want 2 — only this doctor's reviews", res.Metrics.RatingCount)
	}
	if res.Metrics.SatisfactionPct == nil || *res.Metrics.SatisfactionPct != 100 {
		t.Errorf("SatisfactionPct = %v, want 100 (two 5-star reviews, no stranger's 1)", res.Metrics.SatisfactionPct)
	}
}

func mustDashboard(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string) *DashboardSummary {
	t.Helper()
	res, err := metricsService(pool).GetDashboard(ctx, userID)
	if err != nil {
		t.Fatalf("GetDashboard: %v", err)
	}
	return res
}
```

`metricsService` and the `ledger` import already exist from Task 1, so this step adds tests only — no new imports.

- [ ] **Step 2: Run it to see it fail**

```bash
cd /private/tmp/spot-doctor-metrics/backend && go test ./internal/doctor/ -run TestLiveDB_Dashboard -count=1 2>&1 | tail -10
```

Expected: compile failure — `res.Metrics undefined (type *DashboardSummary has no field or method Metrics)`.

- [ ] **Step 3: Extend `DashboardSummary`**

In `backend/internal/doctor/handler_tail2.go`, replace the struct at :483-488 with:

```go
// DashboardSummary is the composite landing projection for GET /dashboard. It is
// composed entirely from existing scoped reads + the ledger balance — no new
// table. Money is int64 kobo.
//
// AppointmentCounts is the doctor_appointments status map, kept for
// pendingRequests; the two appointment TILES read Metrics instead, because
// doctor_appointments has no insert path (see dashboard_metrics.go).
type DashboardSummary struct {
	AppointmentCounts   map[string]int64              `json:"appointmentCounts"`
	UnreadNotifications int64                         `json:"unreadNotifications"`
	WalletBalanceKobo   int64                         `json:"walletBalanceKobo"`
	Currency            string                        `json:"currency"`
	Metrics             DashboardMetrics              `json:"metrics"`
	TodaysAppointments  []DashboardQueueAppointment   `json:"todaysAppointments"`
}
```

Run `gofmt -w internal/doctor/handler_tail2.go` — the alignment above will be reflowed by the formatter, which is expected.

- [ ] **Step 4: Compose the reads in `GetDashboard`**

Replace `backend/internal/doctor/service_tail2.go:143-165` with:

```go
// GetDashboard composes the landing dashboard from existing scoped reads: the
// appointment status counts, the unread-notification count, and the ledger wallet
// balance (projected, never stored) — plus the tile metrics and today's queue,
// which read the booking plane (public.appointments) rather than
// doctor_appointments, and the consult-revenue projection over settlements. No new
// table, and no write: every one of these is a read.
//
// One failing read fails the call. That is deliberate — a zero that came from a
// broken query is indistinguishable from a real zero, which is precisely how the
// original bug stayed hidden.
func (s *Service) GetDashboard(ctx context.Context, userID string) (*DashboardSummary, error) {
	counts, err := s.repo.appointmentStatusCounts(ctx, userID)
	if err != nil {
		return nil, err
	}
	unread, err := s.repo.unreadNotificationCount(ctx, userID)
	if err != nil {
		return nil, err
	}
	balance, err := s.ledger.GetBalance(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("doctor: project dashboard wallet balance from ledger: %w", err)
	}
	tz, err := s.dashboardTimezone(ctx, userID)
	if err != nil {
		return nil, err
	}
	agg, err := s.repo.dashboardAggregates(ctx, userID, tz)
	if err != nil {
		return nil, fmt.Errorf("doctor: project dashboard appointment metrics: %w", err)
	}
	queue, err := s.repo.todayQueue(ctx, userID, tz, agg.Today)
	if err != nil {
		return nil, fmt.Errorf("doctor: project today's consult queue: %w", err)
	}
	revenue, err := s.repo.consultRevenue(ctx, userID, tz)
	if err != nil {
		return nil, err
	}
	// One count, two tiles: the queue list is capped, the number is not (spec D2a).
	revenue.ConsultsThisMonth = agg.ConsultsThisMonth
	rep, err := s.repo.GetReputation(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("doctor: project dashboard satisfaction: %w", err)
	}
	return &DashboardSummary{
		AppointmentCounts:   counts,
		UnreadNotifications: unread,
		WalletBalanceKobo:   balance,
		Currency:            "NGN",
		Metrics: DashboardMetrics{
			TodaysCount:     agg.TodaysCount,
			UpcomingCount:   agg.UpcomingCount,
			SatisfactionPct: dashboardSatisfactionPct(*rep),
			RatingCount:     rep.ReviewCount,
			Revenue:         revenue,
			Timezone:        tz,
			Today:           agg.Today,
		},
		TodaysAppointments: queue,
	}, nil
}
```

`GetReputation` returns `*ReputationSummary` and always a non-nil pointer on a nil error (its query is a bare aggregate, so it cannot return `ErrNoRows`).

- [ ] **Step 5: Run the whole doctor package**

```bash
cd /private/tmp/spot-doctor-metrics/backend && go build ./... && go vet ./internal/doctor/... ./internal/integrations/... && go test ./internal/doctor/... -count=1 2>&1 | tail -20
```

Expected: `ok spotlight/backend/internal/doctor`. With the DSN set, every `TestLiveDB_Dashboard*` must PASS; record skips rather than reporting them as green.

- [ ] **Step 6: Commit**

```bash
cd /private/tmp/spot-doctor-metrics && git add backend/internal/doctor/service_tail2.go backend/internal/doctor/handler_tail2.go backend/internal/doctor/dashboard_metrics_live_db_test.go && git commit -m "feat(doctor): ship metrics and today's queue on GET /dashboard

The five tiles now have one payload source. satisfactionPct is *float64 so 'no
reviews yet' survives the wire instead of arriving as 0%."
```

---

### Task 4: Type the dashboard response in the contract

`/doctor/dashboard` is `{ $ref: Generic }` today ([contracts/doctor.openapi.yaml:1245](../../contracts/doctor.openapi.yaml#L1245)) — which is *why* the client could cast the flat wire straight into its rich view model and invent fields. Typing it is the guard against a repeat.

**Files:**
- Modify: `contracts/doctor.openapi.yaml` (four new component schemas; the `/doctor/dashboard` response `$ref`)

**Interfaces:**
- Consumes: the Task 3 payload.
- Produces: `DashboardResponse`, `DashboardMetrics`, `DashboardRevenue`, `DashboardQueueAppointment` component schemas. No code reads these — the lane that matters is Redocly lint plus the doctor lane's YAML parse.

- [ ] **Step 1: Add the component schemas**

In `contracts/doctor.openapi.yaml`, insert immediately after the `PatientSummary` schema block (which ends at the `gender:` line, [contracts/doctor.openapi.yaml:89](../../contracts/doctor.openapi.yaml#L89)) — `DashboardQueueAppointment` embeds it, so it must already exist above:

```yaml
    # ── dashboard tiles ──────────────────────────────────────────────────────────
    DashboardRevenue:
      type: object
      description: >-
        Consult money, projected from settlements. pendingKobo is escrowed money that
        has not settled, derived with the same split arithmetic settlement.Settle pays
        by; lifetimeKobo/thisMonthKobo sum settlements.provider_kobo for settled
        telemedicine rows. Available money is deliberately NOT here — it is the user
        wallet, which the ledger projects as walletBalanceKobo.
      properties:
        pendingKobo:       { $ref: '#/components/schemas/Money' }
        lifetimeKobo:      { $ref: '#/components/schemas/Money' }
        thisMonthKobo:     { $ref: '#/components/schemas/Money' }
        consultsThisMonth: { type: integer }
    DashboardMetrics:
      type: object
      description: >-
        The landing tiles. Every count is scoped to this doctor and every date is
        evaluated in the doctor's own timezone (doctor_profiles.timezone, the column
        the app's timezone screen writes, defaulting to Africa/Lagos). Counts and the queue both come from
        public.appointments joined through doctors.user_id — the plane bookings
        actually land in.
      properties:
        todaysCount:
          type: integer
          description: Non-cancelled consults on the doctor's local day. Uncapped, so it can exceed the 20 listed rows.
        upcomingCount:
          type: integer
          description: Rows with status booked or confirmed scheduled after now.
        satisfactionPct:
          type: number
          nullable: true
          description: ROUND(AVG(rating)/5*100) over visible doctor_reviews. null means no reviews yet — distinct from 0.
        ratingCount:
          type: integer
          description: How many reviews satisfactionPct is built from; 0 exactly when satisfactionPct is null.
        revenue:  { $ref: '#/components/schemas/DashboardRevenue' }
        timezone: { type: string, description: IANA zone the counts and slot strings are computed in. }
        today:    { type: string, description: 'The doctor''s local day, YYYY-MM-DD — the date the queue was listed for.' }
    DashboardQueueAppointment:
      type: object
      description: >-
        One row of today's queue. slotDate is a calendar day and slotTime is
        doctor-local wall clock, so the row renders without a client-side timezone.
        initials/avatarColor are presentation and derived by the client, not here.
      properties:
        id:          { type: string }
        ref:         { type: string }
        patient:     { $ref: '#/components/schemas/PatientSummary' }
        consultType: { type: string, description: 'The stored consultation_type verbatim: video, audio, chat or in_person.' }
        status:      { type: string, enum: [upcoming, confirmed, in_progress, completed] }
        slotDate:    { type: string, description: 'YYYY-MM-DD in the doctor''s timezone.' }
        slotTime:    { type: string, description: 'HH:MM AM/PM in the doctor''s timezone.' }
        feeKobo:     { $ref: '#/components/schemas/Money' }
        reason:      { type: string }
        isHmo:       { type: boolean, description: 'Always false: public.appointments records no HMO coverage.' }
        createdAt:   { type: string, format: date-time }
    DashboardResponse:
      type: object
      description: GET /doctor/dashboard — the flat batch-1 projection plus the tile metrics and today's queue.
      properties:
        appointmentCounts:
          type: object
          additionalProperties: { type: integer }
          description: Status counts over doctor_appointments (the doctor module's own queue table).
        unreadNotifications: { type: integer }
        walletBalanceKobo:   { $ref: '#/components/schemas/Money' }
        currency:            { type: string }
        metrics:             { $ref: '#/components/schemas/DashboardMetrics' }
        todaysAppointments:
          type: array
          items: { $ref: '#/components/schemas/DashboardQueueAppointment' }
```

- [ ] **Step 2: Point the path at the new schema**

Line 1245 is the `/doctor/dashboard:` key; replace the `get:` line under it (line 1246, currently `$ref`s `Generic`) with:

```yaml
  /doctor/dashboard:
    get: { tags: [doctor-batch1], summary: Doctor dashboard data, responses: { '200': { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/DashboardResponse' } } } } } }
```

- [ ] **Step 3: Lint it — parse is not enough**

The doctor lane only proves the YAML *parses* (`python3 -c "import yaml; yaml.safe_load(...)"`); the contract lane runs Redocly, and a file can parse and still fail lint. Run the gate's own command:

```bash
cd /private/tmp/spot-doctor-metrics
python3 -c "import yaml; yaml.safe_load(open('contracts/doctor.openapi.yaml')); print('parses')"
npx --yes @redocly/cli@1 lint contracts/doctor.openapi.yaml --config redocly.yaml --format=stylish; echo "redocly exit: $?"
```

Expected: `redocly exit: 0`. Warnings are acceptable (the file already carries them for missing `operationId`s); an error is not. Capture the exit code as shown — piping lint output straight to `tail` hides it.

- [ ] **Step 4: Commit**

```bash
cd /private/tmp/spot-doctor-metrics && git add contracts/doctor.openapi.yaml && git commit -m "docs(contract): type GET /doctor/dashboard instead of answering Generic

The untyped response is what let the mobile adapter cast a flat projection into
its rich view model and invent the fields it was missing."
```

---

### Task 5: The client mapping — one pure module, all five tiles

Today `getDashboard`'s live branch returns literal `0`s for the tiles and `earnings.lifetimeKobo = walletBalanceKobo` ([mobile-app/reactnative/src/api/doctor.batch1.api.ts:340-375](../../mobile-app/reactnative/src/api/doctor.batch1.api.ts#L340)). This moves the wire→domain translation into a pure module the same way `batch6Wire.ts` does, so it is testable without a device.

**Files:**
- Create: `mobile-app/reactnative/src/features/doctor/dashboardWire.ts`
- Create: `mobile-app/reactnative/src/features/doctor/__tests__/dashboardWire.test.ts`
- Modify: `mobile-app/reactnative/src/types/doctor.batch1.ts:256` (`satisfactionPct`)
- Modify: `mobile-app/reactnative/src/api/doctor.batch1.api.ts` (delete the local `DashboardWire`, delegate to the mapper)
- Modify: `mobile-app/reactnative/package.json` (add a `test:doctor-dashboard` script — `batch6Wire.test.ts` has no runner wired, which is how its bug survived)

**Interfaces:**
- Consumes: `DashboardResponse` from Task 4, as `DashboardWire`.
- Produces:
  - `mapDashboardWire(wire: DashboardWire): DoctorDashboardData`
  - `mapQueueAppointment(wire: DashboardQueueAppointmentWire): DoctorAppointment`
  - `initialsFromName(name: string): string`, `avatarColorForPatient(id: string): string`, `PATIENT_AVATAR_COLORS: string[]`
  - `formatSlotDateLabel(slotDate: string): string` (used by `AppointmentRow` in Task 6)
  - exported types `DashboardWire`, `DashboardMetricsWire`, `DashboardRevenueWire`, `DashboardQueueAppointmentWire`, `DashboardQueuePatientWire`

- [ ] **Step 1: Give the worktree a node_modules**

```bash
test -d /private/tmp/spot-doctor-metrics/mobile-app/reactnative/node_modules \
  || ln -s /Users/paymax/Documents/spotlight/main/mobile-app/reactnative/node_modules /private/tmp/spot-doctor-metrics/mobile-app/reactnative/node_modules
cd /private/tmp/spot-doctor-metrics/mobile-app/reactnative && git status --short . | head
```

Expected: `git status` shows only the files this task will create. The symlink must be invisible to git (the path is ignored); if it shows up, remove the symlink and stop — do not commit it.

- [ ] **Step 2: Write the failing spec**

Create `mobile-app/reactnative/src/features/doctor/__tests__/dashboardWire.test.ts`:

```ts
// The dashboard's five tiles, mapped off the wire.
//
// The bug these guard: getDashboard()'s live branch ignored the payload it had just
// fetched and returned literals — todaysAppointments: 0, satisfactionPct: 0,
// earnings.lifetimeKobo = walletBalanceKobo — because the doctor was booking into
// public.appointments while the counts were read from doctor_appointments, which
// nothing writes. The endpoint answered 200 with real data and the screen still
// showed a doctor with no patients. GET /dashboard was typed `Generic` in the
// contract, so nothing caught the mismatch.
//
// Runner: npm run test:doctor-dashboard  (node --experimental-strip-types --test;
// this package has no jest, and src/features/doctor/__tests__/batch6Wire.test.ts
// set the precedent).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mapDashboardWire,
  mapQueueAppointment,
  initialsFromName,
  avatarColorForPatient,
  formatSlotDateLabel,
  PATIENT_AVATAR_COLORS,
  type DashboardWire,
} from '../dashboardWire.ts';

const QUEUE_ROW = {
  id: 'a1',
  ref: 'TM-9F2A41',
  patient: { id: 'p1', name: 'Tunde Akinwale', age: 34, gender: 'male' },
  consultType: 'video',
  status: 'upcoming',
  slotDate: '2026-11-13',
  slotTime: '09:00 AM',
  feeKobo: 750000,
  reason: 'headache for a week',
  isHmo: false,
  createdAt: '2026-11-10T08:00:00Z',
};

const FULL: DashboardWire = {
  appointmentCounts: { pending: 3, completed: 9 },
  unreadNotifications: 2,
  walletBalanceKobo: 500000,
  currency: 'NGN',
  metrics: {
    todaysCount: 3,
    upcomingCount: 5,
    satisfactionPct: 96,
    ratingCount: 24,
    revenue: { pendingKobo: 170000, lifetimeKobo: 2040000, thisMonthKobo: 510000, consultsThisMonth: 12 },
    timezone: 'Africa/Lagos',
    today: '2026-11-13',
  },
  todaysAppointments: [QUEUE_ROW],
};

test('every tile reads the wire, not a literal', () => {
  const d = mapDashboardWire(FULL);
  assert.equal(d.counts.todaysAppointments, 3);
  assert.equal(d.counts.upcomingAppointments, 5);
  assert.equal(d.satisfactionPct, 96);
  assert.equal(d.earnings.availableKobo, 500000);
  assert.equal(d.earnings.pendingKobo, 170000);
  assert.equal(d.earnings.lifetimeKobo, 2040000);
  assert.equal(d.earnings.thisMonthKobo, 510000);
  assert.equal(d.earnings.consultsThisMonth, 12);
  assert.equal(d.todaysAppointments.length, 1);
  // The wallet is not consult revenue — the old code used one for both.
  assert.notEqual(d.earnings.lifetimeKobo, d.earnings.availableKobo);
  // Untouched reads still feed their own tiles.
  assert.equal(d.counts.pendingRequests, 3);
  assert.equal(d.counts.unreadMessages, 2);
});

test('no reviews is null, which the tile renders as an em dash', () => {
  const d = mapDashboardWire({ ...FULL, metrics: { ...FULL.metrics, satisfactionPct: null, ratingCount: 0 } });
  assert.equal(d.satisfactionPct, null);
  // A real 0 must stay 0 — 'nobody reviewed you' and 'everyone rated you 1 star'
  // are different messages to a doctor.
  assert.equal(mapDashboardWire({ ...FULL, metrics: { ...FULL.metrics, satisfactionPct: 0 } }).satisfactionPct, 0);
});

test('a thin wire yields zeros and empty arrays, never undefined', () => {
  // The literal body of an endpoint that predates the metrics field, or a doctor
  // with nothing at all.
  const d = mapDashboardWire({});
  assert.equal(d.counts.todaysAppointments, 0);
  assert.equal(d.counts.upcomingAppointments, 0);
  assert.equal(d.satisfactionPct, null);
  assert.deepEqual(d.todaysAppointments, []);
  assert.equal(d.earnings.availableKobo, 0);
  assert.equal(d.earnings.pendingKobo, 0);
  assert.deepEqual(d.earnings.payouts, []);
  assert.deepEqual(d.alerts, []);
  assert.deepEqual(d.messages, []);
  assert.deepEqual(d.waitingRoom, []);
});

test('a queue row becomes the DoctorAppointment the row component expects', () => {
  const a = mapQueueAppointment(QUEUE_ROW);
  assert.equal(a.id, 'a1');
  assert.equal(a.ref, 'TM-9F2A41');
  assert.equal(a.slotDate, '2026-11-13');
  assert.equal(a.slotTime, '09:00 AM');
  assert.equal(a.status, 'upcoming');
  assert.equal(a.feeKobo, 750000);
  assert.equal(a.reason, 'headache for a week');
  assert.equal(a.isHmo, false);
  assert.equal(a.patient.name, 'Tunde Akinwale');
  assert.equal(a.patient.gender, 'male');
});

test('in_person passes through rather than becoming a chat', () => {
  // appointments.consultation_type allows in_person; ConsultType does not (F4
  // tracks widening it). Coercing it would display a lie about the visit.
  assert.equal(mapQueueAppointment({ ...QUEUE_ROW, consultType: 'in_person' }).consultType, 'in_person');
});

test('an unrecognised status cannot invent a completed badge', () => {
  assert.equal(mapQueueAppointment({ ...QUEUE_ROW, status: 'archived' }).status, 'upcoming');
});

test('an unknown gender maps to the union member that is not a claim', () => {
  assert.equal(mapQueueAppointment({ ...QUEUE_ROW, patient: { ...QUEUE_ROW.patient, gender: 'non-binary' } }).patient.gender, 'other');
  assert.equal(mapQueueAppointment({ ...QUEUE_ROW, patient: {} }).patient.gender, 'other');
});

test('initials take the first word and the last word', () => {
  assert.equal(initialsFromName('Tunde Akinwale'), 'TA');
  assert.equal(initialsFromName('Ngozi Adeyemi Okafor'), 'NO');
  assert.equal(initialsFromName('Chidinma'), 'C');
  assert.equal(initialsFromName('   '), 'P');
  assert.equal(initialsFromName('Dr. Ada'), 'DA');
});

test('one patient always gets one colour', () => {
  const c = avatarColorForPatient('p1');
  assert.ok(PATIENT_AVATAR_COLORS.includes(c));
  assert.equal(avatarColorForPatient('p1'), c);
  assert.equal(PATIENT_AVATAR_COLORS.length, 5);
});

test('the slot date label survives a full timestamp', () => {
  // The whole reason the queue looked broken: 'Nov 13' vs 'Invalid Date'.
  assert.equal(formatSlotDateLabel('2026-11-13'), 'Nov 13');
  assert.equal(formatSlotDateLabel('2026-11-13T10:00:00.000Z'), 'Nov 13');
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd /private/tmp/spot-doctor-metrics/mobile-app/reactnative
node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs --test "src/features/doctor/__tests__/dashboardWire.test.ts" 2>&1 | tail -15
```

Expected: a load error, `Cannot find module '.../src/features/doctor/dashboardWire.ts'`.

- [ ] **Step 4: Write the mapper**

Create `mobile-app/reactnative/src/features/doctor/dashboardWire.ts`:

```ts
// Pure wire→domain mapping for GET /doctor/dashboard. Deliberately free of React
// Native imports (no `@/constants/tokens`) so node:test can load it, like
// features/doctor/batch6Wire.ts.
//
// The endpoint answers the flat DashboardSummary the Go service composes — NOT the
// rich DoctorDashboardData the screens render — so the translation happens here
// instead of the `doctorGet<DoctorDashboardData>('/dashboard')` cast that used to
// sit in the api module. That cast is how the tiles ended up hard-coded: the wire
// genuinely had no `counts.todaysAppointments` to read.

import type { DoctorAppointment, PatientSummary } from '@/types/doctor';
import type { DoctorDashboardData } from '@/types/doctor.batch1';

/** The body GET /doctor/dashboard writes (DashboardResponse in contracts/doctor.openapi.yaml). */
export interface DashboardWire {
  appointmentCounts?: Record<string, number>;
  unreadNotifications?: number;
  walletBalanceKobo?: number;
  currency?: string;
  metrics?: DashboardMetricsWire;
  todaysAppointments?: DashboardQueueAppointmentWire[];
}

export interface DashboardMetricsWire {
  todaysCount?: number;
  upcomingCount?: number;
  satisfactionPct?: number | null;
  ratingCount?: number;
  revenue?: DashboardRevenueWire;
  timezone?: string;
  today?: string;
}

export interface DashboardRevenueWire {
  pendingKobo?: number;
  lifetimeKobo?: number;
  thisMonthKobo?: number;
  consultsThisMonth?: number;
}

export interface DashboardQueueAppointmentWire {
  id?: string;
  ref?: string;
  patient?: DashboardQueuePatientWire;
  consultType?: string;
  status?: string;
  slotDate?: string;
  slotTime?: string;
  feeKobo?: number;
  reason?: string;
  isHmo?: boolean;
  createdAt?: string;
}

export interface DashboardQueuePatientWire {
  id?: string;
  name?: string;
  age?: number;
  gender?: string;
}

/**
 * Avatar palette for the queue rows. Local on purpose: `Colors` comes from
 * `@/constants/tokens`, which pulls in React Native and makes this module
 * un-loadable under node:test.
 */
export const PATIENT_AVATAR_COLORS = ['#F59E0B', '#EC4899', '#14B8A6', '#8B5CF6', '#3B82F6'];

export function initialsFromName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'P';
  const first = words[0].charAt(0);
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : '';
  return (first + last).toUpperCase();
}

export function avatarColorForPatient(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PATIENT_AVATAR_COLORS[h % PATIENT_AVATAR_COLORS.length];
}

/**
 * 'Nov 13' from a slot date. The contract says YYYY-MM-DD; a full timestamp is
 * tolerated (slice to the day) because `new Date('<iso-timestamp>T00:00:00')` is
 * Invalid Date, which is what the queue used to render.
 */
export function formatSlotDateLabel(slotDate: string): string {
  return new Date(`${slotDate.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function patientGender(gender: string | undefined): PatientSummary['gender'] {
  return gender === 'male' || gender === 'female' ? gender : 'other';
}

function queueStatus(status: string | undefined): DoctorAppointment['status'] {
  switch (status) {
    case 'confirmed':
    case 'in_progress':
    case 'completed':
    case 'cancelled':
      return status;
    default:
      // 'booked' is already renamed to 'upcoming' in SQL; anything unrecognised
      // lands here rather than inventing a completed/cancelled badge.
      return 'upcoming';
  }
}

export function mapQueueAppointment(wire: DashboardQueueAppointmentWire): DoctorAppointment {
  const name = wire.patient?.name ?? 'Patient';
  const id = wire.id ?? '';
  return {
    id,
    ref: wire.ref ?? '',
    patient: {
      id: wire.patient?.id ?? '',
      name,
      // Presentation tokens, derived here (spec D9) — they are not booking facts.
      initials: initialsFromName(name),
      avatarColor: avatarColorForPatient(wire.patient?.id ?? id),
      age: wire.patient?.age ?? 0,
      gender: patientGender(wire.patient?.gender),
    },
    // Passed through verbatim, in_person included (spec D8). ConsultType has no
    // in_person member — the cast is local to this boundary and AppointmentRow
    // draws a fallback icon; follow-up F4 widens the union for good.
    consultType: wire.consultType as DoctorAppointment['consultType'],
    status: queueStatus(wire.status),
    slotDate: wire.slotDate ?? '',
    slotTime: wire.slotTime ?? '',
    feeKobo: wire.feeKobo ?? 0,
    createdAt: wire.createdAt ?? '',
    reason: wire.reason,
    isHmo: wire.isHmo ?? false,
  };
}

export function mapDashboardWire(wire: DashboardWire): DoctorDashboardData {
  const m = wire.metrics ?? {};
  const revenue = m.revenue ?? {};
  const statusCounts = wire.appointmentCounts ?? {};
  return {
    // Presence and instant-accepting have their own endpoints (GET /presence,
    // GET /availability); the dashboard payload has never carried them.
    presence: 'offline',
    acceptsInstant: false,
    counts: {
      todaysAppointments: m.todaysCount ?? 0,
      upcomingAppointments: m.upcomingCount ?? 0,
      pendingRequests: statusCounts.pending ?? 0,
      waitingRoom: 0,
      followUpRequests: 0,
      unreadMessages: wire.unreadNotifications ?? 0,
      newLabResults: 0,
      pendingPrescriptions: 0,
      refillRequests: 0,
      hmoApprovals: 0,
    },
    todaysAppointments: (wire.todaysAppointments ?? []).map(mapQueueAppointment),
    pendingRequests: [],
    waitingRoom: [],
    messages: [],
    alerts: [],
    earnings: {
      // The wallet (available to withdraw) and the consult projection are two
      // different planes; the tile labels them accordingly.
      availableKobo: wire.walletBalanceKobo ?? 0,
      pendingKobo: revenue.pendingKobo ?? 0,
      lifetimeKobo: revenue.lifetimeKobo ?? 0,
      thisMonthKobo: revenue.thisMonthKobo ?? 0,
      consultsThisMonth: revenue.consultsThisMonth ?? 0,
      payouts: [],
    },
    satisfactionPct: m.satisfactionPct ?? null,
  };
}
```

- [ ] **Step 5: Make the nullability real in the type**

In `mobile-app/reactnative/src/types/doctor.batch1.ts`, replace line 256:

```ts
  satisfactionPct:    number | null;        // 0–100, or null when the doctor has no reviews yet
```

- [ ] **Step 6: Run the spec**

```bash
cd /private/tmp/spot-doctor-metrics/mobile-app/reactnative
node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs --test "src/features/doctor/__tests__/dashboardWire.test.ts" 2>&1 | tail -20
```

Expected: `# pass 10`, `# fail 0`.

- [ ] **Step 7: Wire the runner into package.json so it cannot go un-run again**

In `mobile-app/reactnative/package.json`, add after the `"test:crypto": …` line (line 72) — remember the comma:

```json
    "test:doctor-dashboard": "node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs --test \"src/features/doctor/__tests__/dashboardWire.test.ts\"",
```

Then:

```bash
cd /private/tmp/spot-doctor-metrics/mobile-app/reactnative && python3 -c "import json;json.load(open('package.json'));print('package.json valid')" && npm run test:doctor-dashboard 2>&1 | tail -8
```

Expected: `package.json valid`, then `# fail 0`.

- [ ] **Step 8: Delegate the api module's live branch**

In `mobile-app/reactnative/src/api/doctor.batch1.api.ts`, delete the local `interface DashboardWire { … }` block and its comment (lines 328-339), and replace the whole `getDashboard` function (lines 340-376, signature included) with:

```ts
export async function getDashboard(): Promise<DoctorDashboardData> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_DASHBOARD);
  return mapDashboardWire(await doctorGet<DashboardWire>('/dashboard'));
}
```

Add to the import block near the top (after `import { Colors } from '@/constants/tokens';`):

```ts
import {
  mapDashboardWire,
  type DashboardWire,
} from '@/features/doctor/dashboardWire';
```

Replace the stale comment above the function with:

```ts
// Live GET /dashboard returns the flat DashboardSummary projection; the
// wire→DoctorDashboardData translation lives in features/doctor/dashboardWire
// (pure, node:test-covered) so the tiles read the payload instead of literals.
```

- [ ] **Step 9: Typecheck the doctor surface**

```bash
cd /private/tmp/spot-doctor-metrics/mobile-app/reactnative && npx --max-old-space-size=4096 tsc --noEmit -p tsconfig.doctorcheck.json 2>&1 | tail -20; echo "tsc exit: $?"
```

Expected: no output, `tsc exit: 0`. `DEMO_DASHBOARD`'s `satisfactionPct: 96` still satisfies `number | null`. If the process dies with exit 134, that is a heap crash rather than a type error — retry with a larger `--max-old-space-size`.

- [ ] **Step 10: Commit**

```bash
cd /private/tmp/spot-doctor-metrics && git add mobile-app/reactnative/src/features/doctor/dashboardWire.ts mobile-app/reactnative/src/features/doctor/__tests__/dashboardWire.test.ts mobile-app/reactnative/src/types/doctor.batch1.ts mobile-app/reactnative/src/api/doctor.batch1.api.ts mobile-app/reactnative/package.json && git commit -m "fix(doctor): map the dashboard wire onto all five tiles instead of literals

getDashboard's live branch returned 0s and reused the wallet balance as lifetime
earnings. It now reads metrics/todaysAppointments through a pure module with a
node:test spec, and satisfactionPct is nullable so 'no reviews' stops rendering
as 0%. The spec gets an npm script: batch6Wire.test.ts had none, which is how a
mapped wire stayed broken."
```

---

### Task 6: Today's queue rows render

`AppointmentRow` crashes on an `in_person` booking (`TYPE_ICON[...]` is `undefined` → rendering it throws) and prints "Invalid Date" for a timestamp-shaped `slotDate` ([mobile-app/reactnative/src/features/doctor/components/AppointmentRow.tsx:18-25](../../mobile-app/reactnative/src/features/doctor/components/AppointmentRow.tsx#L18)).

**Files:**
- Modify: `mobile-app/reactnative/src/features/doctor/components/AppointmentRow.tsx:3-4,18,24-25`

**Interfaces:**
- Consumes: `formatSlotDateLabel` from Task 5.
- Produces: an unchanged `Props` contract — the screen's call sites need no edits.

- [ ] **Step 1: Fix the icon map and the date label**

In `AppointmentRow.tsx`, extend the lucide import on line 3 with `CalendarDays`, add the mapper import below the token imports, and change the map plus the two derived locals:

```tsx
import { Video, Phone, MessageCircle, ChevronRight, ShieldCheck, CalendarDays } from 'lucide-react-native';
```

```tsx
import { formatSlotDateLabel } from '@/features/doctor/dashboardWire';
import type { DoctorAppointment } from '@/types/doctor';
```

(replacing the existing `import type { DoctorAppointment, ConsultType } from '@/types/doctor';` — `ConsultType` is no longer referenced once the map is keyed by string.)

```tsx
// Keyed by string, not ConsultType: the booking table allows in_person, which the
// union does not have yet (follow-up F4). An unmapped type draws the neutral
// calendar — `TYPE_ICON[x]` was undefined for it and rendering undefined throws,
// which took the whole dashboard down.
const TYPE_ICON: Record<string, LucideIcon> = { video: Video, audio: Phone, chat: MessageCircle };
const FALLBACK_ICON = CalendarDays;
```

```tsx
  const TypeIcon = TYPE_ICON[appointment.consultType] ?? FALLBACK_ICON;
  const dateLabel = formatSlotDateLabel(appointment.slotDate);
```

- [ ] **Step 2: Typecheck and re-run the mapper spec**

```bash
cd /private/tmp/spot-doctor-metrics/mobile-app/reactnative
npx --max-old-space-size=4096 tsc --noEmit -p tsconfig.doctorcheck.json 2>&1 | tail -10; echo "tsc exit: $?"
npm run test:doctor-dashboard 2>&1 | tail -6
```

Expected: `tsc exit: 0` and `# fail 0`. The date-parsing branch is covered by `formatSlotDateLabel`'s spec; the icon fallback is a map lookup whose visible behaviour is confirmed in the browser pass (Task 8) — say so rather than claiming it is tested.

- [ ] **Step 3: Commit**

```bash
cd /private/tmp/spot-doctor-metrics && git add mobile-app/reactnative/src/features/doctor/components/AppointmentRow.tsx && git commit -m "fix(doctor): stop the queue row crashing on in_person and Invalid Date"
```

---

### Task 7: The dashboard screen reads the aggregate

**Files:**
- Modify: `mobile-app/reactnative/app/(doctor)/(tabs)/index.tsx:18,24,59,71,74,166,171,308,311`

**Interfaces:**
- Consumes: `dashboard.todaysAppointments` (Task 5's `DoctorDashboardData`), `dashboard.counts.todaysAppointments`, `dashboard.satisfactionPct: number | null`.
- Produces: the user-visible five tiles.

- [ ] **Step 1: Point the queue and both appointment tiles at the dashboard**

Five edits in `app/(doctor)/(tabs)/index.tsx`:

1. Line 18 — drop `useAppointments` from the hooks import:

```tsx
import { useDoctorProfile, useEarnings, useNotifications, useUpdateSettings, useSettings, useDashboard, useAnnouncement, useSetPresence, useDismissAnnouncement } from '@/features/doctor/hooks';
```

2. Delete line 24 (`const ACTIVE_STATUSES = …`) and line 59 (`const { data: appointments = [] } = useAppointments();`) and line 71 (`const todays = appointments.filter(…)`). The queue now comes from the dashboard aggregate, which already scopes it to today in the doctor's timezone; `ACTIVE_STATUSES` (`upcoming`/`confirmed`/`in_progress`) also silently dropped `completed` consults, so "today's consults" counted the day before it was ever asked to.

3. Line 74 — add the queue local under `counts`:

```tsx
  const counts = dashboard?.counts;
  const queue = dashboard?.todaysAppointments ?? [];
```

4. Lines 166 and 171 — the tiles:

```tsx
          <StatCard icon={CalendarDays} label="Today's consults" value={String(counts?.todaysAppointments ?? 0)} iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} />
```

```tsx
          <StatCard icon={Smile} label="Satisfaction" value={dashboard?.satisfactionPct == null ? '—' : `${dashboard.satisfactionPct}%`} iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} />
```

   Line 167 (`Upcoming`) already reads `counts?.upcomingAppointments` and needs no change — its zero came from the server, and `counts` is now populated. Line 170 (`Available`) already reads `dashboard?.earnings.availableKobo`; leave its `?? earnings?.availableKobo ?? 0` fallback so the tile still works against a stale bundle.

5. Lines 308 and 311 — the queue block:

```tsx
          {queue.length === 0 ? (
            <StateView variant="empty" icon={CalendarDays} title="No consults scheduled" message="New bookings will appear here." />
          ) : (
            queue.map((a) => (
```

- [ ] **Step 2: Typecheck**

```bash
cd /private/tmp/spot-doctor-metrics/mobile-app/reactnative && npx --max-old-space-size=4096 tsc --noEmit -p tsconfig.doctorcheck.json 2>&1 | tail -15; echo "tsc exit: $?"
```

Expected: `tsc exit: 0`. A leftover `appointments`/`todays`/`ACTIVE_STATUSES` reference shows up here as `Cannot find name` — that is the check that the deletions were complete.

- [ ] **Step 3: Confirm nothing else read the removed locals**

```bash
cd /private/tmp/spot-doctor-metrics/mobile-app/reactnative && grep -n "ACTIVE_STATUSES\|useAppointments\|\btodays\b" "app/(doctor)/(tabs)/index.tsx"; echo "refs exit: $?"
```

Expected: no matches printed, `refs exit: 1`. (A no-match exit code is the pass here — read the number, don't assume.)

- [ ] **Step 4: Commit**

```bash
cd /private/tmp/spot-doctor-metrics && git add "mobile-app/reactnative/app/(doctor)/(tabs)/index.tsx" && git commit -m "fix(doctor): read today's tiles and queue from the dashboard aggregate

Replaces the useAppointments client-side filter, which counted 'upcoming,
confirmed, in_progress' as today's consults — a status filter with no date
filter, that dropped completed consults from the day it was naming."
```

---

### Task 8: Docs, full gate run, publish

**Files:**
- Modify: `mobile-app/reactnative/docs/QA_DOCTOR_BATCH1_REPORT.md:76,77,88` (D1/D2/D13 rows) and the note above the table
- Modify: `mobile-app/reactnative/docs/DOCTOR_BATCH1_API_CONTRACT.md` (Section D — record that live mode maps through `dashboardWire.ts`)

**Interfaces:** none new.

- [ ] **Step 1: Correct the QA rows that were PASS on mock data**

In `mobile-app/reactnative/docs/QA_DOCTOR_BATCH1_REPORT.md`, replace the three rows:

```markdown
| D1 | Today's appointments | StatCard `counts.todaysAppointments` + "Today's queue" list (index.tsx:166,308) | PASS — live mode: `GET /dashboard` `metrics.todaysCount` / `todaysAppointments`, both dated in the doctor's timezone |
| D2 | Upcoming appointments | StatCard `counts.upcomingAppointments` (index.tsx:167) | PASS — live mode: `metrics.upcomingCount` |
| D13 | Patient satisfaction rating | StatCard `dashboard.satisfactionPct` (index.tsx:171) | PASS — live mode: `metrics.satisfactionPct`, `null` (rendered `—`) when the doctor has no reviews |
```

Then, immediately below the table's intro paragraph ("All entries are cards/alerts/banners/states of the single `DoctorDashboardData` aggregate on `(tabs)/index.tsx`, per the consolidation plan."), add:

```markdown
> **Correction (2026-11-13).** D1, D2 and D13 were previously recorded PASS from the
> `DEMO_*` fixtures. In live mode (`EXPO_PUBLIC_DOCTOR_USE_MOCK=false`, which
> `mockPolicy.ts` forces in staging and production) they were 0, 0 and `0%` for every
> doctor: the counts came from `doctor_appointments`, which no booking path writes,
> and the queue was a status filter with no date filter. `GET /dashboard` now carries
> `metrics` + `todaysAppointments` from `public.appointments`, mapped in
> `src/features/doctor/dashboardWire.ts`. See
> `docs/superpowers/specs/2026-11-13-doctor-dashboard-metrics-design.md`.
```

- [ ] **Step 2: Record the mapping in the contract doc**

In `mobile-app/reactnative/docs/DOCTOR_BATCH1_API_CONTRACT.md`, under `### Section D — dashboard (`useDashboard.ts`)` (line 135), after the hooks table, add:

```markdown
**Live mode.** `GET /dashboard` answers the flat projection `DashboardResponse` in
`contracts/doctor.openapi.yaml`. `src/features/doctor/dashboardWire.ts` (pure, no
React Native imports) maps it onto `DoctorDashboardData`:
`metrics.todaysCount`/`upcomingCount` → the two appointment tiles,
`metrics.satisfactionPct` (`null` = no reviews) → the satisfaction tile,
`walletBalanceKobo` → `earnings.availableKobo` and
`metrics.revenue.*` → the consult-revenue fields (two different planes — the wallet
includes non-consult money), `todaysAppointments[]` → the queue rows. `patient.initials`
and `avatarColor` are derived client-side. Fields the endpoint has no data for stay
neutral (`waitingRoom`, `messages`, `alerts`, `pendingRequests[]`, `payouts`) — see the
follow-ups in the spec.
```

- [ ] **Step 3: Run every gate the lanes will run**

```bash
cd /private/tmp/spot-doctor-metrics/backend && go build ./... && go vet ./internal/doctor/... ./internal/integrations/... && echo "go ok"
cd /private/tmp/spot-doctor-metrics/backend && gofmt -l internal/doctor/ && echo "gofmt clean (nothing listed above)"
cd /private/tmp/spot-doctor-metrics/backend && go test ./internal/doctor/... -count=1 2>&1 | tail -8
cd /private/tmp/spot-doctor-metrics && python3 -c "import yaml; yaml.safe_load(open('contracts/doctor.openapi.yaml')); print('openapi parses')"
cd /private/tmp/spot-doctor-metrics && npx --yes @redocly/cli@1 lint contracts/doctor.openapi.yaml --config redocly.yaml --format=stylish; echo "redocly exit: $?"
cd /private/tmp/spot-doctor-metrics/mobile-app/reactnative && npx --max-old-space-size=4096 tsc --noEmit -p tsconfig.doctorcheck.json; echo "tsc exit: $?"
cd /private/tmp/spot-doctor-metrics/mobile-app/reactnative && npm run test:doctor-dashboard 2>&1 | tail -6
```

Then the live-DB run against the dev database, with the DSN taken from `docs/maps/CI-ON-COWORK.md` (never printed):

```bash
cd /private/tmp/spot-doctor-metrics/backend
TEST_DATABASE_URL="<local dev DSN>" go test ./internal/doctor/ -run 'TestLiveDB_Dashboard' -count=1 -v 2>&1 | tail -30
```

Expected: `go ok`, no `gofmt` output, `ok spotlight/backend/internal/doctor`, `openapi parses`, `redocly exit: 0`, `tsc exit: 0`, `# fail 0`, and **eleven** `--- PASS` lines for `TestLiveDB_Dashboard*` — the count the plan's own test blocks add up to (six from Task 1, two from Task 2, three from Task 3). Any live-DB test that SKIPped is *not* a pass — record which ones and say so. If the run prints fewer than eleven, that is a missing test, not a smaller expectation: count the `func TestLiveDB_Dashboard` definitions before concluding.

- [ ] **Step 4: Prove the wire end to end without bouncing the shared container**

The API container `new-api-1` is shared with other sessions, so rebuild nothing. Run the branch's own binary on a spare port against the same dev database and read the endpoint with a minted session, or (if that is not reachable) state plainly in the PR body that the payload is proven by the live-DB composition test and not by an HTTP capture:

```bash
cd /private/tmp/spot-doctor-metrics/backend && go build -o /tmp/spot-doctor-metrics-api . && echo "built"
```

Then diff the JSON keys against Task 4's `DashboardResponse` — `metrics.todaysCount`, `metrics.revenue.pendingKobo`, `todaysAppointments[].slotDate` and a `null`/numeric `metrics.satisfactionPct` must all appear. `curl` output may be shown; the DSN and any JWT may not.

- [ ] **Step 5: Commit the docs and push the branch**

```bash
cd /private/tmp/spot-doctor-metrics && git add mobile-app/reactnative/docs/QA_DOCTOR_BATCH1_REPORT.md mobile-app/reactnative/docs/DOCTOR_BATCH1_API_CONTRACT.md && git commit -m "docs(doctor): correct the batch-1 QA rows that were green on mock fixtures"
cd /private/tmp/spot-doctor-metrics && git log --oneline origin/main..HEAD
cd /private/tmp/spot-doctor-metrics && git -c credential.helper='!gh auth git-credential' push -u origin feat/doctor-dashboard-metrics
```

Expected: the log lists the spec, the plan, and the seven implementation commits; the push prints the new branch's remote ref (this is a feature branch — it deploys nothing).

- [ ] **Step 6: Open the PR**

```bash
cd /private/tmp/spot-doctor-metrics && gh pr create --base main --head feat/doctor-dashboard-metrics --title "fix(doctor): make the dashboard's five tiles report real bookings, money and reviews" --body "$(cat <<'EOF'
## Summary
- Today's consults, Upcoming and Today's queue read `public.appointments` (the plane bookings land in) joined through `doctors.user_id`, dated in the doctor's own `doctor_profiles.timezone` (the column the app's timezone screen writes); the old reads used `doctor_appointments`, which no code path inserts into, so every tile was a healthy-looking zero.
- `GET /doctor/dashboard` gains `metrics` (todaysCount / upcomingCount / satisfactionPct+ratingCount / revenue / timezone / today) and `todaysAppointments[]`, typed in `contracts/doctor.openapi.yaml` in place of `Generic`.
- Consult revenue is projected over `settlements`: settled rows sum `provider_kobo`, escrowed rows run through `settlement.ComputeLegs` so the pending figure is the arithmetic `Settle` actually pays by. `Available` stays the ledger wallet — two planes, labelled apart.
- `satisfactionPct` is nullable end-to-end; the tile renders `—` instead of `0%` for a doctor with no reviews.
- The mobile queue row stops crashing on an `in_person` booking and stops rendering "Invalid Date"; the tiles read the aggregate instead of a client-side status filter that also dropped completed consults from the day it was naming.

## Verification
- `go build ./...`, `go vet ./internal/doctor/... ./internal/integrations/...`, `go test ./internal/doctor/...`
- Live-DB (TEST_DATABASE_URL): **11** new `TestLiveDB_Dashboard*` cases — doctor-local day boundary (Karachi, asserted by row identity not just count), the timezone fallback for a doctor with no profile row, upcoming excluding past and finished rows, queue wire shape, count-vs-capped-list, appointments scoped to one doctor, revenue across settled/escrowed/refunded and both other-module status shapes, a poisoned timezone degrading to the default instead of failing the read, satisfaction scoped to one doctor, the brand-new doctor, and the composed payload. Every clock-sensitive expectation is placed on a row that is past or future at ANY run time.
- `redocly lint contracts/doctor.openapi.yaml` (exit 0), `tsc --noEmit -p tsconfig.doctorcheck.json`, `npm run test:doctor-dashboard` (10 cases).
- Not done: the in-browser tile pass, which needs the shared API container rebuilt and Metro restarted — say so here if it was not run.

## Test plan
- [ ] Doctor with bookings today/tomorrow → the two counts and the queue match them, in the doctor's timezone.
- [ ] Doctor with an escrowed consult → `pendingKobo` equals what settling it will pay.
- [ ] Doctor with no reviews → satisfaction reads `—`, not `0%`.
- [ ] An `in_person` booking in today's queue → row renders with the fallback icon, no crash.
- [ ] Pending consultation requests tile unchanged.

Spec: `docs/superpowers/specs/2026-11-13-doctor-dashboard-metrics-design.md`. Plan: `docs/superpowers/plans/2026-11-13-doctor-dashboard-metrics.md`.
EOF
)"
```

- [ ] **Step 7: Watch the lane this module owns**

```bash
cd /private/tmp/spot-doctor-metrics && gh pr view --json number,headRefOid,mergeStateStatus && gh pr checks --watch
```

`gh pr checks` needs `--paginate` if you enumerate runs via `gh api` instead — an unpaged check list can hide a red job. Report the actual job names and conclusions; the module lane is `Doctor CI` (`backend`, `openapi`, `mobile-typecheck`, `migration-guard` — this PR adds no migration, so `migration-guard` is a no-op pass).

---

## Follow-ups this plan deliberately does not take on

Recorded in the spec (F1–F4); each is its own change:

- **F1** — fold `ListAppointments`' SQL and `DashboardQueueAppointment`'s SQL into one const and switch the queue to `GET /appointments?scope=today&limit=20`, once the neighbour's appointment-plane branch has merged.
- **F2** — the rest of `mobile-app/reactnative/docs/QA_DOCTOR_BATCH1_REPORT.md` is still unverified against live mode; only D1/D2/D13 are corrected here, because those are the ones this change makes true.
- **F3** — `Available` is the whole `user_wallet`, so a doctor's own refunds sit inside it. Renaming the tile to "Wallet" is a product call.
- **F4** — widen `ConsultType` to the four real `consultation_type` values and give `in_person` its own icon; touches the telemedicine vertical's shared type and every consumer.
