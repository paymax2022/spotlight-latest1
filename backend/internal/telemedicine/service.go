package telemedicine

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"spotlight/backend/internal/finance/settlement"
)

// Service manages doctors, appointments, prescriptions, SOAP notes, and pharmacy.
type Service struct {
	db         *pgxpool.Pool
	settlement *settlement.Service
	// platformFeeBp is the booking fee rate in basis points, resolved from
	// FEATURE_TELEMEDICINE_PLATFORM_FEE_ENABLED at wiring time. Zero (the default)
	// means the flag is off and consultations price exactly as they did before
	// ADR-040 — the patient pays the consultation fee alone.
	platformFeeBp int
}

// NewService builds the service with the platform booking fee OFF. The fee is a
// patient-visible price increase, so it is opt-in: it charges only once
// WithPlatformFeeBp has been wired from the feature flag. An unwired service
// under-charges rather than over-charges, which is the safe direction to fail.
func NewService(db *pgxpool.Pool, settlement *settlement.Service) *Service {
	return &Service{db: db, settlement: settlement}
}

// WithPlatformFeeBp enables the platform booking fee at the given rate in basis
// points (telemedicine.PlatformFeeBp = 500 = 5%). Pass 0 to disable — that is the
// rollback path, and it needs no redeploy of the app: the client renders whatever
// quote the server returns, so the fee row drops to ₦0 and the escrow drops to the
// consultation fee on the next request. See ADR-040.
func (s *Service) WithPlatformFeeBp(bp int) *Service {
	if bp < 0 {
		bp = 0
	}
	s.platformFeeBp = bp
	return s
}

// quote prices a consultation at this service's configured rate.
func (s *Service) quote(consultFeeKobo int64) BookingQuote {
	return QuoteAt(consultFeeKobo, s.platformFeeBp)
}

// ─── Specialties ─────────────────────────────────────────────────────────────

// ListSpecialties returns all consultation specialty categories.
func (s *Service) ListSpecialties(ctx context.Context) ([]Specialty, error) {
	const q = `
		SELECT ds.id, ds.slug, ds.name, ds.description, ds.icon, ds.is_featured,
		       (SELECT COUNT(*) FROM doctors d WHERE d.specialty = ds.slug AND d.is_available = TRUE) AS doctor_count
		FROM doctor_specialties ds
		ORDER BY ds.sort_order`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Specialty
	for rows.Next() {
		var sp Specialty
		if err := rows.Scan(&sp.ID, &sp.Slug, &sp.Name, &sp.Description, &sp.Icon, &sp.IsFeatured, &sp.DoctorCount); err != nil {
			return nil, err
		}
		out = append(out, sp)
	}
	return out, rows.Err()
}

// ─── Doctors ─────────────────────────────────────────────────────────────────

// RegisterDoctor creates a doctor profile for an authenticated user (legacy v1).
func (s *Service) RegisterDoctor(ctx context.Context, userID string, req RegisterDoctorRequest) (*Doctor, error) {
	d := &Doctor{
		ID:             uuid.New().String(),
		UserID:         userID,
		Name:           req.Name,
		Specialty:      req.Specialty,
		Bio:            req.Bio,
		ConsultFeeKobo: req.ConsultFeeKobo,
		AvatarURL:      req.AvatarURL,
		IsAvailable:    true,
		Education:      []Education{},
		CreatedAt:      time.Now(),
	}
	quote := s.quote(d.ConsultFeeKobo)
	d.Booking = &quote
	const q = `INSERT INTO doctors (id, user_id, name, specialty, bio, consult_fee_kobo, avatar_url, is_available, education)
	            VALUES ($1,$2,$3,$4,$5,$6,$7,true,'[]'::jsonb)`
	_, err := s.db.Exec(ctx, q, d.ID, d.UserID, d.Name, string(d.Specialty), d.Bio, d.ConsultFeeKobo, d.AvatarURL)
	return d, err
}

