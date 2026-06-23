package doctor

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"strconv"
	"time"

	"spotlight/backend/internal/integrations/rtc"
	platformWS "spotlight/backend/internal/platform/ws"
)

// callTokenTTL is how long an issued RTC join token is valid. Tokens are
// short-lived; clients refresh via POST /calls/:appointmentId/token.
const callTokenTTL = time.Hour

// deterministicAgoraUID derives a stable, positive 32-bit uid from the doctor's
// user id. Agora RTC uids are uint32; we hash the (opaque, UUID-string) user id
// with SHA-256 and take the low 31 bits (>0, fits int32) so the same doctor always
// joins with the same uid across reconnects/refreshes. The stringified form is
// what AccessToken2 binds the token to.
func deterministicAgoraUID(userID string) string {
	sum := sha256.Sum256([]byte(userID))
	u := binary.BigEndian.Uint32(sum[:4]) & 0x7fffffff // 31 bits → non-zero, int32-safe
	if u == 0 {
		u = 1
	}
	return strconv.FormatUint(uint64(u), 10)
}

// issueCallToken mints a provider RTC token for the doctor scoped to the
// appointment (channel = appointmentId). When the Issuer is nil or the provider
// is not configured it returns an EMPTY token (never a fabricated one) plus
// rtcConfigured=false so the caller can flag "not configured" to the client.
// Secrets (App Certificate / VideoSDK secret) never leave the Issuer.
func (s *Service) issueCallToken(provider, appointmentID, userID string) (token, uid string, expiresAt *time.Time, rtcConfigured bool) {
	uid = deterministicAgoraUID(userID)
	if s.rtc == nil || !s.rtc.Enabled(provider) {
		return "", uid, nil, false
	}
	tok, exp, err := s.rtc.Token(provider, appointmentID, uid, callTokenTTL)
	if err != nil || tok == "" {
		return "", uid, nil, false
	}
	return tok, uid, &exp, true
}

// pushDoctor best-effort sends a WS event to the doctor's connected devices.
// A nil Hub or a send failure must never affect the HTTP write (fire-and-forget).
func (s *Service) pushDoctor(userID, eventType string, payload any) {
	if s.hub == nil {
		return
	}
	s.hub.SendToUser(userID, platformWS.Message{Type: eventType, Payload: payload})
}

// mergeCallDetail folds the RTC binding (provider/uid/expiry/configured) into the
// caller-supplied detail body so the persisted row records what was issued. The
// SIGNED TOKEN itself is intentionally NOT stored (short-lived; re-minted on demand).
func mergeCallDetail(raw json.RawMessage, provider, uid string, expiresAt *time.Time, configured bool) json.RawMessage {
	m := map[string]any{}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &m)
	}
	rtcMeta := map[string]any{
		"provider":      provider,
		"uid":           uid,
		"rtcConfigured": configured,
	}
	if expiresAt != nil {
		rtcMeta["tokenExpiresAt"] = expiresAt.UTC().Format(time.RFC3339)
	}
	m["rtc"] = rtcMeta
	b, err := json.Marshal(m)
	if err != nil {
		return raw
	}
	return b
}

// annotateCallToken stamps the freshly-minted token + its binding onto the response
// session (transient fields only — they are not columns on doctor_call_sessions).
func annotateCallToken(sess *CallSession, token, provider string, expiresAt *time.Time, configured bool) {
	if sess == nil {
		return
	}
	uid := deterministicAgoraUID(sess.UserID)
	if token != "" {
		t := token
		sess.RoomToken = &t
	} else {
		sess.RoomToken = nil
	}
	pv := provider
	sess.Provider = &pv
	sess.TokenUID = &uid
	sess.TokenExpiresAt = expiresAt
	sess.RTCConfigured = configured
}

