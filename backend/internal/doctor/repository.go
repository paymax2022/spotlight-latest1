package doctor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/jsonx"
	"spotlight/backend/go-common/ptr"
	"spotlight/backend/go-common/strutil"
)

// Repository is the pgx data-access layer for the doctor module.
// Every read is scoped to the owning doctor's user_id (defence-in-depth on top of RLS).
// Money-record rows (doctor_payouts) carry a UNIQUE idempotency_key — never a balance.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// ErrNotFound is returned when a scoped row does not exist for the doctor.
var ErrNotFound = errors.New("doctor: not found")

// ErrStatusUnsupported is returned when a decision cannot be recorded on the
// booking table at all — the caller asked for a state appointments has no
// column for, not for a row that is missing.
var ErrStatusUnsupported = errors.New("doctor: status not supported by the booking table")

func (r *Repository) GetProfile(ctx context.Context, userID string) (*Profile, error) {
	const q = `
		SELECT id, user_id, provider_type, name, title, specialty_id, specialties,
		       sub_specialties, bio, avatar_url, email, phone, mdcn_number, fee_kobo,
		       rating, review_count, years_experience, languages, hospital, state,
		       is_online, presence, verification, timezone, is_published,
		       profile_draft, completed_steps, created_at, updated_at
		FROM doctor_profiles WHERE user_id = $1`
	p := &Profile{}
	err := r.db.QueryRow(ctx, q, userID).Scan(
		&p.ID, &p.UserID, &p.ProviderType, &p.Name, &p.Title, &p.SpecialtyID, &p.Specialties,
		&p.SubSpecialties, &p.Bio, &p.AvatarURL, &p.Email, &p.Phone, &p.MDCNNumber, &p.FeeKobo,
		&p.Rating, &p.ReviewCount, &p.YearsExperience, &p.Languages, &p.Hospital, &p.State,
		&p.IsOnline, &p.Presence, &p.Verification, &p.Timezone, &p.IsPublished,
		&p.ProfileDraft, &p.CompletedSteps, &p.CreatedAt, &p.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

func (r *Repository) GetLatestVerification(ctx context.Context, userID string) (*Verification, error) {
	const q = `
		SELECT id, user_id, status, kind, mdcn_number, submitted_at, reviewed_at,
		       rejection_reason, rejection_reasons, notes, created_at, updated_at
		FROM doctor_verifications WHERE user_id = $1
		ORDER BY created_at DESC LIMIT 1`
	v := &Verification{}
	err := r.db.QueryRow(ctx, q, userID).Scan(
		&v.ID, &v.UserID, &v.Status, &v.Kind, &v.MDCNNumber, &v.SubmittedAt, &v.ReviewedAt,
		&v.RejectionReason, &v.RejectionReasons, &v.Notes, &v.CreatedAt, &v.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return v, err
}

func (r *Repository) InsertVerification(ctx context.Context, userID string, req SubmitVerificationRequest) (*Verification, error) {
	kind := req.Kind
	if kind == "" {
		kind = "initial"
	}
	id := uuid.New().String()
	now := time.Now()
	// Mirror the vet-side submit: the profile's coarse verification must move
	// to 'pending' too, or the doctor's own status views keep reading
	// 'unsubmitted' after submitting (only the admin review endpoints update it).
	// Also materialize the draft identity into the flat columns on first submit —
	// the profile builder only ever writes the profile_draft jsonb, and the
	// admin MDCN queue reads/joins these columns, so without this the review
	// console lists submissions with blank doctor names and licence numbers.
	const mirror = `
		UPDATE doctor_profiles
		SET verification = 'pending',
		    title        = COALESCE(NULLIF(title, ''),
		        NULLIF(profile_draft->'draft'->'personalInfo'->>'title', '')),
		    name         = COALESCE(NULLIF(name, ''),
		        NULLIF(TRIM(CONCAT_WS(' ',
		            profile_draft->'draft'->'personalInfo'->>'firstName',
		            profile_draft->'draft'->'personalInfo'->>'lastName')), '')),
		    mdcn_number  = COALESCE(NULLIF(mdcn_number, ''),
		        NULLIF(profile_draft->'draft'->'licence'->>'licenceNumber', '')),
		    updated_at   = now()
		WHERE user_id = $1`
	if _, err := r.db.Exec(ctx, mirror, userID); err != nil {
		return nil, err
	}
	// The doctor app submits without a body licence number; fall back to the
	// (now backfilled) profile column so the verification row the reviewers
	// queue shows carries the MDCN reg number too.
	mdcnNumber := req.MDCNNumber
	if mdcnNumber == nil || *mdcnNumber == "" {
		if p, err := r.GetProfile(ctx, userID); err == nil {
			mdcnNumber = p.MDCNNumber
		}
	}
	const q = `
		INSERT INTO doctor_verifications (id, user_id, status, kind, mdcn_number, notes, submitted_at)
		VALUES ($1,$2,'pending',$3,$4,$5,$6)`
	if _, err := r.db.Exec(ctx, q, id, userID, kind, mdcnNumber, req.Notes, now); err != nil {
		return nil, err
	}
	return &Verification{ID: id, UserID: userID, Status: "pending", Kind: kind,
		MDCNNumber: mdcnNumber, SubmittedAt: &now, Notes: req.Notes,
		CreatedAt: now, UpdatedAt: now}, nil
}

func (r *Repository) GetAvailability(ctx context.Context, userID string) (*Availability, error) {
	const q = `
		SELECT id, user_id, working_days, breaks, rules, consult_duration_mins,
		       buffer_mins, accepts_instant, emergency_enabled, timezone,
		       reminder_settings, created_at, updated_at
		FROM doctor_availability WHERE user_id = $1`
	a := &Availability{}
	err := r.db.QueryRow(ctx, q, userID).Scan(
		&a.ID, &a.UserID, &a.WorkingDays, &a.Breaks, &a.Rules, &a.ConsultDurationMins,
		&a.BufferMins, &a.AcceptsInstant, &a.EmergencyEnabled, &a.Timezone,
		&a.ReminderSettings, &a.CreatedAt, &a.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return a, err
}

// UpsertAvailability writes the single per-doctor availability row (UNIQUE user_id).
//
// `emergency_enabled` and `rules` are kept when the schedule omits them: the
// availability screen's body has no emergencyEnabled and no rules at all, while
// PUT /schedule/emergency owns both — the flag and the emergency windows it
// stores in rules->'emergency'. Dereferencing an absent flag to false and an
// absent object to {} deleted that endpoint's data on every hours save.
func (r *Repository) UpsertAvailability(ctx context.Context, userID string, in AvailabilityScheduleInput) (*Availability, error) {
	workingDays := jsonx.RawOrEmptyArray(in.WorkingDays)
	breaks := jsonx.RawOrEmptyArray(in.Breaks)
	reminders := jsonx.RawOrEmptyObject(in.ReminderSettings)
	dur := ptr.Deref(in.ConsultDurationMins, 30)
	buf := ptr.Deref(in.BufferMins, 0)
	instant := ptr.Deref(in.AcceptsInstant, false)
	tz := strOrDefault(in.Timezone, "Africa/Lagos")

	var emergency any
	if in.EmergencyEnabled != nil {
		emergency = *in.EmergencyEnabled
	}
	var rules any
	if len(bytes.TrimSpace(in.Rules)) > 0 {
		rules = jsonx.RawOrEmptyObject(in.Rules)
	}

	const q = `
		INSERT INTO doctor_availability
			(user_id, working_days, breaks, rules, consult_duration_mins, buffer_mins,
			 accepts_instant, emergency_enabled, timezone, reminder_settings, updated_at)
		VALUES ($1,$2,$3,COALESCE($4::jsonb,'{}'::jsonb),$5,$6,$7,COALESCE($8,false),$9,$10, now())
		ON CONFLICT (user_id) DO UPDATE SET
			working_days = EXCLUDED.working_days,
			breaks = EXCLUDED.breaks,
			rules = COALESCE($4::jsonb, doctor_availability.rules),
			consult_duration_mins = EXCLUDED.consult_duration_mins,
			buffer_mins = EXCLUDED.buffer_mins,
			accepts_instant = EXCLUDED.accepts_instant,
			emergency_enabled = COALESCE($8, doctor_availability.emergency_enabled),
			timezone = EXCLUDED.timezone,
			reminder_settings = EXCLUDED.reminder_settings,
			updated_at = now()`
	if _, err := r.db.Exec(ctx, q, userID, workingDays, breaks, rules, dur, buf,
		instant, emergency, tz, reminders); err != nil {
		return nil, err
	}
	return r.GetAvailability(ctx, userID)
}

// appointmentColumns is the doctor's view of ONE booking row.
//
// A patient's BookAppointment (internal/telemedicine/service.go) writes exactly
// one row, into public.appointments, keyed by `doctors.id` — not by the doctor's
// auth id. These screens used to read doctor_appointments, a table this
// repository never inserts into, so the portal answered an empty list while a
// real booking sat on "Awaiting doctor confirmation". The JOIN through `doctors`
// is what makes `$1 = the signed-in doctor` a real scope.
//
// The slot is formatted here rather than left a timestamptz because both halves
// are the DOCTOR'S local wall time (doctor_availability.timezone) while the
// screens do `new Date(`${slotDate}T00:00:00`)` in the device's own zone: a full
// timestamp would shift the day for a doctor travelling outside WAT, and a
// client-side split of the UTC instant would too.
const appointmentColumns = `
		SELECT a.id,
		       d.user_id,
		       COALESCE(a.ref, 'TM-' || upper(substr(replace(a.id::text, '-', ''), 1, 6))),
		       a.patient_id,
		       jsonb_build_object(
		           'id',     a.patient_id::text,
		           'name',   COALESCE(pu.full_name, ''),
		           'age',    COALESCE(pu.age, 0),
		           'gender', COALESCE(lower(pu.gender), 'other')
		       ),
		       a.consultation_type,
		       CASE a.status WHEN 'booked' THEN 'upcoming' ELSE a.status END,
		       to_char(a.scheduled_at AT TIME ZONE COALESCE(av.timezone, 'Africa/Lagos'), 'YYYY-MM-DD'),
		       to_char(a.scheduled_at AT TIME ZONE COALESCE(av.timezone, 'Africa/Lagos'), 'HH12:MI AM'),
		       a.fee_kobo,
		       a.notes,
		       false,
		       NULL::text,
		       a.starts_at,
		       NULL::timestamptz,
		       a.created_at,
		       a.created_at
		FROM appointments a
		JOIN doctors d            ON d.id = a.doctor_id
		 LEFT JOIN user_profiles pu ON pu.id = a.patient_id
		 LEFT JOIN doctor_availability av ON av.user_id = d.user_id
		WHERE d.user_id = $1`

// `is_hmo`/`hmo_provider` are answered constant because `appointments` records
// no coverage: the booking escrowed a cash payment, and the HMO tables
// (doctor_hmo_plan_coverage …) belong to the never-written family, so claiming
// coverage here would be inventing it. `updated_at` mirrors created_at — the
// booking table has no updated_at column and the field is part of the shape the
// screens already parse.

func (r *Repository) ListAppointments(ctx context.Context, userID, status string) ([]Appointment, error) {
	q := appointmentColumns
	args := []any{userID}
	if status != "" {
		// The tab filters in the UI's vocabulary (ConsultStatus), while the CASE
		// above only rewrites it on the way out — so the predicate has to go back.
		q += ` AND a.status = $2`
		args = append(args, appointmentStatusForFilter(status))
	}
	q += ` ORDER BY a.scheduled_at DESC NULLS LAST, a.created_at DESC`
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Appointment{}
	for rows.Next() {
		a, err := scanAppointment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// appointmentStatusForFilter maps a ConsultStatus filter back onto the
// appointments.status CHECK vocabulary (booked|confirmed|completed|cancelled).
// Anything else — `in_progress` has no booking state — is passed through and
// simply matches no row.
func appointmentStatusForFilter(status string) string {
	if status == "upcoming" {
		return "booked"
	}
	return status
}

// appointmentStatusForWrite maps a UI status onto the booking table's CHECK set.
//
// `in_progress` and `no_show` have no state in appointments.status
// (booked|confirmed|completed|cancelled) and no column to carry them
// (`starts_at` alone would claim a consult that never happened), so they are
// refused here rather than passed to Postgres, where the CHECK would fail the
// request with an opaque 500. Those two belong to the consult-session plane,
// which is where the live engine actually records them.
func appointmentStatusForWrite(status string) (string, error) {
	switch status {
	case "upcoming":
		return "booked", nil
	case "confirmed", "completed", "cancelled":
		return status, nil
	default:
		return "", ErrStatusUnsupported
	}
}

func (r *Repository) GetAppointment(ctx context.Context, userID, id string) (*Appointment, error) {
	const q = appointmentColumns + ` AND a.id = $2`
	a, err := scanAppointment(r.db.QueryRow(ctx, q, userID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return a, err
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanAppointment(row rowScanner) (*Appointment, error) {
	a := &Appointment{}
	err := row.Scan(
		&a.ID, &a.UserID, &a.Ref, &a.PatientID, &a.Patient, &a.ConsultType, &a.Status,
		&a.SlotDate, &a.SlotTime, &a.FeeKobo, &a.Reason, &a.IsHMO, &a.HMOProvider,
		&a.StartedAt, &a.EndedAt, &a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return a, nil
}

// UpdateAppointmentStatus is the generic form of the same decision the
// accept/reject endpoints make: map the UI status onto the booking table and
// write it, scoped through the owning doctor rather than a column on the
// booking row. One path, so the two cannot drift apart.
func (r *Repository) UpdateAppointmentStatus(ctx context.Context, userID, id, status string) (*Appointment, error) {
	return r.TransitionAppointment(ctx, userID, id, status, nil, nil)
}

func (r *Repository) ListNotes(ctx context.Context, userID, appointmentID string) ([]ClinicalNote, error) {
	const q = `
		SELECT id, user_id, appointment_id, patient_id, subjective, objective, assessment,
		       plan, diagnosis, sections, status, finalized_at, created_at, updated_at
		FROM doctor_clinical_notes WHERE user_id = $1 AND appointment_id = $2
		ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID, appointmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ClinicalNote{}
	for rows.Next() {
		n := ClinicalNote{}
		if err := rows.Scan(&n.ID, &n.UserID, &n.AppointmentID, &n.PatientID, &n.Subjective,
			&n.Objective, &n.Assessment, &n.Plan, &n.Diagnosis, &n.Sections, &n.Status,
			&n.FinalizedAt, &n.CreatedAt, &n.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func (r *Repository) InsertNote(ctx context.Context, userID, appointmentID, idemKey string, req SaveNoteRequest) (*ClinicalNote, error) {
	status := req.Status
	if status == "" {
		status = "draft"
	}
	id := uuid.New().String()
	now := time.Now()
	var finalizedAt *time.Time
	if status == "finalized" || status == "shared" {
		finalizedAt = &now
	}
	const q = `
		INSERT INTO doctor_clinical_notes
			(id, user_id, appointment_id, subjective, objective, assessment, plan,
			 diagnosis, sections, status, finalized_at, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, id, userID, appointmentID, req.Subjective, req.Objective,
		req.Assessment, req.Plan, jsonx.RawOrEmptyArray(req.Diagnosis), jsonx.RawOrEmptyObject(req.Sections),
		status, finalizedAt, idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		// Idempotent replay — return the prior row.
		return r.getNoteByIdem(ctx, userID, idemKey)
	}
	return &ClinicalNote{ID: id, UserID: userID, AppointmentID: &appointmentID,
		Subjective: req.Subjective, Objective: req.Objective, Assessment: req.Assessment,
		Plan: req.Plan, Diagnosis: jsonx.RawOrEmptyArray(req.Diagnosis), Sections: jsonx.RawOrEmptyObject(req.Sections),
		Status: status, FinalizedAt: finalizedAt, CreatedAt: now, UpdatedAt: now}, nil
}

func (r *Repository) getNoteByIdem(ctx context.Context, userID, idemKey string) (*ClinicalNote, error) {
	const q = `
		SELECT id, user_id, appointment_id, patient_id, subjective, objective, assessment,
		       plan, diagnosis, sections, status, finalized_at, created_at, updated_at
		FROM doctor_clinical_notes WHERE user_id = $1 AND idempotency_key = $2`
	n := &ClinicalNote{}
	err := r.db.QueryRow(ctx, q, userID, idemKey).Scan(&n.ID, &n.UserID, &n.AppointmentID,
		&n.PatientID, &n.Subjective, &n.Objective, &n.Assessment, &n.Plan, &n.Diagnosis,
		&n.Sections, &n.Status, &n.FinalizedAt, &n.CreatedAt, &n.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return n, err
}

func (r *Repository) ListPrescriptions(ctx context.Context, userID string) ([]Prescription, error) {
	const q = `
		SELECT id, user_id, ref, appointment_id, patient_id, patient, diagnosis, status,
		       issued_at, created_at, updated_at
		FROM doctor_prescriptions WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Prescription{}
	for rows.Next() {
		p := Prescription{}
		if err := rows.Scan(&p.ID, &p.UserID, &p.Ref, &p.AppointmentID, &p.PatientID,
			&p.Patient, &p.Diagnosis, &p.Status, &p.IssuedAt, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *Repository) GetPrescription(ctx context.Context, userID, id string) (*Prescription, error) {
	const q = `
		SELECT id, user_id, ref, appointment_id, patient_id, patient, diagnosis, status,
		       issued_at, created_at, updated_at
		FROM doctor_prescriptions WHERE id = $1 AND user_id = $2`
	p := &Prescription{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&p.ID, &p.UserID, &p.Ref, &p.AppointmentID,
		&p.PatientID, &p.Patient, &p.Diagnosis, &p.Status, &p.IssuedAt, &p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	items, err := r.listPrescriptionItems(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	p.Items = items
	return p, nil
}

func (r *Repository) listPrescriptionItems(ctx context.Context, userID, prescriptionID string) ([]PrescriptionItem, error) {
	const q = `
		SELECT name, dosage, route, frequency, duration, notes
		FROM doctor_prescription_items WHERE prescription_id = $1 AND user_id = $2
		ORDER BY position ASC`
	rows, err := r.db.Query(ctx, q, prescriptionID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PrescriptionItem{}
	for rows.Next() {
		it := PrescriptionItem{}
		if err := rows.Scan(&it.Name, &it.Dosage, &it.Route, &it.Frequency, &it.Duration, &it.Notes); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// InsertPrescription writes a prescription + its items atomically and idempotently.
func (r *Repository) InsertPrescription(ctx context.Context, userID, idemKey string, req CreatePrescriptionRequest) (*Prescription, error) {
	status := req.Status
	if status == "" {
		status = "draft"
	}
	id := uuid.New().String()
	now := time.Now()
	var issuedAt *time.Time
	if status == "issued" {
		issuedAt = &now
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const insRx = `
		INSERT INTO doctor_prescriptions
			(id, user_id, appointment_id, patient_id, patient, diagnosis, status, issued_at, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := tx.Exec(ctx, insRx, id, userID, req.AppointmentID, req.PatientID,
		jsonx.RawOrEmptyObject(req.Patient), req.Diagnosis, status, issuedAt, idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		// Replay: prescription already exists for this idem key.
		_ = tx.Rollback(ctx)
		return r.getPrescriptionByIdem(ctx, userID, idemKey)
	}

	const insItem = `
		INSERT INTO doctor_prescription_items
			(prescription_id, user_id, name, dosage, route, frequency, duration, notes, position)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`
	for i, it := range req.Items {
		if _, err := tx.Exec(ctx, insItem, id, userID, it.Name, it.Dosage, it.Route,
			it.Frequency, it.Duration, it.Notes, i); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetPrescription(ctx, userID, id)
}

func (r *Repository) getPrescriptionByIdem(ctx context.Context, userID, idemKey string) (*Prescription, error) {
	var id string
	err := r.db.QueryRow(ctx,
		`SELECT id FROM doctor_prescriptions WHERE user_id = $1 AND idempotency_key = $2`,
		userID, idemKey).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return r.GetPrescription(ctx, userID, id)
}

func (r *Repository) ListLabOrders(ctx context.Context, userID string) ([]LabOrder, error) {
	const q = `
		SELECT id, user_id, ref, appointment_id, patient_id, patient, clinical_note,
		       status, priority, lab_provider, ordered_at, created_at, updated_at
		FROM doctor_lab_orders WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LabOrder{}
	for rows.Next() {
		o := LabOrder{}
		if err := rows.Scan(&o.ID, &o.UserID, &o.Ref, &o.AppointmentID, &o.PatientID,
			&o.Patient, &o.ClinicalNote, &o.Status, &o.Priority, &o.LabProvider,
			&o.OrderedAt, &o.CreatedAt, &o.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// InsertLabOrder writes a lab order + tests atomically and idempotently.
func (r *Repository) InsertLabOrder(ctx context.Context, userID, idemKey string, req CreateLabOrderRequest) (*LabOrder, error) {
	priority := req.Priority
	if priority == "" {
		priority = "routine"
	}
	id := uuid.New().String()

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const insOrder = `
		INSERT INTO doctor_lab_orders
			(id, user_id, appointment_id, patient_id, patient, clinical_note, status, priority, lab_provider, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,'ordered',$7,$8,$9)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := tx.Exec(ctx, insOrder, id, userID, req.AppointmentID, req.PatientID,
		jsonx.RawOrEmptyObject(req.Patient), req.ClinicalNote, priority, req.LabProvider, idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		_ = tx.Rollback(ctx)
		return r.getLabOrderByIdem(ctx, userID, idemKey)
	}

	const insTest = `
		INSERT INTO doctor_lab_order_tests (order_id, user_id, test_id, name, code, category)
		VALUES ($1,$2,$3,$4,$5,$6)`
	for _, t := range req.Tests {
		if _, err := tx.Exec(ctx, insTest, id, userID, t.TestID, t.Name, t.Code, t.Category); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.getLabOrder(ctx, userID, id)
}

func (r *Repository) getLabOrder(ctx context.Context, userID, id string) (*LabOrder, error) {
	const q = `
		SELECT id, user_id, ref, appointment_id, patient_id, patient, clinical_note,
		       status, priority, lab_provider, ordered_at, created_at, updated_at
		FROM doctor_lab_orders WHERE id = $1 AND user_id = $2`
	o := &LabOrder{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&o.ID, &o.UserID, &o.Ref, &o.AppointmentID,
		&o.PatientID, &o.Patient, &o.ClinicalNote, &o.Status, &o.Priority, &o.LabProvider,
		&o.OrderedAt, &o.CreatedAt, &o.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return o, err
}

func (r *Repository) getLabOrderByIdem(ctx context.Context, userID, idemKey string) (*LabOrder, error) {
	var id string
	err := r.db.QueryRow(ctx,
		`SELECT id FROM doctor_lab_orders WHERE user_id = $1 AND idempotency_key = $2`,
		userID, idemKey).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return r.getLabOrder(ctx, userID, id)
}

// GetLabResultForOrder returns the result (+ values) for a lab order.
func (r *Repository) GetLabResultForOrder(ctx context.Context, userID, orderID string) (*LabResult, error) {
	const q = `
		SELECT id, user_id, order_id, ref, patient, lab_name, reported_at, reviewed,
		       reviewed_at, created_at, updated_at
		FROM doctor_lab_results WHERE user_id = $1 AND order_id = $2
		ORDER BY created_at DESC LIMIT 1`
	res := &LabResult{}
	err := r.db.QueryRow(ctx, q, userID, orderID).Scan(&res.ID, &res.UserID, &res.OrderID,
		&res.Ref, &res.Patient, &res.LabName, &res.ReportedAt, &res.Reviewed, &res.ReviewedAt,
		&res.CreatedAt, &res.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	vals, err := r.listLabResultValues(ctx, userID, res.ID)
	if err != nil {
		return nil, err
	}
	res.Values = vals
	return res, nil
}

func (r *Repository) listLabResultValues(ctx context.Context, userID, resultID string) ([]LabResultValue, error) {
	const q = `
		SELECT test_name, value, unit, ref_range, flag
		FROM doctor_lab_result_values WHERE result_id = $1 AND user_id = $2`
	rows, err := r.db.Query(ctx, q, resultID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LabResultValue{}
	for rows.Next() {
		v := LabResultValue{}
		if err := rows.Scan(&v.TestName, &v.Value, &v.Unit, &v.RefRange, &v.Flag); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// ReviewLabResult marks a result reviewed and records the interpretation idempotently.
func (r *Repository) ReviewLabResult(ctx context.Context, userID, resultID, idemKey string, req ReviewLabResultRequest) (*LabResult, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const upd = `
		UPDATE doctor_lab_results SET reviewed = true, reviewed_at = now(), updated_at = now()
		WHERE id = $1 AND user_id = $2`
	tag, err := tx.Exec(ctx, upd, resultID, userID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}

	const insInterp = `
		INSERT INTO doctor_lab_interpretations (result_id, user_id, interpretation, detail, idempotency_key)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (idempotency_key) DO NOTHING`
	if _, err := tx.Exec(ctx, insInterp, resultID, userID, req.Interpretation,
		jsonx.RawOrEmptyObject(req.Detail), idemKey); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.getLabResultByID(ctx, userID, resultID)
}

func (r *Repository) getLabResultByID(ctx context.Context, userID, id string) (*LabResult, error) {
	const q = `
		SELECT id, user_id, order_id, ref, patient, lab_name, reported_at, reviewed,
		       reviewed_at, created_at, updated_at
		FROM doctor_lab_results WHERE id = $1 AND user_id = $2`
	res := &LabResult{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&res.ID, &res.UserID, &res.OrderID,
		&res.Ref, &res.Patient, &res.LabName, &res.ReportedAt, &res.Reviewed, &res.ReviewedAt,
		&res.CreatedAt, &res.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return res, err
}

func (r *Repository) GetPatientRecord(ctx context.Context, userID, patientID string) (*PatientRecord, error) {
	const latest = `
		SELECT patient FROM doctor_appointments
		WHERE user_id = $1 AND patient_id = $2
		ORDER BY created_at DESC LIMIT 1`
	rec := &PatientRecord{PatientID: patientID}
	err := r.db.QueryRow(ctx, latest, userID, patientID).Scan(&rec.Patient)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	appts, err := r.listAppointmentsForPatient(ctx, userID, patientID)
	if err != nil {
		return nil, err
	}
	rec.Appointments = appts
	return rec, nil
}

func (r *Repository) listAppointmentsForPatient(ctx context.Context, userID, patientID string) ([]Appointment, error) {
	// Records-tab read, still against doctor_appointments (out of the
	// appointment-plane scope of this change). slot_date is a `date` and
	// Appointment.SlotDate is now the date-only string the wire carries, so cast
	// it in SQL rather than letting pgx reject a date into *string.
	const q = `
		SELECT id, user_id, ref, patient_id, patient, consult_type, status, slot_date::text,
		       slot_time, fee_kobo, reason, is_hmo, hmo_provider, started_at, ended_at,
		       created_at, updated_at
		FROM doctor_appointments WHERE user_id = $1 AND patient_id = $2 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID, patientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Appointment{}
	for rows.Next() {
		a, err := scanAppointment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

func (r *Repository) ListNotifications(ctx context.Context, userID string) ([]Notification, error) {
	const q = `
		SELECT id, user_id, notif_type, title, body, read, read_at, detail, created_at
		FROM doctor_notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Notification{}
	for rows.Next() {
		n := Notification{}
		if err := rows.Scan(&n.ID, &n.UserID, &n.Type, &n.Title, &n.Body, &n.Read,
			&n.ReadAt, &n.Detail, &n.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func (r *Repository) MarkNotificationRead(ctx context.Context, userID, id string) error {
	const q = `UPDATE doctor_notifications SET read = true, read_at = now() WHERE id = $1 AND user_id = $2`
	tag, err := r.db.Exec(ctx, q, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repository) GetSettings(ctx context.Context, userID string) (*Settings, error) {
	const q = `
		SELECT id, user_id, notify_appointments, notify_messages, notify_payouts,
		       push_enabled, email_enabled, sms_enabled, show_online_status,
		       auto_accept_instant, preferred_currency, biometric_enabled,
		       two_factor_enabled, app_preferences, security, created_at, updated_at
		FROM doctor_settings WHERE user_id = $1`
	return r.scanSettings(r.db.QueryRow(ctx, q, userID))
}

func (r *Repository) scanSettings(row rowScanner) (*Settings, error) {
	s := &Settings{}
	err := row.Scan(&s.ID, &s.UserID, &s.NotifyAppointments, &s.NotifyMessages, &s.NotifyPayouts,
		&s.PushEnabled, &s.EmailEnabled, &s.SMSEnabled, &s.ShowOnlineStatus, &s.AutoAcceptInstant,
		&s.PreferredCurrency, &s.BiometricEnabled, &s.TwoFactorEnabled, &s.AppPreferences,
		&s.Security, &s.CreatedAt, &s.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return s, err
}

// UpsertSettings applies a partial update over the per-doctor settings row (UNIQUE user_id).
func (r *Repository) UpsertSettings(ctx context.Context, userID string, req UpdateSettingsRequest) (*Settings, error) {
	// Seed defaults if the row doesn't yet exist, then apply COALESCE-style partial update.
	const ins = `INSERT INTO doctor_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`
	if _, err := r.db.Exec(ctx, ins, userID); err != nil {
		return nil, err
	}
	const upd = `
		UPDATE doctor_settings SET
			notify_appointments = COALESCE($2, notify_appointments),
			notify_messages     = COALESCE($3, notify_messages),
			notify_payouts      = COALESCE($4, notify_payouts),
			push_enabled        = COALESCE($5, push_enabled),
			email_enabled       = COALESCE($6, email_enabled),
			sms_enabled         = COALESCE($7, sms_enabled),
			show_online_status  = COALESCE($8, show_online_status),
			auto_accept_instant = COALESCE($9, auto_accept_instant),
			preferred_currency  = COALESCE($10, preferred_currency),
			biometric_enabled   = COALESCE($11, biometric_enabled),
			two_factor_enabled  = COALESCE($12, two_factor_enabled),
			app_preferences     = COALESCE($13, app_preferences),
			security            = COALESCE($14, security),
			updated_at          = now()
		WHERE user_id = $1`
	if _, err := r.db.Exec(ctx, upd, userID,
		req.NotifyAppointments, req.NotifyMessages, req.NotifyPayouts, req.PushEnabled,
		req.EmailEnabled, req.SMSEnabled, req.ShowOnlineStatus, req.AutoAcceptInstant,
		req.PreferredCurrency, req.BiometricEnabled, req.TwoFactorEnabled,
		jsonx.NullJSON(req.AppPreferences), jsonx.NullJSON(req.Security)); err != nil {
		return nil, err
	}
	return r.GetSettings(ctx, userID)
}

// FindPayoutByIdem returns a prior payout for an idempotency key (replay), if any.
func (r *Repository) FindPayoutByIdem(ctx context.Context, userID, idemKey string) (*Payout, error) {
	const q = `
		SELECT id, user_id, ref, amount_kobo, currency, status, bank_account_id,
		       ledger_ref, requested_at, paid_at, idempotency_key, created_at
		FROM doctor_payouts WHERE user_id = $1 AND idempotency_key = $2`
	p := &Payout{}
	err := r.db.QueryRow(ctx, q, userID, idemKey).Scan(&p.ID, &p.UserID, &p.Ref, &p.AmountKobo,
		&p.Currency, &p.Status, &p.BankAccountID, &p.LedgerRef, &p.RequestedAt, &p.PaidAt,
		&p.IdempotencyKey, &p.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

// InsertPayout persists a payout REQUEST row referencing the ledger posting.
// No balance column is written — the row records amount + status + ledger_ref only.
func (r *Repository) InsertPayout(ctx context.Context, userID, idemKey, ledgerRef string, amountKobo int64, bankAccountID *string) (*Payout, error) {
	id := uuid.New().String()
	ref := "PO-" + id[0:8]
	now := time.Now()
	const q = `
		INSERT INTO doctor_payouts
			(id, user_id, ref, amount_kobo, currency, status, bank_account_id, ledger_ref, requested_at, idempotency_key)
		VALUES ($1,$2,$3,$4,'NGN','pending',$5,$6,$7,$8)`
	if _, err := r.db.Exec(ctx, q, id, userID, ref, amountKobo, bankAccountID, ledgerRef, now, idemKey); err != nil {
		return nil, err
	}
	return &Payout{ID: id, UserID: userID, Ref: &ref, AmountKobo: amountKobo, Currency: "NGN",
		Status: "pending", BankAccountID: bankAccountID, LedgerRef: &ledgerRef,
		RequestedAt: now, IdempotencyKey: idemKey, CreatedAt: now}, nil
}

// InsertPayoutWithAudit persists the payout REQUEST row AND its immutable audit row
// inside ONE transaction. For the money path the audit is durable: if either the
// payout insert or the audit insert fails, the whole write rolls back and the
// caller gets an error (the ledger debit has already committed, so a failure here
// surfaces to the operator instead of being silently swallowed). No balance column
// is written — the row records amount + status + ledger_ref only.
func (r *Repository) InsertPayoutWithAudit(ctx context.Context, userID, idemKey, ledgerRef string, amountKobo int64, bankAccountID *string) (*Payout, error) {
	id := uuid.New().String()
	ref := "PO-" + id[0:8]
	now := time.Now()

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const insPayout = `
		INSERT INTO doctor_payouts
			(id, user_id, ref, amount_kobo, currency, status, bank_account_id, ledger_ref, requested_at, idempotency_key)
		VALUES ($1,$2,$3,$4,'NGN','pending',$5,$6,$7,$8)`
	if _, err := tx.Exec(ctx, insPayout, id, userID, ref, amountKobo, bankAccountID, ledgerRef, now, idemKey); err != nil {
		return nil, err
	}

	const insAudit = `
		INSERT INTO doctor_compliance_audit (user_id, action, entity_type, entity_id, detail, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6)`
	auditDetail := jsonx.RawOrEmptyObject(toJSON(map[string]any{
		"amount_kobo": amountKobo,
		"currency":    "NGN",
		"ledger_ref":  ledgerRef,
	}))
	if _, err := tx.Exec(ctx, insAudit, userID, "payout.requested", "doctor_payout", id, auditDetail, idemKey); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &Payout{ID: id, UserID: userID, Ref: &ref, AmountKobo: amountKobo, Currency: "NGN",
		Status: "pending", BankAccountID: bankAccountID, LedgerRef: &ledgerRef,
		RequestedAt: now, IdempotencyKey: idemKey, CreatedAt: now}, nil
}

// InsertAudit appends an immutable compliance-audit row (append-only; no UPDATE/DELETE).
func (r *Repository) InsertAudit(ctx context.Context, userID, action, entityType, entityID, idemKey string, detail any) error {
	const q = `
		INSERT INTO doctor_compliance_audit (user_id, action, entity_type, entity_id, detail, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6)`
	_, err := r.db.Exec(ctx, q, userID, action, entityType, entityID, jsonx.RawOrEmptyObject(toJSON(detail)), idemKey)
	return err
}

// toJSON normalises a detail payload: raw bytes and json.RawMessage pass through
// verbatim, anything else is marshalled. nil in, nil out so COALESCE sees NULL.
func toJSON(v any) []byte {
	if v == nil {
		return nil
	}
	if b, ok := v.([]byte); ok {
		return b
	}
	if rm, ok := v.(json.RawMessage); ok {
		return rm
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return b
}

func strOrDefault(p *string, d string) string {
	return strutil.FirstNonEmpty(ptr.DerefZero(p), d)
}
