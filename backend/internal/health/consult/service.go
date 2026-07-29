package healthconsult

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Auditor — minimal immutable-audit slice (HL-12). nil is safe.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// State is the consult lifecycle. The pre-consult intake gate (ADR-010) inserts two
// additive states for INTAKE-GATED consults:
//
//	(gated)    SCHEDULED → INTAKE_PENDING → READY_FOR_CONSULT → IN_PROGRESS → COMPLETED
//	(legacy)   SCHEDULED → IN_PROGRESS → COMPLETED
//
// The direct SCHEDULED → IN_PROGRESS edge is KEPT for non-intake flows (e.g. the vet
// tele-consult, which has no human-patient intake) — brownfield safety. The gate is
// a ONE-WAY DOOR: once the intake orchestrator moves a consult to INTAKE_PENDING
// (preconsult.EnsureIntake, on prompt), the only exit is READY_FOR_CONSULT, which
// only intake submit (preconsult.Submit) produces. So for an intake appointment,
// IN_PROGRESS is unreachable until intake is submitted — "consult on an empty
// intake" is structurally impossible. The CHECK constraint is widened additively by
// migration 20260818000000_preconsult_intake.sql.
type State string

const (
	StateScheduled       State = "SCHEDULED"
	StateIntakePending   State = "INTAKE_PENDING"
	StateReadyForConsult State = "READY_FOR_CONSULT"
	StateInProgress      State = "IN_PROGRESS"
	StateCompleted       State = "COMPLETED"
)

var allowedTransitions = map[State]map[State]bool{
	StateScheduled:       {StateIntakePending: true, StateInProgress: true},
	StateIntakePending:   {StateReadyForConsult: true},
	StateReadyForConsult: {StateInProgress: true},
	StateInProgress:      {StateCompleted: true},
	StateCompleted:       {},
}

func canTransition(from, to State) bool {
	next, ok := allowedTransitions[from]
	if !ok {
		return false
	}
	return next[to]
}