// service_ops.go — Wave 4 (operational) business logic.
//
// Mirrors the Wave 2/3 service style: reads delegate to the repository scoped to the
// authenticated doctor; mutations that target a table with a UNIQUE idempotency_key
// (doctor_chat_messages, doctor_hmo_claims), or that transition / upsert an existing
// row, require the Idempotency-Key header (ErrIdempotencyRequired) and rely on the
// repository's ON CONFLICT replay / status-guarded UPDATE for replay safety.
//
// NONE of these touch the money ledger — they are CRUD / state transitions / aggregation.
// Monetary fields stay int64 kobo (no floats, no stored balances). The free-form
// `Generic` request bodies are parsed via the shared parseClinicalPatch helper
// (service_clinical.go) so the few typed knobs (status verbs, slot, amounts, timezone)
// are pulled out without redefining anything.
//
// opsPatch carries the Wave-4-specific knobs not already in clinicalPatch. We keep it
// separate to avoid touching the shared clinicalPatch struct.
type opsPatch struct {
	Date          *string         `json:"date,omitempty"`
	BlockedDate   *string         `json:"blockedDate,omitempty"`
	Reason        *string         `json:"reason,omitempty"`
	AllDay        *bool           `json:"allDay,omitempty"`
	StartDate     *string         `json:"startDate,omitempty"`
	EndDate       *string         `json:"endDate,omitempty"`
	StartTime     *string         `json:"startTime,omitempty"`
	EndTime       *string         `json:"endTime,omitempty"`
	Note          *string         `json:"note,omitempty"`
	Active        *bool           `json:"active,omitempty"`
	Enabled       *bool           `json:"enabled,omitempty"`
	ReminderType  *string         `json:"reminderType,omitempty"`
	Settings      json.RawMessage `json:"settings,omitempty"`
	Rule          json.RawMessage `json:"rule,omitempty"`
	Timezone      *string         `json:"timezone,omitempty"`
	Mode          *string         `json:"mode,omitempty"`
	Provider      *string         `json:"provider,omitempty"`
	Status        *string         `json:"status,omitempty"`
	ClinicID      *string         `json:"clinicId,omitempty"`
	ActiveClinic  *string         `json:"activeClinicId,omitempty"`
	Schedule      json.RawMessage `json:"schedule,omitempty"`
	Ref           *string         `json:"ref,omitempty"`
	PatientID     *string         `json:"patientId,omitempty"`
	AppointmentID *string         `json:"appointmentId,omitempty"`
	RequestedSlot *string         `json:"requestedSlot,omitempty"`
	ProposedSlot  *string         `json:"proposedSlot,omitempty"`
	AmountKobo    int64           `json:"amountKobo,omitempty"`
}

func parseOpsPatch(raw json.RawMessage) opsPatch {
	var p opsPatch
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &p)
	}
	return p
}

// parseOpsDate parses an ISO date (YYYY-MM-DD or full RFC3339) from a *string, returning
// the zero time when absent/unparseable (the DB column is `date`, so a zero time maps to
// a NULL-ish epoch — callers pass a required field, validated by the binding upstream).
func parseOpsDate(p *string) time.Time {
	if p == nil || *p == "" {
		return time.Time{}
	}
	if t, err := time.Parse("2006-01-02", *p); err == nil {
		return t
	}
	if t, err := time.Parse(time.RFC3339, *p); err == nil {
		return t
	}
	return time.Time{}
}

// ══ CHAT ════════════════════════════════════════════════════════════════════
// NOTE: realtime WS push to the patient is OUT OF SCOPE for this wave — only REST
// persistence is implemented. TODO(integration): wire a websocket/presence channel.

func (s *Service) ListChatThreads(ctx context.Context, userID string) ([]ChatThread, error) {
	return s.repo.ListChatThreads(ctx, userID)
}

func (s *Service) ListChatMessages(ctx context.Context, userID, threadID string) ([]ChatMessage, error) {
	return s.repo.ListChatMessages(ctx, userID, threadID)
}

func (s *Service) SendChatMessage(ctx context.Context, userID, threadID, idemKey string, req SendChatMessageRequest) (*ChatMessage, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	msg, err := s.repo.InsertChatMessage(ctx, userID, threadID, req, idemKey)
	if err != nil {
		return nil, err
	}
	// Wave 6: best-effort realtime push to the doctor's connected devices.
	// REST persistence already succeeded; WS failure must not fail this write.
	s.pushDoctor(userID, "chat.message", msg)
	return msg, nil
}

// ══ CALL SESSIONS ═══════════════════════════════════════════════════════════

func (s *Service) GetCallSession(ctx context.Context, userID, appointmentID string) (*CallSession, error) {
	return s.repo.GetCallSessionForAppointment(ctx, userID, appointmentID)
}

