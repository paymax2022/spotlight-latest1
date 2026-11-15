# Doctor Dashboard Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the five signed-in doctor dashboard tiles — today's consults, upcoming consults, available revenue, satisfaction %, today's queue — report the doctor's real bookings, money and reviews instead of hard-coded zeros.

**Architecture:** The two count tiles and the queue stop reading `doctor_appointments` (a table no booking path ever inserts into) and read `public.appointments` joined through `doctors.user_id` — the plane the patient app actually writes. Money stays a projection: `Available` keeps coming from the ledger wallet, and a new consult-revenue bucket is projected over `settlements`, deriving the escrowed leg with `settlement.ComputeLegs` rather than re-inventing the split. Satisfaction comes from the existing `GetReputation` read, with `null` meaning "no reviews yet". The React Native adapter, not the wire, derives presentation tokens (initials, avatar colour).

**Tech Stack:** Go 1.27.4, `pgx/v5` + `pgxpool`, gin; Postgres (Supabase) with SQL-side `AT TIME ZONE`; OpenAPI 3.0.3 contracts linted by Redocly; Expo Router + React Native + TanStack Query; `node --experimental-strip-types --test` for the client mapping.

**Spec:** [docs/superpowers/specs/2026-11-13-doctor-dashboard-metrics-design.md](../specs/2026-11-13-doctor-dashboard-metrics-design.md) — read it before starting. Decisions D1–D9 and the interface block are authoritative; this plan implements them, it does not re-decide them.

## Where the work happens

Everything is in the isolated worktree **`/private/tmp/spot-doctor-metrics`** on branch `feat/doctor-dashboard-metrics` (created from `origin/main` = `effe1b355`). Use absolute paths — the shell's cwd resets between commands.

**`origin/main` moved 21 commits during execution and the branch has not caught up yet.** The merge-base is `effe1b355` (2026-11-12, PR #998); main head is `531df7af9` (PR #1008, squash-merged 2026-11-14T22:16:36Z — which is why ancestry must be tested on `mergeCommit`, not `headRefOid`; `638de0d4c` is not an ancestor of main). Twenty PRs landed between them, and two of them change what this plan says: #1008 fixed the same defect class one plane over (`GET /appointments` now reads `public.appointments`) and built the client-side mapping plane Task 5 now builds on, while #1020 moved veterinary onboarding out of the Doctor app. **Task 3 Step 0 rebases this branch onto `origin/main` before any new work**, because Tasks 4/5/7 edit files those commits touched, and every line number below marked post-#1008 is measured against `531df7af9`, not `effe1b355`. Rebasing here rather than at Task 8 keeps the drift in one commit instead of leaking into five executors who each have to rediscover it.

The rebase is provably conflict-free before it runs: the branch's only non-doc changes are `backend/internal/doctor/dashboard_metrics.go`, `dashboard_metrics_test.go` and `dashboard_metrics_live_db_test.go` (all created here, all `metrics*`-prefixed), and none of the three appears in the 142 files main changed. Step 0 re-runs that check rather than trusting it.

This repo is driven by several sessions at once. `/Users/paymax/Documents/spotlight/main` is a **different, dirty working tree** holding other sessions' in-flight work: never `cd` there to edit, never `git stash`, never move `main`'s ref, and never read its dirty files as evidence of what `origin/main` contains. The three files that used to be that neighbour's untracked work — `appointments_plane_live_db_test.go`, `handler_avatar_test.go`, `mdcn_discoverability_live_db_test.go` — are now committed on main via #1008, so the `metrics*`-prefixed helper names in this plan are no longer a collision dodge; they stay because they describe what the helpers do. The client module is still `dashboardWire.ts`, not `mapping.ts`: `src/features/doctor/mapping.ts` exists now and belongs to #1008 (223 lines plus three test files), and this plan's payload is dashboard-only — see Task 5, which reuses that module's mapper rather than extending it.

The worktree has **no `node_modules`** under `mobile-app/reactnative` (untracked, so not copied). Task 5 symlinks the main checkout's install for typechecking only.

## Global Constraints

- Go 1.27.4 (`backend/go.mod`), module path `spotlight/backend`. No new third-party dependency anywhere in this plan.
- Money is `int64` kobo across the wire. Never a float, never naira.
- `satisfactionPct` is nullable end-to-end (spec D6): `*float64` in Go, `number | null` in TS, `—` in the tile. `null` means "no reviews", `0` means "reviewed and hated".
- Date logic lives in SQL as `AT TIME ZONE $tz::text` (spec D3). No `time/tzdata` import, no `time.LoadLocation` anywhere — the container has no zone database and Go-side tz would be a silent 500.
- The doctor module reads money; it never posts to the ledger and never moves money. `settlement.ComputeLegs` is used as a pure function only.
- Scope fence (spec D1): do not touch `ListAppointments`, `GET /appointments`, appointment-requests, accept/reject, or `doctor.Appointment.SlotDate`'s type. #1008 owns that plane and already fixed it — `repository.go:220-221` now renders appointment slots with `AT TIME ZONE COALESCE(av.timezone, 'Africa/Lagos')`, which is exactly why Task 5's mapper delegates to #1008's `mapAppointmentWire` instead of re-deriving the row.
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
// anchored to Lagos). `GET /schedule` is not a read-back of this column: none of
// ScheduleSettings' top-level fields carries a zone, and the one zone that
// response does expose is the nested `schedule.timezone` — `doctor_availability`'s
// column, not this one. Since #1008 that is not hypothetical: ScheduleSettings'
// `Schedule Availability` field is typed `Availability`, whose `Timezone`
// (model.go:76) is that column, and the appointments plane renders slots with
// `AT TIME ZONE COALESCE(av.timezone, …)` (repository.go:220). So the same
// doctor's dashboard and appointment list can price "today" against two different
// columns — spec F5 documents the screen that fails to write this one. A doctor
// with no profile row at all is the default, not an error.
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
than waiving the finding. Replace the `defaultDoctorTimezone` comment (`dashboard_metrics.go:32-35`)
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
// TestLiveDB_DashboardConsultRevenue re-checks it against a settled and an escrowed
// row written the way the money path leaves them.
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
	// nothing notices. Settled forty days back — deliberately not AddDate(0,-1,0),
	// which Go normalises: on the 29th to 31st of a month whose predecessor is
	// shorter it lands in the CURRENT month (2027-03-29 becomes 2027-03-01), and on
	// those eight days a year this row stops being last month's, ThisMonthKobo
	// rises to LifetimeKobo, and the suite goes red for a reason that is nothing to
	// do with the product. Forty days always crosses at least one month boundary,
	// since no month is longer than 31. With a provider_kobo of 90000 where the
	// projection for its own total would be 76500, it is counted by LifetimeKobo and
	// excluded by ThisMonthKobo. Its escrowed_at is the column default now() (NOT
	// NULL DEFAULT now(), verified live), which is what turns a `settled_at` →
	// `escrowed_at` swap in the FILTER into a wrong number rather than a different
	// way of saying the same thing.
	prevMonthID, _ := f.bookLocal(t, tz, "completed", -40, 10*60)
	f.escrow(t, prevMonthID, "settled", 90000, 90000, 0,
		time.Now().UTC().AddDate(0, 0, -40), "telemedicine")

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
	// count once the zone resolves. bookLocal returns (id, ref) and t.Fatalf's on a
	// failed insert itself, so there is no error to check here.
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
}
```

- [ ] **Step 6: Run it**

```bash
cd /private/tmp/spot-doctor-metrics/backend && go test ./internal/doctor/ -run 'TestLiveDB_DashboardConsultRevenue|TestLiveDB_DashboardTimezonePoisonedZoneDegrades' -count=1 -v 2>&1 | tail -24
```

Expected: PASS for both with the DSN set (SKIP and a recorded "not actually run" without it). Before writing the guard, run this same command against the code as committed and record the red: `dashboardTimezone` returns the poisoned string and `dashboardAggregates` fails with `time zone "Mars/Olympus_Mons" not recognized` — that is the failure this test exists to prevent, and a test that was never seen red is not evidence.

- [ ] **Step 7: Prove the three money filters bite — by mutation, not by reading**

The assertions above can all be green while a predicate is dead weight. Delete each predicate in turn, run the focused test, and record what goes red; then restore and re-run. The three below are the ones a one-line `sed` can do; the `FILTER`, the column swap and the projection substitution need multi-line edits and are transcribed in the next paragraph, because their routes to a red are not obvious. Write the transcript to `/private/tmp/spot-doctor-metrics/.superpowers/sdd/2026-11-13-doctor-dashboard-metrics/task-2-mutation.md` — one entry per mutation with the grep line proving the edit landed, the first failing assertion, and its number; round 2 appended its seven-mutation set to `task-2-mutation2.md`, and Task 8 posts both. This step ends with the file restored byte-for-byte and the test green again; a mutation left in the tree is a bug, not evidence.

```bash
cd /private/tmp/spot-doctor-metrics/backend
M=internal/doctor/dashboard_metrics.go
cp "$M" /tmp/task2-dashboard_metrics.orig.go
restore() { cp /tmp/task2-dashboard_metrics.orig.go "$M"; }
T() { TEST_DATABASE_URL="$DSN" RAILS_MODE=fake go test ./internal/doctor/ -run 'TestLiveDB_DashboardConsultRevenue' -count=1 2>&1 | tail -15; }
# One grep serves as the mutation log for all three blocks: it prints exactly the two settlement WHERE
# clauses, so the line that changed is visible in the transcript rather than assumed.
P() { grep -n 'WHERE d.user_id = \$1 AND st\.' "$M"; }

# (a) settledQ loses its module filter: the restaurant settled row's 320000 must leak into LifetimeKobo.
sed -i '' "s/AND st.module_type = 'telemedicine' AND st.status = 'settled'/AND st.status = 'settled'/" "$M"
P; T
restore

# (b) settledQ loses its status filter: the escrowed row's adversarial provider_kobo 168301 must leak in.
sed -i '' "s/AND st.module_type = 'telemedicine' AND st.status = 'settled'/AND st.module_type = 'telemedicine'/" "$M"
P; T
restore

# (c) escrowedQ loses its module filter: the restaurant escrowed row's 400000 total must change PendingKobo.
sed -i '' "s/AND st.module_type = 'telemedicine' AND st.status = 'escrowed'/AND st.status = 'escrowed'/" "$M"
P; T
restore

# Restored byte-for-byte, and green. The sha is the stronger proof: diff says the
# two files agree, sha256 says so with a number that belongs in the transcript.
shasum -a 256 "$M" /tmp/task2-dashboard_metrics.orig.go
diff /tmp/task2-dashboard_metrics.orig.go "$M" && echo "restored byte-for-byte"
rm -f /tmp/task2-dashboard_metrics.orig.go
T
```

Expected: **three reds and one green.** The `P` line in each block is part of the evidence, not decoration — a `sed` pattern that no longer matches leaves the file untouched and the test green, which would read as "this predicate is unprotected" when the real cause is a mutation that never happened; `P` prints both settlement WHERE clauses, so a red is only creditable when the line it names has visibly changed. Numbers, as observed when this step was actually run (round 2, with the prev-month row and the one-kobo digits in place): (a) `LifetimeKobo = 580001` **and** `ThisMonthKobo = 490001`, because the restaurant settled row lands in the current month too; (b) `LifetimeKobo = 428302`, with `ThisMonthKobo` holding at 170001; (c) `PendingKobo = 508300` (168300 projected for the telemedicine row + 85% of the restaurant row's 400000 — note the summand is the *projection*, so this number does not move when the stored 168301 does). Any mutation that stays green despite `P` showing the deletion is a real finding — the fixture does not protect that predicate — and the fix is a fixture row that does, not a waiver.

Two more mutations belong in this transcript because the prev-month row made them meaningful, and both were run in round 2 (their exact edits are in `task-2-mutation2.md`, since deleting a multi-line `FILTER` is not a one-line `sed`): **(d)** delete the `FILTER` around the month sum but leave the `$2` timezone bind in the `QueryRow` call, and the read dies before any assertion — pgx reports `expected 1 arguments, got 2`. That is a red, and it is *not* the evidence wanted here: it proves the bind became unreferenced, not that the month figure is wrong. **(e)** delete the `FILTER` *and* drop the now-unreferenced `$2` bind, and `ThisMonthKobo` reads 260001 — exactly `LifetimeKobo`, which is the whole point of the row settled forty days back. **(f)** swap `st.settled_at` for `st.escrowed_at` inside the `FILTER` and land on the same 260001, because every row this helper writes carries `escrowed_at DEFAULT now()` — including the one settled last month. Both (e) and (f) are caught by the inequality assertion, which is why that assertion exists and why it says which of the two it names. **(g)** replace the escrowed read's `ComputeLegs` projection with a plain `SUM(st.provider_kobo)` — the most plausible "simplification" of all — and `PendingKobo` reads 168301 against the test's own want of 168300. That single kobo on the escrowed row is what makes it red; without it the symmetric refactor would report 0 for every real escrowed consult and stay green.

Do **not** reach for `git status` as this step's cleanliness proof: Step 7 runs while the guard is still uncommitted work-in-progress, so the file legitimately differs from `HEAD` and a report that claims a clean status here is claiming something that cannot be true. Byte-identity against the backup is what this step can prove; the tree-as-committed proof belongs to Step 8, after the commit exists.

- [ ] **Step 8: Commit**

```bash
cd /private/tmp/spot-doctor-metrics/backend && go build ./... && go vet ./internal/doctor/... && gofmt -l internal/doctor/
cd /private/tmp/spot-doctor-metrics && git add backend/internal/doctor/dashboard_metrics.go backend/internal/doctor/dashboard_metrics_test.go backend/internal/doctor/dashboard_metrics_live_db_test.go && git commit -m "$(cat <<'EOF'
feat(doctor): project consult revenue over settlements for the earnings tile

Pending money is derived with settlement.ComputeLegs rather than a re-typed 0.85
so the dashboard figure is the arithmetic Settle itself pays by. Settled money
sums provider_kobo, which Settle writes in the same tx that moves the balance.