type Consult struct {
	ID               string     `json:"id"`
	AppointmentID    *string    `json:"appointment_id,omitempty"`
	ProviderID       string     `json:"provider_id"`
	PatientID        string     `json:"patient_id"`
	State            State      `json:"state"`
	RecordingEnabled bool       `json:"recording_enabled"`
	StartedAt        *time.Time `json:"started_at,omitempty"`
	CompletedAt      *time.Time `json:"completed_at,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	// TM-008 follow-up links: a follow-up consult points at the consult it follows
	// (ParentConsultID) and optionally the referral it fulfils (ReferralID).
	ParentConsultID *string `json:"parent_consult_id,omitempty"`
	ReferralID      *string `json:"referral_id,omitempty"`
}

type ClinicalNote struct {
	ID         string    `json:"id"`
	ConsultID  string    `json:"consult_id"`
	AuthorID   string    `json:"author_id"`
	Subjective string    `json:"subjective"`
	Objective  string    `json:"objective"`
	Assessment string    `json:"assessment"`
	Plan       string    `json:"plan"`
	CreatedAt  time.Time `json:"created_at"`
}

// AVToken is the lobby join token. It is computed at runtime from the env signing
// key — the key is never persisted and never logged. Recording is OFF by default.
type AVToken struct {
	ConsultID string `json:"consult_id"`
	Room      string `json:"room"`
	Token     string `json:"token"`
	ExpiresAt int64  `json:"expires_at"`
	Recording bool   `json:"recording"`
}

// Service runs the tele-consult engine (provider-agnostic). avKey is read from env
// by the wiring layer; it is held only in memory and never logged.
type Service struct {
	db    *pgxpool.Pool
	avKey []byte
	audit Auditor
}

func NewService(db *pgxpool.Pool, avKey string, audit Auditor) *Service {
	return &Service{db: db, avKey: []byte(avKey), audit: audit}
}

// Schedule creates a SCHEDULED consult (recording OFF by default).
func (s *Service) Schedule(ctx context.Context, providerID, patientID string, appointmentID *string) (*Consult, error) {
	if providerID == "" || patientID == "" {
		return nil, fmt.Errorf("consult: provider and patient required")
	}
	c := &Consult{
		ID:            uuid.New().String(),
		AppointmentID: appointmentID,
		ProviderID:    providerID,
		PatientID:     patientID,
		State:         StateScheduled,
		CreatedAt:     time.Now(),
	}
	const ins = `INSERT INTO health_consults (id, appointment_id, provider_id, patient_id, state, recording_enabled)
	             VALUES ($1,$2,$3,$4,'SCHEDULED',false)`
	if _, err := s.db.Exec(ctx, ins, c.ID, appointmentID, providerID, patientID); err != nil {
		return nil, fmt.Errorf("consult: insert: %w", err)
	}
	s.audited(providerID, patientID, "health.consult.schedule", c.ID, nil, map[string]any{"state": string(StateScheduled)})
	return c, nil
}

// IssueLobbyToken returns a short-lived AV join token for a participant. Only the
// consult's provider or patient may join (object-level authZ). The token is an
// HMAC over (consult|room|user|window) — the signing key never leaves memory and
// is never logged.
func (s *Service) IssueLobbyToken(ctx context.Context, userID, consultID string) (*AVToken, error) {
	c, providerOwner, err := s.load(ctx, consultID)
	if err != nil {
		return nil, err
	}
	if userID != c.PatientID && userID != providerOwner {
		return nil, fmt.Errorf("consult: forbidden")
	}
	exp := time.Now().Add(15 * time.Minute).Unix()
	room := "consult-" + consultID
	mac := hmac.New(sha256.New, s.avKey)
	mac.Write([]byte(fmt.Sprintf("%s|%s|%s|%d", consultID, room, userID, exp)))
	return &AVToken{
		ConsultID: consultID,
		Room:      room,
		Token:     hex.EncodeToString(mac.Sum(nil)),
		ExpiresAt: exp,
		Recording: c.RecordingEnabled, // false by default
	}, nil
}

// Start moves a consult to IN_PROGRESS (provider opens the room). For a non-intake
// (legacy) consult this is the direct SCHEDULED → IN_PROGRESS edge. For an
// intake-gated consult the orchestrator has already moved it to INTAKE_PENDING on
// prompt, and INTAKE_PENDING → IN_PROGRESS is NOT a legal transition — the only exit
// from INTAKE_PENDING is READY_FOR_CONSULT, which only intake submit produces. So a
// gated consult cannot start on an empty intake (ADR-010).
func (s *Service) Start(ctx context.Context, actorID, consultID string) (*Consult, error) {
	return s.transition(ctx, actorID, consultID, StateInProgress, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE health_consults SET started_at=now() WHERE id=$1`, consultID)
		return err
	})
}

