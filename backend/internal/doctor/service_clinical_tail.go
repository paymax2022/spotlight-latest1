package doctor

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

// service_clinical_tail.go — business logic for the "clinical tail" endpoint groups.
//
// Mirrors the established service style: reads delegate to the repository scoped to
// the authenticated doctor; mutations on tables with a UNIQUE idempotency_key require
// the Idempotency-Key header (ErrIdempotencyRequired) and rely on the repository's
// ON CONFLICT replay. Operations whose backing table has NO idem column (call
// disputes/feedback, prescription audit) are best-effort appends — they still require
// the header for API consistency but dedupe is not enforced (documented at the call).
//
// NONE of these touch the money ledger. Free-form `Generic` bodies are parsed via the
// shared parseOpsPatch helper (service_ops.go) so the few typed knobs are pulled out
// without redefining anything. The reused helpers strOrDefault / derefStr (service.go)
// and jsonOrEmptyObject (repository.go) are NOT redeclared here.

// ── Projection structs (response-only; unique names) ─────────────────────────

// CallDispute mirrors public.doctor_call_disputes.
type CallDispute struct {
	ID            string          `json:"id"`
	UserID        string          `json:"userId"`
	CallSessionID *string         `json:"callSessionId,omitempty"`
	AppointmentID *string         `json:"appointmentId,omitempty"`
	Status        string          `json:"status"`
	Reason        *string         `json:"reason,omitempty"`
	Detail        json.RawMessage `json:"detail,omitempty"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
}

// EmergencyCase mirrors public.doctor_emergency_cases.
type EmergencyCase struct {
	ID        string          `json:"id"`
	UserID    string          `json:"userId"`
	PatientID *string         `json:"patientId,omitempty"`
	Status    string          `json:"status"`
	Summary   *string         `json:"summary,omitempty"`
	Detail    json.RawMessage `json:"detail,omitempty"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

// EmergencyEscalation mirrors public.doctor_emergency_escalations.
type EmergencyEscalation struct {
	ID             string          `json:"id"`
	UserID         string          `json:"userId"`
	PatientID      *string         `json:"patientId,omitempty"`
	EscalationType string          `json:"escalationType"`
	FacilityID     *string         `json:"facilityId,omitempty"`
	Status         string          `json:"status"`
	Detail         json.RawMessage `json:"detail,omitempty"`
	CreatedAt      time.Time       `json:"createdAt"`
}

// CallPreCheckProjection is a readiness summary for a call (no token fabrication).
type CallPreCheckProjection struct {
	AppointmentID string  `json:"appointmentId"`
	HasSession    bool    `json:"hasSession"`
	Status        string  `json:"status"`
	RTCConfigured bool    `json:"rtcConfigured"`
	Provider      *string `json:"provider,omitempty"`
}

// ChatPresenceProjection is a derived presence view (no presence table exists, so
// online is always false and lastSeenAt is null — derived from the thread).
type ChatPresenceProjection struct {
	ThreadID   string     `json:"threadId"`
	Online     bool       `json:"online"`
	LastSeenAt *time.Time `json:"lastSeenAt"`
}

// ChatStateProjection is a thread-state view.
type ChatStateProjection struct {
	ThreadID      string     `json:"threadId"`
	Status        string     `json:"status"`
	LastMessageAt *time.Time `json:"lastMessageAt,omitempty"`
	UnreadCount   int        `json:"unreadCount"`
}

// HMOEligibilityProjection is the appointment-level coverage summary.
type HMOEligibilityProjection struct {
	AppointmentID string  `json:"appointmentId"`
	Eligible      bool    `json:"eligible"`
	Reason        string  `json:"reason,omitempty"`
	Provider      *string `json:"provider,omitempty"`
	PlanName      *string `json:"planName,omitempty"`
	CopayKobo     int64   `json:"copayKobo"`
}

// ══ APPOINTMENT TRANSITIONS ═════════════════════════════════════════════════

func (s *Service) StartAppointment(ctx context.Context, userID, appointmentID string, raw json.RawMessage) (*Appointment, error) {
	return s.repo.TransitionAppointment(ctx, userID, appointmentID, "in_progress", nil, raw)
}

func (s *Service) EndAppointment(ctx context.Context, userID, appointmentID string, raw json.RawMessage) (*Appointment, error) {
	return s.repo.TransitionAppointment(ctx, userID, appointmentID, "completed", nil, raw)
}

func (s *Service) CancelAppointment(ctx context.Context, userID, appointmentID string, raw json.RawMessage) (*Appointment, error) {
	return s.repo.TransitionAppointment(ctx, userID, appointmentID, "cancelled", nil, raw)
}

func (s *Service) MarkNoShow(ctx context.Context, userID, appointmentID string, raw json.RawMessage) (*Appointment, error) {
	return s.repo.TransitionAppointment(ctx, userID, appointmentID, "no_show", nil, raw)
}

// ══ CLINICAL NOTES ══════════════════════════════════════════════════════════

// GetClinicalNote returns the latest clinical note for an appointment, or nil (not an
// error) when none exists so the handler can return a 200 with a null body.
func (s *Service) GetClinicalNote(ctx context.Context, userID, appointmentID string) (*ClinicalNote, error) {
	note, err := s.repo.GetLatestNote(ctx, userID, appointmentID)
	if errors.Is(err, ErrNotFound) {
		return nil, nil
	}
	return note, err
}

// SaveClinicalNote upserts a rich clinical note from the raw JSON body. Requires an
// Idempotency-Key (deduped via the table's UNIQUE idempotency_key in InsertNote).
func (s *Service) SaveClinicalNote(ctx context.Context, userID, appointmentID, idemKey string, raw json.RawMessage) (*ClinicalNote, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	var req SaveNoteRequest
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, err
		}
	}
	return s.repo.InsertNote(ctx, userID, appointmentID, idemKey, req)
}

