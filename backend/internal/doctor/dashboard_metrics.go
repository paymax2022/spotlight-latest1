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

// defaultDoctorTimezone mirrors the NOT NULL DEFAULT of doctor_availability.timezone
// (20260625000000_doctor_module.sql:164) — the same fallback the write path applies
// at repository.go:149 with strOrDefault(in.Timezone, "Africa/Lagos").
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
// column `PUT /schedule/timezone` writes and GET /schedule reads back — NOT
// doctor_availability.timezone, which no screen ever sets (a doctor who chose
// Asia/Karachi on the timezone screen would otherwise have every "today"
// predicate anchored to Lagos). A doctor with no profile row at all is the
// default, not an error.
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