The dashboard now interpolates doctor_profiles.timezone into AT TIME ZONE, which
makes a poisoned value fatal where it used to be inert, so the read probes the
zone once and degrades to the default on SQLSTATE 22023 rather than 500ing.
EOF
)"
cd /private/tmp/spot-doctor-metrics && git status --short -- backend/internal/doctor/
```

Expected: the last command prints **nothing** — that is the tree-as-committed proof Step 7 could not honestly claim, and it is only meaningful now that the guard is in `HEAD`. Record it in the report.

---

### Task 3: Compose it into `GET /dashboard`

**Files:**
- Modify: `backend/internal/doctor/service_tail2.go:143-165` (`GetDashboard`)
- Modify: `backend/internal/doctor/handler_tail2.go:480-488` (`DashboardSummary` — doc comment **and** struct; the comment is inside the range because it asserts "no new table", which this task makes false)
- Modify: `backend/internal/doctor/dashboard_metrics_live_db_test.go` (append)

**Interfaces:**
- Consumes: everything from Tasks 1-2; `s.repo.GetReputation` ([backend/internal/doctor/repository_account_tail.go:394](../../backend/internal/doctor/repository_account_tail.go#L394)); `s.ledger.GetBalance`.
- Produces: `GET /doctor/dashboard` now answers
  `{appointmentCounts, unreadNotifications, walletBalanceKobo, currency, metrics:{todaysCount,upcomingCount,satisfactionPct,ratingCount,revenue:{pendingKobo,lifetimeKobo,thisMonthKobo,consultsThisMonth},timezone,today},todaysAppointments:[…]}`.
  Task 4 documents this and Task 5 consumes it.

- [ ] **Step 0: Rebase onto `origin/main` before touching anything**

Do this first, and only once Task 2's fix round has committed — rebasing under a running implementer moves the files out from under it.

```bash
cd /private/tmp/spot-doctor-metrics && git status --porcelain | head -20; echo "dirty count: $(git status --porcelain | wc -l)"
```

Expected: a dirty count of `0`. If anything is modified, it is unfinished work — commit it or stop and report it; never `git stash` here and never `git checkout --` a file another round may still own.

```bash
cd /private/tmp/spot-doctor-metrics && echo "own commits before: $(git rev-list --count $(git merge-base origin/main HEAD)..HEAD)" && git fetch origin main && git rebase origin/main && git log --oneline -1 && echo "own commits after: $(git rev-list --count origin/main..HEAD)"
```

Expected: rebase exits 0 with no conflict output, and **the two counts are the same number** — that equality is the proof, so do not write an expected value from memory. A count that grows means the rebase duplicated commits; a count that shrinks means it dropped one. Either way stop and report rather than pushing. If a conflict does appear, resolve it by reading both sides; never `--skip` and never drop a commit to get past it. If `origin/main` moved again since, re-run Step 0's check and re-measure the post-#1008 line numbers before continuing.

Then prove the branch still builds and its own tests still pass against main's code, before any new line is written:

```bash
cd /private/tmp/spot-doctor-metrics/backend && go build ./... && go vet ./internal/doctor/ && go test ./internal/doctor/ -run 'TestConsultSplit|TestDashboardSatisfactionPct' -count 1 2>&1 | tail -5
```

Expected: build and vet silent, `ok spotlight/backend/internal/doctor`. A failure here is main's drift meeting our reads, not a Task 3 bug — report it rather than coding around it.

- [ ] **Step 0b: Bring `dashboardTimezone`'s comment in line with #1008**

Task 2 wrote, in `dashboard_metrics.go`, that `GET /schedule` is not a read-back of `doctor_profiles.timezone` because `ScheduleSettings` carries no zone. Post-#1008 that sentence is half true and misleading: the struct gained `Schedule Availability`, which is typed `Availability` and therefore carries `Availability.Timezone` (`model.go:76`) — so the response does expose a zone, just the other column's. Name the field and the type rather than a line number: `ScheduleSettings` grows with every comment above it, so a numeric cite here rots inside the same round. Replace the sentence with the Step-4 text below, which is what the rebase makes true. Nothing in the read changes; this is a comment-only commit, staged alone.

```go
// doctor who chose Asia/Karachi would otherwise have every "today" predicate
// anchored to Lagos). `GET /schedule` is not a read-back of this column: none of
// ScheduleSettings' top-level fields carries a zone, and the one zone that
// response does expose is the nested `schedule.timezone` — `doctor_availability`'s
// column, not this one. Since #1008 that is not hypothetical: ScheduleSettings'
// `Schedule Availability` field is typed `Availability`, whose `Timezone`
// (model.go:76) is that column, and the appointments plane renders slots with
// `AT TIME ZONE COALESCE(av.timezone, …)` (repository.go:220). So the same
// doctor's dashboard and appointment list can price "today" against two different
// columns — spec F5 documents the screen that fails to write this one. A doctor
// with no profile row at all is the default, not an error.
```

```bash
cd /private/tmp/spot-doctor-metrics/backend && go build ./... && cd /private/tmp/spot-doctor-metrics && git add backend/internal/doctor/dashboard_metrics.go && git commit -m "$(cat <<'MSG'
docs(doctor): say which zone GET /schedule really exposes now #1008 is in

The timezone comment claimed ScheduleSettings carried no zone at all. It still
carries none at the top level, but #1008 nested the availability row inside it,
so the response does reach doctor_availability.timezone — which is the second
column, and the reason the dashboard and the appointment list can disagree about
today. The comment now says that, and points at spec F5 for the screen that never
writes either column on demand.
MSG
)"
```

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
	// The settled row stores 170001, never 170000, because 170000 IS FLOOR(0.85 ×
	// 200000): with the split's own answer in the column, a stored figure and a
	// re-derived figure are the same number and this test could not tell
	// SUM(provider_kobo) from settledQ re-typing the 85% in SQL.
	f.bookLocal(t, tz, "completed", 0, 9*60)
	f.bookLocal(t, tz, "completed", 0, 14*60)
	f.bookLocal(t, tz, "booked", 2, 9*60)
	settledID, _ := f.bookLocal(t, tz, "completed", -1, 9*60)
	f.escrow(t, settledID, "settled", 200000, 170001, 0, time.Now().UTC(), "telemedicine")
	// provider_kobo = 0 because nothing has been paid on this row yet, which is
	// exactly what the escrowed leg projects instead of summing a stored column.
	escrowedID, _ := f.bookLocal(t, tz, "completed", -2, 9*60)
	f.escrow(t, escrowedID, "escrowed", 200000, 0, 2000, time.Time{}, "telemedicine")
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
	// Task 5 renders the day header from Metrics.Today, so the composition must carry
	// the aggregate's local day — not "" and not a UTC day. The queue's own SlotDate
	// is the same value produced by the same read, so equality pins both.
	if !isoDay.MatchString(res.Metrics.Today) {
		t.Errorf("Metrics.Today = %q, want YYYY-MM-DD", res.Metrics.Today)
	}
	if len(res.TodaysAppointments) > 0 && res.TodaysAppointments[0].SlotDate != res.Metrics.Today {
		t.Errorf("queue SlotDate = %q but Metrics.Today = %q — one day, two answers",
			res.TodaysAppointments[0].SlotDate, res.Metrics.Today)
	}
	if res.Metrics.Revenue.LifetimeKobo != 170001 {
		t.Errorf("Revenue.LifetimeKobo = %d, want 170001", res.Metrics.Revenue.LifetimeKobo)
	}
	wantPending, err := pendingConsultKobo(200000, 2000)
	if err != nil {
		t.Fatalf("expected pending: %v", err)
	}
	if res.Metrics.Revenue.PendingKobo != wantPending {
		t.Errorf("Revenue.PendingKobo = %d, want %d (ComputeLegs for the same row)",
			res.Metrics.Revenue.PendingKobo, wantPending)
	}
	// Deterministic, unlike Task 2's fixture: this test's only settled row settles
	// at now(), so it is always inside the current calendar month in the doctor's
	// zone. Here ThisMonthKobo == LifetimeKobo is the EXPECTED result, not the FILTER
	// failing — Task 2's …ConsultRevenue owns the prev-month exclusion, and its row
	// settled forty days back is what proves that.
	if res.Metrics.Revenue.ThisMonthKobo != 170001 {
		t.Errorf("Revenue.ThisMonthKobo = %d, want 170001", res.Metrics.Revenue.ThisMonthKobo)
	}
	if res.Metrics.Revenue.ConsultsThisMonth < 2 {
		t.Errorf("Revenue.ConsultsThisMonth = %d, want at least 2 (today's two completed rows)",
			res.Metrics.Revenue.ConsultsThisMonth)
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
	if !strings.Contains(string(raw), `"todaysCount":2,`) {
		t.Errorf("payload missing todaysCount: %s", raw)
	}
	// The no-reviews case ships JSON null, not 0 — the client renders '—' from it.
	bare := newMetricsFixture(t, pool)
	braw, err := json.Marshal(mustDashboard(t, ctx, pool, bare.doctorUser))
	if err != nil {
		t.Fatalf("marshal bare: %v", err)
	}
	if !strings.Contains(string(braw), `"satisfactionPct":null,`) {
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

// Spec D2a has to survive the composition, not only the repository call: 21 rows
// today means the tile says 21 and the list shows 20. Task 1 proved this at
// dashboardAggregates/todayQueue directly; this is the version that fails if
// GetDashboard derives the count from the capped slice it just built.
func TestLiveDB_DashboardComposedCountOutrunsTheCappedQueue(t *testing.T) {
	pool := metricsDB(t)
	f := newMetricsFixture(t, pool)
	tz := defaultDoctorTimezone
	for i := 0; i < dashboardQueueLimit+1; i++ {
		f.bookLocal(t, tz, "completed", 0, 8*60+i)
	}
	res, err := metricsService(pool).GetDashboard(context.Background(), f.doctorUser)
	if err != nil {
		t.Fatalf("GetDashboard: %v", err)
	}
	if res.Metrics.TodaysCount != dashboardQueueLimit+1 {
		t.Errorf("TodaysCount = %d, want %d", res.Metrics.TodaysCount, dashboardQueueLimit+1)
	}
	if len(res.TodaysAppointments) != dashboardQueueLimit {
		t.Errorf("queue rows = %d, want %d", len(res.TodaysAppointments), dashboardQueueLimit)
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

In `backend/internal/doctor/handler_tail2.go`, replace **lines :480-488 — the existing doc comment together with the struct** — with the block below. The comment lines :480-482 are part of the range on purpose: they tell the next reader that this projection is "composed entirely from existing scoped reads + the ledger balance — no new table", and the field list this task adds makes that sentence false. Replacing only :483-488 would leave the old comment stacked on top of the new one, and `go doc` renders both, so the PR would ship the claim it exists to retire.

```go
// DashboardSummary is the composite landing projection for GET /dashboard. Money
// is int64 kobo and every field is scoped to the signed-in doctor.
//
// AppointmentCounts is the booking-plane status map (appointmentStatusCounts,
// with 'booked' renamed 'pending'), kept because pendingRequests renders it.
// The two appointment TILES read Metrics instead: doctor_appointments, which
// this response used to count, has no insert path at all — see
// dashboard_metrics.go.
//
// Metrics is the projection this endpoint used to fake: the five tiles read the
// booking plane (appointments), the money plane (settlements, ledger) and
// doctor_reviews. Those are new tables for this response, which is why the reads
// live in dashboard_metrics.go rather than in here.
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
// doctor_appointments, and the consult-revenue projection over settlements.
// This endpoint therefore reads tables it did not read before; what it does not
// do is write to any of them, or post to the ledger.
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
		return nil, fmt.Errorf("doctor: project dashboard consult revenue: %w", err)
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
cd /private/tmp/spot-doctor-metrics && git add backend/internal/doctor/service_tail2.go backend/internal/doctor/handler_tail2.go backend/internal/doctor/dashboard_metrics_live_db_test.go && git commit -m "$(cat <<'MSG'
feat(doctor): ship metrics and today's queue on GET /dashboard

The five tiles now have one payload source. satisfactionPct is *float64 so 'no
reviews yet' survives the wire instead of arriving as 0%.
MSG
)"
```

---

### Task 4: Type the dashboard response in the contract

`Shipped in `a03ed2f27`, tightened in `6a58b8be4`, prose corrected in `dce246b53`. On `origin/main` this path answered `{ $ref: Generic }` — which is *why* the client could cast the flat wire straight into its rich view model and invent fields. Typing it is the guard against a repeat, and Step 4 is the proof the guard actually rejects the drift.

**Files:**
- Modify: `contracts/doctor.openapi.yaml` (four new component schemas; the `/doctor/dashboard` response `$ref`)

**Interfaces:**
- Consumes: the Task 3 payload.
- Produces: `DashboardResponse`, `DashboardMetrics`, `DashboardRevenue`, `DashboardQueueAppointment` component schemas. No code reads these — the lane that matters is Redocly lint plus the doctor lane's YAML parse.

- [ ] **Step 1: Add the component schemas**

In `contracts/doctor.openapi.yaml`, insert immediately after the `PatientSummary` schema block (which ends at the `gender:` line) and before the `# ── MVP: profile & verification ──` divider — locate it with `grep -n "^    PatientSummary:" contracts/doctor.openapi.yaml`, not by number: Step 2 edits the same file further down, and your own insert moves every line below it.

Two of the four schemas below are deliberately narrower or wider than they look, and both choices are load-bearing, so read them before "tidying" them:

- `DashboardQueueAppointment.patient` is an **inline four-field object, not `$ref: PatientSummary`**. `DashboardQueuePatient` (`dashboard_metrics.go:64-69`) emits `id`, `name`, `age`, `gender` and nothing else, while `PatientSummary` also declares `initials` and `avatarColor` — which this response never sends, because Task 5 derives them client-side. Embedding the shared shape would promise two fields the server does not write, which is the same class of defect this whole PR exists to close.
- `status` enumerates exactly the three values `todayQueue` can produce, and `in_progress` is not one of them: `appointments_status_check` allows `booked|confirmed|completed|cancelled` (`supabase/migrations/20260616280000_telemedicine.sql:27-28`, and `pg_get_constraintdef` on the dev DB says the same today), the read drops `cancelled` and renames `booked` → `upcoming`. Naming the absent value in the description keeps the claim falsifiable instead of aspirational.
- `consultType` is **not** an enum on purpose. The column carries `video|audio|chat|in_person` (`20260618040000_telemedicine_clinical.sql:10`) and the read passes it through verbatim; spec F4 tracks widening the client's icon map. An enum here would turn a booking the app cannot draw into a contract-validation failure instead of a fallback icon.
- Every one of the five objects declares **`required` with its full key list plus `additionalProperties: false`**, which is the first time this file does that on a *response* — its existing convention puts `required` on request bodies only. It is deliberate, and it is the difference between a typed contract and a decorative one: without it, a schema that validates `{}` accepts a payload with `todaysCount` renamed to `todayCount`, `ratingCount` missing, and an invented top-level field, which is exactly the drift class this task exists to prevent. The claim is safe to make because the Go structs carry no `omitempty` anywhere on these fields (so every key is always present, `satisfactionPct` included, as `null` when there are no reviews) and the queue read initialises an empty slice rather than a nil one. `appointmentCounts` keeps `additionalProperties: { type: integer }` and no key list — it is a map built by `GROUP BY`, so which keys appear depends on the doctor's data, and OpenAPI 3.0 cannot enumerate a map's keys without misstating the zero case.

