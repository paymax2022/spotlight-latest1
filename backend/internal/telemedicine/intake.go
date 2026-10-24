package telemedicine

// Pre-consult health intake for a booked telemedicine appointment.
//
// The patient app ships the questionnaire itself (PRECONSULT_SCHEMA in
// src/features/health/api/preconsult.mock.ts) and the doctor reads the answers
// back before the consult. The appointment screen treats a SUBMITTED intake as
// the structural gate for joining the consult, so the answers need a server-side
// home keyed by the TELEMEDICINE appointment.
//
// They cannot live in the health platform's intake table:
// `health_preconsult_intake.appointment_id` hard-FKs `health_appointments(id)`
// and its `provider_id` FKs `health_providers(id)`, while a tele-consult is an
// `appointments` row with a `doctors` row. Every intake call for a real booking
// 404'd, which left a paid patient staring at a permanently disabled
// "Complete intake to join" button.
//
// Answers are stored as JSON because the schema is app-shipped and versioned;
// the row records which schema answered it (schema_id/version) so the doctor
// console renders what was actually collected. Submit flips DRAFT → SUBMITTED
// and captures the red-flag outcome; the patient may still edit answers
// afterwards (the app offers "review or update before the consult"), which
// updates the same row without reopening the gate.
//
// Red-flag triage runs server-side over the STRUCTURED answers only — the
// symptom selection and the 1–10 severity scale, never a free-text guess — and
// is decision support, never a diagnosis.
//
// PHI: reads are authorised to the patient or the assigned doctor in the SQL
// WHERE clause (the same pattern as GetAppointment); a doctor read is audited
// when the audit sink is wired, ids only — answer bodies never enter the detail.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

const (
	IntakeDraft     = "DRAFT"
	IntakeSubmitted = "SUBMITTED"

	// The app-shipped questionnaire's identity, used for a not-started intake.
	defaultIntakeSchemaID      = "preconsult_v1"
	defaultIntakeSchemaVersion = 1
)

// ErrNotIntakeOwner is the write denial: only the patient answers their intake.
var ErrNotIntakeOwner = errors.New("telemedicine: only the patient may edit this intake")

// IntakeAnswers is a field-id → answer map. Values keep the client's JSON types
// (bool / string / number / string[]) because the rendering schema is client-side.
type IntakeAnswers = map[string]any

// IntakeRedFlag is the submit-time safety outcome, captured rather than
// recomputed, so the doctor sees what the patient reported at that moment.
type IntakeRedFlag struct {
	Severity string   `json:"severity"` // emergency | urgent
	Routing  string   `json:"routing"`  // EMERGENCY | URGENT_CARE | CRISIS
	Hits     []string `json:"hits"`     // matched symptom codes
}