// FinalizeClinicalNote sets status='finalized' and stamps finalized_at.
func (s *Service) FinalizeClinicalNote(ctx context.Context, userID, noteID string, raw json.RawMessage) (*ClinicalNote, error) {
	return s.repo.TransitionNote(ctx, userID, noteID, "finalized", raw)
}

// ShareClinicalNote sets status='shared' and records the share detail.
func (s *Service) ShareClinicalNote(ctx context.Context, userID, noteID string, raw json.RawMessage) (*ClinicalNote, error) {
	return s.repo.TransitionNote(ctx, userID, noteID, "shared", raw)
}

// ══ PRESCRIPTIONS ═══════════════════════════════════════════════════════════

// GetIssuedPrescription returns a prescription only if it has been issued; otherwise
// ErrNotFound (the handler maps that to 404). Reuses the GetPrescription read shape.
func (s *Service) GetIssuedPrescription(ctx context.Context, userID, id string) (*Prescription, error) {
	rx, err := s.repo.GetPrescription(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if rx.Status != "issued" {
		return nil, ErrNotFound
	}
	return rx, nil
}

// IssuePrescription transitions draft->issued and stamps issued_at. Requires an
// Idempotency-Key (the underlying UPDATE is naturally idempotent — issued_at is
// preserved via COALESCE — so the header is enforced for API consistency).
func (s *Service) IssuePrescription(ctx context.Context, userID, prescriptionID, idemKey string) (*Prescription, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.TransitionPrescription(ctx, userID, prescriptionID, "issued")
}

// CancelPrescription sets status='cancelled'.
func (s *Service) CancelPrescription(ctx context.Context, userID, prescriptionID string) (*Prescription, error) {
	return s.repo.TransitionPrescription(ctx, userID, prescriptionID, "cancelled")
}

// SharePrescription appends a 'shared' audit entry (doctor_prescription_audit has no
// idem column — best-effort append) and echoes the prescription.
func (s *Service) SharePrescription(ctx context.Context, userID, prescriptionID string, raw json.RawMessage) (*Prescription, error) {
	return s.repo.RecordPrescriptionAudit(ctx, userID, prescriptionID, "shared", raw)
}

// AttachPrescriptionPharmacy records the chosen pharmacy as an audit entry
// (best-effort append into doctor_prescription_audit) and echoes the prescription.
func (s *Service) AttachPrescriptionPharmacy(ctx context.Context, userID, prescriptionID string, raw json.RawMessage) (*Prescription, error) {
	return s.repo.RecordPrescriptionAudit(ctx, userID, prescriptionID, "pharmacy_attached", raw)
}

// SendPrescriptionToPharmacy marks the prescription as sent to a pharmacy (best-effort
// audit append) and echoes the prescription.
func (s *Service) SendPrescriptionToPharmacy(ctx context.Context, userID, prescriptionID string, raw json.RawMessage) (*Prescription, error) {
	return s.repo.RecordPrescriptionAudit(ctx, userID, prescriptionID, "sent_to_pharmacy", raw)
}

// RequestRefillConsultation creates a refill-request flagged consultation_required.
// Requires an Idempotency-Key (deduped via doctor_refill_requests.idempotency_key).
func (s *Service) RequestRefillConsultation(ctx context.Context, userID, prescriptionID, idemKey string, raw json.RawMessage) (*RefillRequest, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.InsertRefillConsultation(ctx, userID, prescriptionID, raw, idemKey)
}

// ══ CALLS ═══════════════════════════════════════════════════════════════════

// GetCallPreCheck resolves the latest call session for an appointment and returns a
// readiness projection. When no session exists it returns a default (hasSession=false)
// rather than failing — NO tokens are ever fabricated.
func (s *Service) GetCallPreCheck(ctx context.Context, userID, appointmentID string) (*CallPreCheckProjection, error) {
	sess, err := s.repo.GetCallSessionForAppointment(ctx, userID, appointmentID)
	if errors.Is(err, ErrNotFound) {
		return &CallPreCheckProjection{AppointmentID: appointmentID, HasSession: false, Status: "no_session", RTCConfigured: false}, nil
	}
	if err != nil {
		return nil, err
	}
	return &CallPreCheckProjection{
		AppointmentID: appointmentID,
		HasSession:    true,
		Status:        sess.Status,
		RTCConfigured: sess.RoomToken != nil && *sess.RoomToken != "",
		Provider:      sess.Provider,
	}, nil
}

// GetCallRich returns the call session for an appointment (reuses GetCallSession).
func (s *Service) GetCallRich(ctx context.Context, userID, appointmentID string) (*CallSession, error) {
	return s.repo.GetCallSessionForAppointment(ctx, userID, appointmentID)
}

// DisputeCall raises a call dispute. doctor_call_disputes has no idempotency_key column
// so the insert is a best-effort append; the header is required for API consistency
// only (dedupe is NOT enforced — documented inline).
func (s *Service) DisputeCall(ctx context.Context, userID, appointmentID, idemKey string, raw json.RawMessage) (*CallDispute, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	p := parseOpsPatch(raw)
	return s.repo.InsertCallDispute(ctx, userID, appointmentID, strOrDefault(p.Reason, ""), raw)
}

// SubmitCallFeedback appends consultation feedback (no idem column — best-effort).
func (s *Service) SubmitCallFeedback(ctx context.Context, userID, appointmentID string, raw json.RawMessage) (*ConsultationFeedback, error) {
	var body struct {
		Rating  *int    `json:"rating,omitempty"`
		Comment *string `json:"comment,omitempty"`
	}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &body)
	}
	return s.repo.InsertCallFeedback(ctx, userID, appointmentID, body.Rating, body.Comment, raw)
}