```yaml
    # ── dashboard tiles ──────────────────────────────────────────────────────────
    DashboardRevenue:
      type: object
      required: [pendingKobo, lifetimeKobo, thisMonthKobo, consultsThisMonth]
      additionalProperties: false
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
        consultsThisMonth: { type: integer, description: 'Completed consults whose scheduled_at falls in the doctor''s current local month. Comes from the same read as todaysCount, not from the money query.' }
    DashboardMetrics:
      type: object
      required: [todaysCount, upcomingCount, satisfactionPct, ratingCount, revenue, timezone, today]
      additionalProperties: false
      description: >-
        The landing tiles. Every count is scoped to this doctor and every date is
        evaluated in the doctor's own timezone (doctor_profiles.timezone, the column
        `PUT /schedule/timezone` writes, or Africa/Lagos when the stored value is not
        a zone Postgres accepts). Counts and the queue both come from
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
        timezone: { type: string, description: 'The zone the counts and slot strings are computed in — anything Postgres accepts as a zone: an IANA name or a fixed offset such as -05. An unrecognised stored value is rejected by the read, so this field is never the junk that was stored.' }
        today:    { type: string, description: 'The doctor''s local day, YYYY-MM-DD — the date the queue was listed for.' }
    DashboardQueueAppointment:
      type: object
      required: [id, ref, patient, consultType, status, slotDate, slotTime, feeKobo, reason, isHmo, createdAt]
      additionalProperties: false
      description: >-
        One row of today's queue. slotDate is a calendar day and slotTime is
        doctor-local wall clock, so the row renders without a client-side timezone.
        initials/avatarColor are presentation and derived by the client, not here.
      properties:
        id:          { type: string }
        ref:         { type: string }
        patient:
          type: object
          required: [id, name, age, gender]
          additionalProperties: false
          description: The four stored fields this read selects. Avatar colour and initials are not here — the client derives them.
          properties:
            id:     { type: string }
            name:   { type: string }
            age:    { type: integer }
            gender: { type: string, enum: [male, female, other], description: 'Normalised in SQL: anything that is not male or female, case-insensitively, arrives as other.' }
        consultType: { type: string, description: 'The stored consultation_type verbatim: video, audio, chat or in_person.' }
        status:      { type: string, enum: [upcoming, confirmed, completed], description: '''booked'' is renamed ''upcoming'' and cancelled rows are never listed. No in_progress: appointments_status_check has no such status.' }
        slotDate:    { type: string, description: 'YYYY-MM-DD in the doctor''s timezone.' }
        slotTime:    { type: string, description: 'HH:MM AM/PM in the doctor''s timezone.' }
        feeKobo:     { $ref: '#/components/schemas/Money' }
        reason:      { type: string }
        isHmo:       { type: boolean, description: 'Always false: public.appointments records no HMO coverage.' }
        createdAt:   { type: string, format: date-time }
    DashboardResponse:
      type: object
      required: [appointmentCounts, unreadNotifications, walletBalanceKobo, currency, metrics, todaysAppointments]
      additionalProperties: false
      description: GET /doctor/dashboard — the flat batch-1 projection plus the tile metrics and today's queue.
      properties:
        appointmentCounts:
          type: object
          additionalProperties: { type: integer }
          description: >-
            Booking-plane status counts (appointmentStatusCounts over
            public.appointments, with 'booked' reported as 'pending' because that is
            the key the client's pendingRequests tile already reads). This field used
            to count doctor_appointments, which no booking path ever writes.
        unreadNotifications: { type: integer }
        walletBalanceKobo:   { $ref: '#/components/schemas/Money' }
        currency:            { type: string, enum: [NGN], description: 'Literal NGN on this endpoint; every kobo field is its minor unit.' }
        metrics:             { $ref: '#/components/schemas/DashboardMetrics' }
        todaysAppointments:
          type: array
          maxItems: 20
          description: 'Today''s rows ascending by slot, capped at the list limit. metrics.todaysCount is NOT capped, so the number can exceed this array. Always present: the read initialises an empty slice, never nil.'
          items: { $ref: '#/components/schemas/DashboardQueueAppointment' }
```

- [ ] **Step 2: Point the path at the new schema**

