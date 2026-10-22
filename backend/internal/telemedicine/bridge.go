package telemedicine

// Doctor-console bridge.
//
// A telemedicine booking is the patient's view of a consultation; the doctor's
// working surface is the doctor console (doctor_appointments + chat threads +
// the rich consult screens under /api/v1/doctor). This file mirrors every
// booked appointment into that universe and keeps the two consistent:
//
//   - bridgeToDoctorConsole  writes the mirrored rows on booking (idempotent,
//     best-effort — money and the appointment row already exist by then).
//     The mirrored doctor_appointments row SHARES the telemedicine
//     appointment's id, which makes every readback/sync lookup a direct
//     appointment_id join rather than a ref dance.
//   - ListAppointmentMessages / SendAppointmentMessage let BOTH parties use
//     the same thread from the patient app (the console's own endpoints are
//     doctor-user-scoped and hard-code author='doctor').
//   - GetAppointmentCallToken is the media control plane: a LiveKit join
//     token per appointment when the server is configured, honest
//     configured:false when it is not.
//   - prescriptionFromDoctorConsole / visitSummaryFromDoctorConsole read back
//     what the doctor issued/wrote from the console onto the patient's
//     appointment screens.
//   - SyncFromDoctorConsole mirrors console lifecycle transitions (confirm /
//     start / end / cancel) back onto the telemedicine appointment, including
//     the money: end settles via CompleteAppointment, cancel refunds via
//     CancelAppointment.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/internal/integrations/livekit"
)

// liveKitTokens is the slice of *livekit.Client the bridge needs, kept as an
// interface so an unconfigured server wires nil and every method stays
// testable without a live media server.
type liveKitTokens interface {
	JoinToken(livekit.JoinRequest) (livekit.Token, error)
	CreateRoom(ctx context.Context, name string) error
	ClientURL() string
}

// WithConsoleBridge turns the doctor-console bridge on
// (FEATURE_TELEMEDICINE_CONSOLE_BRIDGE_ENABLED). See Service.consoleBridge.
func (s *Service) WithConsoleBridge(on bool) *Service {
	s.consoleBridge = on
	return s
}

var (
	// ErrAppointmentNotFound covers both "no such appointment" and "not a
	// participant": a caller learns nothing about appointments they are not on.
	ErrAppointmentNotFound = errors.New("telemedicine: appointment not found")
	// ErrConsultInProgress refuses a patient cancel once the doctor has started.
	ErrConsultInProgress = errors.New("telemedicine: the consultation has started and can no longer be cancelled")
	// ErrAppointmentClosed refuses a call token for a cancelled/completed visit.
	ErrAppointmentClosed = errors.New("telemedicine: appointment is closed")
	// ErrSyncActorNotDoctor refuses a console sync from anyone but the
	// appointment's assigned doctor.
	ErrSyncActorNotDoctor = errors.New("telemedicine: console sync is only accepted from the assigned doctor")
)

// assignedDoctorUserID is the auth user of the appointment's doctor: the only
// account whose console rows the bridge trusts.
func (s *Service) assignedDoctorUserID(ctx context.Context, appointmentID string) (string, error) {
	var uid string
	err := s.db.QueryRow(ctx, `
		SELECT COALESCE(d.user_id::text,'') FROM appointments a JOIN doctors d ON d.id = a.doctor_id
		WHERE a.id = $1`, appointmentID).Scan(&uid)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrAppointmentNotFound
	}
	return uid, err
}

// WithLiveKit wires the consult call-token control plane. Nil-safe: unwired,
// GetAppointmentCallToken reports configured:false.
func (s *Service) WithLiveKit(lk liveKitTokens) *Service {
	s.livekit = lk
	return s
}

// ---------- booking → console mirror ----------

// bridgeToDoctorConsole creates the doctor-console rows for a booked
// appointment. Best-effort by contract: the appointment (and the escrow behind
// it) already exists, so a failure here is logged and the booking still
// succeeds. Both inserts are idempotent, so the replay path re-attempts the
// bridge and heals a crashed first attempt.
func (s *Service) bridgeToDoctorConsole(ctx context.Context, appt *Appointment) {
	if !s.consoleBridge {
		return
	}
	if err := s.writeDoctorConsoleRows(ctx, appt); err != nil {
		log.Printf("[telemedicine][bridge] appointment %s: %v", appt.ID, err)
	}
}