// SwitchCallProvider updates the call session's RTC provider for an appointment.
func (s *Service) SwitchCallProvider(ctx context.Context, userID, appointmentID string, raw json.RawMessage) (*CallSession, error) {
	p := parseOpsPatch(raw)
	return s.repo.SwitchCallProvider(ctx, userID, appointmentID, strOrDefault(p.Provider, "agora"), raw)
}

// ══ CHAT ════════════════════════════════════════════════════════════════════

// GetChatPresence returns a derived presence projection (no presence table exists).
func (s *Service) GetChatPresence(ctx context.Context, userID, threadID string) (*ChatPresenceProjection, error) {
	if _, err := s.repo.GetChatThreadProjection(ctx, userID, threadID); err != nil {
		return nil, err
	}
	return &ChatPresenceProjection{ThreadID: threadID, Online: false, LastSeenAt: nil}, nil
}

// ListChatRichMessages reuses ListChatMessages (the scan already carries message_kind /
// attachment fields, so "rich" is the same projection).
func (s *Service) ListChatRichMessages(ctx context.Context, userID, threadID string) ([]ChatMessage, error) {
	return s.repo.ListChatMessages(ctx, userID, threadID)
}

// GetChatState returns a thread-state projection.
func (s *Service) GetChatState(ctx context.Context, userID, threadID string) (*ChatStateProjection, error) {
	t, err := s.repo.GetChatThreadProjection(ctx, userID, threadID)
	if err != nil {
		return nil, err
	}
	return &ChatStateProjection{ThreadID: t.ID, Status: t.Status, LastMessageAt: t.LastMessageAt, UnreadCount: t.UnreadCount}, nil
}