// AppointmentIntake is one row of telemedicine_intakes, in the shape both the
// patient wizard and the doctor console read.
type AppointmentIntake struct {
	ID             string         `json:"id"`
	AppointmentID  string         `json:"appointment_id"`
	Status         string         `json:"status"`
	SchemaID       string         `json:"schema_id"`
	SchemaVersion  int            `json:"schema_version"`
	ConsentVersion string         `json:"consent_version,omitempty"`
	Answers        IntakeAnswers  `json:"answers"`
	RedFlag        *IntakeRedFlag `json:"red_flag,omitempty"`
	SubmittedAt    *time.Time     `json:"submitted_at,omitempty"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DoctorName     string         `json:"doctor_name"`
	// PatientOwns tells the caller whether it may write, which the doctor
	// console uses to hide the edit affordance.
	PatientOwns bool `json:"patient_owns"`
}

// SaveIntakeRequest carries the answers plus the schema/consent identity the
// client answered under. Absent schema fields keep the row's existing values.
type SaveIntakeRequest struct {
	Answers        IntakeAnswers `json:"answers"`
	ConsentVersion string        `json:"consent_version"`
	SchemaID       string        `json:"schema_id"`
	SchemaVersion  int           `json:"schema_version"`
}

// loadIntakeAppointment resolves the appointment for this caller and reports
// whether the caller is the patient (writes) or the assigned doctor (reads).
func (s *Service) loadIntakeAppointment(ctx context.Context, appointmentID, userID string) (patientID, doctorID string, isPatient bool, err error) {
	const q = `
		SELECT a.patient_id::text, a.doctor_id::text, a.patient_id = $2
		FROM appointments a
		WHERE a.id = $1
		  AND (a.patient_id = $2 OR EXISTS (
		      SELECT 1 FROM doctors d WHERE d.id = a.doctor_id AND d.user_id = $2
		  ))`
	err = s.db.QueryRow(ctx, q, appointmentID, userID).Scan(&patientID, &doctorID, &isPatient)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", false, ErrAppointmentNotFound
	}
	if err != nil {
		return "", "", false, fmt.Errorf("telemedicine: load intake appointment: %w", err)
	}
	return patientID, doctorID, isPatient, nil
}

// GetAppointmentIntake reads the intake for an appointment. No row yet is a
// successful answer meaning "not started" — an empty DRAFT. A caller who is
// neither the patient nor the assigned doctor sees not-found.
func (s *Service) GetAppointmentIntake(ctx context.Context, appointmentID, userID string) (*AppointmentIntake, error) {
	patientID, doctorID, isPatient, err := s.loadIntakeAppointment(ctx, appointmentID, userID)
	if err != nil {
		return nil, err
	}

	const q = `
		SELECT i.id::text, i.status, i.schema_id, i.schema_version,
		       COALESCE(i.consent_version, ''), i.answers_json,
		       i.red_flag_severity, i.red_flag_routing, i.red_flag_hits,
		       i.submitted_at, i.updated_at, COALESCE(d.name, '')
		FROM telemedicine_intakes i
		LEFT JOIN doctors d ON d.id = i.doctor_id
		WHERE i.appointment_id = $1`

	var (
		it                         = &AppointmentIntake{AppointmentID: appointmentID, PatientOwns: isPatient}
		consentVersion, doctorName string
		answersRaw, hitsRaw        []byte
		severity, routing          *string
		submittedAt                *time.Time
	)
	err = s.db.QueryRow(ctx, q, appointmentID).
		Scan(&it.ID, &it.Status, &it.SchemaID, &it.SchemaVersion, &consentVersion,
			&answersRaw, &severity, &routing, &hitsRaw, &submittedAt, &it.UpdatedAt, &doctorName)
	if errors.Is(err, pgx.ErrNoRows) {
		return &AppointmentIntake{
			ID:            uuid.New().String(),
			AppointmentID: appointmentID,
			Status:        IntakeDraft,
			SchemaID:      defaultIntakeSchemaID,
			SchemaVersion: defaultIntakeSchemaVersion,
			Answers:       IntakeAnswers{},
			UpdatedAt:     time.Now(),
			DoctorName:    s.appointmentDoctorName(ctx, appointmentID),
			PatientOwns:   isPatient,
		}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("telemedicine: read intake: %w", err)
	}

	it.ConsentVersion = consentVersion
	it.DoctorName = doctorName
	it.SubmittedAt = submittedAt
	it.Answers = IntakeAnswers{}
	if len(answersRaw) > 0 {
		if err := json.Unmarshal(answersRaw, &it.Answers); err != nil {
			return nil, fmt.Errorf("telemedicine: decode intake answers: %w", err)
		}
	}
	if severity != nil && routing != nil {
		hits := []string{}
		if len(hitsRaw) > 0 {
			_ = json.Unmarshal(hitsRaw, &hits)
		}
		it.RedFlag = &IntakeRedFlag{Severity: *severity, Routing: *routing, Hits: hits}
	}

	// A doctor opening the patient's answers is logged, ids only — never the
	// answer bodies — so the app's "every access is logged" copy is true.
	if !isPatient && s.audit != nil {
		if aerr := s.audit.InsertAudit(ctx, userID, "telemedicine.intake.viewed", "appointment_intake", it.ID, "",
			map[string]any{"appointment_id": appointmentID, "patient_id": patientID, "doctor_id": doctorID}); aerr != nil {
			log.Printf("telemedicine: intake access audit failed: %v", aerr)
		}
	}
	return it, nil
}

// appointmentDoctorName falls back to the name denormalised on the appointment
// row at booking, so a deleted doctor profile cannot blank the patient's
// confirmation copy.
func (s *Service) appointmentDoctorName(ctx context.Context, appointmentID string) string {
	var name string
	if err := s.db.QueryRow(ctx, `SELECT COALESCE(doctor_name, '') FROM appointments WHERE id=$1`, appointmentID).
		Scan(&name); err != nil {
		return ""
	}
	return name
}

// SaveAppointmentIntakeDraft autosaves answers (and any consent just accepted)
// without closing the intake. Patient-only.
func (s *Service) SaveAppointmentIntakeDraft(ctx context.Context, appointmentID, userID string, req SaveIntakeRequest) (*AppointmentIntake, error) {
	return s.writeIntake(ctx, appointmentID, userID, req, false)
}

// SubmitAppointmentIntake stores the answers, flips the row to SUBMITTED and
// captures the red-flag outcome. Patient-only.
func (s *Service) SubmitAppointmentIntake(ctx context.Context, appointmentID, userID string, req SaveIntakeRequest) (*AppointmentIntake, error) {
	return s.writeIntake(ctx, appointmentID, userID, req, true)
}

func (s *Service) writeIntake(ctx context.Context, appointmentID, userID string, req SaveIntakeRequest, submit bool) (*AppointmentIntake, error) {
	patientID, doctorID, isPatient, err := s.loadIntakeAppointment(ctx, appointmentID, userID)
	if err != nil {
		return nil, err
	}
	if !isPatient || userID != patientID {
		return nil, ErrNotIntakeOwner
	}

	answers := req.Answers
	if answers == nil {
		answers = IntakeAnswers{}
	}
	answersRaw, err := json.Marshal(answers)
	if err != nil {
		return nil, fmt.Errorf("telemedicine: encode intake answers: %w", err)
	}

	// Triage runs on submit AND on every edit after submit: answers stay
	// editable, and a symptom added later (chest pain after submitting) must
	// still route the patient. The stored outcome only ever rises — an edit can
	// add urgency, never remove it (raiseRedFlag).
	// Read-merge-write under a per-appointment advisory lock, so two concurrent
	// edits cannot both read the old triage and drop each other's escalation.
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("telemedicine: begin intake write: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('telemedicine_intake:' || $1, 0))`, appointmentID); err != nil {
		return nil, fmt.Errorf("telemedicine: lock intake: %w", err)
	}
	var prevStatus string
	var prevSeverity, prevRouting *string
	var prevHitsRaw []byte
	if err := tx.QueryRow(ctx, `
		SELECT status, red_flag_severity, red_flag_routing, COALESCE(red_flag_hits, '[]'::jsonb)
		FROM telemedicine_intakes WHERE appointment_id=$1::uuid`, appointmentID).
		Scan(&prevStatus, &prevSeverity, &prevRouting, &prevHitsRaw); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("telemedicine: read intake: %w", err)
	}
	triage := submit || prevStatus == IntakeSubmitted
	var severity, routing any
	var hitsRaw any
	if triage {
		var prev *IntakeRedFlag
		if prevRouting != nil && *prevRouting != "" {
			prev = &IntakeRedFlag{Routing: *prevRouting}
			if prevSeverity != nil {
				prev.Severity = *prevSeverity
			}
			_ = json.Unmarshal(prevHitsRaw, &prev.Hits)
		}
		hits := []string{}
		if rf := raiseRedFlag(prev, evaluateIntakeRedFlag(answers)); rf != nil {
			severity, routing, hits = rf.Severity, rf.Routing, rf.Hits
		}
		b, err := json.Marshal(hits)
		if err != nil {
			return nil, fmt.Errorf("telemedicine: encode red-flag hits: %w", err)
		}
		hitsRaw = string(b)
	}

	// One row per appointment, so every write is an upsert on appointment_id.
	// A submit is one-way for the status but answers stay editable afterwards;
	// consent never reverts to un-accepted.
	const up = `
		INSERT INTO telemedicine_intakes (
		    id, appointment_id, patient_id, doctor_id, schema_id, schema_version,
		    consent_version, consent_at, status, answers_json,
		    red_flag_severity, red_flag_routing, red_flag_hits, submitted_at)
		VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6,
		        NULLIF($7, ''), CASE WHEN NULLIF($7, '') IS NULL THEN NULL ELSE now() END,
		        $8, $9::jsonb, $10, $11, COALESCE($12::jsonb, '[]'::jsonb),
		        CASE WHEN $8 = 'SUBMITTED' THEN now() ELSE NULL END)
		ON CONFLICT (appointment_id) DO UPDATE SET
		    schema_id       = EXCLUDED.schema_id,
		    schema_version  = EXCLUDED.schema_version,
		    consent_version = COALESCE(EXCLUDED.consent_version, telemedicine_intakes.consent_version),
		    consent_at      = COALESCE(EXCLUDED.consent_at, telemedicine_intakes.consent_at),
		    answers_json    = EXCLUDED.answers_json,
		    status          = CASE WHEN $13 THEN 'SUBMITTED' ELSE telemedicine_intakes.status END,
		    submitted_at    = CASE WHEN $13 THEN now() ELSE telemedicine_intakes.submitted_at END,
		    red_flag_severity = CASE WHEN $14 THEN EXCLUDED.red_flag_severity ELSE telemedicine_intakes.red_flag_severity END,
		    red_flag_routing  = CASE WHEN $14 THEN EXCLUDED.red_flag_routing ELSE telemedicine_intakes.red_flag_routing END,
		    red_flag_hits     = CASE WHEN $14 THEN EXCLUDED.red_flag_hits ELSE telemedicine_intakes.red_flag_hits END,
		    updated_at      = now()`

	status := IntakeDraft
	if submit {
		status = IntakeSubmitted
	}
	schemaID := req.SchemaID
	if schemaID == "" {
		schemaID = defaultIntakeSchemaID
	}
	schemaVersion := req.SchemaVersion
	if schemaVersion == 0 {
		schemaVersion = defaultIntakeSchemaVersion
	}

	_, err = tx.Exec(ctx, up,
		uuid.New().String(), appointmentID, patientID, doctorID, schemaID, schemaVersion,
		req.ConsentVersion, status, string(answersRaw), severity, routing, hitsRaw, submit, triage,
	)
	if err != nil {
		return nil, fmt.Errorf("telemedicine: write intake: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("telemedicine: commit intake: %w", err)
	}

	// Re-read as the patient — the writer always is them, and reading through the
	// same path keeps the response identical to a subsequent GET.
	return s.GetAppointmentIntake(ctx, appointmentID, patientID)
}