func (s *Service) writeDoctorConsoleRows(ctx context.Context, appt *Appointment) error {
	// The mirrored rows are owned by the doctor's AUTH user — every console
	// query filters user_id = auth.uid(). A doctor profile without a linked
	// account cannot host a console session; skip the bridge (the telemedicine
	// appointment still stands).
	var doctorUserID string
	if err := s.db.QueryRow(ctx, `SELECT COALESCE(user_id::text,'') FROM doctors WHERE id=$1`, appt.DoctorID).
		Scan(&doctorUserID); err != nil {
		return fmt.Errorf("load doctor: %w", err)
	}
	if doctorUserID == "" {
		return nil
	}

	patient := s.patientSummary(ctx, appt.PatientID)
	patientJSON, err := json.Marshal(patient)
	if err != nil {
		return fmt.Errorf("encode patient summary: %w", err)
	}

	// Shared id: doctor_appointments.id == appointments.id == appt.ID. This is
	// the whole join contract for readback and reverse sync.
	reason := appt.Notes
	tag := strings.ToUpper(appt.ID[:6])
	_, err = s.db.Exec(ctx, `
		INSERT INTO doctor_appointments
		    (id, user_id, ref, patient_id, patient, consult_type, status,
		     slot_date, slot_time, fee_kobo, reason)
		VALUES ($1,$2::uuid,'TM-'||$3,$4,$5::jsonb,$6,'confirmed',$7::date,$8,$9,$10)
		ON CONFLICT (id) DO NOTHING`,
		appt.ID, doctorUserID, tag, appt.PatientID, string(patientJSON),
		appt.ConsultationType, appt.ScheduledAt.Format("2006-01-02"),
		appt.ScheduledAt.Format("15:04"), appt.FeeKobo, reason,
	)
	if err != nil {
		return fmt.Errorf("mirror appointment: %w", err)
	}

	// One chat thread per appointment; the console's chat screen resolves
	// threads by appointment_id, so this link is load-bearing.
	_, err = s.db.Exec(ctx, `
		INSERT INTO doctor_chat_threads (id, user_id, appointment_id, patient, consult_type, status)
		SELECT gen_random_uuid(), $2::uuid, $1, $3::jsonb, $4, 'active'
		WHERE NOT EXISTS (SELECT 1 FROM doctor_chat_threads WHERE appointment_id = $1 AND user_id = $2::uuid)`,
		appt.ID, doctorUserID, string(patientJSON), appt.ConsultationType,
	)
	if err != nil {
		return fmt.Errorf("create chat thread: %w", err)
	}
	return nil
}

// patientSummary builds the denormalized PatientSummary jsonb the console
// renders (camelCase keys — the console passes the column through verbatim).
func (s *Service) patientSummary(ctx context.Context, patientID string) map[string]any {
	name, email := "", ""
	age := 0
	gender := "other"
	err := s.db.QueryRow(ctx, `
		SELECT COALESCE(full_name,''), COALESCE(email,''), COALESCE(age,0), COALESCE(gender,'')
		FROM user_profiles WHERE id=$1`, patientID).Scan(&name, &email, &age, &gender)
	if err != nil {
		log.Printf("[telemedicine][bridge] patient %s profile read: %v", patientID, err)
	}
	if strings.TrimSpace(name) == "" {
		if email != "" {
			name = strings.SplitN(email, "@", 2)[0]
		} else {
			name = "Patient"
		}
	}
	initials := ""
	for _, w := range strings.Fields(name) {
		if r := []rune(w)[0]; r != 0 {
			initials += strings.ToUpper(string(r))
		}
		if len(initials) >= 2 {
			break
		}
	}
	if initials == "" {
		initials = "PT"
	}
	switch strings.ToLower(gender) {
	case "male":
		gender = "male"
	case "female":
		gender = "female"
	default:
		gender = "other"
	}
	return map[string]any{
		"id":          patientID,
		"userId":      patientID, // console WS routing keys off this
		"name":        name,
		"initials":    initials,
		"avatarColor": "#6750A4",
		"age":         age,
		"gender":      gender,
	}
}

// ---------- shared chat thread ----------

// AppointmentMessage is one line in the consult chat, visible to both the
// patient app and the doctor console thread.
type AppointmentMessage struct {
	ID        string    `json:"id"`
	Author    string    `json:"author"` // 'patient' | 'doctor'
	Body      string    `json:"body"`
	Kind      string    `json:"message_kind"`
	CreatedAt time.Time `json:"created_at"`
}