On `origin/main` the `/doctor/dashboard:` key is line 1248 and the `get:` line under it is 1249 ([contracts/doctor.openapi.yaml:1248-1249](../../contracts/doctor.openapi.yaml#L1248)), but Step 1 has already inserted lines above it, so locate it by text rather than number: `grep -n "^  /doctor/dashboard:" contracts/doctor.openapi.yaml`. Replace that key and its single-line `get:` (currently `$ref`s `Generic`) with:

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

Expected: `redocly exit: 0` **with exactly `You have 920 warnings.`** — that is the count this file carried before Task 4 and it carries after both commits, so a different number means the new block introduced a problem rather than a warning. Warnings are acceptable (the file already carries them for missing `operationId`s); an error is not. Capture the exit code unpiped — zsh has no `PIPESTATUS`, and piping lint output straight to `tail` hides it. Assert too that no warning names a `Dashboard*` schema: `grep -ci dashboard` on the saved output must print `0`.

- [ ] **Step 4: Prove the schema bites — the drift harness**

A guard nobody tested is a decoration, and "it lints" is not evidence that it *rejects*
anything: this block was shipped once with `required` and `additionalProperties` missing, and
Redocly lint passed it at exit 0 with all 920 warnings, exactly as it passes the tightened
block. So run the payload matrix twice — once against the schema before your fix and once
after — and keep both outputs. The before-run is the negative control: if the drifted payloads
validate *after* the fix, or fail to validate *before* it, the harness is broken and the fix is
unproven.

Three traps are already paid for: `ajv-cli@5` takes `-s`/`-d` and rejects `--schema`; draft-07
does not know the `int64` format, so the `format` keys have to be stripped or ajv refuses to
compile the mirror; and OpenAPI's `nullable: true` must become `type: [T, 'null']` or the honest
payload fails for the wrong reason. The `renamed-key` case drops the old key rather than setting
it to `null` — a null violates `type: integer` even in a toothless schema, so the negative
control would pass for a reason that has nothing to do with the guard under test.

```python
import json, subprocess, sys, yaml

SRC = sys.argv[1]           # a contracts/doctor.openapi.yaml to read
TAG = sys.argv[2]           # 'before' or 'after', used in the filenames
doc = yaml.safe_load(open(SRC))
sch = doc['components']['schemas']

def conv(n):
    if isinstance(n, dict):
        d = {}
        for k, v in n.items():
            if k == '$ref':
                d[k] = v.replace('#/components/schemas/', '#/definitions/')
            elif k == 'format':
                continue
            elif k == 'nullable':
                continue
            else:
                d[k] = conv(v)
        if n.get('nullable') is True:
            d['type'] = [d.get('type', 'string'), 'null']
        return d
    if isinstance(n, list):
        return [conv(x) for x in n]
    return n

defs = {'Money': {'type': 'integer'}}
for name in ('DashboardRevenue', 'DashboardMetrics', 'DashboardQueueAppointment',
             'DashboardResponse'):
    defs[name] = conv(sch[name])
mirror = {'$schema': 'http://json-schema.org/draft-07/schema#',
          'definitions': defs, '$ref': '#/definitions/DashboardResponse'}
sp = f'/tmp/t4-{TAG}-schema.json'
open(sp, 'w').write(json.dumps(mirror))

row = {'id': 'a', 'ref': 'TM-1',
       'patient': {'id': 'p', 'name': 'n', 'age': 1, 'gender': 'male'},
       'consultType': 'video', 'status': 'upcoming', 'slotDate': '2026-11-15',
       'slotTime': '09:00 AM', 'feeKobo': 0, 'reason': '', 'isHmo': False,
       'createdAt': '2026-11-15T08:00:00Z'}
good = {'appointmentCounts': {'pending': 1}, 'unreadNotifications': 0,
        'walletBalanceKobo': 0, 'currency': 'NGN',
        'metrics': {'todaysCount': 0, 'upcomingCount': 0, 'satisfactionPct': None,
                    'ratingCount': 0,
                    'revenue': {'pendingKobo': 0, 'lifetimeKobo': 0, 'thisMonthKobo': 0,
                                'consultsThisMonth': 0},
                    'timezone': 'Africa/Lagos', 'today': '2026-11-15'},
        'todaysAppointments': []}
cases = [('good', good, True),
         ('empty-object', {}, False),
         # A rename drops the old key; leaving it as null would fail `type: integer` even in
         # the toothless before-schema, so the negative control would pass for the wrong reason.
         ('renamed-key', {**good, 'metrics': dict(
                              (k, v) for k, v in good['metrics'].items() if k != 'todaysCount'
                          ) | {'todayCount': 0}}, False),
         ('dropped-key', {**good, 'metrics': {k: v for k, v in good['metrics'].items()
                                              if k != 'ratingCount'}}, False),
         ('invented-top-level', {**good, 'someNewThing': 1}, False),
         ('currency-changed', {**good, 'currency': 'NGA'}, False),
         ('queue-too-long', {**good, 'todaysAppointments': [dict(row) for _ in range(21)]},
          False)]
# In the before-run the point is that the shipped schema accepts the drift, so every case
# is expected VALID there; the after-run expects the drift rejected.
baseline = (TAG == 'before')
bad = 0
for name, payload, want_valid in cases:
    expect = True if baseline else want_valid
    dp = f'/tmp/t4-{TAG}-{name}.json'
    open(dp, 'w').write(json.dumps(payload))
    r = subprocess.run(['npx', '--yes', 'ajv-cli@5', 'validate', '-s', sp, '-d', dp],
                       capture_output=True, text=True)
    valid = (r.returncode == 0)
    ok = (valid == expect)
    bad += (not ok)
    print(f'{name:20s} {"VALID  " if valid else "INVALID"} expected '
          f'{"valid" if expect else "invalid"} {"ok" if ok else "MISMATCH"}')
print(f'{TAG}: {bad} harness mismatches')
sys.exit(1 if bad else 0)
```

```bash
cd /private/tmp/spot-doctor-metrics
git show a03ed2f27:contracts/doctor.openapi.yaml > /tmp/t4-before.yaml   # the toothless schema
python3 /tmp/t4-drift.py /tmp/t4-before.yaml before
python3 /tmp/t4-drift.py contracts/doctor.openapi.yaml after
```

Observed for this task — before against `a03ed2f27` (no `required`, no
`additionalProperties: false`, no `maxItems`), after against the tightened block:

```text
before: all seven payloads VALID (the six drifted ones included) -> before: 0 harness mismatches
after:  good VALID; empty-object, renamed-key, dropped-key, invented-top-level,
        currency-changed and queue-too-long all INVALID          -> after: 0 harness mismatches
```

Those six `VALID` lines are the finding: the typed contract accepted an empty body, a renamed
`todaysCount`, a dropped `ratingCount`, an invented top-level field, a wrong currency code and a
21-row queue. A `MISMATCH` line in either arm means fix the harness, not the expectation.

- [ ] **Step 5: Commit**

```bash
cd /private/tmp/spot-doctor-metrics && git add contracts/doctor.openapi.yaml && git commit -m "$(cat <<'MSG'
docs(contract): type GET /doctor/dashboard instead of answering Generic

The untyped response is what let the mobile adapter cast a flat projection into
its rich view model and invent the fields it was missing.
MSG
)"
```

---

### Task 5: The client mapping — one pure module, all five tiles

Today `getDashboard`'s live branch returns literal `0`s for the tiles and `earnings.lifetimeKobo = walletBalanceKobo` ([mobile-app/reactnative/src/api/doctor.batch1.api.ts:343-379](../../mobile-app/reactnative/src/api/doctor.batch1.api.ts#L343), post-#1008 line numbers, confirmed against `git show 63b1ebb77:…`). This moves the wire→domain translation into a pure module the same way `batch6Wire.ts` does, so it is testable without a device.

**Shipped as `80d6e9661`** (4 files, 307+/46−). Both new files are byte-identical to the
blocks below — verified by diffing the committed blobs against this section's fences, not by
eyeballing — and the gates read `# tests 47` / `# pass 47` / `# fail 0` / `# skipped 0` and
`tsc exit: 0` with an empty output file.

The queue rows are **not re-derived here**. #1008 landed `mapAppointmentWire` ([mobile-app/reactnative/src/features/doctor/mapping.ts:158](../../mobile-app/reactnative/src/features/doctor/mapping.ts#L158)), which already turns that same `patient` jsonb into this same `DoctorAppointment` — avatar rule, `booked` → `upcoming`, gender normalise, id-derived `ref` — with three spec files pinning all of it. Re-implementing any of that on the dashboard would give one patient different initials and a different circle colour depending on which screen they were opened from, and would have quietly kept a bug this task's first draft carried: its own gender lookup never lowercased, so `'Female'` mapped to `'other'`. So `mapQueueAppointment` delegates and overrides exactly one field, for the reason written into Step 4.

**Files:**
- Create: `mobile-app/reactnative/src/features/doctor/dashboardWire.ts`
- Create: `mobile-app/reactnative/src/features/doctor/__tests__/dashboardWire.test.ts`
- Modify: `mobile-app/reactnative/src/types/doctor.batch1.ts:256` (`satisfactionPct`)
- Modify: `mobile-app/reactnative/src/api/doctor.batch1.api.ts` (delete the local `DashboardWire`, delegate to the mapper)

`package.json` is **not** in this list any more. #1008 added `test:doctor-mapping` (package.json:30), which globs `src/features/doctor/__tests__/*.test.ts` — the directory this task writes into — so the new spec is inside a runner the moment it exists, and `batch6Wire.test.ts` (the un-run file whose bug motivated a new script) is already in that same glob. Step 7 proves it instead of adding a second runner over one directory.

**Interfaces:**
- Consumes: `DashboardResponse` from Task 4, as `DashboardWire`; `mapAppointmentWire` and `AppointmentWire` from `@/features/doctor/mapping` (#1008).
- Produces:
  - `mapDashboardWire(wire: DashboardWire): DoctorDashboardData`
  - `mapQueueAppointment(wire: DashboardQueueAppointmentWire): DoctorAppointment` — delegates to `mapAppointmentWire`, overrides `consultType`
  - `formatSlotDateLabel(slotDate: string): string` (used by `AppointmentRow` in Task 6)
  - exported types `DashboardWire`, `DashboardMetricsWire`, `DashboardRevenueWire`, `DashboardQueueAppointmentWire`, `DashboardQueuePatientWire`
- Dropped for #1008, so no executor should reach for them: `initialsFromName`, `avatarColorForPatient`, `PATIENT_AVATAR_COLORS`. The platform rules live on `@/features/telemedicine/mapping` as `initialsFromName`/`avatarColorFor` (an 8-entry `Colors.primary`-led palette, not this plan's 5-entry one) and arrive here through `mapAppointmentWire`.

- [ ] **Step 1: Give the worktree a node_modules**

```bash
test -d /private/tmp/spot-doctor-metrics/mobile-app/reactnative/node_modules \
  || ln -s /Users/paymax/Documents/spotlight/main/mobile-app/reactnative/node_modules /private/tmp/spot-doctor-metrics/mobile-app/reactnative/node_modules
cd /private/tmp/spot-doctor-metrics/mobile-app/reactnative && git status --short . | head
```

Expected: `?? mobile-app/reactnative/node_modules` and nothing else yet — and that line is
correct, not a problem to fix. The symlink is **not** invisible to git: `.gitignore:21-22`
ignore `node_modules/` *with a trailing slash*, which matches a directory, and a symlink is a
file to git, so `git check-ignore -v mobile-app/reactnative/node_modules` exits 1. That is
exactly why every commit step in this task names its paths explicitly — `git add -A` here would
commit a symlink pointing at another machine's absolute path. Never stage it, and leave it in
place: Tasks 6 and 7 typecheck against it too.

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
// Runner: npm run test:doctor-mapping  (the glob #1008 added already covers this
// directory; this package has no jest, and
// src/features/doctor/__tests__/batch6Wire.test.ts set the precedent).

import test from 'node:test';
import assert from 'node:assert/strict';

import { avatarColorFor } from '@/features/telemedicine/mapping';
import { mapAppointmentWire } from '@/features/doctor/mapping';

import {
  mapDashboardWire,
  mapQueueAppointment,
  formatSlotDateLabel,
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
  appointmentCounts: { pending: 7, completed: 9 },   // 7, not 3: see the pendingRequests assert
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
  assert.equal(d.todaysAppointments[0].id, 'a1');
  assert.equal(d.todaysAppointments[0].patient.initials, 'TA');
  // The wallet is not consult revenue — the old code used one for both.
  assert.notEqual(d.earnings.lifetimeKobo, d.earnings.availableKobo);
  // Untouched reads still feed their own tiles. `pending` is 7 while
  // todaysCount is 3 so this also pins WHICH field feeds which tile: with both
  // at 3 the mapper could read either for either and stay green (T1).
  assert.equal(d.counts.pendingRequests, 7);
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
  // The five `?? 0` fallbacks the block above did not reach: each of these is a
  // mutant that stays green without it (`?? 0` -> `?? 1` on pendingRequests,
  // unreadMessages, lifetimeKobo, thisMonthKobo, consultsThisMonth).
  assert.equal(d.counts.pendingRequests, 0);
  assert.equal(d.counts.unreadMessages, 0);
  assert.equal(d.earnings.lifetimeKobo, 0);
  assert.equal(d.earnings.thisMonthKobo, 0);
  assert.equal(d.earnings.consultsThisMonth, 0);
});

test('the tile path keeps the passthrough, not just the exported helper', () => {
  // mapDashboardWire has to route the queue through mapQueueAppointment. Mapping
  // it with mapAppointmentWire directly compiles, leaves every other assertion in
  // this file green, and puts the 'anything unrecognised is video' collapse back
  // on the one screen that actually renders the queue (spec D8). The seam has to
  // be pinned from the tile, because the tile is the production path.
  const d = mapDashboardWire({
    ...FULL,
    todaysAppointments: [{ ...QUEUE_ROW, consultType: 'in_person' }],
  });
  assert.equal(d.todaysAppointments[0].consultType, 'in_person');
  assert.equal(mapAppointmentWire({ ...QUEUE_ROW, consultType: 'in_person' }).consultType, 'video');
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
  // Presentation tokens come off the platform rule, not a dashboard-local guess.
  assert.equal(a.patient.initials, 'TA');
  assert.equal(a.patient.avatarColor, avatarColorFor('p1'));
});

test('in_person passes through rather than becoming a video consult', () => {
  // appointments.consultation_type allows in_person; ConsultType does not (F4
  // tracks widening it). mapAppointmentWire routes this field through
  // mapConsultType, which collapses anything unrecognised to 'video' and has that
  // collapse under test of its own (__tests__/mapping.appointments.test.ts:62) —
  // so delegating the rest of the row still has to stop here, or an in-person
  // visit displays as a video call (spec D8). AppointmentRow draws a fallback
  // icon for it (Task 6).
  const wire = { ...QUEUE_ROW, consultType: 'in_person' };
  assert.equal(mapQueueAppointment(wire).consultType, 'in_person');
  assert.equal(mapAppointmentWire(wire).consultType, 'video');
});

test('the queue row and the appointments list are the same row', () => {
  // The delegation contract: one patient, one avatar, one status vocabulary, no
  // matter which screen asks. If mapQueueAppointment ever grows its own rules,
  // this is the test that says so.
  const dash = mapQueueAppointment(QUEUE_ROW);
  const list = mapAppointmentWire(QUEUE_ROW);
  assert.equal(dash.patient.initials, list.patient.initials);
  assert.equal(dash.patient.avatarColor, list.patient.avatarColor);
  assert.equal(dash.patient.gender, list.patient.gender);
  assert.equal(dash.status, list.status);
  assert.equal(dash.ref, list.ref);
  assert.equal(dash.slotDate, list.slotDate);
  assert.equal(dash.slotTime, list.slotTime);
  assert.equal(dash.feeKobo, list.feeKobo);
  assert.equal(dash.isHmo, list.isHmo);
  // consultType matches too, because 'video' is a type both planes recognise.
  assert.equal(dash.consultType, list.consultType);
});

test('an unrecognised status cannot invent a completed badge', () => {
  assert.equal(mapQueueAppointment({ ...QUEUE_ROW, status: 'archived' }).status, 'upcoming');
});

test('an unknown gender maps to the union member that is not a claim', () => {
  assert.equal(mapQueueAppointment({ ...QUEUE_ROW, patient: { ...QUEUE_ROW.patient, gender: 'non-binary' } }).patient.gender, 'other');
  assert.equal(mapQueueAppointment({ ...QUEUE_ROW, patient: {} }).patient.gender, 'other');
  // Case-folded by the shared rule: 'Female' is a female patient, not 'other'.
  assert.equal(mapQueueAppointment({ ...QUEUE_ROW, patient: { ...QUEUE_ROW.patient, gender: 'Female' } }).patient.gender, 'female');
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
node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs --test \
  "src/features/doctor/__tests__/dashboardWire.test.ts" > /tmp/t5-step3.txt 2>&1
echo "exit: $?"; grep -n "Cannot find module\|ERR_MODULE_NOT_FOUND\|# pass\|# fail" /tmp/t5-step3.txt
```

Expected: `exit: 1` and a `Cannot find module` line naming the mapper. Capture to a file — the
`| tail -15` form of this command showed only `# pass 0` / `# fail 1` and the trailer, because
Node prints the loader error near the **top** of the output and the summary at the bottom, so
the very line this step exists to observe was cut (seen in this task's own run at
`task-5-report.md`, Step 3). The observed line, before `dashboardWire.ts` existed:

```text
# Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/private/tmp/spot-doctor-metrics/mobile-app/reactnative/src/features/doctor/dashboardWire.ts' imported from /private/tmp/spot-doctor-metrics/mobile-app/reactnative/src/features/doctor/__tests__/dashboardWire.test.ts
```

- [ ] **Step 4: Write the mapper**

Create `mobile-app/reactnative/src/features/doctor/dashboardWire.ts`:

```ts
// Pure wire→domain mapping for GET /doctor/dashboard. It imports no React Native
// of its own; the shared plane it delegates to does pull `constants/tokens` in
// transitively, which is already answered for by the runner's react-native stub
// (tests/unit/stubs/react-native.mjs — `Platform.select` and all), the same reason
// npm run test:doctor-mapping can load features/doctor/mapping.ts at all. Like
// features/doctor/batch6Wire.ts, this file stays render-free so node:test covers it.
//
// The endpoint answers the flat DashboardSummary the Go service composes — NOT the
// rich DoctorDashboardData the screens render — so the translation happens here
// instead of the `doctorGet<DoctorDashboardData>('/dashboard')` cast that used to
// sit in the api module. That cast is how the tiles ended up hard-coded: the wire
// genuinely had no `counts.todaysAppointments` to read.

import { mapAppointmentWire } from '@/features/doctor/mapping';
import type { DoctorAppointment } from '@/types/doctor';
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
 * 'Nov 13' from a slot date. The contract says YYYY-MM-DD; a full timestamp is
 * tolerated (slice to the day) because `new Date('<iso-timestamp>T00:00:00')` is
 * Invalid Date, which is what the queue used to render.
 */
export function formatSlotDateLabel(slotDate: string): string {
  return new Date(`${slotDate.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * A queue row IS an appointment row, so it is mapped by the function the
 * appointments list already uses: #1008's `mapAppointmentWire` owns the avatar
 * rule, the `booked` → `upcoming` map, the gender normalise and the id-derived
 * `ref`, and three of its own spec files pin them. Duplicating any of that here
 * would let one patient wear different initials on two screens.
 *
 * `consultType` is the single field the delegation has to hand back.
 * `mapConsultType` collapses anything outside video/audio/chat to 'video' — under
 * test as intended, over there — while spec D8 wants the wire value verbatim,
 * `in_person` included, so an in-person booking is never displayed as a video
 * call. ConsultType has no in_person member yet: the cast is local to this
 * boundary, AppointmentRow draws a fallback icon (Task 6), and follow-up F4
 * widens the union for good.
 */
export function mapQueueAppointment(wire: DashboardQueueAppointmentWire): DoctorAppointment {
  const row = mapAppointmentWire({ ...wire, id: wire.id ?? '' });
  return { ...row, consultType: wire.consultType as DoctorAppointment['consultType'] };
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
node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs --test \
  "src/features/doctor/__tests__/dashboardWire.test.ts" > /tmp/t5-step6.txt 2>&1
echo "exit: $?"; grep -E "^# (tests|pass|fail|skipped|cancelled)" /tmp/t5-step6.txt
```

Expected: `exit: 0`, then `# tests 10`, `# suites 0`, `# pass 10`, `# fail 0`, `# cancelled 0`,
`# skipped 0` — the fix wave adds the tenth test. `grep` the summary rather than `tail` it: the
tail works for this one (the summary really is last) but it silently varies with how much output
each test emits, and a red run's assertion text is what you need to see.

- [ ] **Step 7: Prove the existing runner already covers the new file**

`test:doctor-mapping` (added by #1008, package.json:30) globs `src/features/doctor/__tests__/*.test.ts` — the directory this task writes into — so `dashboardWire.test.ts` is inside it the moment it exists, and so is `batch6Wire.test.ts`, whose missing runner was this step's original reason to invent one. Do not add a `test:doctor-dashboard` script: two runners over one directory is how one of them rots.

```bash
cd /private/tmp/spot-doctor-metrics/mobile-app/reactnative
npm run test:doctor-mapping > /tmp/t5-step7.txt 2>&1
echo "exit: $?"; grep -E "^# (tests|suites|pass|fail|cancelled|skipped)|dashboardWire|batch6Wire" /tmp/t5-step7.txt
```

Expected: `exit: 0`, `# tests 48`, `# pass 48`, `# fail 0`, `# skipped 0`, and both file names
named. The count is the falsifiable part: this runner measured **`# tests 38` / `# pass 38` /
`# fail 0`** on this worktree before the task existed (measured at `ec3fcd715`), which is what
"the glob already covers my new file" has to mean — 38 after Step 2 says the spec was written and
never picked up, and anything but 48 (38 + this file's ten tests) says the file name or the glob
is wrong. If `# skipped` is
nonzero, say so: a skipped suite is not a passing one. Capture to a file instead of piping to
`grep` — the pipe reports grep's status, and this command's original form had no `^# tests`
alternative, so the number the step leans on never appeared in its own output.

- [ ] **Step 8: Delegate the api module's live branch**

In `mobile-app/reactnative/src/api/doctor.batch1.api.ts`, delete the local `interface DashboardWire { … }` block and its comment (post-#1008 lines 331-341 — comment 331-335, interface 336-341; the numbers are from `git show 63b1ebb77:…` and the implementer's first pass mis-read them as ending at 340), and replace the whole `getDashboard` function (lines 343-379, signature included) with:

```ts
export async function getDashboard(): Promise<DoctorDashboardData> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_DASHBOARD);
  return mapDashboardWire(await doctorGet<DashboardWire>('/dashboard'));
}
```

Add after #1008's mapping imports at the top of the file (after the `import type { AppointmentRequestWire } from '@/features/doctor/mapping';` line, post-#1008 line 11):

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
cd /private/tmp/spot-doctor-metrics/mobile-app/reactnative
NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit -p tsconfig.doctorcheck.json > /tmp/t5-tsc.txt 2>&1
echo "tsc exit: $?"; cat /tmp/t5-tsc.txt
```

Two traps in the command that used to sit here. `npx --max-old-space-size=4096 tsc …` does not
raise anyone's heap: npm swallows the flag (`npm warn Unknown cli config "--max-old-space-size"`)
and Node starts with its default, so the guard only looked applied — the flag has to be in
`NODE_OPTIONS`. And `… tsc … 2>&1 | tail -20; echo "tsc exit: $?"` prints **tail's** status, not
the compiler's, so a red typecheck reported itself green; capture to a file and read `$?`
unpiped.

Expected: `tsc exit: 0` and an empty `/tmp/t5-tsc.txt`. Both measured here before the task: this
same command on this worktree at `ec3fcd715` exits 0 with zero lines, so any line it prints now
is this task's doing. The scope matters — `tsconfig.doctorcheck.json` `include`s
`app/(doctor)/**/*`, so the screen that renders the tile is inside this check, and there are
exactly four `satisfactionPct` readers in it: `src/types/doctor.batch1.ts:256` (the declaration
Step 5 widens), `src/api/doctor.batch1.api.ts:328` (`DEMO_DASHBOARD`, whose `96` still satisfies
`number | null`), `src/api/doctor.batch1.api.ts:377` (the literal Step 8 deletes) and
`app/(doctor)/(tabs)/index.tsx:184` (`` value={`${dashboard?.satisfactionPct ?? 0}%`} `` —
typechecks unchanged, and Task 7 gives it the em dash). If the process dies with exit 134 that is
a heap crash, not a type error: raise `NODE_OPTIONS`, do not narrow the check.

- [ ] **Step 10: Commit**

```bash
cd /private/tmp/spot-doctor-metrics && git add mobile-app/reactnative/src/features/doctor/dashboardWire.ts mobile-app/reactnative/src/features/doctor/__tests__/dashboardWire.test.ts mobile-app/reactnative/src/types/doctor.batch1.ts mobile-app/reactnative/src/api/doctor.batch1.api.ts && git commit -m "$(cat <<'MSG'
fix(doctor): map the dashboard wire onto all five tiles instead of literals

getDashboard's live branch returned 0s and reused the wallet balance as lifetime
earnings. It now reads metrics/todaysAppointments through a pure module with a
node:test spec, and satisfactionPct is nullable so 'no reviews' stops rendering
as 0%. Queue rows delegate to the appointments list's own mapper rather than
re-deriving the avatar and status rules, with consultType handed back so
in_person is not drawn as a video call. The spec needs no new npm script:
#1008's test:doctor-mapping already globs this directory.
MSG
)"
```

- [ ] **Step 11: Mutation evidence — prove the spec bites**

Ten green tests do not prove the mapper is what makes them green. Break the mapper six
ways, one at a time, and record which test goes red for each. Restore by writing the
original bytes back (capture `sha256` of the file before you start and check it after),
never `git checkout --` — this worktree is shared and that command would discard another
session's uncommitted work. After the six mutations the file must hash back to the value
it had when the commit landed, and `npm run test:doctor-mapping` must be back to
`# pass 48` / `# fail 0`.

| # | Mutation (all six are in `dashboardWire.ts`; the spec is never mutated) | The test that must go red |
|---|---|---|
| 1 | `mapQueueAppointment`: return `row` instead of `{ ...row, consultType: … }` | *in_person passes through rather than becoming a video consult* **and** the new *the tile path keeps the passthrough, not just the exported helper* (measured: 8 pass / 2 fail) |
| 2 | `mapDashboardWire`: `satisfactionPct: m.satisfactionPct ?? null` → `?? 0` | *no reviews is null, which the tile renders as an em dash* — and, as seen in `task-5-mutation.md`, *a thin wire yields zeros and empty arrays, never undefined* too: that spec's `assert.equal(d.satisfactionPct, null)` rests on the same fallback, so the table under-claimed and coverage is one test wider than written |
| 3 | `mapDashboardWire`: `todaysAppointments: m.todaysCount ?? 0` → `todaysAppointments: 0` | *every tile reads the wire, not a literal* |
| 4 | `formatSlotDateLabel`: drop the `.slice(0, 10)` | *the slot date label survives a full timestamp* (`'Invalid Date'` vs `'Nov 13'`) |
| 5 | `todaysAppointments: (wire.todaysAppointments ?? []).map(mapQueueAppointment)` → `.map((w) => mapAppointmentWire({ ...w, id: w.id ?? '' }))` (drop the `consultType` override; keep the import) | *the tile path keeps the passthrough, not just the exported helper* — this is the mutant that shipped green before the fix wave |
| 6 | `pendingRequests: statusCounts.pending ?? 0` → `m.todaysCount ?? 0` | *every tile reads the wire, not a literal* (7 vs 3); before `pending` moved off 3 this mutant survived all nine tests |

**Fix wave 1, measured (`533d982b5`, transcript `task-5-fix1-mutation.md`).** All six mutants and
the mirror of 6 went red — none survived — and the five `?? 0`→`?? 1` extras Edit 3 was written to
reach went red too. The two rows that matter are 5 and 6: each is killed by exactly the assertion
the fix wave added (5 by the new tile-path test alone, 6 by test 1's `pendingRequests === 7`). The
implementer also ran the negative control nobody had to ask for: with the pre-fix nine-test spec
from `git show HEAD:…` the same two mutants come back **exit 0, 9/9 green**, so the kills are
attributable to the new assertions rather than to something that was already true. Gate numbers
re-measured by the controller in the real tree, not copied: `# tests 10 / # pass 10 / # fail 0`,
`npm run test:doctor-mapping` `# tests 48 / # pass 48 / # fail 0 / # skipped 0`,
`tsc exit: 0` with an empty output file, and `shasum -a 256` on `dashboardWire.ts` =
`8c651bd1a…5230ca`, byte-identical to the commit that shipped it — the mapper really was not
touched, which is what let this round be a spec-only change.

One premise in that round's brief was **wrong and the implementer caught it**: the brief asserted
"`tsconfig.doctorcheck.json` `include`s `src/features/doctor/**/*`, which is this test file, so the
tenth test really is typechecked". `include` does not win: the config `extends: "./tsconfig.json"`,
which excludes `**/__tests__/**` at `mobile-app/reactnative/tsconfig.json:12-17`, and the child
inherits that list. Proved two ways — `npx tsc --showConfig -p tsconfig.doctorcheck.json` prints the
`exclude` array, and `npx tsc --noEmit --listFiles -p tsconfig.doctorcheck.json | grep -c __tests__`
is **0**. So Step 9's typecheck validates the mapper, the types and the api module and has never
validated a single line of any `node:test` spec in this package. `node --experimental-strip-types`
parses and runs the file but checks no types, which is why the suite is still meaningful: a typo in
an assertion is a runtime `undefined` and a red test, not a green type error. Recorded as **F9**
below, because the way to close it is not the obvious one.

Mutation 1 is the one that matters most, and it has now been answered rather than assumed: with
the override removed, *in_person passes through rather than becoming a video consult* goes red
(`'video'` vs `'in_person'`) while *the queue row and the appointments list are the same row*
stays `ok` — so the delegation seam really is carried by its own test, and the equality test is
not silently absorbing it. Re-run this if you change either test's shape.

What this does **not** cover, recorded so the next reader does not over-claim it: the
`getDashboard` delegation in `src/api/doctor.batch1.api.ts` has no node:test coverage (the
api module pulls React Native in and the runner stubs only `constants/tokens` transitively).
It is covered by Step 9's typecheck and by Task 7's live screen run; do not describe Step 2's
spec as testing the api module.

---
### Task 6: Today's queue rows render — a precondition, not a live-bug repair

`AppointmentRow` looks `TYPE_ICON[appointment.consultType]` up with no fallback, and builds its date
label inline as `new Date(`${slotDate}T00:00:00`)`. Both need fixing **before Task 7 rewires the
screen**, and neither was producing a visible defect at the moment this task landed. Say it plainly
rather than inheriting this step's first framing, which claimed the row "crashes" and "prints Invalid
Date" on the shipped dashboard (Task 6 review finding T6-R1, confirmed by the controller):

- **No route for `in_person` yet.** This component's only two production call sites —
  `app/(doctor)/(tabs)/index.tsx:318` and `app/(doctor)/(tabs)/appointments.tsx:81` — both render
  `useAppointments()` rows, and that path is `getAppointments()` → `mapAppointmentWire` →
  `mapConsultType` (`src/features/telemedicine/mapping.ts:124-128`), which collapses every
  unrecognised value to `'video'`. The `in_person` value that *would* throw lives in
  `dashboard.todaysAppointments`, and at this commit no screen reads that array — Task 7's edit 5 is
  what routes it here. So the throw is a code-path inference about the next task, not an observed
  failure. It is still a real hazard, but **its source is stored data, not new bookings** — an earlier
  revision of this bullet claimed `service.go:571` "inserts the value verbatim, so `in_person` bookings
  exist as soon as the queue is read", and that is false at the write end (Task 7 review finding T7-R6,
  confirmed by the controller). Measured: `service.go:489` calls `resolveConsultPackage`, whose
  no-package branch runs `normalizeConsultMode` (`internal/telemedicine/consult.go:52-62`), which has no
  `in_person` case and returns `ErrConsultModeInvalid` — `consult_test.go:25-27` asserts exactly that,
  and `go test ./internal/telemedicine/ -run TestNormalizeConsultMode` → `ok … 1.369s`. With a
  `packageID` the value comes from `moduleConsultType(pkg.Mode)`, and `consult_session_packages.mode` is
  CHECK'd to `('chat','voice','video')` (`supabase/migrations/20271405000000_consult_sessions.sql:12`).
  So nothing this branch ships can *create* the value. What makes the fallback necessary is that the
  column's CHECK has always allowed it and the endpoint wrote `req.ConsultationType` verbatim until
  `3e061a53e` (2026-11-04) — at `aee407792` that line is `service.go:486` — so pre-existing rows can
  carry `in_person`, and the queue read passes them through unchanged
  (`dashboard_metrics.go:229` → `dashboardWire.ts:90-93` → `index.tsx:315`). Rendering `undefined` as a
  component element throws, which is why the fallback had to land before the screen rewired. Task 8 must
  not write a QA step that says "book an in-person consult": the row is obtained from a legacy row or by
  hand-inserting SQL, and if neither is available the step is not runnable and says so.
- **No `Invalid Date` on either path.** The queue's date is produced as
  `to_char(a.scheduled_at AT TIME ZONE $2, 'YYYY-MM-DD')` (`backend/internal/doctor/dashboard_metrics.go:231`),
  so it is day-shaped by construction, and `formatSlotDateLabel`'s `slice(0, 10)` is defensive
  robustness rather than a repair. It is still the right change: it is the single place the day
  slicing is defined, and Task 5's spec pins it.

Why the type checker never saw the map problem: `TYPE_ICON` is `Record<ConsultType, LucideIcon>` and
`ConsultType` is `'video' | 'audio' | 'chat'` (`src/types/telemedicine.ts:3`), so the three-key map is
*provably total* against a union smaller than reality — `appointments.consultation_type` is
CHECK-constrained to `('video','audio','chat','in_person')`
(`supabase/migrations/20260618040000_telemedicine_clinical.sql:10-12`), the table this dashboard now
reads, and the queue passes `consultType` through verbatim (spec D8). `VetAppointmentRow.tsx:24`
already carries the fourth key (`in_person: User`), which is the in-repo precedent for the fix shape.
Task 5's mapping test asserts the wire value survives; this task makes rendering it not throw.

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
// Keyed by string, not ConsultType: appointments.consultation_type allows in_person,
// which the union does not have yet (follow-up F4). `TYPE_ICON[x]` is undefined for an
// unmapped type and rendering undefined throws, taking the whole screen with it. That
// value reaches this row from the dashboard queue this PR wires up; it cannot arrive via
// useAppointments(), whose mapConsultType collapses every unrecognised type to 'video'.
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
NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit -p tsconfig.doctorcheck.json > /tmp/t6-tsc.txt 2>&1
echo "tsc exit: $?"; wc -l < /tmp/t6-tsc.txt; cat /tmp/t6-tsc.txt
npm run test:doctor-mapping > /tmp/t6-test.txt 2>&1
echo "test exit: $?"; grep -E "^# (tests|pass|fail|skipped)" /tmp/t6-test.txt
```

Expected: `tsc exit: 0` with an empty output file, and `# fail 0` at `# tests 48`. Two traps this
step used to walk into: `npx --max-old-space-size=4096 tsc` does not set the heap at all (npm
swallows the flag before tsc sees it, so the run either dies with exit 134 or succeeds for the wrong
reason), and `… 2>&1 | tail -10; echo "tsc exit: $?"` reports **`tail`'s** status, not tsc's — this
harness runs zsh, which has no `PIPESTATUS` to rescue it. Capture to a file and read `$?` directly.

Then prove the old code is really gone — by matching the **code shapes**, not the bare word
`ConsultType`. The comment Step 1 mandates verbatim contains that token, so
`grep -n "ConsultType\|toLocaleDateString\|new Date("` exits **0** and prints line 19. That
falsified this task's original verification step (finding F-1): its expectation of "no output, exit
1" could not hold while the comment stayed, and a verifier reading the number rather than assuming
it would have reported a pass-condition failure for code that was correct. The pass is exit 1 on:

```bash
cd /private/tmp/spot-doctor-metrics/mobile-app/reactnative
grep -n "Record<ConsultType\|DoctorAppointment, ConsultType\|toLocaleDateString\|new Date(" src/features/doctor/components/AppointmentRow.tsx; echo "grep exit: $?"
```

Measured both ways on Task 6's close: the bare-word form exits 0 printing only line 19 (the
comment); the form above exits 1 with no output. Also expect the positive grep —
`grep -n "TYPE_ICON\|FALLBACK_ICON\|formatSlotDateLabel\|CalendarDays"` — to print the two imports,
the `TYPE_ICON` declaration plus its comment, `FALLBACK_ICON`, and the two derived locals.

**But do not mistake that negative grep for proof of the fallback** (T6-R2). Strip
`?? FALLBACK_ICON` and it *still* exits 1, and `tsc` still exits 0: nothing in
`tsconfig.json` or `tsconfig.doctorcheck.json` sets `noUncheckedIndexedAccess` (measured —
`grep -rn noUncheckedIndexedAccess tsconfig*.json` finds no match), so indexing a
`Record<string, LucideIcon>` is typed `LucideIcon` outright and the `??` is invisible to the checker.
The assertion that actually discriminates is the exact-string positive one:

```bash
grep -n "TYPE_ICON\[appointment.consultType\] ?? FALLBACK_ICON" src/features/doctor/components/AppointmentRow.tsx; echo "exit: $?"
```

Measured: hits line 31, exit 0. Use *that* as the fallback's proof; the negative grep proves only
that the old type usage and the inline date expression are gone. Neither proves the icon renders —
that stays Task 8's browser pass.

The date-parsing branch is covered by `formatSlotDateLabel`'s spec; the icon fallback is a map
lookup whose visible behaviour is confirmed in the browser pass (Task 8) — say so rather than
claiming it is tested.

- [ ] **Step 3: Commit**

```bash
cd /private/tmp/spot-doctor-metrics && git add mobile-app/reactnative/src/features/doctor/components/AppointmentRow.tsx && git commit -m "$(cat <<'MSG'
fix(doctor): make the queue row safe to render from the dashboard aggregate

An unmapped consult type made TYPE_ICON[x] undefined and rendering undefined
throws; day-slice the label in one place instead of inlining new Date(...).
Neither value has a route to this row until the screen reads the aggregate, so
this is Task 7's precondition rather than a repair of an observed crash.
MSG
)"
```

Landed on this branch as `952ae5b36` plus `d906d535a`: the first commit's subject and the comment it
shipped both claimed the dashboard *had been* going down, which T6-R1 showed to be false, and the
second corrected the reason in the code to name the actual route.

---

### Task 7: The dashboard screen reads the aggregate

**Files:**
- Modify: `mobile-app/reactnative/app/(doctor)/(tabs)/index.tsx:18,25,60,71,83,179,184,314,317` (post-#1008 line numbers)

#1008 rewrote this screen while this plan was being written — it added `mapHeaderAvatar(profile)` for the header, replaced the `settings?.showOnlineStatus ?? profile?.isOnline` presence read with `profile?.isOnline` plus a new `presenceLabel`, dropped `useUpdateSettings`/`updateSettings`/`PawPrint`, and deleted the `toggleOnline` settings mutation. Every line number below is measured on `531df7af9`. Read the file as it stands after Task 3's rebase before editing, and do not re-add anything #1008 removed: `useUpdateSettings` still exists as a hook (`hooks/useAccount.ts:58`), so a stale import would typecheck clean while quietly reverting someone's cleanup.

**Interfaces:**
- Consumes: `dashboard.todaysAppointments` (Task 5's `DoctorDashboardData`), `dashboard.counts.todaysAppointments`, `dashboard.satisfactionPct: number | null`.
- Produces: the user-visible five tiles.

- [ ] **Step 1: Point the queue and both appointment tiles at the dashboard**

Five edits in `app/(doctor)/(tabs)/index.tsx`:

1. Line 18 — drop `useAppointments` from the hooks import. Take main's line as written and remove that one name; the result is:

```tsx
import { useDoctorProfile, useEarnings, useNotifications, useSettings, useDashboard, useAnnouncement, useSetPresence, useDismissAnnouncement } from '@/features/doctor/hooks';
```

   There is no `useUpdateSettings` in it. #1008 removed that hook from this screen when it moved presence onto `PUT /presence`; re-adding it is a silent revert, and `tsc` will not catch it.

2. Delete line 25 (`const ACTIVE_STATUSES = …`) and line 60 (`const { data: appointments = [] } = useAppointments();`) and line 71 (`const todays = appointments.filter(…)`). The queue now comes from the dashboard aggregate, which already scopes it to today in the doctor's timezone; `ACTIVE_STATUSES` (`upcoming`/`confirmed`/`in_progress`) also silently dropped `completed` consults, so "today's consults" counted the day before it was ever asked to.

3. Line 83 — add the queue local under `counts`:

```tsx
  const counts = dashboard?.counts;
  const queue = dashboard?.todaysAppointments ?? [];
```

4. Lines 179 and 184 — the tiles:

```tsx
          <StatCard icon={CalendarDays} label="Today's consults" value={String(counts?.todaysAppointments ?? 0)} iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} />
```

```tsx
          <StatCard icon={Smile} label="Satisfaction" value={dashboard?.satisfactionPct == null ? '—' : `${dashboard.satisfactionPct}%`} iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} />
```

   Line 180 (`Upcoming`) already reads `counts?.upcomingAppointments` and needs no change — its zero came from the server, and `counts` is now populated. Line 183 (`Available`) already reads `dashboard?.earnings.availableKobo`; leave its `?? earnings?.availableKobo ?? 0` fallback so the tile still works against a stale bundle.

5. Lines 314 and 317 — the queue block:

```tsx
          {queue.length === 0 ? (
            <StateView variant="empty" icon={CalendarDays} title="No consults scheduled" message="New bookings will appear here." />
          ) : (
            queue.map((a) => (
```

- [ ] **Step 2: Typecheck**

```bash
cd /private/tmp/spot-doctor-metrics/mobile-app/reactnative
NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit -p tsconfig.doctorcheck.json > /tmp/t7-tsc.txt 2>&1
echo "tsc exit: $?"; wc -l < /tmp/t7-tsc.txt; cat /tmp/t7-tsc.txt
```

Expected: `tsc exit: 0` and an empty output file. (`npx --max-old-space-size=4096 tsc` does not set
the heap — npm eats the flag — and `… | tail -15; echo "tsc exit: $?"` prints `tail`'s status;
zsh has no `PIPESTATUS`. Capture, then read `$?`.) A leftover `appointments`/`todays`/`ACTIVE_STATUSES` reference shows up here as `Cannot find name` — that is the check that the deletions were complete.

- [ ] **Step 3: Confirm nothing else read the removed locals**

```bash
cd /private/tmp/spot-doctor-metrics/mobile-app/reactnative && grep -n "ACTIVE_STATUSES\|useAppointments\|\btodays\b" "app/(doctor)/(tabs)/index.tsx"; echo "refs exit: $?"
```

Expected: no matches printed, `refs exit: 1`. (A no-match exit code is the pass here — read the number, don't assume.)

- [ ] **Step 4: Commit**

```bash
cd /private/tmp/spot-doctor-metrics && git add "mobile-app/reactnative/app/(doctor)/(tabs)/index.tsx" && git commit -m "$(cat <<'MSG'
fix(doctor): read today's tiles and queue from the dashboard aggregate

Replaces the useAppointments client-side filter, which counted `upcoming,
confirmed, in_progress` as today's consults — a status filter with no date
filter, that dropped completed consults from the day it was naming.
MSG
)"
```

---

### Task 8: Docs, full gate run, publish

**Files:**
- Modify: `mobile-app/reactnative/docs/QA_DOCTOR_BATCH1_REPORT.md`, the D1 / D2 / D13 rows of the Section D table and the note above it. Locate them by `grep -n "^| D1 \|^| D2 \|^| D13 " docs/QA_DOCTOR_BATCH1_REPORT.md`, **never** by number. Measured on the current tree, that grep prints `:76`, `:77`, `:88`, and the file has been unchanged since `5526a8bc1` (2026-06-23) — so every commit on this branch shows the same three rows. An earlier revision of this very line asserted the rows were at `75,76,87` and that `76,77,88` was a one-line-off cite for D2/D3/D14; that "correction" was itself unmeasured and is **false**: `:75` is the table's `|---|` separator and `:87` is D12 *Earnings summary*. Reason it is recorded rather than quietly overwritten: a number written into a plan without the command output beside it is a guess wearing the shape of evidence, and the grep rule is what stops the next reader inheriting it.
- Modify: `mobile-app/reactnative/docs/DOCTOR_BATCH1_API_CONTRACT.md` (Section D — record that live mode maps through `dashboardWire.ts`)

**Interfaces:** none new.

- [ ] **Step 1: Correct the QA rows that were PASS on mock data**

In `mobile-app/reactnative/docs/QA_DOCTOR_BATCH1_REPORT.md`, replace the three rows. The `index.tsx` line numbers below are what the plan predicts *after* Task 7 and after #1020's −7 shift — measure them, do not copy them:

```bash
cd /private/tmp/spot-doctor-metrics/mobile-app/reactnative && grep -n "label=\"Today's consults\"\|label=\"Upcoming\"\|label=\"Satisfaction\"\|\.map((a) =>" "app/(doctor)/(tabs)/index.tsx"
```

Use the line numbers that command prints — the three `StatCard` lines, and for D1's queue reference the
`queue.map((a) =>` line that renders the rows (Task 7 renames it from `todays.map`), not the `alerts.map`
above it and not the `SectionHeader` above that. A docs commit that cites a line which no longer holds
that code is worse than one that cites nothing: it reads as verified. This is why the three rows below
name their slots instead of filling them — replace `<TODAY_CARD>`, `<QUEUE_MAP>`, `<UPCOMING_CARD>` and
`<SAT_CARD>` with the line numbers your grep printed for, respectively, the `Today's consults` StatCard,
the `queue.map((a) =>`, the `Upcoming` StatCard and the `Satisfaction` StatCard. Everything else in each
row is verbatim, including the em-dash rendering and the backticks:

```markdown
| D1 | Today's appointments | StatCard `counts.todaysAppointments` + "Today's queue" list (index.tsx:<TODAY_CARD>,<QUEUE_MAP>) | PASS — live mode: `GET /dashboard` `metrics.todaysCount` / `todaysAppointments`, both dated in the doctor's timezone |
| D2 | Upcoming appointments | StatCard `counts.upcomingAppointments` (index.tsx:<UPCOMING_CARD>) | PASS — live mode: `metrics.upcomingCount` |
| D13 | Patient satisfaction rating | StatCard `dashboard.satisfactionPct` (index.tsx:<SAT_CARD>) | PASS — live mode: `metrics.satisfactionPct`; a `null` renders `—`, which is this app's no-figure glyph — a doctor with no reviews, and any doctor while `GET /dashboard` is still in flight or has failed (follow-up F10 in the plan) |
```

The D13 row states the glyph's whole meaning rather than one case of it. Task 7's review (T7-R1) measured
that `—` is on screen while the aggregate is loading, and the controller declined to give loading its own
glyph (see F10 for all three reasons), so a row that said "`—` when the doctor has no reviews" would be
true and still mislead a reader who took it as exclusive. Keep the wording reader-facing: the row is
published documentation, not an instruction to whoever writes it.

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
cd /private/tmp/spot-doctor-metrics/backend && git diff --relative --name-only origin/main...HEAD -- internal/doctor | grep '\.go$' | xargs -r gofmt -l; echo "gofmt: nothing listed above = every file THIS BRANCH touched is formatted"
cd /private/tmp/spot-doctor-metrics/backend && go test ./internal/doctor/... -count=1 > /tmp/t8-gotest.txt 2>&1; echo "go test exit: $?"; tail -8 /tmp/t8-gotest.txt
cd /private/tmp/spot-doctor-metrics && python3 -c "import yaml; yaml.safe_load(open('contracts/doctor.openapi.yaml')); print('openapi parses')"
cd /private/tmp/spot-doctor-metrics && npx --yes @redocly/cli@1 lint contracts/doctor.openapi.yaml --config redocly.yaml --format=stylish; echo "redocly exit: $?"
cd /private/tmp/spot-doctor-metrics/mobile-app/reactnative && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit -p tsconfig.doctorcheck.json > /tmp/t8-tsc.txt 2>&1; echo "tsc exit: $?"; wc -l < /tmp/t8-tsc.txt; cat /tmp/t8-tsc.txt
cd /private/tmp/spot-doctor-metrics/mobile-app/reactnative && npm run test:doctor-mapping > /tmp/t8-test.txt 2>&1; echo "test exit: $?"; grep -E "^# (tests|suites|pass|fail|cancelled|skipped|todo)" /tmp/t8-test.txt
```

Then the live-DB run against the dev database, with the DSN taken from `docs/maps/CI-ON-COWORK.md` (never printed). Two traps already paid for here, so don't repay them: the DSN in that file is markdown-escaped, so the trailing backslash is not part of it — strip it and check the length (55 chars; a 56-char string is the escaped one and fails exactly like a stopped database). And check the database is actually listening before you read a red as behavioural: `lsof -nP -iTCP:54322 -sTCP:LISTEN`. A run whose summary is `PASS 1 / SKIP 0 / FAIL 11` with `connection refused` says Docker is down, not that the code is wrong — bring it up, or say in the report that the live gate did not run and leave the task unverified rather than claiming a pass.

```bash
cd /private/tmp/spot-doctor-metrics/backend
TEST_DATABASE_URL="<local dev DSN>" go test ./internal/doctor/ -run 'TestLiveDB_Dashboard' -count=1 -v 2>&1 | tail -30
```

Expected: `go ok`, `xargs gofmt -l` printing nothing, `ok spotlight/backend/internal/doctor`, `openapi parses`, `redocly exit: 0`, `tsc exit: 0`, `# fail 0`, and **thirteen** `--- PASS` lines for `TestLiveDB_Dashboard*` — the count the plan's own test blocks add up to (six from Task 1, three from Task 2 including the probe-error case its fix round added, four from Task 3 including the composed count-vs-cap case its review round added). Any live-DB test that SKIPped is *not* a pass — record which ones and say so. If the run prints fewer than thirteen, that is a missing test, not a smaller expectation: count the `func TestLiveDB_Dashboard` definitions before concluding (`grep -c '^func TestLiveDB_Dashboard' backend/internal/doctor/dashboard_metrics_live_db_test.go`).
The branch-scoped gofmt line needs `--relative`: `git diff --name-only` prints **repo-root**-relative
paths whatever the cwd is, so without it `xargs gofmt -l` runs inside `backend/` against
`backend/internal/…` and dies on every file with `lstat backend/internal/doctor/dashboard_metrics.go:
no such file or directory`. **It fails loudly — rc 1** (re-measured on this branch's head with go1.27.4
on darwin: five `lstat` lines, `rc=1`). An earlier revision of this plan recorded that broken form as
`rc 0`, "a clean pass having formatted-checked nothing", and the Task 8 implementer came back with rc 1
and was right; the wrong number was mine.

What *is* silent is the sibling failure, and it is the easier one to commit by accident: when the file
**list** itself is empty, `xargs -r` never runs gofmt at all and the pipeline exits 0 having checked
nothing. That happens whenever the pathspec resolves somewhere other than where you think it does —
re-measured while verifying the above, running the diff with `git -C <repo-root>` from inside `backend/`
made `-- internal/doctor` resolve at the repo root, where that directory does not exist, so the gate
printed `count: 0` and `rc(good)=0` and looked green for the wrong reason. Both forms therefore need
the list itself as evidence, not just an exit code:

```bash
git diff --relative --name-only origin/main...HEAD -- internal/doctor | grep '\.go$' | tee /tmp/files.txt
wc -l /tmp/files.txt          # must be 5 — the five dashboard-metrics files
```

`xargs -r` is still load-bearing for a branch that touches no Go file: plain `xargs gofmt -l` with empty
input runs `gofmt -l` with no arguments, which is not the check anyone intends. One more trap in the same
shape, hit in this very verification: `grep … | cat; echo "rc=$?"` reports **`cat`'s** status, never
grep's, so an empty match prints `rc=0`. Pipe to a file and check `$?` on the real command.
Do not gate on repo-wide `gofmt -l internal/doctor/`: four files are unformatted on `origin/main` itself (`model.go`, `service_ops.go`, `repository_mdcn_review.go`, `mdcn_discoverability_live_db_test.go`), no CI lane runs gofmt as a command, and reformatting someone else's file is out of scope for this PR — the branch-scoped form above is the gate.

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

Expected: because Task 3 Step 0 rebased this branch onto `origin/main`, the log is exactly the branch's own work and nothing else — the spec commit, the plan commits, one implementation commit per task, and the fix-round commits. It was 26 commits when Task 3's rebase step was written and grows by roughly one per task plus one per fix round, so do not assert an exact number; assert the shape. A subject that also appears on `origin/main` means the rebase duplicated history — stop and re-check before pushing rather than pushing it. The push prints the new branch's remote ref (this is a feature branch — it deploys nothing).

- [ ] **Step 6: Open the PR**

```bash
cd /private/tmp/spot-doctor-metrics && gh pr create --base main --head feat/doctor-dashboard-metrics --title "fix(doctor): make the dashboard's five tiles report real bookings, money and reviews" --body "$(cat <<'EOF'
## Summary
- Today's consults, Upcoming and Today's queue read `public.appointments` (the plane bookings land in) joined through `doctors.user_id`, dated in the doctor's own `doctor_profiles.timezone` (the column the app's timezone screen writes); the old reads used `doctor_appointments`, which no code path inserts into, so every tile was a healthy-looking zero.
- `GET /doctor/dashboard` gains `metrics` (todaysCount / upcomingCount / satisfactionPct+ratingCount / revenue / timezone / today) and `todaysAppointments[]`, typed in `contracts/doctor.openapi.yaml` in place of `Generic`.
- Consult revenue is projected over `settlements`: settled rows sum `provider_kobo`, escrowed rows run through `settlement.ComputeLegs` so the pending figure is the arithmetic `Settle` actually pays by. `Available` stays the ledger wallet — two planes, labelled apart.
- `satisfactionPct` is nullable end-to-end; the tile renders `—` instead of `0%` for a doctor with no reviews.
- The mobile queue row is made safe to render from the aggregate: an unmapped consult type looked `TYPE_ICON[x]` up as `undefined`, which throws when rendered — `in_person` is allowed by the column's CHECK and reaches the row from data written before `3e061a53e` (2026-11-04), which is when the booking path began refusing it (`normalizeConsultMode` has no case for it), and the new queue passes the stored value through verbatim, so the fallback had to land before the screen rewired. Day-slicing the label moves to one shared helper. Neither defect was visible on the old `useAppointments()` path, which collapses every unrecognised type to `'video'` and receives day-shaped dates from SQL; the tiles read the aggregate instead of a client-side status filter that also dropped completed consults from the day it was naming.

## Verification
- `go build ./...`, `go vet ./internal/doctor/... ./internal/integrations/...`, `go test ./internal/doctor/...`
- Live-DB (TEST_DATABASE_URL): **12** `TestLiveDB_Dashboard*` cases — doctor-local day boundary (Karachi, asserted by row identity not just count), the timezone fallback for a doctor with no profile row, upcoming excluding past and finished rows, queue wire shape, count-vs-capped-list, appointments scoped to one doctor, revenue across settled/escrowed/refunded and both other-module status shapes (with this-month money separated from lifetime by a row settled in the previous month, and the escrowed and settled sums proven by different fixtures), a poisoned timezone degrading to the default instead of failing the read, a zone the probe itself cannot read propagating its error rather than silently degrading, satisfaction scoped to one doctor, the brand-new doctor, and the composed payload. Every clock-sensitive expectation is placed on a row that is past or future at ANY run time.
- `redocly lint contracts/doctor.openapi.yaml` (exit 0), `tsc --noEmit -p tsconfig.doctorcheck.json`, `npm run test:doctor-mapping` (48 cases, of which 10 are `dashboardWire.test.ts`, riding the same glob as #1008's three mapping suites and `batch6Wire.test.ts`). The typecheck in that trio does not look at any of the 48 — see F9 — so a green `tsc` and a green `node --test` are two different kinds of evidence, not one claim doubled.
- Not done: the in-browser tile pass, which needs the shared API container rebuilt and Metro restarted — say so here if it was not run.

## Test plan
- [ ] Doctor with bookings today/tomorrow → the two counts and the queue match them, in the doctor's timezone.
- [ ] Doctor with an escrowed consult → `pendingKobo` equals what settling it will pay.
- [ ] Doctor with no reviews → satisfaction reads `—`, not `0%`.
- [ ] A row in today's queue whose stored `consultation_type` is `in_person` → renders with the fallback icon, no crash. **How to obtain that row:** the app cannot produce one any more (`normalizeConsultMode` refuses `in_person` since `3e061a53e`), so use a booking written before then, or hand-insert one against the dev database. If neither is available, mark this step not-run rather than implying the app was exercised.
- [ ] Pending consultation requests tile unchanged.

Spec: `docs/superpowers/specs/2026-11-13-doctor-dashboard-metrics-design.md`. Plan: `docs/superpowers/plans/2026-11-13-doctor-dashboard-metrics.md`.

## Seven things this PR deliberately leaves open — accept or decline each

1. **Reject unknown zones at `PUT /schedule/timezone`.** `Service.SetTimezone` (`backend/internal/doctor/service_ops.go:360-366`) validates only the empty string, so any text lands in `doctor_profiles.timezone`. Before this PR that column was inert; now five date expressions interpolate it, and an unrecognised value is a Postgres 22023. This PR degrades on the *read* (`Repository.usableTimezone`), which protects the dashboard and nothing else. The honest fix is on the write path, and validating IANA names honestly needs a zone database this PR is not allowed to add.
2. **Two zone columns, and #1008 landed the second one as a live read.** #1008's message claimed "PUT /schedule/timezone writes `doctor_profiles.timezone` while slot rendering reads `doctor_availability.timezone`". Its conclusion (two columns, no canonical store) is the one this PR takes for dashboard date math only, choosing `doctor_profiles.timezone` because it is the only column any screen is wired to set. Its evidence did not hold at the time — slot rendering was `telemedicine.GetAvailability` (`backend/internal/telemedicine/service_block13.go:36-64`), reading `doctor_availability_slots` and applying no timezone at all. #1008 then made the claim true on its own plane: `repository.go:220-221` now renders appointment slots with `AT TIME ZONE COALESCE(av.timezone, 'Africa/Lagos')`, and `GET /schedule` now returns the availability row itself (`ScheduleSettings`' `Schedule Availability` field, typed `Availability` and carrying `Availability.Timezone` at `model.go:76`). So the same doctor can be dated today on the dashboard and yesterday in `GET /appointments`, and no screen writes the column the list reads. One thing did NOT change: `timezone.tsx:21` still seeds from the top-level `settings.timezone`, which the Go payload has never sent — #1008's zone arrives nested under `schedule`, and the client's `AvailabilitySchedule` (`src/types/doctor.ts:262-269`) does not declare it — so spec F5's live-mode no-op stands, and repairing that screen against the nested field would display a zone that `PUT /schedule/timezone` does not write. The fix is a canonical zone, not a third read.
3. **The booking surface and the dashboard now use different clocks.** The slot calendar (`telemedicine.GetAvailability`, `backend/internal/telemedicine/service_block13.go:36-64`) reads `doctor_availability_slots` with `slot_date >= CURRENT_DATE` — no `AT TIME ZONE` at all, so it is dated in the database server's zone — while #1008's appointments read (`repository.go:220-221`) is dated in `doctor_availability.timezone` and this PR's tiles in `doctor_profiles.timezone`. Three date expressions over one doctor's calendar, in three different sources of truth. For a doctor outside Africa/Lagos they can disagree about which day a slot is on. Out of the fence (spec D1 is the dashboard reads) but it is a user-visible consequence of merging this.
4. **`QueueItemRow.tsx:24,44` has the same three-key `TYPE_ICON` and the same unguarded lookup as the row this PR fixes.** It was left alone because its prop is `ConsultationQueueItem` (the live waiting-room plane), not `appointments`, so an `in_person` value is not proven reachable there. Widening `ConsultType` to the four real `consultation_type` values (spec F4) is the fix that covers both.
5. **Nothing in CI runs the doctor wire tests.** `Doctor CI`'s only mobile gate is `tsc --noEmit -p tsconfig.doctorcheck.json`, the root tsconfig excludes `**/__tests__/**`, and no RN feature's `test:*` script is CI-invoked. This PR adds no runner of its own: #1008 shipped `npm run test:doctor-mapping`, whose glob (`src/features/doctor/__tests__/*.test.ts`) already picks up this PR's `dashboardWire.test.ts` alongside batch 6's — that is how batch 6's broken wire stayed broken, and it is still how nobody notices a new one breaking. Wiring the script into the lane is a CI-behaviour change the repo has not chosen, so it is not taken here.
6. **The revenue JOIN trusts a 1:1 nothing enforces.** `consultRevenue` joins `settlements` to `appointments` on `a.settlement_id = st.id`, so two appointment rows sharing one settlement would count that money twice. `appointments.settlement_id` has no UNIQUE constraint (`supabase/migrations/20260616280000_telemedicine.sql:32-34` — the only UNIQUE on the table is `idempotency_key`). It is unreachable today because the sole Go writer is the booking `INSERT` (`backend/internal/telemedicine/service.go:573`), which creates its own settlement, and no `UPDATE` in the repo moves the column — but the read is one backfill or admin repair away from a wrong money number. The in-repo precedent for the guard is `supabase/migrations/20260919000400_restaurant_payouts.sql:66-72`, which hit this same hazard and added partial UNIQUE indexes on `settlement_id`. A migration is out of this PR's fence — spec "Out of scope" line: "Any migration: everything reads existing tables and columns" — so the guard is named here rather than shipped.
7. **Ten serialised statements per dashboard load, and a month bucket that can straddle midnight.** `GetDashboard` now issues `appointmentStatusCounts`, `unreadNotificationCount`, `ledger.GetBalance`, `GetProfile`, the `usableTimezone` probe, `dashboardAggregates`, `todayQueue`, `consultRevenue` (two queries internally) and `GetReputation` — ten statements, one after another, on the first screen every doctor opens. Nothing in the spec asks for concurrency and the fail-fast policy is easier to reason about serialised, so this is recorded as a decision rather than an accident; measuring it needs a load profile nobody has. The same family has a real edge: `Metrics.Today` comes from `dashboardAggregates`, while `consultRevenue` re-derives its own month bucket from `CURRENT_TIMESTAMP` inside its statement. A request that straddles the doctor's local midnight therefore reports one day and prices the money into the next — seconds of exposure once a day per doctor, but the numbers it returns are then internally inconsistent, and the fix is to thread `agg.Today` through that read exactly as it is already threaded through the queue. Left open because closing it changes a query signature this PR's tests pin.

## Two notes for anyone reading the money tests later

- Neither money fixture row holds a round number. The settled row stores `provider_kobo = 170001`, not `170000`, because `170000 IS FLOOR(0.85 × 200000)` — with a round value the test cannot tell "sum what `Settle` paid" from "re-derive the 85% in SQL", and the re-derivation is exactly the defect this tile is meant to fix. The escrowed row stores `168301`, one kobo above the `168300` the escrowed projection computes (`ComputeLegs(200000, fee 2000)`), for the mirror-image reason: paid and projected differ on both rows, so neither read can collapse into the other. Production never writes a non-zero `provider_kobo` on an unsettled row — `Settle` fills it in the same transaction that flips the status — so the fixture's value is deliberately unreal in one direction and deliberately off-by-one in the other. Three money predicates in this file were proven by deleting them, and the composed reads' two `SUM`s were re-proven the same way; both transcripts are comments on this PR.
- The doctor app now has two fields labelled "pending": consult money escrowed but unsettled (this tile) and the wallet's pending payout (batch 6). Different payloads, different screens, nothing adds them. If that reads as confusing in the product, the fix is the tile's label, not the data.
EOF
)"
```

- [ ] **Step 6b: Post the mutation transcripts, so the money proof travels with the PR**

The transcripts are the only artifacts that show the SQL predicates behind the money were tested by deleting them, and they live in a git-ignored workspace. Check both carry no DSN before posting, and post the transcripts rather than the fix reports — the reports speak in the plan's internal vocabulary ("the brief") a PR reader does not have:

```bash
cd /private/tmp/spot-doctor-metrics
grep -c 'postgresql://' .superpowers/sdd/2026-11-13-doctor-dashboard-metrics/task-2-mutation.md .superpowers/sdd/2026-11-13-doctor-dashboard-metrics/task-3-mutation.md
{ printf '> Each money predicate in `consultRevenue`/`settledQ`/`escrowedQ` was checked by deleting it and re-running the live test. Round 1 is Task 2 (the status and module filters); round 2 is Task 3 (both `SUM` aggregates, the composition, the `Metrics.Today` string and the ROUND rule). "the brief" below means the per-task instruction sheet derived from the plan.\n\n'; cat .superpowers/sdd/2026-11-13-doctor-dashboard-metrics/task-2-mutation.md; printf '\n---\n\n'; cat .superpowers/sdd/2026-11-13-doctor-dashboard-metrics/task-3-mutation.md; } > /tmp/pr-mutation-comment.md
gh pr comment --body-file /tmp/pr-mutation-comment.md
rm -f /tmp/pr-mutation-comment.md
```

Expected: the `grep -c` prints `0` for both files — if either line shows anything else, stop and do not post. `gh pr comment` prints the new comment's URL; report it, since it is the citation for the money filters.

- [ ] **Step 7: Watch the lane this module owns**

```bash
cd /private/tmp/spot-doctor-metrics && gh pr view --json number,headRefOid,mergeStateStatus && gh pr checks --watch
```

`gh pr checks` needs `--paginate` if you enumerate runs via `gh api` instead — an unpaged check list can hide a red job. Report the actual job names and conclusions; the module lane is `Doctor CI` (`backend`, `openapi`, `mobile-typecheck`, `migration-guard` — this PR adds no migration, so `migration-guard` is a no-op pass).

---

## Follow-ups this plan deliberately does not take on

The spec's own registry carries F1–F5 (this list said "F1–F4" until Task 4's review noticed the
spec had grown an F5 — the timezone screen #1027 repairs); F6 and F7 were added by Task 5's review.
Each is its own change:

- **F1** — fold `ListAppointments`' SQL and `DashboardQueueAppointment`'s SQL into one const and switch the queue to `GET /appointments?scope=today&limit=20`, once the neighbour's appointment-plane branch has merged.
- **F2** — the rest of `mobile-app/reactnative/docs/QA_DOCTOR_BATCH1_REPORT.md` is still unverified against live mode; only D1/D2/D13 are corrected here, because those are the ones this change makes true.
- **F3** — `Available` is the whole `user_wallet`, so a doctor's own refunds sit inside it. Renaming the tile to "Wallet" is a product call.
- **F4** — widen `ConsultType` to the four real `consultation_type` values and give `in_person` its own icon; touches the telemedicine vertical's shared type and every consumer. Two things whoever picks this up should know, both learned in Task 6's review: keying `AppointmentRow`'s `TYPE_ICON` by `string` **removed the exhaustiveness error** that would otherwise have flagged the new member there (T6-R5), so restoring `Record<ConsultType, LucideIcon>` is part of this follow-up, not a later tidy — and `?? FALLBACK_ICON` never guards inherited keys, since `TYPE_ICON['constructor']` is truthy (T6-R4); the DB CHECK constraint is what makes that safe today, so do not present the fallback as input validation.
- **F5** — the timezone screen cannot save in live mode, so the zone D3 reads is usually the default. Spec F5, verbatim; PR #1027 (`feat/doctor-portal-remaining-gaps`, still OPEN at 2026-11-15) adds the missing `Timezone` field to `ScheduleSettings` and closes it. Not ours to fix here.
- **F6** — `metrics.ratingCount` is typed in `DashboardMetricsWire` and read by nobody. The server always sends it (`required` in the contract, `RatingCount int64` in `dashboard_metrics.go`, set from `rep.ReviewCount`) and it is the only proof of the satisfaction percentage's size, but `DoctorDashboardData` has no field to carry it, so the tile can only ever say "96%". Task 5's review proved this by deleting the declaration — all nine tests stayed green. Spec §D's tile copy asks for the percentage alone, so dropping it is conformant today; adding a "of 24 reviews" subtitle needs the domain type widened.
- **F7** — `metrics.timezone` and `metrics.today` are dropped the same way. The server computes the counts and the queue inside `doctor_availability.timezone` and returns the day it listed for, and that is exactly the midnight-boundary guarantee D2 relies on, but nothing carries it to the client. Task 6 is safe without it because each queue row's `slotDate` is the server's own string, copied and never recomputed; a future "Today, 13 Nov" heading would otherwise have to invent the day from the device clock.
- **F8** — `src/features/doctor/components/QueueItemRow.tsx:24,44` has the same `Record<ConsultType, LucideIcon>` lookup with no fallback as the row Task 6 fixes. It is not a live crash yet because `/queue` reads `doctor_consult_queue`, the orphan table no booking path writes (the spec's out-of-scope list); it becomes one the moment that table is wired. Deliberately untouched: Task 6's brief is that one component, and widening it would let a fix ride along with an unverifiable claim.
- **F9** — no gate in this package typechecks a `node:test` spec. `mobile-app/reactnative/tsconfig.json:12-17` excludes `**/__tests__/**` and `tsconfig.doctorcheck.json` inherits that list, so `--listFiles` under the doctor config contains zero test files even though its `include` names the directory. Adding a test file to `include` cannot fix it: under TS's `extends`, a child's `exclude` replaces the inherited array rather than narrowing it, so the change is to restate `exclude` in the child without the `__tests__` pattern (and to decide whether the whole-app `typecheck` should keep excluding them — that is what keeps `banking` and `tsconfig.merchant.json` out). Do not believe such an edit until `npx tsc --noEmit --listFiles -p tsconfig.doctorcheck.json | grep -c __tests__` prints a nonzero number, which is the same command that measured the blindness. Out of scope here because it changes a shared gate, and Task 5's suite already runs the spec under `--experimental-strip-types`, so a wrong *value* is caught even where a wrong *type* is not.
- **F10** — the dashboard cannot tell a doctor that it does not know yet. Task 7's review (T7-R1) measured
  the state honestly and I declined its one-line remedy, so the reasoning belongs here rather than in a
  resolved-finding table. Measured: `mockAllowed('false', true) → false`, so `doctorPlaceholder`
  (`src/api/doctor.client.ts:16-18`) gives react-query `placeholderData: undefined` and an observer
  reports `data = undefined / isPending = true`; `GetDashboard` issues its reads one after another
  (`backend/internal/doctor/service_tail2.go:154-179`, seven visible there) against one for `/profile`,
  so the tiles usually paint before the aggregate exists, and on `dashError` they stay that way. The suggestion was to render
  `…` while `dashboard == null` at `app/(doctor)/(tabs)/index.tsx:181`. Not taken, for three reasons that
  are all measurements: (a) `…` has no precedent as a *value* in this vertical — every `'…'` site is a
  busy button label or a truncated string (`dues/index.tsx:51`, `consult/[id]/call.tsx:281`,
  `connect/voting/leaderboard.tsx:51`, `services/food.tsx:370`), while `—` is the established no-figure
  glyph, including for a number still arriving (`(tabs)/earnings.tsx:73` renders
  `wLoading && !wallet ? '—' : formatKobo(…)`, plus six `|| '—'` sites in `app/(doctor)/`); (b) gating one
  tile of five makes the screen internally dishonest — during the same load `Today's consults`, `Upcoming`
  and `Available` render `0`, `0` and `₦0` from `?? 0` and the queue renders the words "No consults
  scheduled" (`index.tsx:312`), which assert more firmly than an em dash does; (c) a real fix needs a
  loading affordance that `StatCard` does not have — its `Props` (`components/StatCard.tsx:10-16`) carry
  no state beyond `value: string` (`:13`), rendered in a `numberOfLines={1}` Text (`:27`) — so it is a
  design change, not a ternary. What *is* done here:
  Task 8's D13 row says the glyph's whole meaning instead of one case of it. Whoever takes this should
  land the affordance and then pin the rule where a gate runs it — T7-R7's shape, a pure
  `satisfactionTile(dashboard)` under `src/features/doctor/` (outside `__tests__`, so
  `tsconfig.doctorcheck.json` typechecks it) with cases for `undefined`, `null`, `0` and `96`. That
  module is deliberately not created for the status quo: a test asserting the two branches this round
  chose not to separate would be structure built around a decision rather than a requirement.
  T7-R2's truncation is the same family — the queue is `LIMIT 20` (`dashboard_metrics.go:243`,
  `dashboardQueueLimit = 20` at `:41`) under a header that says "Today's queue" with no "showing 20 of
  31" line, and its two protective live-DB tests (`dashboard_metrics_live_db_test.go:307,825`) **skip**
  without `TEST_DATABASE_URL`, which the review measured — so on any laptop clone that guard is silent.
- **F11** — four `DoctorDashboardData` arrays are hard-coded empty in live mode, and the screen's copy
  does not say so. `dashboardWire.ts:117-120` returns `[]` for `pendingRequests`, `waitingRoom`,
  `messages` and `alerts`, and `:108-109,:111-114` return `0` for `waitingRoom`, `followUpRequests`,
  `newLabResults`, `pendingPrescriptions`, `refillRequests` and `hmoApprovals`. So "Needs attention"
  (`index.tsx:230,232`) and "Recent messages" (`:253`) can never render for a live-mode doctor, and the
  Waiting chip is dead — yet each section is written as ordinary content and the endpoint simply has no
  field for them. Task 7's
  review (T7-R4) raised this while asking only about a stale comment on the neighbouring field; the arrays
  are a Task 5 decision that deserves its own line, not a comment edit that implies they are wired. The
  honest options are a server field per section or copy that says the section is unavailable — either way
  it is a contract change, which is why it is not in this PR (spec "Out of scope": every read here uses
  columns and tables that already exist).
- **F12** — the batch-1 QA report's Section D table cites `(tabs)/index.tsx` against three revisions at
  once, and only the three rows this PR rewrote are current. Task 8's implementer noticed the neighbours
  looked wrong; the Task 8 reviewer then found *why*, and the answer changes the character of the defect:
  these are not bad cites as written, they are **drift**. The table was authored against the 378-line
  file at `5526a8bc1`/`6db1dd494`, where D12's `:171` genuinely is `label="Available"` and D3's `:198`
  genuinely is the requests `Pressable`. Measured then, still true then, stale twice over since.
  The three baselines, all counted: **378** lines at authoring, **398** on `origin/main`, **395** at this
  branch's HEAD. At HEAD the stale rows land where the report's own "Cite baseline." note now says:
  Available `:180` (D12 quotes `:171`, which is a closing `</Pressable>`), the active-consultation card
  opens at `:185` (D4 quotes `176-193`), the two deep-links are `:207` and `:212` (D3 quotes `:198`, an
  inner `activeConsultation.ref` `Text`, and D5 quotes `:203`, a blank line), and the alert-sort
  comparator sits at `:81-83` — cite it as a range, because `origin/main`'s equivalent of D12's
  three-line note is `:84-86` and naming only its middle line (`:85`) sends a reader to one line where
  there are three.
  Direction matters, so do not trust the earlier wording in this plan, which said the branch shifted
  things "down by 3" and was wrong: `git diff --numstat` gives **6 insertions / 9 deletions** across
  **6** hunks (`-15,15 +15,13`, `-57,7 +55,6`, `-68,7 +65,6`, `-81,6 +77,7`, `-176,12 +173,12`,
  `-311,10 +308,10`; four change the line count, two are net zero), so the file is three lines *shorter*
  and everything below the deletions moved **up** in numbering. That shrank D12's error from twelve lines
  on main to nine at HEAD — this branch helped, by accident, and "correct by adding 3" is the trap the
  wrong word would have set.
  Scope, measured rather than estimated: Section D has 21 rows and **14** lines in it cite `index.tsx`;
  10 of those are rows, so **7 rows plus the non-row notes** carry the stale numbering — not "twelve
  rows", which is what this plan previously guessed. Repairing them means re-verifying each row's
  *verdict* against live mode (that is F2's job, and it is bigger than a line-number sweep), so they
  stay tracked. What this PR could do cheaply was tell the reader which numbering they are looking at,
  and the note added to the report's correction blockquote now does that — in HEAD's numbers, because a
  reader of this file is on HEAD.
- **F13** — the auth guard on `GET /dashboard` is now covered; what remains unexercised is narrower than
  this entry first claimed. The Task 8 reviewer caught the original wording over-claiming in both
  directions: it said "registration and auth were never in doubt" while its own body listed the
  middleware chain as untested, and it implied the handler had never been driven as HTTP when the
  package already had a table doing exactly that for four sibling reads. Both were fair hits. The gap is
  now closed at the boundary that was actually missing: `TestReads_NoAuth` in
  `backend/internal/doctor/handler_test.go:61-85` gained a `{"GetDashboard", http.MethodGet, "/dashboard", …}`
  case, and `go test ./internal/doctor/ -run TestReads_NoAuth -count=1 -v` reports
  `--- PASS: TestReads_NoAuth/GetDashboard (0.00s)` with `ok spotlight/backend/internal/doctor 2.909s`.
  That assertion is not vacuous: a route the test failed to register would give 404, and an unguarded
  handler built on `doctor.NewHandler(nil)` would reach the nil service and panic rather than answer 401,
  so a 401 can only come from `h.userID(c)` at `handler_tail2.go:187-190` aborting first.
  Still unproven, and deliberately left so: the *wiring* of `RequireAuthContext` on the real `docGroup`
  (`backend/internal/app/finance_routes.go:3098-3099`, registered at `:3535`) is a static fact no test
  executes end to end — this test injects the same `middleware.AuthUserContextKey` the real middleware
  sets, which is the file's documented substitute (`handler_test.go:18-24`) — and the success path's
  status code and envelope with a real database have no gin-level test either. `TestLiveDB_Dashboard*`
  asserts on `json.Marshal(res)` (`dashboard_metrics_live_db_test.go:775,779,788`), which proves the keys
  the mapper consumes but not what `c.JSON` puts on the wire — and, the whole-branch review measured
  (S-1), not even the *path*: those two assertions are `strings.Contains` of a leaf, so renaming
  `Metrics`' tag leaves `"todaysCount":2,` in the blob while `dashboardWire.ts`'s `wire.metrics ?? {}`
  falls back to zeros and all 13 live tests stay green. That mechanism is now reproduced as a guard:
  `TestDashboardSummaryWirePaths` (`dashboard_metrics_test.go`) walks the 28 dotted paths the client
  reads and forbids `omitempty` on the five dashboard types. It needs no database, so it bites on a
  laptop and not only in the `live-db` lane, and it is mutation-proven three ways — parent tag renamed
  (10 path subtests plus 4 zero-dashboard keys go red, 14 assertions in all, while the old
  `"todaysCount":2,` substring is still present in that same payload), `omitempty` added to
  `UpcomingCount`, and the two count tags swapped. The CI `live-db` job re-runs the service
  suite on a clean migrated schema (`ci.yml`'s `dbscope` keys it on `^backend/`, and six of this branch's
  files are under `backend/`), so the service half is gated in public; the gin-envelope half would need a
  helper this package does not have, and the same absence applies to `/vet/dashboard` and
  `/records/dashboard`, so writing it is a follow-up worth doing once across all three.
- **F14** — drop `reason` from the dashboard queue payload. `AppointmentRow.tsx:31-56` renders name,
  initials, avatarColor, `slotDate`, `slotTime`, status and the HMO badge — nothing else, so
  `reason` (=`appointments.notes`, the patient's own words) travels to the device for up to 20
  patients on every dashboard load unread. Unlike `ref`, `feeKobo`, `createdAt` and
  `patient.{age,gender}` — which `mapAppointmentWire`'s shared `DoctorAppointment` type *requires*,
  so dropping them would leave the mapper inventing values — `reason` is declared optional
  (`types/doctor.ts`), so it is the one field that can genuinely go. It sits in
  `contracts/doctor.openapi.yaml:138`'s `required` list, which makes the removal a contract change and
  is the reason this is a follow-up rather than a last-minute edit; `dashboard_metrics.go:71-83` now
  records why every field rides until then.
- **F15** — `src/features/doctor/batch6Wire.ts:79-81` asserts that "the two earnings paths cannot
  disagree about the same doctor's money". This branch added a third `lifetimeKobo`
  (`dashboardWire.ts:130`, Σ settled consult legs) beside that file's ledger balance (`:88`), so the
  invariant the comment states is what broke. No screen shows both numbers, and `dashboardWire.ts` now
  names the difference at its own call site; the stale sentence is in a file outside this branch's
  diff, so correcting it belongs here.
- **F16** — a failed dashboard is indistinguishable from an empty one on screen. `GetDashboard` went
  from three reads to six, so any one of `doctor_reviews`/`settlements`/`appointments`/
  `doctor_profiles` failing returns 500, and `index.tsx:176-181,311-312` renders `0`, `0`, `—` and "No
  consults scheduled" — while the only error surface on the screen (`:226-228`) is a `StateView` whose
  message is about *alerts*. The server refuses to let a broken query look like a zero; the client
  composition undoes that. Needs the same product answer F10 asks for (what does a tile say when it
  does not know yet), so do the two together.
- **F17** — a silently downgraded timezone is unknowable on screen. `usableTimezone`
  (`dashboard_metrics.go:169`) falls back to `Africa/Lagos` on a Postgres `22023` with only a
  `log.Printf`, the resolved zone ships as `metrics.timezone`, and `dashboardWire.ts:34` declares it
  and reads it nowhere — as it does `metrics.today` (F7). So that doctor's day boundaries are priced in
  Lagos with no signal, and the queue cannot be headed with the server's day. F5/#1027 makes this live
  soon, because the zone this read uses is the one the settings screen currently cannot save.
- **F18** — the settled-legs join has no 1:1 guard. `settledQ`/`escrowedQ`
  `JOIN appointments a ON a.settlement_id = st.id` with no `DISTINCT` and no `GROUP BY st.id`; the
  invariant holds only because the sole writer of `appointments.settlement_id` in the whole backend is
  `telemedicine/service.go:573`, one fresh settlement per booking insert. A second writer would
  double-count the same settlement once per appointment, silently.
- **F19** — nothing pins the *composition's* day anchor. `todayQueue` takes `$3::date` from
  `agg.Today` (`service_tail2.go:171-173`), which is correct, but the one assertion that looks like
  proof (`dashboard_metrics_live_db_test.go:732`, `SlotDate != Metrics.Today`) is a tautology — the
  WHERE clause forces the two to agree for every row it returns — and the two seeded-day tests use
  Lagos slots at 08:00–14:00, where the local and UTC days coincide. Passing the wrong day into
  `todayQueue` from `GetDashboard` is uncaught; the falsifier is a Karachi-vs-Lagos crossing fixture
  that calls the service, not the repository.
- **F20** — the two month figures ride different clocks. `consultsThisMonth` filters on the
  **scheduled** month (`dashboard_metrics.go:197-198`) while `thisMonthKobo` filters on the **settled**
  month (`:323-324`), so a consult completed last month and settled today is this month's money inside
  a count that omits it. Latent: no tile renders either today.
- **F21** — two money states sit outside both reads. `settlements.status` also allows `releasing` and
  `disputed`, and neither appears in `settledQ` or `escrowedQ`. Measured safe for now — no writer sets
  either for telemedicine (`grep -rn "StatusReleasing|StatusDisputed"` over `backend/` hits only
  restaurant, transport, fractionalre and paystackcheckout readers) — so it errs low and never
  double-counts, but it is unguarded against the day a consult can be disputed.