// GetChatTranscript returns the message list as a transcript (reuses ListChatMessages).
func (s *Service) GetChatTranscript(ctx context.Context, userID, threadID string) ([]ChatMessage, error) {
	return s.repo.ListChatMessages(ctx, userID, threadID)
}

// SendChatAttachment sends a chat message carrying an attachment (reuses
// InsertChatMessage; message_kind is derived as 'attachment' when attachmentUrl is set).
// Requires an Idempotency-Key (deduped via doctor_chat_messages.idempotency_key).
func (s *Service) SendChatAttachment(ctx context.Context, userID, threadID, idemKey string, raw json.RawMessage) (*ChatMessage, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	var req SendChatMessageRequest
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, err
		}
	}
	return s.repo.InsertChatMessage(ctx, userID, threadID, req, idemKey)
}

// SendChatVoice sends a voice chat message (attachmentUrl carries the audio clip).
// Requires an Idempotency-Key (deduped via doctor_chat_messages.idempotency_key).
func (s *Service) SendChatVoice(ctx context.Context, userID, threadID, idemKey string, raw json.RawMessage) (*ChatMessage, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	var req SendChatMessageRequest
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, err
		}
	}
	return s.repo.InsertChatMessage(ctx, userID, threadID, req, idemKey)
}

// EndChatThread sets the thread status to 'ended'.
func (s *Service) EndChatThread(ctx context.Context, userID, threadID string, raw json.RawMessage) (*ChatThread, error) {
	return s.repo.SetChatThreadStatus(ctx, userID, threadID, "ended", raw)
}

// EscalateChatThread sets the thread status to 'escalated' and folds in detail.
func (s *Service) EscalateChatThread(ctx context.Context, userID, threadID string, raw json.RawMessage) (*ChatThread, error) {
	return s.repo.SetChatThreadStatus(ctx, userID, threadID, "escalated", raw)
}

// ShareChatThread records a share by folding detail into the thread state (status
// preserved as 'active' unless a status patch is supplied).
func (s *Service) ShareChatThread(ctx context.Context, userID, threadID string, raw json.RawMessage) (*ChatThread, error) {
	t, err := s.repo.GetChatThreadProjection(ctx, userID, threadID)
	if err != nil {
		return nil, err
	}
	return s.repo.SetChatThreadStatus(ctx, userID, threadID, t.Status, raw)
}

// ReportChatMessage flips the reported flag on a message.
func (s *Service) ReportChatMessage(ctx context.Context, userID, messageID string) (*ChatMessage, error) {
	return s.repo.ReportChatMessage(ctx, userID, messageID)
}

// AnnotateChatMessage stores annotations on a message.
func (s *Service) AnnotateChatMessage(ctx context.Context, userID, messageID string, raw json.RawMessage) (*ChatMessage, error) {
	return s.repo.AnnotateChatMessage(ctx, userID, messageID, raw)
}

// ══ EMERGENCY ═══════════════════════════════════════════════════════════════

// GetEmergencyCase fetches one emergency case scoped to the doctor.
func (s *Service) GetEmergencyCase(ctx context.Context, userID, id string) (*EmergencyCase, error) {
	return s.repo.GetEmergencyCase(ctx, userID, id)
}