// RegisterDoctorV2 creates a richer doctor profile (health premium flow).
func (s *Service) RegisterDoctorV2(ctx context.Context, userID string, req RegisterDoctorV2Request) (*Doctor, error) {
	d := &Doctor{
		ID:              uuid.New().String(),
		UserID:          userID,
		Name:            req.FullName,
		Specialty:       DoctorSpecialty(req.Specialty),
		ExperienceYears: req.YearsExperience,
		IsAvailable:     false, // available only after verification
		IsOnline:        false,
		IsHMOVerified:   false,
		Education:       []Education{},
		CreatedAt:       time.Now(),
	}
	mdcn := req.MDCNNumber
	phone := req.Phone
	d.MDCNNumber = &mdcn
	d.Phone = &phone
	const q = `
		INSERT INTO doctors
		    (id, user_id, name, specialty, experience_years, mdcn_number, phone, is_available, education)
		VALUES ($1,$2,$3,$4,$5,$6,$7,false,'[]'::jsonb)`
	_, err := s.db.Exec(ctx, q, d.ID, d.UserID, d.Name, string(d.Specialty), d.ExperienceYears, mdcn, phone)
	return d, err
}

// ListDoctors returns available doctors with extended filters.
func (s *Service) ListDoctors(ctx context.Context, q ListDoctorsQuery) ([]Doctor, error) {
	if q.Limit <= 0 || q.Limit > 100 {
		q.Limit = 20
	}

	args := []any{q.Limit, q.Offset}
	var filters []string
	filters = append(filters, "d.is_available = TRUE")

	if q.SpecialtyID != "" {
		args = append(args, q.SpecialtyID)
		filters = append(filters, fmt.Sprintf("d.specialty = $%d", len(args)))
	}
	if q.AvailableNow {
		filters = append(filters, "d.is_online = TRUE")
	}
	if q.MinExperience > 0 {
		args = append(args, q.MinExperience)
		filters = append(filters, fmt.Sprintf("d.experience_years >= $%d", len(args)))
	}
	if q.Search != "" {
		args = append(args, "%"+strings.ToLower(q.Search)+"%")
		filters = append(filters, fmt.Sprintf("(LOWER(d.name) LIKE $%d OR LOWER(d.specialty) LIKE $%d)", len(args), len(args)))
	}

	orderBy := "d.name"
	if q.TopRated {
		orderBy = "d.rating DESC, d.review_count DESC"
	}

	where := strings.Join(filters, " AND ")
	sql := fmt.Sprintf(`
		SELECT d.id, d.user_id, d.name, d.specialty, d.sub_specialty, d.bio, d.about,
		       d.consult_fee_kobo, d.avatar_url, d.is_available, d.is_online, d.is_hmo_verified,
		       d.experience_years, d.rating, d.review_count, d.patients_count, d.success_rate,
		       d.mdcn_number, d.phone, d.education, d.created_at
		FROM doctors d
		WHERE %s
		ORDER BY %s
		LIMIT $1 OFFSET $2`, where, orderBy)

	rows, err := s.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanDoctors(rows, s.platformFeeBp)
}