// ErrNotBridged is returned when an appointment has no doctor-console mirror
// (booked before the bridge existed, or the doctor has no linked account).
var ErrNotBridged = errors.New("telemedicine: appointment is not bridged to a doctor console thread")

// threadForAppointment resolves the bridged chat thread plus its owning
// doctor's auth id (doctor_chat_messages rows are keyed to the doctor).
func (s *Service) threadForAppointment(ctx context.Context, appointmentID string) (threadID, doctorUserID string, err error) {
	if !s.consoleBridge {
		return "", "", ErrNotBridged
	}
	// Only the ASSIGNED doctor's thread counts. Any other thread carrying this
	// appointment id (planted, or left over) is ignored, so patient messages can
	// never be routed into a thread someone else owns.
	err = s.db.QueryRow(ctx, `
		SELECT t.id::text, t.user_id::text
		FROM doctor_chat_threads t
		JOIN appointments a ON a.id = t.appointment_id
		JOIN doctors d ON d.id = a.doctor_id AND d.user_id = t.user_id
		WHERE t.appointment_id = $1
		ORDER BY t.created_at ASC LIMIT 1`,
		appointmentID).Scan(&threadID, &doctorUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", ErrNotBridged
	}
	return threadID, doctorUserID, err
}

// ListAppointmentMessages returns the consult chat for an appointment.
// AuthZ is the appointment itself (patient or assigned doctor); an unbridged
// appointment simply has no conversation yet.
func (s *Service) ListAppointmentMessages(ctx context.Context, appointmentID, userID string) ([]AppointmentMessage, error) {
	if _, err := s.GetAppointment(ctx, appointmentID, userID); err != nil {
		return nil, err
	}
	threadID, _, err := s.threadForAppointment(ctx, appointmentID)
	if errors.Is(err, ErrNotBridged) {
		return []AppointmentMessage{}, nil
	} else if err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `
		SELECT id::text, author, COALESCE(body,''), message_kind, created_at
		FROM doctor_chat_messages
		WHERE thread_id=$1::uuid ORDER BY created_at ASC LIMIT 200`, threadID)
	if err != nil {
		return nil, fmt.Errorf("telemedicine: read chat messages: %w", err)
	}
	defer rows.Close()
	out := []AppointmentMessage{}
	for rows.Next() {
		var m AppointmentMessage
		if err := rows.Scan(&m.ID, &m.Author, &m.Body, &m.Kind, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// SendAppointmentMessage posts one chat line to the bridged thread from either
// side. The author is derived from the caller's relationship to the
// appointment, never from the body — a patient cannot sign a message as the
// doctor. Patient messages bump the console's unread count.
func (s *Service) SendAppointmentMessage(ctx context.Context, appointmentID, userID, body string) (*AppointmentMessage, error) {
	body = strings.TrimSpace(body)
	if body == "" {
		return nil, errors.New("telemedicine: message body is empty")
	}
	if len(body) > 4000 {
		return nil, errors.New("telemedicine: message too long")
	}
	appt, err := s.GetAppointment(ctx, appointmentID, userID)
	if err != nil {
		return nil, err
	}
	threadID, doctorUserID, err := s.threadForAppointment(ctx, appointmentID)
	if err != nil {
		return nil, err
	}
	author := "doctor"
	if userID == appt.PatientID {
		author = "patient"
	}
	m := &AppointmentMessage{
		ID: uuid.New().String(), Author: author, Body: body,
		Kind: "text", CreatedAt: time.Now(),
	}
	_, err = s.db.Exec(ctx, `
		INSERT INTO doctor_chat_messages (id, thread_id, user_id, author, body, message_kind)
		VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,'text')`,
		m.ID, threadID, doctorUserID, author, body)
	if err != nil {
		return nil, fmt.Errorf("telemedicine: insert chat message: %w", err)
	}
	unread := 0
	if author == "patient" {
		unread = 1
	}
	if _, err := s.db.Exec(ctx, `
		UPDATE doctor_chat_threads
		SET last_message=$2, last_message_at=now(), updated_at=now(),
		    unread_count = unread_count + $3
		WHERE id=$1::uuid`, threadID, body, unread); err != nil {
		log.Printf("[telemedicine][bridge] thread %s summary roll-forward: %v", threadID, err)
	}
	return m, nil
}

// ---------- call control plane ----------

// ConsultCallInfo is the media control-plane answer for the consult room.
// Configured:false is not an error: it means no LiveKit server is wired and
// the room runs in local-media demo mode, which the client must present
// honestly.
type ConsultCallInfo struct {
	Configured bool   `json:"configured"`
	Provider   string `json:"provider,omitempty"`
	URL        string `json:"url,omitempty"`
	Room       string `json:"room,omitempty"`
	Token      string `json:"token,omitempty"`
	Role       string `json:"role,omitempty"`
}

// GetAppointmentCallToken mints a LiveKit join token for one participant of
// one appointment's room. Deterministic room (telemed-<appointment id>) so the
// doctor and the patient always land in the same place; the assigned doctor is
// host (may publish), the patient is participant.
func (s *Service) GetAppointmentCallToken(ctx context.Context, appointmentID, userID string) (*ConsultCallInfo, error) {
	appt, err := s.GetAppointment(ctx, appointmentID, userID)
	if err != nil {
		return nil, err
	}
	switch appt.Status {
	case ApptBooked, ApptConfirmed, ApptInProgress:
	default:
		return nil, ErrAppointmentClosed
	}
	if s.livekit == nil {
		return &ConsultCallInfo{Configured: false}, nil
	}
	isPatient := userID == appt.PatientID
	role := livekit.RoleParticipant
	roleName := "participant"
	if !isPatient {
		role = livekit.RoleHost
		roleName = "host"
	}
	room := "telemed-" + appointmentID
	// auto_create is off on the server; CreateRoom is idempotent, so this
	// re-provisions a room the empty-room timeout already closed.
	if err := s.livekit.CreateRoom(ctx, room); err != nil {
		return nil, fmt.Errorf("telemedicine: ensure consult room: %w", err)
	}
	tok, err := s.livekit.JoinToken(livekit.JoinRequest{Room: room, Identity: userID, Role: role})
	if err != nil {
		return nil, fmt.Errorf("telemedicine: join token: %w", err)
	}
	return &ConsultCallInfo{
		Configured: true, Provider: "livekit", URL: s.livekit.ClientURL(),
		Room: room, Token: tok.JWT, Role: roleName,
	}, nil
}

// ---------- doctor-console readbacks ----------

// prescriptionFromDoctorConsole maps a console-issued prescription (the rich
// consult screen writes doctor_prescriptions/_items) onto the telemedicine
// Prescription the patient's summary renders.
func (s *Service) prescriptionFromDoctorConsole(ctx context.Context, appointmentID, patientID, doctorID, doctorName string) (*Prescription, error) {
	if !s.consoleBridge {
		return nil, errors.New("telemedicine: prescription not found")
	}
	var rxID, status string
	var issuedAt *time.Time
	var diagnosis *string
	// Only a prescription written by the appointment's assigned doctor: the row's
	// appointment_id alone proves nothing about who wrote it.
	err := s.db.QueryRow(ctx, `
		SELECT p.id::text, p.status, p.issued_at, p.diagnosis
		FROM doctor_prescriptions p
		JOIN appointments a ON a.id = p.appointment_id
		JOIN doctors d ON d.id = a.doctor_id AND d.user_id = p.user_id
		WHERE p.appointment_id=$1 AND p.status <> 'draft'
		ORDER BY p.issued_at DESC NULLS LAST LIMIT 1`, appointmentID).
		Scan(&rxID, &status, &issuedAt, &diagnosis)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errors.New("telemedicine: prescription not found")
	}
	if err != nil {
		return nil, fmt.Errorf("telemedicine: read console prescription: %w", err)
	}
	p := &Prescription{
		ID: rxID, AppointmentID: appointmentID, DoctorID: doctorID, PatientID: patientID,
		DoctorName: doctorName,
	}
	if issuedAt != nil {
		p.IssuedAt = *issuedAt
	} else {
		p.IssuedAt = time.Now()
	}
	if diagnosis != nil {
		p.Instructions = *diagnosis
	}
	rows, err := s.db.Query(ctx, `
		SELECT COALESCE(name,''), COALESCE(dosage,''), COALESCE(route,''),
		       COALESCE(frequency,''), COALESCE(duration,''), COALESCE(notes,'')
		FROM doctor_prescription_items WHERE prescription_id=$1::uuid ORDER BY position ASC`, rxID)
	if err != nil {
		return nil, fmt.Errorf("telemedicine: read console prescription items: %w", err)
	}
	defer rows.Close()
	lines := []string{}
	for rows.Next() {
		var it RxItem
		if err := rows.Scan(&it.Name, &it.Dosage, &it.Route, &it.Frequency, &it.Duration, &it.Notes); err != nil {
			return nil, err
		}
		p.Items = append(p.Items, it)
		line := it.Name
		if it.Dosage != "" {
			line += " " + it.Dosage
		}
		if it.Frequency != "" {
			line += " — " + it.Frequency
		}
		if it.Duration != "" {
			line += " for " + it.Duration
		}
		lines = append(lines, line)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	p.Medications = strings.Join(lines, "\n")
	return p, nil
}

// visitSummaryFromDoctorConsole derives the patient's visit summary from the
// console's clinical note (doctor_clinical_notes) for a bridged appointment,
// preferring a finalized/shared note over a draft.
func (s *Service) visitSummaryFromDoctorConsole(ctx context.Context, appointmentID, patientID string) (*VisitSummary, error) {
	if !s.consoleBridge {
		return nil, errors.New("telemedicine: no visit summary available")
	}
	var doctorID string
	if err := s.db.QueryRow(ctx, `SELECT doctor_id FROM appointments WHERE id=$1`, appointmentID).
		Scan(&doctorID); err != nil {
		return nil, errors.New("telemedicine: no visit summary available")
	}
	var subjective, objective, assessment, plan *string
	err := s.db.QueryRow(ctx, `
		SELECT n.subjective, n.objective, n.assessment, n.plan
		FROM doctor_clinical_notes n
		JOIN appointments a ON a.id = n.appointment_id
		JOIN doctors d ON d.id = a.doctor_id AND d.user_id = n.user_id
		WHERE n.appointment_id=$1
		ORDER BY (n.status='draft') ASC, n.updated_at DESC LIMIT 1`, appointmentID).
		Scan(&subjective, &objective, &assessment, &plan)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errors.New("telemedicine: no visit summary available")
	}
	if err != nil {
		return nil, fmt.Errorf("telemedicine: read console clinical note: %w", err)
	}
	str := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	return &VisitSummary{
		ID: uuid.New().String(), AppointmentID: appointmentID, DoctorID: doctorID, PatientID: patientID,
		Diagnosis: str(assessment),
		Notes:     str(objective),
		FollowUp:  str(plan),
		CreatedAt: time.Now(),
	}, nil
}

// ---------- doctor-console → telemedicine reverse sync ----------

// SyncFromDoctorConsole mirrors a doctor-console lifecycle transition onto the
// telemedicine appointment the console row was bridged from. Bridged rows
// share the appointment id, so an id that matches no telemedicine appointment
// is simply "not bridged" and returns nil.
//
// Money stays single-sourced: 'completed' runs the real settlement through
// CompleteAppointment and 'cancelled' the real refund through
// CancelAppointment — the console never touches the ledger directly.
func (s *Service) SyncFromDoctorConsole(ctx context.Context, appointmentID, status, doctorUserID string) error {
	if !s.consoleBridge {
		return nil
	}
	assigned, err := s.assignedDoctorUserID(ctx, appointmentID)
	if errors.Is(err, ErrAppointmentNotFound) {
		return nil // not a bridged telemedicine appointment
	}
	if err != nil {
		return fmt.Errorf("telemedicine: sync lookup: %w", err)
	}
	if assigned == "" || assigned != doctorUserID {
		return ErrSyncActorNotDoctor
	}
	var current string
	err = s.db.QueryRow(ctx, `SELECT status FROM appointments WHERE id=$1`, appointmentID).Scan(&current)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("telemedicine: sync lookup: %w", err)
	}
	switch status {
	case "confirmed":
		_, err = s.db.Exec(ctx, `UPDATE appointments SET status='confirmed' WHERE id=$1 AND status='booked'`, appointmentID)
		return err
	case "in_progress":
		_, err = s.db.Exec(ctx, `
			UPDATE appointments SET status='in_progress'
			WHERE id=$1 AND status IN ('booked','confirmed')`, appointmentID)
		return err
	case "completed":
		if current == string(ApptCompleted) || current == string(ApptCancelled) {
			return nil
		}
		return s.CompleteAppointment(ctx, appointmentID, doctorUserID)
	case "cancelled":
		if current == string(ApptCancelled) || current == string(ApptCompleted) {
			return nil
		}
		return s.CancelAppointment(ctx, appointmentID, doctorUserID)
	default:
		// upcoming (reschedule proposal) and no_show have no telemedicine
		// equivalent yet; the console keeps them, the patient app does not move.
		return nil
	}
}