// StartCallSession creates (or replays) a live session for an appointment and
// issues a real RTC join token (channel = appointmentId, uid = deterministic per
// doctor). When the provider is not configured the persisted room_token is empty
// and the session is annotated rtcConfigured=false (NEVER a fabricated token).
// The token itself is short-lived and returned fresh (not the source of truth);
// only provider/uid/expiry are persisted to the row's detail.
func (s *Service) StartCallSession(ctx context.Context, userID, appointmentID, idemKey string, raw json.RawMessage) (*CallSession, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	p := parseOpsPatch(raw)
	mode := strOrDefault(p.Mode, "video")
	provider := strOrDefault(p.Provider, rtc.ProviderAgora)

	token, uid, expiresAt, configured := s.issueCallToken(provider, appointmentID, userID)

	// Persist provider/uid/expiry into detail so a refresh/get can reconstruct the
	// channel binding; the short-lived token is returned fresh rather than stored.
	detail := mergeCallDetail(raw, provider, uid, expiresAt, configured)

	sess, err := s.repo.StartCallSession(ctx, userID, appointmentID, mode, provider, token, detail)
	if err != nil {
		return nil, err
	}
	annotateCallToken(sess, token, provider, expiresAt, configured)

	// Wave 6: best-effort realtime push — signal the doctor's devices the call is up.
	s.pushDoctor(userID, "call.ringing", sess)
	return sess, nil
}

// IssueCallToken mints a fresh RTC token for the authed doctor scoped to the
// appointment. No idempotency (tokens are time-bound). Auth + ownership are
// enforced by resolving the existing call session for (doctor, appointment).
func (s *Service) IssueCallToken(ctx context.Context, userID, appointmentID string) (*CallSession, error) {
	sess, err := s.repo.GetCallSessionForAppointment(ctx, userID, appointmentID)
	if err != nil {
		return nil, err
	}
	provider := strOrDefault(sess.Provider, rtc.ProviderAgora)
	token, _, expiresAt, configured := s.issueCallToken(provider, appointmentID, userID)
	annotateCallToken(sess, token, provider, expiresAt, configured)
	return sess, nil
}

// EndCallSession ends the live session for an appointment (resolves it first so callers
// only need the appointment id). status defaults to 'ended'; 'failed' is also accepted.
func (s *Service) EndCallSession(ctx context.Context, userID, appointmentID, idemKey string, raw json.RawMessage) (*CallSession, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	sess, err := s.repo.GetCallSessionForAppointment(ctx, userID, appointmentID)
	if err != nil {
		return nil, err
	}
	p := parseOpsPatch(raw)
	status := "ended"
	if derefStr(p.Status) == "failed" {
		status = "failed"
	}
	return s.repo.EndCallSession(ctx, userID, sess.ID, status, raw)
}

// ══ SCHEDULE MANAGEMENT (Section E) ═════════════════════════════════════════

func (s *Service) ListBlockedDates(ctx context.Context, userID string) ([]BlockedDate, error) {
	return s.repo.ListBlockedDates(ctx, userID)
}

func (s *Service) CreateBlockedDate(ctx context.Context, userID, idemKey string, raw json.RawMessage) (*BlockedDate, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	p := parseOpsPatch(raw)
	date := parseOpsDate(p.Date)
	if date.IsZero() {
		date = parseOpsDate(p.BlockedDate)
	}
	allDay := true
	if p.AllDay != nil {
		allDay = *p.AllDay
	}
	return s.repo.InsertBlockedDate(ctx, userID, date, p.Reason, allDay, p.StartTime, p.EndTime)
}

func (s *Service) GetVacation(ctx context.Context, userID string) (*Vacation, error) {
	return s.repo.GetVacation(ctx, userID)
}

func (s *Service) SetVacation(ctx context.Context, userID, idemKey string, raw json.RawMessage) (*Vacation, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	p := parseOpsPatch(raw)
	active := true
	if p.Active != nil {
		active = *p.Active
	}
	return s.repo.SetVacation(ctx, userID, parseOpsDate(p.StartDate), parseOpsDate(p.EndDate), p.Note, active)
}

func (s *Service) ListRecurringRules(ctx context.Context, userID string) ([]RecurringRule, error) {
	return s.repo.ListRecurringRules(ctx, userID)
}

func (s *Service) SaveRecurringRule(ctx context.Context, userID, idemKey string, raw json.RawMessage) (*RecurringRule, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	p := parseOpsPatch(raw)
	rule := p.Rule
	if len(rule) == 0 {
		// If the caller posted the rule body at the top level, store the whole patch.
		rule = raw
	}
	return s.repo.SaveRecurringRule(ctx, userID, rule)
}

func (s *Service) ListReminders(ctx context.Context, userID string) ([]Reminder, error) {
	return s.repo.ListReminders(ctx, userID)
}

func (s *Service) SaveReminderSettings(ctx context.Context, userID, idemKey string, raw json.RawMessage) (*Reminder, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	p := parseOpsPatch(raw)
	settings := p.Settings
	if len(settings) == 0 {
		settings = raw
	}
	enabled := true
	if p.Enabled != nil {
		enabled = *p.Enabled
	}
	return s.repo.SaveReminder(ctx, userID, strOrDefault(p.ReminderType, "appointment"), settings, enabled)
}