// GetDoctor returns a single doctor profile by ID.
func (s *Service) GetDoctor(ctx context.Context, id string) (*Doctor, error) {
	const q = `
		SELECT d.id, d.user_id, d.name, d.specialty, d.sub_specialty, d.bio, d.about,
		       d.consult_fee_kobo, d.avatar_url, d.is_available, d.is_online, d.is_hmo_verified,
		       d.experience_years, d.rating, d.review_count, d.patients_count, d.success_rate,
		       d.mdcn_number, d.phone, d.education, d.created_at
		FROM doctors d WHERE d.id = $1`
	rows, err := s.db.Query(ctx, q, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	doctors, err := scanDoctors(rows, s.platformFeeBp)
	if err != nil {
		return nil, err
	}
	if len(doctors) == 0 {
		return nil, fmt.Errorf("telemedicine: doctor not found")
	}
	return &doctors[0], nil
}

// ToggleDoctorAvailability sets a doctor's online status.
func (s *Service) ToggleDoctorAvailability(ctx context.Context, userID string, isOnline bool) error {
	tag, err := s.db.Exec(ctx,
		`UPDATE doctors SET is_online=$1, is_available=$1 WHERE user_id=$2`,
		isOnline, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("telemedicine: doctor profile not found for user")
	}
	return nil
}

// GetDoctorDashboard returns aggregated stats and schedule for a doctor.
func (s *Service) GetDoctorDashboard(ctx context.Context, userID string) (*DoctorDashboard, error) {
	// Verify doctor exists and get ID/rating/online status.
	var doctorID string
	var rating float64
	var isOnline bool
	var patientsCount int
	err := s.db.QueryRow(ctx,
		`SELECT id, rating, is_online, patients_count FROM doctors WHERE user_id=$1`,
		userID).Scan(&doctorID, &rating, &isOnline, &patientsCount)
	if err != nil {
		return nil, fmt.Errorf("telemedicine: doctor not found")
	}

	// Weekly revenue from completed appointments.
	var weeklyRevenue int64
	_ = s.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(fee_kobo * 0.85), 0)
		FROM appointments
		WHERE doctor_id = $1
		  AND status = 'completed'
		  AND created_at >= NOW() - INTERVAL '7 days'`, doctorID).Scan(&weeklyRevenue)

	// Prior-week revenue for growth %.
	var priorRevenue int64
	_ = s.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(fee_kobo * 0.85), 0)
		FROM appointments
		WHERE doctor_id = $1
		  AND status = 'completed'
		  AND created_at >= NOW() - INTERVAL '14 days'
		  AND created_at < NOW() - INTERVAL '7 days'`, doctorID).Scan(&priorRevenue)

	var growthPct float64
	if priorRevenue > 0 {
		growthPct = float64(weeklyRevenue-priorRevenue) / float64(priorRevenue) * 100
	}

	// Today's patient count (completed this week).
	var patientsSeen int
	_ = s.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM appointments
		WHERE doctor_id=$1 AND status='completed'
		  AND scheduled_at >= NOW() - INTERVAL '7 days'`, doctorID).Scan(&patientsSeen)

	stats := DashboardStats{
		WeeklyRevenueKobo: weeklyRevenue,
		RevenueGrowthPct:  growthPct,
		PatientsSeen:      patientsSeen,
		Rating:            rating,
		IsOnline:          isOnline,
	}

	// Pending requests — booked appointments not yet confirmed.
	pendingRows, err := s.db.Query(ctx, `
		SELECT a.id, a.notes, a.created_at
		FROM appointments a
		WHERE a.doctor_id=$1 AND a.status='booked'
		ORDER BY a.created_at ASC LIMIT 5`, doctorID)
	if err != nil {
		return nil, err
	}
	defer pendingRows.Close()
	var pending []PendingReq
	for pendingRows.Next() {
		var pr PendingReq
		var notes string
		if err := pendingRows.Scan(&pr.ID, &notes, &pr.CreatedAt); err != nil {
			return nil, err
		}
		pr.PatientName = "Patient"
		pr.RequestType = firstWord(notes, "Consultation")
		pending = append(pending, pr)
	}

	// Today's confirmed/in-progress appointments.
	apptRows, err := s.db.Query(ctx, `
		SELECT a.id, a.scheduled_at, a.consultation_type, a.notes, a.status
		FROM appointments a
		WHERE a.doctor_id=$1
		  AND a.status IN ('booked','confirmed')
		  AND a.scheduled_at::date = CURRENT_DATE
		ORDER BY a.scheduled_at ASC LIMIT 10`, doctorID)
	if err != nil {
		return nil, err
	}
	defer apptRows.Close()
	var scheduled []ScheduledAppt
	for apptRows.Next() {
		var sa ScheduledAppt
		var scheduledAt time.Time
		var reason string
		if err := apptRows.Scan(&sa.ID, &scheduledAt, &sa.Type, &reason, &sa.Status); err != nil {
			return nil, err
		}
		sa.Time = scheduledAt.Format("15:04")
		sa.PatientName = "Patient"
		sa.Reason = reason
		scheduled = append(scheduled, sa)
	}

	return &DoctorDashboard{
		Stats:              stats,
		PendingRequests:    coalesceReqs(pending),
		TodaysAppointments: coalesceAppts(scheduled),
	}, nil
}

// ─── Appointments ────────────────────────────────────────────────────────────

// assertDoctorApproved is the fail-closed MDCN credential gate. A telemedicine
// doctor (doctors.user_id) may only take/complete consultations once their MDCN
// verification is APPROVED. The authoritative approval lives in the doctor module
// (doctor_verifications.status='approved'), mirrored onto doctor_profiles.
// verification. We accept either signal as approved; the absence of any approved
// record is treated as NOT approved (fail-closed). A missing verification table in
// a partially-migrated environment also fails closed.
func (s *Service) assertDoctorApproved(ctx context.Context, doctorUserID string) error {
	var approved bool
	const q = `
		SELECT EXISTS (
			SELECT 1 FROM doctor_verifications
			WHERE user_id = $1 AND status = 'approved'
		) OR EXISTS (
			SELECT 1 FROM doctor_profiles
			WHERE user_id = $1 AND verification = 'approved'
		)`
	if err := s.db.QueryRow(ctx, q, doctorUserID).Scan(&approved); err != nil {
		// Fail-closed: if we cannot confirm approval, do not permit the action.
		return fmt.Errorf("telemedicine: doctor credential not verified")
	}
	if !approved {
		return fmt.Errorf("telemedicine: doctor is not MDCN-approved for consultations")
	}
	return nil
}

// assertSlotFree rejects a booking when the doctor already has an active
// appointment (not cancelled/completed) at the same scheduled_at.
func (s *Service) assertSlotFree(ctx context.Context, doctorID string, scheduledAt time.Time) error {
	var taken bool
	const q = `
		SELECT EXISTS (
			SELECT 1 FROM appointments
			WHERE doctor_id = $1 AND scheduled_at = $2
			  AND status NOT IN ('cancelled','completed')
		)`
	if err := s.db.QueryRow(ctx, q, doctorID, scheduledAt).Scan(&taken); err != nil {
		return fmt.Errorf("telemedicine: check slot availability: %w", err)
	}
	if taken {
		return fmt.Errorf("telemedicine: the selected time slot is no longer available")
	}
	return nil
}

// BookAppointment escrows the consultation fee and creates an appointment.
func (s *Service) BookAppointment(ctx context.Context, patientID string, req BookAppointmentRequest) (*Appointment, error) {
	var doctor Doctor
	const qD = `SELECT id, user_id, consult_fee_kobo, is_available, name, specialty FROM doctors WHERE id=$1`
	if err := s.db.QueryRow(ctx, qD, req.DoctorID).
		Scan(&doctor.ID, &doctor.UserID, &doctor.ConsultFeeKobo, &doctor.IsAvailable, &doctor.Name, &doctor.Specialty); err != nil {
		return nil, fmt.Errorf("telemedicine: doctor not found")
	}
	if !doctor.IsAvailable {
		return nil, fmt.Errorf("telemedicine: doctor is not currently available")
	}
	// Credential gate (fail-closed): a doctor may only take bookings once their MDCN
	// credential is APPROVED. is_available alone is a soft availability toggle and
	// MUST NOT bypass the licence check (safety hole).
	if err := s.assertDoctorApproved(ctx, doctor.UserID); err != nil {
		return nil, err
	}
	// Slot-collision guard: reject a booking when an active (not cancelled/completed)
	// appointment already occupies this doctor's slot at the same scheduled_at.
	if err := s.assertSlotFree(ctx, req.DoctorID, req.ScheduledAt); err != nil {
		return nil, err
	}

	// Price the booking SERVER-SIDE from the doctor's own consultation fee. The
	// client sends no amount it can be charged on: the platform fee is derived here
	// from PlatformFeeBp, so the figure displayed to the patient, the figure charged
	// and the figure escrowed are all the same number by construction (ADR-040).
	quote := s.quote(doctor.ConsultFeeKobo)
	if !quote.Priceable() {
		// Fail closed. A doctor whose stored fee is non-positive or absurd cannot be
		// booked — escrowing the zero total would give away a consultation free.
		return nil, fmt.Errorf("telemedicine: doctor's consultation fee is not bookable")
	}
	// Bound the card rail: it charges the client-quoted amount at the PSP before we
	// escrow, so a stale quote is caught here, before any money moves.
	if err := validateExpectedTotal(req.ExpectedTotalKobo, quote.TotalKobo); err != nil {
		return nil, err
	}

	apptID := uuid.New().String()
	ref := "appointment:" + apptID
	// Escrow the FULL total (consultation + platform fee). The platform fee is
	// released to platform revenue at settlement as its own 100%-platform leg, so
	// every kobo the patient pays has a ledger entry behind it.
	sett, err := s.settlement.Escrow(ctx, patientID, ref, req.IdempotencyKey, "telemedicine", quote.TotalKobo)
	if err != nil {
		return nil, fmt.Errorf("telemedicine: escrow fee: %w", err)
	}
	// Escrow is idempotent: a replay of this Idempotency-Key returns the settlement
	// that ALREADY exists, escrowed for whatever the price was on the first attempt.
	// We recompute the quote from the doctor's live consult_fee_kobo on every
	// attempt, so if the doctor edited their fee in between, the two disagree — and
	// writing the appointment from the fresh quote would record a price that was
	// never charged: the patient's receipt, the platform's fee and the doctor's
	// earnings figure would all describe money that does not exist in escrow.
	//
	// Fail closed against the escrow, which is the money that actually moved.
	if err := assertEscrowMatchesQuote(sett.TotalKobo, quote.TotalKobo); err != nil {
		return nil, err
	}

	ct := req.ConsultationType
	if ct == "" {
		ct = "video"
	}

	appt := &Appointment{
		ID:               apptID,
		PatientID:        patientID,
		DoctorID:         req.DoctorID,
		DoctorName:       doctor.Name,
		DoctorSpecialty:  string(doctor.Specialty),
		ConsultationType: ct,
		ScheduledAt:      req.ScheduledAt,
		Status:           ApptBooked,
		Notes:            req.Notes,
		// fee_kobo stays the CONSULTATION fee — the doctor-earnings queries compute
		// 85% of it. The platform fee and the escrowed total are their own columns.
		FeeKobo:         quote.ConsultFeeKobo,
		PlatformFeeKobo: quote.PlatformFeeKobo,
		TotalKobo:       quote.TotalKobo,
		IdempotencyKey:  req.IdempotencyKey,
		SettlementID:    sett.ID,
		CreatedAt:       time.Now(),
	}
	const q = `
		INSERT INTO appointments
		    (id, patient_id, doctor_id, doctor_name, doctor_specialty, consultation_type,
		     scheduled_at, status, notes, fee_kobo, platform_fee_kobo, total_kobo,
		     idempotency_key, settlement_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'booked',$8,$9,$10,$11,$12,$13)`
	if _, err := s.db.Exec(ctx, q,
		appt.ID, appt.PatientID, appt.DoctorID, appt.DoctorName, appt.DoctorSpecialty,
		appt.ConsultationType, appt.ScheduledAt, appt.Notes,
		appt.FeeKobo, appt.PlatformFeeKobo, appt.TotalKobo,
		appt.IdempotencyKey, appt.SettlementID,
	); err != nil {
		return nil, fmt.Errorf("telemedicine: insert appointment: %w", err)
	}
	return appt, nil
}

// ListMyAppointments returns the authenticated patient's appointments.
func (s *Service) ListMyAppointments(ctx context.Context, patientID, filter string) ([]Appointment, error) {
	var where string
	switch filter {
	case "upcoming":
		where = `AND a.scheduled_at >= NOW() AND a.status NOT IN ('cancelled','completed')`
	case "past":
		where = `AND (a.scheduled_at < NOW() OR a.status IN ('completed','cancelled'))`
	}
	sql := fmt.Sprintf(`
		SELECT a.id, a.patient_id, a.doctor_id,
		       COALESCE(a.doctor_name,''), COALESCE(a.doctor_specialty,''),
		       COALESCE(a.consultation_type,'video'),
		       a.scheduled_at, a.status, COALESCE(a.notes,''),
		       a.fee_kobo, COALESCE(a.platform_fee_kobo,0), COALESCE(NULLIF(a.total_kobo, 0), a.fee_kobo),
		       a.idempotency_key, COALESCE(a.settlement_id::text,''), a.created_at
		FROM appointments a
		WHERE a.patient_id = $1 %s
		ORDER BY a.scheduled_at DESC LIMIT 50`, where)
	rows, err := s.db.Query(ctx, sql, patientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAppointments(rows)
}

// GetAppointment returns a single appointment visible to the patient or doctor.
func (s *Service) GetAppointment(ctx context.Context, id, userID string) (*Appointment, error) {
	const q = `
		SELECT a.id, a.patient_id, a.doctor_id,
		       COALESCE(a.doctor_name,''), COALESCE(a.doctor_specialty,''),
		       COALESCE(a.consultation_type,'video'),
		       a.scheduled_at, a.status, COALESCE(a.notes,''),
		       a.fee_kobo, COALESCE(a.platform_fee_kobo,0), COALESCE(NULLIF(a.total_kobo, 0), a.fee_kobo),
		       a.idempotency_key, COALESCE(a.settlement_id::text,''), a.created_at
		FROM appointments a
		WHERE a.id = $1
		  AND (a.patient_id = $2 OR EXISTS (
		      SELECT 1 FROM doctors d WHERE d.id = a.doctor_id AND d.user_id = $2
		  ))`
	rows, err := s.db.Query(ctx, q, id, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	appts, err := scanAppointments(rows)
	if err != nil {
		return nil, err
	}
	if len(appts) == 0 {
		return nil, fmt.Errorf("telemedicine: appointment not found")
	}
	return &appts[0], nil
}

// CompleteAppointment marks an appointment as completed and settles the fee (85/15).
func (s *Service) CompleteAppointment(ctx context.Context, appointmentID, doctorUserID string) error {
	var appt Appointment
	const q = `SELECT id, doctor_id, status, settlement_id, COALESCE(platform_fee_kobo,0)
	            FROM appointments WHERE id=$1`
	if err := s.db.QueryRow(ctx, q, appointmentID).
		Scan(&appt.ID, &appt.DoctorID, &appt.Status, &appt.SettlementID, &appt.PlatformFeeKobo); err != nil {
		return fmt.Errorf("telemedicine: appointment not found")
	}
	if appt.Status != ApptBooked && appt.Status != ApptConfirmed {
		return fmt.Errorf("telemedicine: appointment is not in a completable state")
	}
	var dbDoctorUserID string
	if err := s.db.QueryRow(ctx, `SELECT user_id FROM doctors WHERE id=$1`, appt.DoctorID).
		Scan(&dbDoctorUserID); err != nil {
		return fmt.Errorf("telemedicine: doctor record not found")
	}
	if dbDoctorUserID != doctorUserID {
		return fmt.Errorf("telemedicine: only the assigned doctor can complete this appointment")
	}
	// The platform booking fee rides on TOP of the 85/15 split as a 100%-platform
	// leg (ServiceFeeKobo — the mirror of a rider tip), so it does not dilute the
	// doctor. Working Settle's algebra through with total = consult + fee:
	//
	//	base     = total − tip − serviceFee = consult
	//	platform = base×0.15 + serviceFee   = 0.15·consult + fee
	//	provider = total − platform         = 0.85·consult   ← unchanged
	//
	// Appointments escrowed before ADR-040 carry platform_fee_kobo = 0, which
	// reproduces the old pure 85/15 split exactly — they settle unchanged.
	split := settlement.Split{
		ProviderID:     doctorUserID,
		ProviderPct:    0.85,
		PlatformPct:    0.15,
		ServiceFeeKobo: appt.PlatformFeeKobo,
	}
	if err := s.settlement.Settle(ctx, appt.SettlementID, split); err != nil {
		return fmt.Errorf("telemedicine: settle fee: %w", err)
	}
	_, err := s.db.Exec(ctx, `UPDATE appointments SET status='completed' WHERE id=$1`, appointmentID)
	return err
}

// CancelAppointment refunds the patient if the appointment has not been completed.
// Only the patient who booked it or the assigned doctor may cancel.
func (s *Service) CancelAppointment(ctx context.Context, appointmentID, actorID string) error {
	var patientID, status, settlementID, doctorID string
	if err := s.db.QueryRow(ctx,
		`SELECT patient_id, doctor_id, status, settlement_id FROM appointments WHERE id=$1`,
		appointmentID).Scan(&patientID, &doctorID, &status, &settlementID); err != nil {
		return fmt.Errorf("telemedicine: appointment not found")
	}
	// Object-level authZ. `actorID` was previously accepted and never compared, so
	// any authenticated user could cancel any appointment by id — forcing a full
	// refund of a stranger's booking and denying the doctor their fee. Fail closed:
	// an unresolvable doctor record denies rather than falls through.
	if actorID != patientID {
		var doctorUserID string
		if err := s.db.QueryRow(ctx, `SELECT user_id FROM doctors WHERE id=$1`, doctorID).
			Scan(&doctorUserID); err != nil {
			return fmt.Errorf("telemedicine: not permitted to cancel this appointment")
		}
		if actorID != doctorUserID {
			return fmt.Errorf("telemedicine: not permitted to cancel this appointment")
		}
	}
	if status == string(ApptCompleted) {
		return fmt.Errorf("telemedicine: cannot cancel a completed appointment")
	}
	if err := s.settlement.Refund(ctx, settlementID, "appointment_cancelled"); err != nil {
		return fmt.Errorf("telemedicine: refund fee: %w", err)
	}
	_, err := s.db.Exec(ctx, `UPDATE appointments SET status='cancelled' WHERE id=$1`, appointmentID)
	return err
}

// IssuePrescription creates a prescription for a completed appointment.
func (s *Service) IssuePrescription(ctx context.Context, appointmentID, doctorUserID string, req IssuePrescriptionRequest) (*Prescription, error) {
	var patientID, doctorID, status string
	if err := s.db.QueryRow(ctx,
		`SELECT patient_id, doctor_id, status FROM appointments WHERE id=$1`,
		appointmentID).Scan(&patientID, &doctorID, &status); err != nil {
		return nil, fmt.Errorf("telemedicine: appointment not found")
	}
	if status != string(ApptCompleted) {
		return nil, fmt.Errorf("telemedicine: prescriptions can only be issued for completed appointments")
	}
	var dbDoctorUserID string
	if err := s.db.QueryRow(ctx, `SELECT user_id FROM doctors WHERE id=$1`, doctorID).Scan(&dbDoctorUserID); err != nil {
		return nil, fmt.Errorf("telemedicine: doctor not found")
	}
	if dbDoctorUserID != doctorUserID {
		return nil, fmt.Errorf("telemedicine: only the assigned doctor can issue prescriptions")
	}
	p := &Prescription{
		ID:            uuid.New().String(),
		AppointmentID: appointmentID,
		DoctorID:      doctorID,
		PatientID:     patientID,
		Medications:   req.Medications,
		Instructions:  req.Instructions,
		IssuedAt:      time.Now(),
	}
	const q = `INSERT INTO prescriptions (id, appointment_id, doctor_id, patient_id, medications, instructions)
	            VALUES ($1,$2,$3,$4,$5,$6)`
	_, err := s.db.Exec(ctx, q, p.ID, p.AppointmentID, p.DoctorID, p.PatientID, p.Medications, p.Instructions)
	return p, err
}

// GetPrescription returns the prescription issued for an appointment.
// Object-level authZ: only the patient or the assigned doctor of that
// appointment may read it back.
func (s *Service) GetPrescription(ctx context.Context, appointmentID, callerUserID string) (*Prescription, error) {
	var patientID, doctorID string
	if err := s.db.QueryRow(ctx,
		`SELECT patient_id, doctor_id FROM appointments WHERE id=$1`,
		appointmentID).Scan(&patientID, &doctorID); err != nil {
		return nil, fmt.Errorf("telemedicine: appointment not found")
	}
	var dbDoctorUserID string
	if err := s.db.QueryRow(ctx, `SELECT user_id FROM doctors WHERE id=$1`, doctorID).Scan(&dbDoctorUserID); err != nil {
		return nil, fmt.Errorf("telemedicine: doctor not found")
	}
	if callerUserID != patientID && callerUserID != dbDoctorUserID {
		return nil, fmt.Errorf("telemedicine: not permitted to view this prescription")
	}
	p := &Prescription{}
	const q = `SELECT id, appointment_id, doctor_id, patient_id, medications, instructions, issued_at
	            FROM prescriptions WHERE appointment_id=$1 ORDER BY issued_at DESC LIMIT 1`
	if err := s.db.QueryRow(ctx, q, appointmentID).Scan(
		&p.ID, &p.AppointmentID, &p.DoctorID, &p.PatientID, &p.Medications, &p.Instructions, &p.IssuedAt,
	); err != nil {
		return nil, fmt.Errorf("telemedicine: prescription not found")
	}
	return p, nil
}

// ─── SOAP Notes ──────────────────────────────────────────────────────────────

// SubmitSOAPNote saves a SOAP consultation note for a completed appointment.
func (s *Service) SubmitSOAPNote(ctx context.Context, doctorUserID string, req SubmitSOAPNoteRequest) (*SOAPNote, error) {
	// Verify appointment & doctor.
	var patientID, doctorID string
	if err := s.db.QueryRow(ctx,
		`SELECT patient_id, doctor_id FROM appointments WHERE id=$1`,
		req.AppointmentID).Scan(&patientID, &doctorID); err != nil {
		return nil, fmt.Errorf("telemedicine: appointment not found")
	}
	var dbDoctorUserID string
	if err := s.db.QueryRow(ctx, `SELECT user_id FROM doctors WHERE id=$1`, doctorID).Scan(&dbDoctorUserID); err != nil {
		return nil, fmt.Errorf("telemedicine: doctor not found")
	}
	if dbDoctorUserID != doctorUserID {
		return nil, fmt.Errorf("telemedicine: only the assigned doctor can submit notes for this appointment")
	}

	rxJSON, _ := json.Marshal(req.Prescriptions)
	note := &SOAPNote{
		ID:            uuid.New().String(),
		AppointmentID: req.AppointmentID,
		DoctorID:      doctorID,
		PatientID:     patientID,
		Subjective:    req.Subjective,
		Objective:     req.Objective,
		Assessment:    req.Assessment,
		Plan:          req.Plan,
		Prescriptions: req.Prescriptions,
		CreatedAt:     time.Now(),
	}
	const q = `
		INSERT INTO doctor_soap_notes
		    (id, appointment_id, doctor_id, patient_id, subjective, objective, assessment, plan, prescriptions)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (appointment_id) DO UPDATE
		    SET subjective=$5, objective=$6, assessment=$7, plan=$8, prescriptions=$9`
	_, err := s.db.Exec(ctx, q,
		note.ID, note.AppointmentID, note.DoctorID, note.PatientID,
		note.Subjective, note.Objective, note.Assessment, note.Plan, rxJSON)
	return note, err
}

// ─── Licence Documents ───────────────────────────────────────────────────────

// UploadLicenceDoc records a licence document upload for a doctor.
func (s *Service) UploadLicenceDoc(ctx context.Context, userID string, req UploadLicenceRequest) (*LicenceDocument, error) {
	doc := &LicenceDocument{
		ID:           uuid.New().String(),
		DoctorUserID: userID,
		DocumentType: req.DocumentType,
		Filename:     req.Filename,
		StorageKey:   fmt.Sprintf("doctors/%s/%s/%s", userID, req.DocumentType, req.Filename),
		Status:       "pending",
		UploadedAt:   time.Now(),
	}
	if req.IdempotencyKey != "" {
		ik := req.IdempotencyKey
		doc.IdempotencyKey = &ik
	}
	const q = `
		INSERT INTO doctor_licence_docs
		    (id, doctor_user_id, document_type, filename, storage_key, status, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,'pending',$6)
		ON CONFLICT (doctor_user_id, document_type) DO UPDATE
		    SET filename=$4, storage_key=$5, status='pending', idempotency_key=$6, uploaded_at=NOW()`
	_, err := s.db.Exec(ctx, q, doc.ID, doc.DoctorUserID, doc.DocumentType,
		doc.Filename, doc.StorageKey, doc.IdempotencyKey)
	return doc, err
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type pgRows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
}

func scanDoctors(rows pgRows, platformFeeBp int) ([]Doctor, error) {
	var out []Doctor
	for rows.Next() {
		var d Doctor
		var educationJSON []byte
		var subSpec, mdcn, phone *string
		if err := rows.Scan(
			&d.ID, &d.UserID, &d.Name, &d.Specialty, &subSpec, &d.Bio, &d.About,
			&d.ConsultFeeKobo, &d.AvatarURL, &d.IsAvailable, &d.IsOnline, &d.IsHMOVerified,
			&d.ExperienceYears, &d.Rating, &d.ReviewCount, &d.PatientsCount, &d.SuccessRate,
			&mdcn, &phone, &educationJSON, &d.CreatedAt,
		); err != nil {
			return nil, err
		}
		d.SubSpecialty = subSpec
		d.MDCNNumber = mdcn
		d.Phone = phone
		if educationJSON != nil {
			_ = json.Unmarshal(educationJSON, &d.Education)
		}
		if d.Education == nil {
			d.Education = []Education{}
		}
		// Attach the server-computed booking breakdown so the app renders our
		// numbers instead of applying a fee rate of its own (ADR-040).
		q := QuoteAt(d.ConsultFeeKobo, platformFeeBp)
		d.Booking = &q
		out = append(out, d)
	}
	return out, rows.Err()
}

func scanAppointments(rows pgRows) ([]Appointment, error) {
	var out []Appointment
	for rows.Next() {
		var a Appointment
		if err := rows.Scan(
			&a.ID, &a.PatientID, &a.DoctorID,
			&a.DoctorName, &a.DoctorSpecialty, &a.ConsultationType,
			&a.ScheduledAt, &a.Status, &a.Notes,
			&a.FeeKobo, &a.PlatformFeeKobo, &a.TotalKobo,
			&a.IdempotencyKey, &a.SettlementID, &a.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func firstWord(s, fallback string) string {
	if s == "" {
		return fallback
	}
	words := strings.Fields(s)
	if len(words) > 0 {
		return words[0]
	}
	return fallback
}

func coalesceReqs(reqs []PendingReq) []PendingReq {
	if reqs == nil {
		return []PendingReq{}
	}
	return reqs
}

func coalesceAppts(appts []ScheduledAppt) []ScheduledAppt {
	if appts == nil {
		return []ScheduledAppt{}
	}
	return appts
}