// CreateEmergencyCase inserts an emergency case idempotently.
func (s *Service) CreateEmergencyCase(ctx context.Context, userID, idemKey string, raw json.RawMessage) (*EmergencyCase, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	var body struct {
		PatientID *string `json:"patientId,omitempty"`
		Summary   *string `json:"summary,omitempty"`
	}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &body)
	}
	return s.repo.InsertEmergencyCase(ctx, userID, body.PatientID, body.Summary, raw, idemKey)
}

// NotifyEmergencyContact inserts a 'contact' escalation for the patient.
func (s *Service) NotifyEmergencyContact(ctx context.Context, userID, patientID, idemKey string, raw json.RawMessage) (*EmergencyEscalation, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	pid := patientID
	return s.repo.InsertEmergencyEscalation(ctx, userID, &pid, "contact", raw, idemKey)
}

// EscalateAmbulance inserts an 'ambulance' escalation.
func (s *Service) EscalateAmbulance(ctx context.Context, userID, idemKey string, raw json.RawMessage) (*EmergencyEscalation, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	p := parseOpsPatch(raw)
	return s.repo.InsertEmergencyEscalation(ctx, userID, p.PatientID, "ambulance", raw, idemKey)
}

// EscalateHospital inserts a 'hospital' escalation.
func (s *Service) EscalateHospital(ctx context.Context, userID, idemKey string, raw json.RawMessage) (*EmergencyEscalation, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	p := parseOpsPatch(raw)
	return s.repo.InsertEmergencyEscalation(ctx, userID, p.PatientID, "hospital", raw, idemKey)
}

// ══ AI READ-BACK (advisory; nothing is stored) ══════════════════════════════

// notStoredEnvelope builds an AiEnvelope indicating the result must be (re)generated.
// AI generation persists nothing, so these GET endpoints never call the LLM and never
// fabricate clinical content — they return the mandatory disclaimer + a not_stored hint.
func notStoredEnvelope() *AiEnvelope {
	return &AiEnvelope{
		Status:       AiStatusIdle,
		Model:        AiModelLabel,
		Disclaimer:   AiDisclaimer,
		ErrorMessage: "Not stored. AI assistance is advisory and is not persisted — (re)generate via the corresponding POST endpoint.",
	}
}

func (s *Service) GetStoredNoteSummary(ctx context.Context, userID, appointmentID string) (*AiEnvelope, error) {
	return notStoredEnvelope(), nil
}

func (s *Service) GetStoredRxSafety(ctx context.Context, userID, id string) (*AiEnvelope, error) {
	return notStoredEnvelope(), nil
}

func (s *Service) GetStoredLabExplanation(ctx context.Context, userID, resultID string) (*AiEnvelope, error) {
	return notStoredEnvelope(), nil
}

// ══ HMO ELIGIBILITY ═════════════════════════════════════════════════════════

// GetHMOEligibility resolves coverage for the appointment's patient. When the
// appointment, its patient, or the coverage row is missing it returns a 200 projection
// with eligible=false rather than failing.
func (s *Service) GetHMOEligibility(ctx context.Context, userID, appointmentID string) (*HMOEligibilityProjection, error) {
	appt, err := s.repo.GetAppointment(ctx, userID, appointmentID)
	if errors.Is(err, ErrNotFound) {
		return &HMOEligibilityProjection{AppointmentID: appointmentID, Eligible: false, Reason: "appointment not found"}, nil
	}
	if err != nil {
		return nil, err
	}
	if appt.PatientID == nil || *appt.PatientID == "" {
		return &HMOEligibilityProjection{AppointmentID: appointmentID, Eligible: false, Reason: "no patient on appointment"}, nil
	}
	cov, err := s.repo.GetHMOCoverageForPatient(ctx, userID, *appt.PatientID)
	if errors.Is(err, ErrNotFound) {
		return &HMOEligibilityProjection{AppointmentID: appointmentID, Eligible: false, Reason: "no coverage on file"}, nil
	}
	if err != nil {
		return nil, err
	}
	return &HMOEligibilityProjection{
		AppointmentID: appointmentID,
		Eligible:      true,
		Provider:      cov.Provider,
		PlanName:      cov.PlanName,
		CopayKobo:     cov.CopayKobo,
	}, nil
}