func (s *Service) SetTimezone(ctx context.Context, userID, idemKey string, raw json.RawMessage) (*Profile, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	p := parseOpsPatch(raw)
	tz := strOrDefault(p.Timezone, "Africa/Lagos")
	return s.repo.SetTimezone(ctx, userID, tz)
}

// ══ APPOINTMENT QUEUE (Section F) ═══════════════════════════════════════════

func (s *Service) ListConsultQueue(ctx context.Context, userID string) ([]ConsultQueueEntry, error) {
	return s.repo.ListConsultQueue(ctx, userID)
}

func (s *Service) ListAppointmentRequests(ctx context.Context, userID string) ([]AppointmentRequest, error) {
	return s.repo.ListAppointmentRequests(ctx, userID)
}

func (s *Service) GetAppointmentRequest(ctx context.Context, userID, id string) (*AppointmentRequest, error) {
	return s.repo.GetAppointmentRequest(ctx, userID, id)
}

// AcceptAppointment confirms the appointment (and mirrors the request → accepted).
func (s *Service) AcceptAppointment(ctx context.Context, userID, appointmentID, idemKey string, raw json.RawMessage) (*Appointment, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.TransitionAppointment(ctx, userID, appointmentID, "confirmed", nil, raw)
}

// RejectAppointment cancels the appointment (and mirrors the request → rejected).
func (s *Service) RejectAppointment(ctx context.Context, userID, appointmentID, idemKey string, raw json.RawMessage) (*Appointment, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.TransitionAppointment(ctx, userID, appointmentID, "cancelled", nil, raw)
}

// RescheduleAppointment moves the appointment back to upcoming and records the proposed
// slot on the request row. Covers both /request-reschedule and /reschedule (same effect:
// the slot is captured in the request; the patient confirms out-of-band).
func (s *Service) RescheduleAppointment(ctx context.Context, userID, appointmentID, idemKey string, raw json.RawMessage) (*Appointment, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	p := parseOpsPatch(raw)
	slot := p.RequestedSlot
	if slot == nil {
		slot = p.ProposedSlot
	}
	return s.repo.TransitionAppointment(ctx, userID, appointmentID, "upcoming", slot, raw)
}

// ══ HMO CLAIMS (submit / dispute) ═══════════════════════════════════════════
// GET list/get already shipped in Wave 3a (ListHMOClaims / GetHMOClaim). Wave 4 adds
// the missing submit + dispute mutations.

func (s *Service) SubmitHMOClaim(ctx context.Context, userID, idemKey string, raw json.RawMessage) (*HMOClaim, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	p := parseOpsPatch(raw)
	// amountKobo is reporting-only metadata — NO ledger posting (claims settle via the HMO).
	return s.repo.InsertHMOClaim(ctx, userID, p.Ref, p.PatientID, p.AppointmentID, p.AmountKobo, raw, idemKey)
}

func (s *Service) DisputeHMOClaim(ctx context.Context, userID, claimID, idemKey string, raw json.RawMessage) (*HMOClaim, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.DisputeHMOClaim(ctx, userID, claimID, raw)
}

// ══ MULTI-CLINIC PORTFOLIO ══════════════════════════════════════════════════
// Quality analytics / ranking / improvement recs already shipped in Wave 2
// (GetQualityScore / GetRanking / GetImprovements) — NOT duplicated here.

func (s *Service) GetClinicPortfolio(ctx context.Context, userID string) (*ClinicPortfolio, error) {
	return s.repo.GetClinicPortfolio(ctx, userID)
}

func (s *Service) SetActiveClinic(ctx context.Context, userID, idemKey string, raw json.RawMessage) (*ClinicPortfolio, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	p := parseOpsPatch(raw)
	clinicID := strOrDefault(p.ClinicID, derefStr(p.ActiveClinic))
	if clinicID == "" {
		// Missing required field → map to the package's generic 400 sentinel
		// (the handler's fail() renders ErrInvalidAmount as HTTP 400). Avoids a raw
		// 500 from the active_clinic_id ::uuid cast on an empty string.
		return nil, ErrInvalidAmount
	}
	return s.repo.SetActiveClinic(ctx, userID, clinicID)
}

func (s *Service) UpdateClinicSchedule(ctx context.Context, userID, clinicID, idemKey string, raw json.RawMessage) (*ClinicPortfolio, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	p := parseOpsPatch(raw)
	sched := p.Schedule
	if len(sched) == 0 {
		sched = raw
	}
	return s.repo.UpdateClinicSchedule(ctx, userID, clinicID, sched)
}