// emergencySymptomCodes are the red-flag selections the wizard's symptom step
// offers; a hit routes the patient to in-person care instead of a queue.
var emergencySymptomCodes = map[string]bool{
	"chest_pain": true,
	"breathing":  true,
	"stroke":     true,
	"bleeding":   true,
}

const crisisSymptomCode = "self_harm"

// evaluateIntakeRedFlag is the authoritative submit-time safety check. It reads
// ONLY structured answers and can only raise urgency. Crisis (self-harm) wins
// over the physical emergencies because its copy is supportive, not "go to the
// emergency department".
func evaluateIntakeRedFlag(answers IntakeAnswers) *IntakeRedFlag {
	flags := stringSlice(answers["red_flag_symptoms"])

	var physical []string
	for _, f := range flags {
		if f == crisisSymptomCode {
			return &IntakeRedFlag{Severity: "emergency", Routing: "CRISIS", Hits: []string{f}}
		}
		if emergencySymptomCodes[f] {
			physical = append(physical, f)
		}
	}
	if len(physical) > 0 {
		return &IntakeRedFlag{Severity: "emergency", Routing: "EMERGENCY", Hits: physical}
	}
	// JSON decodes numbers as float64; the scale is 1–10 so the compare is exact.
	if sev, ok := answers["severity"].(float64); ok && sev >= 9 {
		return &IntakeRedFlag{Severity: "urgent", Routing: "URGENT_CARE", Hits: []string{"severity_9_plus"}}
	}
	return nil
}

