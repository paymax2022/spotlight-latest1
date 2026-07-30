package healthscheduling

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/scheduler"
)

// Auditor — minimal immutable-audit slice (HL-12). nil is safe.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// State is the appointment lifecycle (HEALTH-BUILD §5):
//
//	REQUESTED → ACCEPTED → CONFIRMED → IN_PROGRESS → COMPLETED
//	(any) → CANCELLED | NO_SHOW ; CONFIRMED → RESCHEDULED → CONFIRMED
type State string

const (
	StateRequested   State = "REQUESTED"
	StateAccepted    State = "ACCEPTED"
	StateConfirmed   State = "CONFIRMED"
	StateInProgress  State = "IN_PROGRESS"
	StateCompleted   State = "COMPLETED"
	StateCancelled   State = "CANCELLED"
	StateNoShow      State = "NO_SHOW"
	StateRescheduled State = "RESCHEDULED"
)

var allowedTransitions = map[State]map[State]bool{
	StateRequested:   {StateAccepted: true, StateCancelled: true},
	StateAccepted:    {StateConfirmed: true, StateCancelled: true},
	StateConfirmed:   {StateInProgress: true, StateRescheduled: true, StateCancelled: true, StateNoShow: true},
	StateInProgress:  {StateCompleted: true, StateCancelled: true},
	StateRescheduled: {StateConfirmed: true, StateCancelled: true},
	StateCompleted:   {},
	StateCancelled:   {},
	StateNoShow:      {},
}

func canTransition(from, to State) bool {
	next, ok := allowedTransitions[from]
	if !ok {
		return false
	}
	return next[to]
}

type Appointment struct {
	ID            string    `json:"id"`
	ProviderID    string    `json:"provider_id"`
	PatientID     string    `json:"patient_id"`
	SubjectType   string    `json:"subject_type"` // PATIENT | PET
	VisitType     string    `json:"visit_type"`   // TELE | HOME | CLINIC
	State         State     `json:"state"`
	SlotStart     time.Time `json:"slot_start"`
	SlotEnd       time.Time `json:"slot_end"`
	ReminderJobID *string   `json:"reminder_job_id,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

// Service owns appointment slots + transitions. Reminders ride the shared
// scheduler (reused — never rebuilt). HL-11: tele is not emergency care — the
// caller surfaces the disclaimer; this layer only books the slot.
type Service struct {
	db    *pgxpool.Pool
	sched *scheduler.Service
	audit Auditor
}

func NewService(db *pgxpool.Pool, sched *scheduler.Service, audit Auditor) *Service {
	return &Service{db: db, sched: sched, audit: audit}
}

// Request books a slot in REQUESTED for the acting patient and schedules a
// reminder on the shared scheduler.
func (s *Service) Request(ctx context.Context, patientID, providerID, subjectType, visitType string, start, end time.Time) (*Appointment, error) {
	if patientID == "" || providerID == "" {
		return nil, fmt.Errorf("scheduling: patient and provider required")
	}
	if !validVisit(visitType) {
		return nil, fmt.Errorf("scheduling: invalid visit_type")
	}
	if !end.After(start) {
		return nil, fmt.Errorf("scheduling: slot_end must be after slot_start")
	}
	if subjectType == "" {
		subjectType = "PATIENT"
	}
	a := &Appointment{
		ID:          uuid.New().String(),
		ProviderID:  providerID,
		PatientID:   patientID,
		SubjectType: subjectType,
		VisitType:   visitType,
		State:       StateRequested,
		SlotStart:   start,
		SlotEnd:     end,
		CreatedAt:   time.Now(),
	}
	// AP-002: prevent double-booking a provider's slot under concurrency. A
	// per-(provider, slot) advisory transaction lock serializes concurrent bookings
	// of the same slot, so the conflict check + insert is atomic — the second racer
	// blocks on the lock, then sees the first booking and is rejected. Half-open
	// overlap: back-to-back slots do not conflict.
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("scheduling: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	lockKey := providerID + "|" + start.UTC().Format(time.RFC3339Nano)
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, lockKey); err != nil {
		return nil, fmt.Errorf("scheduling: slot lock: %w", err)
	}
	var conflict bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM health_appointments
			WHERE provider_id=$1
			  AND state = ANY($2)
			  AND slot_start < $4 AND slot_end > $3
		)`, providerID, blockingStateList(), start, end).Scan(&conflict); err != nil {
		return nil, fmt.Errorf("scheduling: slot conflict check: %w", err)
	}
	if conflict {
		return nil, ErrSlotTaken
	}

	const ins = `INSERT INTO health_appointments (id, provider_id, patient_id, subject_type, visit_type, state, slot_start, slot_end)
	             VALUES ($1,$2,$3,$4,$5,'REQUESTED',$6,$7)`
	if _, err := tx.Exec(ctx, ins, a.ID, a.ProviderID, a.PatientID, a.SubjectType, a.VisitType, a.SlotStart, a.SlotEnd); err != nil {
		return nil, fmt.Errorf("scheduling: insert appointment: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("scheduling: commit booking: %w", err)
	}

	// Reminder one hour before the slot — reused scheduler primitive (no rebuild).
	if s.sched != nil {
		remindAt := start.Add(-1 * time.Hour)
		if remindAt.After(time.Now()) {
			job, err := s.sched.Schedule(ctx, scheduler.Job{
				JobType:     "health.appointment.reminder",
				OwnerUserID: patientID,
				EntityRef:   a.ID,
				Payload:     map[string]any{"appointment_id": a.ID, "visit_type": visitType},
				NextRunAt:   remindAt,
				MaxRuns:     1,
			})
			if err == nil && job != nil {
				_, _ = s.db.Exec(ctx, `UPDATE health_appointments SET reminder_job_id=$2 WHERE id=$1`, a.ID, job.ID)
				a.ReminderJobID = &job.ID
			}
		}
	}
	s.audited(patientID, providerID, "health.appointment.request", a.ID, nil, map[string]any{"state": string(StateRequested), "visit_type": visitType})
	return a, nil
}

