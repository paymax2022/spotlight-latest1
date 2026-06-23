package doctor

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// repository_clinical_tail.go — pgx data access for the "clinical tail" endpoint
// groups (rich clinical notes, prescription lifecycle, call disputes/feedback,
// chat state/annotations, emergency cases/escalations, HMO eligibility).
//
// Every read is scoped to the owning doctor's user_id (defence-in-depth on top of
// RLS). Mutations on tables carrying a UNIQUE idempotency_key (doctor_clinical_notes,
// doctor_prescriptions, doctor_refill_requests, doctor_emergency_cases,
// doctor_emergency_escalations) create rows with ON CONFLICT (idempotency_key) DO
// NOTHING + replay (mirroring InsertChatMessage / InsertNote). State-transition
// mutations on pre-existing rows (note finalize/share, prescription issue/cancel,
// call provider switch, chat status) are scoped and status-guarded. The append-only
// audit/feedback/dispute tables have NO idempotency_key column, so their inserts are
// best-effort appends (documented inline at each call site). None post ledger entries.

// ══ CLINICAL NOTES ══════════════════════════════════════════════════════════

// GetLatestNote returns the most-recent clinical note for an appointment (scoped),
// or ErrNotFound when none exists.
func (r *Repository) GetLatestNote(ctx context.Context, userID, appointmentID string) (*ClinicalNote, error) {
	const q = `
		SELECT id, user_id, appointment_id, patient_id, subjective, objective, assessment,
		       plan, diagnosis, sections, status, finalized_at, created_at, updated_at
		FROM doctor_clinical_notes WHERE user_id = $1 AND appointment_id = $2
		ORDER BY created_at DESC LIMIT 1`
	n := &ClinicalNote{}
	err := r.db.QueryRow(ctx, q, userID, appointmentID).Scan(&n.ID, &n.UserID, &n.AppointmentID,
		&n.PatientID, &n.Subjective, &n.Objective, &n.Assessment, &n.Plan, &n.Diagnosis,
		&n.Sections, &n.Status, &n.FinalizedAt, &n.CreatedAt, &n.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return n, err
}

// getNoteByID re-selects a clinical note scoped to owner + id.
func (r *Repository) getNoteByID(ctx context.Context, userID, id string) (*ClinicalNote, error) {
	const q = `
		SELECT id, user_id, appointment_id, patient_id, subjective, objective, assessment,
		       plan, diagnosis, sections, status, finalized_at, created_at, updated_at
		FROM doctor_clinical_notes WHERE id = $1 AND user_id = $2`
	n := &ClinicalNote{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&n.ID, &n.UserID, &n.AppointmentID,
		&n.PatientID, &n.Subjective, &n.Objective, &n.Assessment, &n.Plan, &n.Diagnosis,
		&n.Sections, &n.Status, &n.FinalizedAt, &n.CreatedAt, &n.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return n, err
}

// TransitionNote moves a clinical note to a terminal status (finalized|shared) and
// stamps finalized_at. Scoped + idempotent (re-running with the same status is a
// no-op UPDATE that still returns the row).
func (r *Repository) TransitionNote(ctx context.Context, userID, noteID, status string, detail []byte) (*ClinicalNote, error) {
	const q = `
		UPDATE doctor_clinical_notes
		SET status = $3, finalized_at = COALESCE(finalized_at, now()), updated_at = now()
		WHERE id = $1 AND user_id = $2`
	tag, err := r.db.Exec(ctx, q, noteID, userID, status)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.getNoteByID(ctx, userID, noteID)
}

// ══ PRESCRIPTIONS (lifecycle) ═══════════════════════════════════════════════

// TransitionPrescription moves a prescription to a new status (issued|cancelled),
// stamping issued_at when transitioning to 'issued'. Scoped; ErrNotFound when no row.
func (r *Repository) TransitionPrescription(ctx context.Context, userID, prescriptionID, status string) (*Prescription, error) {
	var q string
	if status == "issued" {
		q = `UPDATE doctor_prescriptions
		     SET status = $3, issued_at = COALESCE(issued_at, now()), updated_at = now()
		     WHERE id = $1 AND user_id = $2`
	} else {
		q = `UPDATE doctor_prescriptions
		     SET status = $3, updated_at = now()
		     WHERE id = $1 AND user_id = $2`
	}
	tag, err := r.db.Exec(ctx, q, prescriptionID, userID, status)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.GetPrescription(ctx, userID, prescriptionID)
}

// RecordPrescriptionAudit appends an entry to doctor_prescription_audit (no idem
// column on that table — append-only). Scoped: confirms the prescription belongs to
// the doctor first. Returns the (unchanged) prescription read shape so the handlers
// can echo state. action ∈ created|issued|cancelled|shared|sent_to_pharmacy.
func (r *Repository) RecordPrescriptionAudit(ctx context.Context, userID, prescriptionID, action string, detail []byte) (*Prescription, error) {
	rx, err := r.GetPrescription(ctx, userID, prescriptionID)
	if err != nil {
		return nil, err
	}
	id := uuid.New().String()
	const q = `
		INSERT INTO doctor_prescription_audit (id, prescription_id, user_id, action, new_status, detail)
		VALUES ($1,$2,$3,$4,$5,$6)`
	if _, err := r.db.Exec(ctx, q, id, prescriptionID, userID, action, rx.Status, jsonOrEmptyObject(detail)); err != nil {
		return nil, err
	}
	return rx, nil
}

// InsertRefillConsultation creates a refill-request row flagged as needing a
// consultation. Idempotent via UNIQUE idempotency_key. Scoped: confirms the
// prescription belongs to the doctor first.
func (r *Repository) InsertRefillConsultation(ctx context.Context, userID, prescriptionID string, detail []byte, idemKey string) (*RefillRequest, error) {
	if _, err := r.GetPrescription(ctx, userID, prescriptionID); err != nil {
		return nil, err
	}
	id := uuid.New().String()
	const q = `
		INSERT INTO doctor_refill_requests (id, user_id, prescription_id, status, detail, idempotency_key)
		VALUES ($1,$2,$3,'consultation_required',$4,$5)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, id, userID, prescriptionID, jsonOrEmptyObject(detail), idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.getRefillConsultByIdem(ctx, userID, idemKey)
	}
	return r.GetRefillRequest(ctx, userID, id)
}

func (r *Repository) getRefillConsultByIdem(ctx context.Context, userID, idemKey string) (*RefillRequest, error) {
	const q = `SELECT id FROM doctor_refill_requests WHERE user_id = $1 AND idempotency_key = $2`
	var id string
	err := r.db.QueryRow(ctx, q, userID, idemKey).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return r.GetRefillRequest(ctx, userID, id)
}

// ══ CALLS (disputes / feedback / provider switch) ═══════════════════════════

// resolveCallSessionID returns the latest call-session id for an appointment (scoped),
// or "" (no error) when none exists — disputes/feedback can be raised without a session.
func (r *Repository) resolveCallSessionID(ctx context.Context, userID, appointmentID string) (string, error) {
	const q = `
		SELECT id FROM doctor_call_sessions
		WHERE user_id = $1 AND appointment_id = $2 ORDER BY created_at DESC LIMIT 1`
	var id string
	err := r.db.QueryRow(ctx, q, userID, appointmentID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}

// InsertCallDispute appends a call dispute (no idempotency_key column on
// doctor_call_disputes — append-only best-effort). callSessionID may be empty
// (stored NULL). Scoped to the doctor.
func (r *Repository) InsertCallDispute(ctx context.Context, userID, appointmentID, reason string, detail []byte) (*CallDispute, error) {
	sessionID, err := r.resolveCallSessionID(ctx, userID, appointmentID)
	if err != nil {
		return nil, err
	}
	var sessionPtr *string
	if sessionID != "" {
		sessionPtr = &sessionID
	}
	id := uuid.New().String()
	const q = `
		INSERT INTO doctor_call_disputes (id, user_id, call_session_id, appointment_id, status, reason, detail)
		VALUES ($1,$2,$3,$4,'open',$5,$6)
		RETURNING id, user_id, call_session_id, appointment_id, status, reason, detail, created_at, updated_at`
	d := &CallDispute{}
	if err := r.db.QueryRow(ctx, q, id, userID, sessionPtr, appointmentID, reason, jsonOrEmptyObject(detail)).Scan(
		&d.ID, &d.UserID, &d.CallSessionID, &d.AppointmentID, &d.Status, &d.Reason, &d.Detail,
		&d.CreatedAt, &d.UpdatedAt); err != nil {
		return nil, err
	}
	return d, nil
}

// InsertCallFeedback appends consultation feedback (no idempotency_key column —
// append-only best-effort). rating may be nil. Scoped to the doctor. Reuses the
// existing ConsultationFeedback model (mirrors doctor_consultation_feedback).
func (r *Repository) InsertCallFeedback(ctx context.Context, userID, appointmentID string, rating *int, comment *string, detail []byte) (*ConsultationFeedback, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO doctor_consultation_feedback (id, user_id, appointment_id, rating, comment, detail)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING id, user_id, appointment_id, rating, comment, detail, created_at`
	f := &ConsultationFeedback{}
	if err := r.db.QueryRow(ctx, q, id, userID, appointmentID, rating, comment, jsonOrEmptyObject(detail)).Scan(
		&f.ID, &f.UserID, &f.AppointmentID, &f.Rating, &f.Comment, &f.Detail, &f.CreatedAt); err != nil {
		return nil, err
	}
	return f, nil
}

// SwitchCallProvider updates the provider on the latest call session for an
// appointment. Scoped; ErrNotFound when the appointment has no session.
func (r *Repository) SwitchCallProvider(ctx context.Context, userID, appointmentID, provider string, detail []byte) (*CallSession, error) {
	sessionID, err := r.resolveCallSessionID(ctx, userID, appointmentID)
	if err != nil {
		return nil, err
	}
	if sessionID == "" {
		return nil, ErrNotFound
	}
	const q = `
		UPDATE doctor_call_sessions
		SET provider = $3, detail = detail || $4::jsonb, updated_at = now()
		WHERE id = $1 AND user_id = $2`
	if _, err := r.db.Exec(ctx, q, sessionID, userID, provider, jsonOrEmptyObject(detail)); err != nil {
		return nil, err
	}
	return r.getCallSessionByID(ctx, userID, sessionID)
}

// ══ CHAT (state / annotations / status) ═════════════════════════════════════

// GetChatThreadProjection re-uses getChatThread so the handlers can build
// presence/state projections. Scoped; ErrNotFound when the thread is foreign.
func (r *Repository) GetChatThreadProjection(ctx context.Context, userID, threadID string) (*ChatThread, error) {
	return r.getChatThread(ctx, userID, threadID)
}

// SetChatThreadStatus transitions a chat thread (ended|escalated|...) and folds an
// optional detail patch into the JSONB `state` column. Scoped; ErrNotFound when foreign.
func (r *Repository) SetChatThreadStatus(ctx context.Context, userID, threadID, status string, detail []byte) (*ChatThread, error) {
	const q = `
		UPDATE doctor_chat_threads
		SET status = $3, state = state || $4::jsonb, updated_at = now()
		WHERE id = $1 AND user_id = $2`
	tag, err := r.db.Exec(ctx, q, threadID, userID, status, jsonOrEmptyObject(detail))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.getChatThread(ctx, userID, threadID)
}

// ReportChatMessage flips the `reported` flag on a message scoped to the doctor.
// ErrNotFound when the message is foreign.
func (r *Repository) ReportChatMessage(ctx context.Context, userID, messageID string) (*ChatMessage, error) {
	const q = `UPDATE doctor_chat_messages SET reported = true WHERE id = $1 AND user_id = $2`
	tag, err := r.db.Exec(ctx, q, messageID, userID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.getChatMessageByID(ctx, userID, messageID)
}

// AnnotateChatMessage stores a JSONB annotations payload on a message scoped to the
// doctor. ErrNotFound when the message is foreign.
func (r *Repository) AnnotateChatMessage(ctx context.Context, userID, messageID string, annotations []byte) (*ChatMessage, error) {
	const q = `UPDATE doctor_chat_messages SET annotations = $3::jsonb WHERE id = $1 AND user_id = $2`
	tag, err := r.db.Exec(ctx, q, messageID, userID, jsonOrEmptyObject(annotations))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.getChatMessageByID(ctx, userID, messageID)
}

// ══ EMERGENCY ═══════════════════════════════════════════════════════════════

// GetEmergencyCase fetches one emergency case scoped to the doctor.
func (r *Repository) GetEmergencyCase(ctx context.Context, userID, id string) (*EmergencyCase, error) {
	const q = `
		SELECT id, user_id, patient_id, status, summary, detail, created_at, updated_at
		FROM doctor_emergency_cases WHERE id = $1 AND user_id = $2`
	e := &EmergencyCase{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&e.ID, &e.UserID, &e.PatientID, &e.Status,
		&e.Summary, &e.Detail, &e.CreatedAt, &e.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return e, err
}

// InsertEmergencyCase creates an emergency case idempotently (UNIQUE idempotency_key).
func (r *Repository) InsertEmergencyCase(ctx context.Context, userID string, patientID, summary *string, detail []byte, idemKey string) (*EmergencyCase, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO doctor_emergency_cases (id, user_id, patient_id, status, summary, detail, idempotency_key)
		VALUES ($1,$2,$3,'open',$4,$5,$6)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, id, userID, patientID, summary, jsonOrEmptyObject(detail), idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.getEmergencyCaseByIdem(ctx, userID, idemKey)
	}
	return r.GetEmergencyCase(ctx, userID, id)
}

func (r *Repository) getEmergencyCaseByIdem(ctx context.Context, userID, idemKey string) (*EmergencyCase, error) {
	const q = `
		SELECT id, user_id, patient_id, status, summary, detail, created_at, updated_at
		FROM doctor_emergency_cases WHERE user_id = $1 AND idempotency_key = $2`
	e := &EmergencyCase{}
	err := r.db.QueryRow(ctx, q, userID, idemKey).Scan(&e.ID, &e.UserID, &e.PatientID, &e.Status,
		&e.Summary, &e.Detail, &e.CreatedAt, &e.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return e, err
}

// InsertEmergencyEscalation creates an escalation idempotently (UNIQUE
// idempotency_key). escalationType ∈ hospital|ambulance|contact. patientID may be nil.
func (r *Repository) InsertEmergencyEscalation(ctx context.Context, userID string, patientID *string, escalationType string, detail []byte, idemKey string) (*EmergencyEscalation, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO doctor_emergency_escalations (id, user_id, patient_id, escalation_type, status, detail, idempotency_key)
		VALUES ($1,$2,$3,$4,'initiated',$5,$6)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, id, userID, patientID, escalationType, jsonOrEmptyObject(detail), idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.getEmergencyEscalationByIdem(ctx, userID, idemKey)
	}
	return r.getEmergencyEscalationByID(ctx, userID, id)
}

func (r *Repository) getEmergencyEscalationByID(ctx context.Context, userID, id string) (*EmergencyEscalation, error) {
	const q = `
		SELECT id, user_id, patient_id, escalation_type, facility_id, status, detail, created_at
		FROM doctor_emergency_escalations WHERE id = $1 AND user_id = $2`
	e := &EmergencyEscalation{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&e.ID, &e.UserID, &e.PatientID, &e.EscalationType,
		&e.FacilityID, &e.Status, &e.Detail, &e.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return e, err
}

func (r *Repository) getEmergencyEscalationByIdem(ctx context.Context, userID, idemKey string) (*EmergencyEscalation, error) {
	const q = `
		SELECT id, user_id, patient_id, escalation_type, facility_id, status, detail, created_at
		FROM doctor_emergency_escalations WHERE user_id = $1 AND idempotency_key = $2`
	e := &EmergencyEscalation{}
	err := r.db.QueryRow(ctx, q, userID, idemKey).Scan(&e.ID, &e.UserID, &e.PatientID, &e.EscalationType,
		&e.FacilityID, &e.Status, &e.Detail, &e.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return e, err
}