// redFlagRank orders triage outcomes by urgency.
func redFlagRank(rf *IntakeRedFlag) int {
	if rf == nil {
		return 0
	}
	switch rf.Routing {
	case "CRISIS":
		return 3
	case "EMERGENCY":
		return 2
	case "URGENT_CARE":
		return 1
	}
	return 0
}

// raiseRedFlag keeps the more urgent of the stored and the fresh outcome, so a
// later edit can escalate a submitted intake but never quietly de-escalate it.
func raiseRedFlag(prev, next *IntakeRedFlag) *IntakeRedFlag {
	if redFlagRank(next) > redFlagRank(prev) {
		return next
	}
	return prev
}

func stringSlice(v any) []string {
	switch s := v.(type) {
	case []string:
		return s
	case []any:
		out := make([]string, 0, len(s))
		for _, e := range s {
			if str, ok := e.(string); ok {
				out = append(out, str)
			}
		}
		return out
	}
	return nil
}

// ---------- HTTP handlers ----------

// GetAppointmentIntake serves both sides of the consult: the patient's wizard
// and the doctor console's pre-consult readback
// (GET /appointments/:id/intake). A missing intake is a 200 with an empty DRAFT,
// never a 404 — "not started yet" is not a failure.
func (h *Handler) GetAppointmentIntake(c *gin.Context) {
	it, err := h.svc.GetAppointmentIntake(c.Request.Context(), c.Param("id"), ginutil.UserID(c))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{keyError: httperr.Msg(c, http.StatusNotFound, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": it})
}

// SaveAppointmentIntakeDraft is the wizard's autosave
// (PUT /appointments/:id/intake/draft).
func (h *Handler) SaveAppointmentIntakeDraft(c *gin.Context) {
	h.writeIntakeRequest(c, false)
}

// SubmitAppointmentIntake closes the intake and captures the safety outcome
// (POST /appointments/:id/intake/submit).
func (h *Handler) SubmitAppointmentIntake(c *gin.Context) {
	h.writeIntakeRequest(c, true)
}

// maxIntakeBody caps an intake write; the app-shipped questionnaire is a few KB.
const maxIntakeBody = 64 << 10

func (h *Handler) writeIntakeRequest(c *gin.Context, submit bool) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxIntakeBody)
	var req SaveIntakeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{keyError: httperr.Msg(c, http.StatusRequestEntityTooLarge, err)})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	appointmentID := c.Param("id")
	userID := ginutil.UserID(c)

	var (
		it  *AppointmentIntake
		err error
	)
	if submit {
		it, err = h.svc.SubmitAppointmentIntake(c.Request.Context(), appointmentID, userID, req)
	} else {
		it, err = h.svc.SaveAppointmentIntakeDraft(c.Request.Context(), appointmentID, userID, req)
	}
	switch {
	case errors.Is(err, ErrAppointmentNotFound):
		c.JSON(http.StatusNotFound, gin.H{keyError: httperr.Msg(c, http.StatusNotFound, err)})
		return
	case errors.Is(err, ErrNotIntakeOwner):
		// A doctor (or anyone else) posting into a patient's intake is a
		// forbidden write, not a missing resource.
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	case err != nil:
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": it})
}
