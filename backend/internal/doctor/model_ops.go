package doctor

import (
	"encoding/json"
	"time"
)

// model_ops.go — Wave 4 (operational CRUD / aggregation) request & response shapes.
//
// Covers the remaining endpoint groups: realtime persistence (chat threads/messages,
// call sessions), schedule management (blocked dates, vacations, recurring rules,
// reminders, timezone), the appointment queue (consult queue, appointment requests,
// accept/reject/reschedule transitions), HMO claim submission/dispute, and the
// multi-clinic portfolio.
//
// As with the other waves, the OpenAPI types most of these as the free-form `Generic`
// schema, so request bodies are captured as json.RawMessage and merged/stored into the
// doctor_* JSONB columns; the typed ones (ChatThread/ChatMessage/CallSession) follow
// contracts/doctor.openapi.yaml exactly. Responses mirror the backing tables in
// camelCase to match the mobile contracts (doctor.ts / doctor.batch1.ts / doctor.phase3.ts).
//
// NONE of these are money movements — they are CRUD / state transitions / aggregation.
// Monetary columns surface as int64 kobo only (no floats, no stored balances).

// ── Chat (doctor_chat_threads / doctor_chat_messages) ────────────────────────

// ChatThread mirrors public.doctor_chat_threads (OpenAPI schema ChatThread).
type ChatThread struct {
	ID            string          `json:"id"`
	UserID        string          `json:"userId"`
	AppointmentID *string         `json:"appointmentId,omitempty"`
	Patient       json.RawMessage `json:"patient,omitempty"`
	ConsultType   *string         `json:"consultType,omitempty"`
	Status        string          `json:"status"`
	LastMessage   *string         `json:"lastMessage,omitempty"`
	LastMessageAt *time.Time      `json:"lastMessageAt,omitempty"`
	UnreadCount   int             `json:"unreadCount"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
}

// ChatMessage mirrors public.doctor_chat_messages (OpenAPI schema ChatMessage).
type ChatMessage struct {
	ID             string    `json:"id"`
	ThreadID       string    `json:"threadId"`
	UserID         string    `json:"userId"`
	Author         string    `json:"author"` // doctor|patient
	Body           *string   `json:"body,omitempty"`
	MessageKind    string    `json:"messageKind"`
	AttachmentURL  *string   `json:"attachmentUrl,omitempty"`
	AttachmentName *string   `json:"attachmentName,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
}

// SendChatMessageRequest mirrors the OpenAPI SendChatMessageRequest body.
type SendChatMessageRequest struct {
	Body           string  `json:"body"`
	AttachmentURL  *string `json:"attachmentUrl,omitempty"`
	AttachmentName *string `json:"attachmentName,omitempty"`
}

// ── Call sessions (doctor_call_sessions) ─────────────────────────────────────

// CallSession mirrors public.doctor_call_sessions (OpenAPI schema CallSession).
// RoomToken is the provider (Agora/VideoSDK) join token — issuance is an
// integration TODO, so it is persisted as the stored placeholder for now.
type CallSession struct {
	ID            string          `json:"id"`
	UserID        string          `json:"userId"`
	AppointmentID *string         `json:"appointmentId,omitempty"`
	Patient       json.RawMessage `json:"patient,omitempty"`
	Mode          string          `json:"mode"`   // audio|video
	Status        string          `json:"status"` // connecting|ringing|live|ended|failed
	Provider      *string         `json:"provider,omitempty"`
	RoomToken     *string         `json:"roomToken,omitempty"`
	StartedAt     *time.Time      `json:"startedAt,omitempty"`
	EndedAt       *time.Time      `json:"endedAt,omitempty"`
	DurationSecs  int             `json:"durationSecs"`
	Detail        json.RawMessage `json:"detail,omitempty"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`

	// ── Wave 6: RTC join binding (transient, not persisted on the row) ──────────
	// These are populated on the RESPONSE from the freshly-minted token. RoomToken
	// (above) carries the short-lived signed token. TokenUID is the deterministic
	// uid the token is bound to; TokenExpiresAt is when it lapses. RTCConfigured is
	// false when the provider has no server-side creds — in that case RoomToken is
	// empty and the client must NOT attempt to join (no fabricated token is ever sent).
	TokenUID       *string    `json:"tokenUid,omitempty"`
	TokenExpiresAt *time.Time `json:"tokenExpiresAt,omitempty"`
	RTCConfigured  bool       `json:"rtcConfigured"`
}

// ── Schedule management (Section E) ──────────────────────────────────────────

// BlockedDate mirrors public.doctor_blocked_dates (mobile BlockedDate).
type BlockedDate struct {
	ID          string    `json:"id"`
	UserID      string    `json:"userId"`
	BlockedDate time.Time `json:"date"`
	Reason      *string   `json:"reason,omitempty"`
	AllDay      bool      `json:"allDay"`
	StartTime   *string   `json:"startTime,omitempty"`
	EndTime     *string   `json:"endTime,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
}

// Vacation mirrors public.doctor_vacations (mobile VacationPeriod).
type Vacation struct {
	ID        string     `json:"id"`
	UserID    string     `json:"userId"`
	StartDate time.Time  `json:"startDate"`
	EndDate   time.Time  `json:"endDate"`
	Note      *string    `json:"note,omitempty"`
	Active    bool       `json:"active"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt *time.Time `json:"updatedAt,omitempty"`
}

// RecurringRule mirrors public.doctor_recurring_rules (mobile RecurringRule).
type RecurringRule struct {
	ID        string          `json:"id"`
	UserID    string          `json:"userId"`
	Rule      json.RawMessage `json:"rule,omitempty"`
	Active    bool            `json:"active"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

// Reminder mirrors public.doctor_reminders (mobile ReminderSettings projection).
type Reminder struct {
	ID           string          `json:"id"`
	UserID       string          `json:"userId"`
	ReminderType string          `json:"reminderType"`
	Settings     json.RawMessage `json:"settings,omitempty"`
	Enabled      bool            `json:"enabled"`
	CreatedAt    time.Time       `json:"createdAt"`
	UpdatedAt    time.Time       `json:"updatedAt"`
}

// ── Appointment queue (Section F) ────────────────────────────────────────────

// ConsultQueueEntry mirrors public.doctor_consult_queue.
type ConsultQueueEntry struct {
	ID            string          `json:"id"`
	UserID        string          `json:"userId"`
	AppointmentID *string         `json:"appointmentId,omitempty"`
	Position      int             `json:"position"`
	Status        string          `json:"status"`
	Detail        json.RawMessage `json:"detail,omitempty"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
}

// AppointmentRequest mirrors public.doctor_appointment_requests (mobile AppointmentRequest).
type AppointmentRequest struct {
	ID            string          `json:"id"`
	UserID        string          `json:"userId"`
	AppointmentID *string         `json:"appointmentId,omitempty"`
	Patient       json.RawMessage `json:"patient,omitempty"`
	ConsultType   *string         `json:"consultType,omitempty"`
	Status        string          `json:"status"`
	RequestedSlot *string         `json:"requestedSlot,omitempty"`
	Detail        json.RawMessage `json:"detail,omitempty"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
}

// ── Multi-clinic portfolio (doctor_profiles.profile_draft + active_clinic_id) ─

// ClinicPortfolio mirrors mobile ClinicPortfolio. There is no dedicated clinics
// table in the migration — memberships live in doctor_profiles.profile_draft
// (the profile-builder JSONB) and the selected clinic is active_clinic_id.
type ClinicPortfolio struct {
	ActiveClinicID *string         `json:"activeClinicId,omitempty"`
	Memberships    json.RawMessage `json:"memberships"`
}
