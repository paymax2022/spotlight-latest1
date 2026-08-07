package doctor

import (
	"encoding/json"
	"time"
)

// model_account.go — Wave 2 (account / provider / admin) request & response shapes.
//
// The OpenAPI (contracts/doctor.openapi.yaml) types most of these endpoints as the
// free-form `Generic` schema (additionalProperties: true), so request bodies are
// captured as json.RawMessage and merged/stored into the doctor_* JSONB columns,
// while responses mirror the per-batch mobile contracts (camelCase JSON).

// ── Onboarding ───────────────────────────────────────────────────────────────

// LegalConsent mirrors public.doctor_legal_consents.
type LegalConsent struct {
	ID          string     `json:"id"`
	UserID      string     `json:"userId"`
	ConsentKind string     `json:"consentKind"`
	Version     string     `json:"version"`
	Accepted    bool       `json:"accepted"`
	AcceptedAt  *time.Time `json:"acceptedAt,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
}

// AcceptConsentRequest is the body for POST /onboarding/consents.
type AcceptConsentRequest struct {
	ConsentKind string `json:"consentKind" binding:"required"`
	Version     string `json:"version,omitempty"`
	Accepted    *bool  `json:"accepted,omitempty"`
}

// AppPermission mirrors public.doctor_app_permissions.
type AppPermission struct {
	ID             string     `json:"id"`
	UserID         string     `json:"userId"`
	PermissionKind string     `json:"permissionKind"`
	State          string     `json:"state"`
	DecidedAt      *time.Time `json:"decidedAt,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}

// RecordPermissionRequest is the body for POST /onboarding/permissions.
type RecordPermissionRequest struct {
	PermissionKind string `json:"permissionKind" binding:"required"`
	State          string `json:"state" binding:"required"` // granted|denied|undetermined
}

// MerchantUpgrade mirrors public.doctor_merchant_upgrades.
type MerchantUpgrade struct {
	ID          string          `json:"id"`
	UserID      string          `json:"userId"`
	State       string          `json:"state"`
	RequestedAt *time.Time      `json:"requestedAt,omitempty"`
	CompletedAt *time.Time      `json:"completedAt,omitempty"`
	Detail      json.RawMessage `json:"detail,omitempty"`
	CreatedAt   time.Time       `json:"createdAt"`
	UpdatedAt   time.Time       `json:"updatedAt"`
}

// SetProviderTypeRequest is the body for POST /onboarding/provider-type.
type SetProviderTypeRequest struct {
	ProviderType string `json:"providerType" binding:"required"` // doctor|specialist|veterinarian
}

// VerificationDocument mirrors public.doctor_verification_documents.
type VerificationDocument struct {
	ID             string    `json:"id"`
	VerificationID *string   `json:"verificationId,omitempty"`
	UserID         string    `json:"userId"`
	DocType        string    `json:"docType"`
	Label          *string   `json:"label,omitempty"`
	FileName       *string   `json:"fileName,omitempty"`
	FileURL        *string   `json:"fileUrl,omitempty"`
	MimeType       *string   `json:"mimeType,omitempty"`
	SizeBytes      *int64    `json:"sizeBytes,omitempty"`
	Required       bool      `json:"required"`
	UploadedAt     time.Time `json:"uploadedAt"`
	CreatedAt      time.Time `json:"createdAt"`
}

// AuditEntry mirrors public.doctor_compliance_audit (read projection).
type AuditEntry struct {
	ID         string          `json:"id"`
	UserID     string          `json:"userId"`
	Action     string          `json:"action"`
	EntityType *string         `json:"entityType,omitempty"`
	EntityID   *string         `json:"entityId,omitempty"`
	Detail     json.RawMessage `json:"detail,omitempty"`
	CreatedAt  time.Time       `json:"createdAt"`
}

// ── Notifications (batch6) ───────────────────────────────────────────────────

// NotificationGroup is a derived group of notifications by group_key.
type NotificationGroup struct {
	GroupKey string         `json:"groupKey"`
	Count    int            `json:"count"`
	Unread   int            `json:"unread"`
	Items    []Notification `json:"items"`
}

// NotificationPreference mirrors public.doctor_notification_preferences.
type NotificationPreference struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	Channel   string    `json:"channel"`
	Category  string    `json:"category"`
	Enabled   bool      `json:"enabled"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// UpdateNotificationPreferenceRequest is the body for PUT /notifications/preferences.
type UpdateNotificationPreferenceRequest struct {
	Channel  string `json:"channel" binding:"required"`
	Category string `json:"category" binding:"required"`
	Enabled  *bool  `json:"enabled,omitempty"`
}

// ── Support (batch7) ─────────────────────────────────────────────────────────

// SupportTicket mirrors public.doctor_support_tickets.
type SupportTicket struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	Ref       *string   `json:"ref,omitempty"`
	Subject   *string   `json:"subject,omitempty"`
	Category  *string   `json:"category,omitempty"`
	Status    string    `json:"status"`
	LastReply *string   `json:"lastReply,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// CreateSupportTicketRequest matches the OpenAPI CreateSupportTicketRequest schema.
type CreateSupportTicketRequest struct {
	Subject  string `json:"subject" binding:"required"`
	Category string `json:"category" binding:"required"`
	Body     string `json:"body" binding:"required"`
}

// SupportDispute mirrors public.doctor_support_disputes.
type SupportDispute struct {
	ID        string          `json:"id"`
	UserID    string          `json:"userId"`
	Status    string          `json:"status"`
	Subject   *string         `json:"subject,omitempty"`
	Evidence  json.RawMessage `json:"evidence,omitempty"`
	Detail    json.RawMessage `json:"detail,omitempty"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

// CreateDisputeRequest is the body for POST /disputes.
type CreateDisputeRequest struct {
	Subject *string         `json:"subject,omitempty"`
	Detail  json.RawMessage `json:"detail,omitempty"`
}

// AddEvidenceRequest is the body for POST /disputes/:disputeId/evidence.
type AddEvidenceRequest struct {
	Evidence json.RawMessage `json:"evidence,omitempty"`
}

// SupportMessage mirrors public.doctor_support_messages.
type SupportMessage struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	ThreadID  string    `json:"threadId"`
	TicketID  *string   `json:"ticketId,omitempty"`
	Author    string    `json:"author"`
	Body      *string   `json:"body,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// SendSupportMessageRequest is the body for POST /support/:threadId/messages.
type SendSupportMessageRequest struct {
	Body   *string `json:"body,omitempty"`
	Author string  `json:"author,omitempty"`
}

// ── Compliance / training / safety (batch7) ──────────────────────────────────

// TrainingModule mirrors public.doctor_mandatory_training.
type TrainingModule struct {
	ID          string          `json:"id"`
	UserID      string          `json:"userId"`
	ModuleID    string          `json:"moduleId"`
	Title       *string         `json:"title,omitempty"`
	Status      string          `json:"status"`
	CompletedAt *time.Time      `json:"completedAt,omitempty"`
	Detail      json.RawMessage `json:"detail,omitempty"`
	CreatedAt   time.Time       `json:"createdAt"`
	UpdatedAt   time.Time       `json:"updatedAt"`
}

// SafetyIssue mirrors public.doctor_safety_issues.
type SafetyIssue struct {
	ID        string          `json:"id"`
	UserID    string          `json:"userId"`
	Severity  string          `json:"severity"`
	Status    string          `json:"status"`
	Subject   *string         `json:"subject,omitempty"`
	Detail    json.RawMessage `json:"detail,omitempty"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

// ReportSafetyIssueRequest is the body for POST /safety-issues.
type ReportSafetyIssueRequest struct {
	Severity string          `json:"severity,omitempty"`
	Subject  *string         `json:"subject,omitempty"`
	Detail   json.RawMessage `json:"detail,omitempty"`
}

// DataPrivacySettings mirrors public.doctor_data_privacy_settings.
type DataPrivacySettings struct {
	ID                  string          `json:"id"`
	UserID              string          `json:"userId"`
	Settings            json.RawMessage `json:"settings,omitempty"`
	ExportRequestedAt   *time.Time      `json:"exportRequestedAt,omitempty"`
	DeletionRequestedAt *time.Time      `json:"deletionRequestedAt,omitempty"`
	CreatedAt           time.Time       `json:"createdAt"`
	UpdatedAt           time.Time       `json:"updatedAt"`
}

// ── Security / devices / preferences (batch7) ────────────────────────────────

// Device mirrors public.doctor_devices.
type Device struct {
	ID          string          `json:"id"`
	UserID      string          `json:"userId"`
	DeviceLabel *string         `json:"deviceLabel,omitempty"`
	Platform    *string         `json:"platform,omitempty"`
	LastSeenAt  *time.Time      `json:"lastSeenAt,omitempty"`
	Revoked     bool            `json:"revoked"`
	RevokedAt   *time.Time      `json:"revokedAt,omitempty"`
	Detail      json.RawMessage `json:"detail,omitempty"`
	CreatedAt   time.Time       `json:"createdAt"`
}

// ── Reputation / reviews (phase2 + batch6) ───────────────────────────────────

// QualityScore mirrors public.doctor_quality_scores.
type QualityScore struct {
	ID              string          `json:"id"`
	UserID          string          `json:"userId"`
	Score           float64         `json:"score"`
	PeriodLabel     *string         `json:"periodLabel,omitempty"`
	Ranking         json.RawMessage `json:"ranking,omitempty"`
	Recommendations json.RawMessage `json:"recommendations,omitempty"`
	Detail          json.RawMessage `json:"detail,omitempty"`
	CreatedAt       time.Time       `json:"createdAt"`
	UpdatedAt       time.Time       `json:"updatedAt"`
}

// ConsultationFeedback mirrors public.doctor_consultation_feedback.
type ConsultationFeedback struct {
	ID            string          `json:"id"`
	UserID        string          `json:"userId"`
	AppointmentID *string         `json:"appointmentId,omitempty"`
	Rating        *int            `json:"rating,omitempty"`
	Comment       *string         `json:"comment,omitempty"`
	Detail        json.RawMessage `json:"detail,omitempty"`
	CreatedAt     time.Time       `json:"createdAt"`
}

// ReviewDispute mirrors public.doctor_review_disputes.
type ReviewDispute struct {
	ID        string          `json:"id"`
	UserID    string          `json:"userId"`
	ReviewID  *string         `json:"reviewId,omitempty"`
	Kind      string          `json:"kind"`
	Status    string          `json:"status"`
	Reason    *string         `json:"reason,omitempty"`
	Detail    json.RawMessage `json:"detail,omitempty"`
	CreatedAt time.Time       `json:"createdAt"`
}

// ReviewActionRequest is the body for POST /reviews/:reviewId/{report,dispute,removal-request}.
type ReviewActionRequest struct {
	Reason *string         `json:"reason,omitempty"`
	Detail json.RawMessage `json:"detail,omitempty"`
}