// Complete moves IN_PROGRESS → COMPLETED and persists the ClinicalNote atomically
// (HEALTH-BUILD §5: on COMPLETED persist a note). Emission of a Prescription/
// LabOrder is left to the caller (it owns those refs) — this returns the note id.
func (s *Service) Complete(ctx context.Context, providerOwnerID, consultID string, note ClinicalNote) (*Consult, *ClinicalNote, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("consult: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	c, providerOwner, err := lockConsult(ctx, tx, consultID)
	if err != nil {
		return nil, nil, err
	}
	if providerOwnerID != providerOwner { // only the clinician completes + signs the note
		return nil, nil, fmt.Errorf("consult: forbidden")
	}
	if c.State == StateCompleted {
		return c, nil, nil
	}
	if !canTransition(c.State, StateCompleted) {
		return nil, nil, fmt.Errorf("consult: illegal transition %s -> COMPLETED", c.State)
	}
	if _, err := tx.Exec(ctx, `UPDATE health_consults SET state='COMPLETED', completed_at=now(), updated_at=now() WHERE id=$1`, consultID); err != nil {
		return nil, nil, fmt.Errorf("consult: update state: %w", err)
	}
	note.ID = uuid.New().String()
	note.ConsultID = consultID
	note.AuthorID = providerOwnerID
	note.CreatedAt = time.Now()
	const insNote = `INSERT INTO health_clinical_notes (id, consult_id, author_id, subjective, objective, assessment, plan)
	                 VALUES ($1,$2,$3,$4,$5,$6,$7)`
	if _, err := tx.Exec(ctx, insNote, note.ID, note.ConsultID, note.AuthorID, note.Subjective, note.Objective, note.Assessment, note.Plan); err != nil {
		return nil, nil, fmt.Errorf("consult: insert note: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, nil, fmt.Errorf("consult: commit: %w", err)
	}
	// HL-8: clinical note bodies are PII — never logged; audit records ids only.
	s.audited(providerOwnerID, c.PatientID, "health.consult.complete", consultID,
		map[string]any{"state": string(c.State)}, map[string]any{"state": string(StateCompleted), "note_id": note.ID})
	c.State = StateCompleted
	return c, &note, nil
}

// AddNote appends an in-call note while IN_PROGRESS (does not change state).
func (s *Service) AddNote(ctx context.Context, providerOwnerID, consultID string, note ClinicalNote) (*ClinicalNote, error) {
	c, providerOwner, err := s.load(ctx, consultID)
	if err != nil {
		return nil, err
	}
	if providerOwnerID != providerOwner {
		return nil, fmt.Errorf("consult: forbidden")
	}
	if c.State != StateInProgress && c.State != StateScheduled {
		return nil, fmt.Errorf("consult: notes only while scheduled/in-progress")
	}
	note.ID = uuid.New().String()
	note.ConsultID = consultID
	note.AuthorID = providerOwnerID
	note.CreatedAt = time.Now()
	const ins = `INSERT INTO health_clinical_notes (id, consult_id, author_id, subjective, objective, assessment, plan)
	             VALUES ($1,$2,$3,$4,$5,$6,$7)`
	if _, err := s.db.Exec(ctx, ins, note.ID, note.ConsultID, note.AuthorID, note.Subjective, note.Objective, note.Assessment, note.Plan); err != nil {
		return nil, fmt.Errorf("consult: insert note: %w", err)
	}
	s.audited(providerOwnerID, c.PatientID, "health.consult.note", note.ID, nil, map[string]any{"consult_id": consultID})
	return &note, nil
}

// Transition is the exported guarded state change used by the pre-consult intake
// orchestrator (ADR-010): it drives SCHEDULED→INTAKE_PENDING (when intake is first
// prompted) and INTAKE_PENDING→READY_FOR_CONSULT (on intake submit). Object-level
// authZ (patient or provider owner) + the allowedTransitions guard + audit are
// reused unchanged. Re-applying the current state is a no-op.
func (s *Service) Transition(ctx context.Context, actorID, consultID string, to State) (*Consult, error) {
	return s.transition(ctx, actorID, consultID, to, nil)
}

// LoadByAppointment returns the consult linked to an appointment plus the provider
// owner's user id (the assigned doctor) for object-level authZ. It reuses the same
// provider-owner join as load(). Returns "consult: not found" when no consult is
// linked to the appointment.
func (s *Service) LoadByAppointment(ctx context.Context, appointmentID string) (*Consult, string, error) {
	var c Consult
	var state, providerOwner string
	const q = `SELECT cs.id, cs.appointment_id, cs.provider_id, cs.patient_id, cs.state, cs.recording_enabled,
	                  cs.started_at, cs.completed_at, cs.created_at, COALESCE(p.owner_user_id::text,'')
	           FROM health_consults cs
	           LEFT JOIN health_providers p ON p.id = cs.provider_id
	           WHERE cs.appointment_id=$1
	           ORDER BY cs.created_at DESC LIMIT 1`
	if err := s.db.QueryRow(ctx, q, appointmentID).Scan(&c.ID, &c.AppointmentID, &c.ProviderID, &c.PatientID,
		&state, &c.RecordingEnabled, &c.StartedAt, &c.CompletedAt, &c.CreatedAt, &providerOwner); err != nil {
		if err == pgx.ErrNoRows {
			return nil, "", fmt.Errorf("consult: not found")
		}
		return nil, "", err
	}
	c.State = State(state)
	return &c, providerOwner, nil
}

// --- internals ---

func (s *Service) transition(ctx context.Context, actorID, consultID string, to State, side func(pgx.Tx) error) (*Consult, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("consult: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	c, providerOwner, err := lockConsult(ctx, tx, consultID)
	if err != nil {
		return nil, err
	}
	if actorID != c.PatientID && actorID != providerOwner {
		return nil, fmt.Errorf("consult: forbidden")
	}
	if c.State == to {
		return c, nil
	}
	if !canTransition(c.State, to) {
		return nil, fmt.Errorf("consult: illegal transition %s -> %s", c.State, to)
	}
	if _, err := tx.Exec(ctx, `UPDATE health_consults SET state=$2, updated_at=now() WHERE id=$1`, consultID, string(to)); err != nil {
		return nil, fmt.Errorf("consult: update state: %w", err)
	}
	if side != nil {
		if err := side(tx); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("consult: commit: %w", err)
	}
	s.audited(actorID, c.PatientID, "health.consult.transition", consultID,
		map[string]any{"state": string(c.State)}, map[string]any{"state": string(to)})
	c.State = to
	return c, nil
}

func (s *Service) load(ctx context.Context, consultID string) (*Consult, string, error) {
	var c Consult
	var state, providerOwner string
	const q = `SELECT cs.id, cs.appointment_id, cs.provider_id, cs.patient_id, cs.state, cs.recording_enabled,
	                  cs.started_at, cs.completed_at, cs.created_at, cs.parent_consult_id, cs.referral_id,
	                  COALESCE(p.owner_user_id::text,'')
	           FROM health_consults cs
	           LEFT JOIN health_providers p ON p.id = cs.provider_id
	           WHERE cs.id=$1`
	if err := s.db.QueryRow(ctx, q, consultID).Scan(&c.ID, &c.AppointmentID, &c.ProviderID, &c.PatientID,
		&state, &c.RecordingEnabled, &c.StartedAt, &c.CompletedAt, &c.CreatedAt, &c.ParentConsultID, &c.ReferralID, &providerOwner); err != nil {
		if err == pgx.ErrNoRows {
			return nil, "", fmt.Errorf("consult: not found")
		}
		return nil, "", err
	}
	c.State = State(state)
	return &c, providerOwner, nil
}

func lockConsult(ctx context.Context, tx pgx.Tx, consultID string) (*Consult, string, error) {
	var c Consult
	var state, providerOwner string
	const q = `SELECT cs.id, cs.provider_id, cs.patient_id, cs.state, cs.recording_enabled, COALESCE(p.owner_user_id::text,'')
	           FROM health_consults cs
	           LEFT JOIN health_providers p ON p.id = cs.provider_id
	           WHERE cs.id=$1 FOR UPDATE OF cs`
	if err := tx.QueryRow(ctx, q, consultID).Scan(&c.ID, &c.ProviderID, &c.PatientID, &state, &c.RecordingEnabled, &providerOwner); err != nil {
		if err == pgx.ErrNoRows {
			return nil, "", fmt.Errorf("consult: not found")
		}
		return nil, "", err
	}
	c.State = State(state)
	return &c, providerOwner, nil
}

func (s *Service) audited(actor, target, action, resourceID string, oldV, newV map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actor, target, action, "health", "health_consult", resourceID, oldV, newV, "", "", "info")
}
