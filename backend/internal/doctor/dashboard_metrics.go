package doctor

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"spotlight/backend/go-common/dbutil"
	"spotlight/backend/internal/finance/settlement"
	"strings"
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
// doctor_availability.timezone (same file, :165). It is the same literal the availability
// write path applies at repository.go:149 with strOrDefault(in.Timezone, "Africa/Lagos").
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
	ID          string                `json:"id"`
	Ref         string                `json:"ref"`
	Patient     DashboardQueuePatient `json:"patient"`
	ConsultType string                `json:"consultType"`
	Status      string                `json:"status"`
	SlotDate    string                `json:"slotDate"`
	SlotTime    string                `json:"slotTime"`
	FeeKobo     int64                 `json:"feeKobo"`
	Reason      string                `json:"reason"`
	IsHMO       bool                  `json:"isHmo"`
	CreatedAt   string                `json:"createdAt"`
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
// column, not this one. Since #1008 that is not hypothetical: `Schedule`
// (handler_tail2.go:499, model.go:76) is typed `Availability`, and the
// appointments plane renders slots with `AT TIME ZONE COALESCE(av.timezone, …)`
// (repository.go:220). So the same doctor's dashboard and appointment list can
// price "today" against two different columns — spec F5 documents the screen
// that fails to write this one. A doctor with no profile row at all is the default,
// not an error.
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
	return s.repo.usableTimezone(ctx, p.Timezone)
}

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
//
// The argument is trimmed before it is probed and before it is returned, because
// this server rejects a padded name — `AT TIME ZONE 'Africa/Lagos '` raises the
// same 22023 as a bogus zone — and the write path stores the request body
// verbatim, so the likeliest accidental value is the trailing space a paste or a
// picker leaves behind. Trimming keeps that doctor's real zone; a value that is
// only whitespace trims to "", which the probe rejects and therefore degrades to
// the default, which is already what a blank zone costs them.
func (r *Repository) usableTimezone(ctx context.Context, tz string) (string, error) {
	tz = strings.TrimSpace(tz)
	const probe = `SELECT to_char(CURRENT_TIMESTAMP AT TIME ZONE $1::text, 'YYYY-MM-DD')`
	var day string
	if err := r.db.QueryRow(ctx, probe, tz).Scan(&day); err != nil {
		// 22023 = invalid_parameter_value, which is what an unrecognised zone
		// raises. Anything else — a dead pool, a lost connection — is a real
		// failure and must surface rather than hide behind the default.
		if dbutil.SQLState(err) == "22023" {
			log.Printf("[doctor] dashboard timezone %q rejected by postgres, projecting %s instead", tz, defaultDoctorTimezone)
			return defaultDoctorTimezone, nil
		}
		return "", fmt.Errorf("doctor: probe timezone %q: %w", tz, err)
	}
	return tz, nil
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