// Transition is the guarded appointment state change. providerOwned tells the
// caller whether the actor must be the provider (accept) or the patient (cancel);
// object-level authZ is enforced against the row.
func (s *Service) Transition(ctx context.Context, actorID, apptID string, to State) (*Appointment, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("scheduling: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	a, providerOwner, err := lockAppointment(ctx, tx, apptID)
	if err != nil {
		return nil, err
	}
	// authZ: either the patient or the provider's owner may drive transitions.
	if actorID != a.PatientID && actorID != providerOwner {
		return nil, fmt.Errorf("scheduling: forbidden")
	}
	if a.State == to {
		return a, nil
	}
	if !canTransition(a.State, to) {
		return nil, fmt.Errorf("scheduling: illegal transition %s -> %s", a.State, to)
	}
	if _, err := tx.Exec(ctx, `UPDATE health_appointments SET state=$2, updated_at=now() WHERE id=$1`, apptID, string(to)); err != nil {
		return nil, fmt.Errorf("scheduling: update state: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("scheduling: commit: %w", err)
	}
	s.audited(actorID, a.PatientID, "health.appointment.transition", apptID,
		map[string]any{"state": string(a.State)}, map[string]any{"state": string(to)})
	a.State = to
	return a, nil
}

// Reschedule sets a new slot and routes through RESCHEDULED→CONFIRMED.
func (s *Service) Reschedule(ctx context.Context, actorID, apptID string, start, end time.Time) (*Appointment, error) {
	if !end.After(start) {
		return nil, fmt.Errorf("scheduling: slot_end must be after slot_start")
	}
	if _, err := s.Transition(ctx, actorID, apptID, StateRescheduled); err != nil {
		return nil, err
	}
	if _, err := s.db.Exec(ctx, `UPDATE health_appointments SET slot_start=$2, slot_end=$3, updated_at=now() WHERE id=$1`, apptID, start, end); err != nil {
		return nil, fmt.Errorf("scheduling: update slot: %w", err)
	}
	return s.Transition(ctx, actorID, apptID, StateConfirmed)
}

func (s *Service) ListForPatient(ctx context.Context, patientID string) ([]Appointment, error) {
	const q = `SELECT id, provider_id, patient_id, subject_type, visit_type, state, slot_start, slot_end, reminder_job_id, created_at
	           FROM health_appointments WHERE patient_id=$1 ORDER BY slot_start DESC`
	rows, err := s.db.Query(ctx, q, patientID)
	if err != nil {
		return nil, fmt.Errorf("scheduling: list: %w", err)
	}
	defer rows.Close()
	var out []Appointment
	for rows.Next() {
		var a Appointment
		var state string
		if err := rows.Scan(&a.ID, &a.ProviderID, &a.PatientID, &a.SubjectType, &a.VisitType, &state, &a.SlotStart, &a.SlotEnd, &a.ReminderJobID, &a.CreatedAt); err != nil {
			return nil, err
		}
		a.State = State(state)
		out = append(out, a)
	}
	return out, nil
}

// --- internals ---

func lockAppointment(ctx context.Context, tx pgx.Tx, id string) (*Appointment, string, error) {
	var a Appointment
	var state, providerOwner string
	const q = `SELECT ap.id, ap.provider_id, ap.patient_id, ap.subject_type, ap.visit_type, ap.state, ap.slot_start, ap.slot_end,
	                  COALESCE(p.owner_user_id::text,'')
	           FROM health_appointments ap
	           LEFT JOIN health_providers p ON p.id = ap.provider_id
	           WHERE ap.id=$1 FOR UPDATE OF ap`
	if err := tx.QueryRow(ctx, q, id).Scan(&a.ID, &a.ProviderID, &a.PatientID, &a.SubjectType, &a.VisitType, &state, &a.SlotStart, &a.SlotEnd, &providerOwner); err != nil {
		if err == pgx.ErrNoRows {
			return nil, "", fmt.Errorf("scheduling: appointment not found")
		}
		return nil, "", err
	}
	a.State = State(state)
	return &a, providerOwner, nil
}

func (s *Service) audited(actor, target, action, resourceID string, oldV, newV map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actor, target, action, "health", "health_appointment", resourceID, oldV, newV, "", "", "info")
}

func validVisit(v string) bool {
	switch v {
	case "TELE", "HOME", "CLINIC":
		return true
	}
	return false
}
