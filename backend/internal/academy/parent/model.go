// Package parent is the Spotlight Academy Phase-2 parent (guardian) layer:
// child dashboards, parental controls, progress reports, and purchase approvals,
// plus admin CRUD for notification templates.
//
// GOLDEN RULE — child safety (docs/prd/edtech nfr.md child-safety):
//
//	A guardian may ONLY act on minors they hold an ACTIVE academy_guardian_links
//	to. Every parent endpoint verifies the link before touching any minor data,
//	and FAILS CLOSED (no active link → denied + audited). The link check is
//	centralised in the repository (GetActiveGuardianLink) and the pure decision
//	helper canActOnMinor; the service calls it on EVERY (guardian, minor) op.
//
// Tables owned/managed: academy_parent_controls, academy_progress_reports,
// academy_purchase_approvals, academy_notification_templates. Reads (guarded by
// the link) from academy_guardian_links, academy_subjects, academy_mastery_records,
// academy_progress_events, academy_attempts, academy_orders.
package parent

import "time"

// ── Child / dashboard models ─────────────────────────────────────────────────────

// Child is a minor a guardian is actively linked to.
type Child struct {
	MinorUserID string    `json:"minor_user_id"`
	LinkID      string    `json:"link_id"`
	Status      string    `json:"status"`
	LinkedAt    time.Time `json:"linked_at"`
}

// SubjectMastery aggregates a minor's mastery for one subject.
type SubjectMastery struct {
	SubjectID    string  `json:"subject_id"`
	SubjectCode  string  `json:"subject_code"`
	SubjectName  string  `json:"subject_name"`
	Objectives   int     `json:"objectives"`    // mastery records tracked
	Mastered     int     `json:"mastered"`      // mastered + exam_ready
	AvgScore     float64 `json:"avg_score"`     // 0..1 across tracked objectives
	MasteryRatio float64 `json:"mastery_ratio"` // mastered / objectives (0..1)
}

// ChildDashboard is the aggregated cross-subject view for one minor.
type ChildDashboard struct {
	MinorUserID    string           `json:"minor_user_id"`
	Subjects       []SubjectMastery `json:"subjects"`
	RecentProgress []ProgressEvent  `json:"recent_progress"`
	ExamReadiness  *float64         `json:"exam_readiness,omitempty"` // latest attempt readiness
	GeneratedAt    time.Time        `json:"generated_at"`
}

// ProgressEvent mirrors an academy_progress_events row (read-only here).
type ProgressEvent struct {
	ID          string         `json:"id"`
	Type        string         `json:"type"`
	ObjectiveID *string        `json:"objective_id,omitempty"`
	Payload     map[string]any `json:"payload"`
	CreatedAt   time.Time      `json:"created_at"`
}

// MasteryRow is one academy_mastery_records row joined to its subject.
type MasteryRow struct {
	ObjectiveID string  `json:"objective_id"`
	SubjectID   string  `json:"subject_id"`
	SubjectCode string  `json:"subject_code"`
	SubjectName string  `json:"subject_name"`
	State       string  `json:"state"`
	Score       float64 `json:"score"`
}

// ── Parent controls ──────────────────────────────────────────────────────────────

// ParentControls mirrors one academy_parent_controls row.
type ParentControls struct {
	ID                string         `json:"id"`
	GuardianUserID    string         `json:"guardian_user_id"`
	MinorUserID       string         `json:"minor_user_id"`
	ScreenTimeMinutes int            `json:"screen_time_minutes"` // 0 = unlimited
	AllowedHours      map[string]any `json:"allowed_hours"`
	ContentMaxAge     *int           `json:"content_max_age,omitempty"`
	UpdatedAt         time.Time      `json:"updated_at"`
}

// UpsertControlsRequest — guardian PUT /parent/children/:minorId/controls.
type UpsertControlsRequest struct {
	ScreenTimeMinutes int            `json:"screen_time_minutes"`
	AllowedHours      map[string]any `json:"allowed_hours"`
	ContentMaxAge     *int           `json:"content_max_age,omitempty"`
}

// ── Progress reports ─────────────────────────────────────────────────────────────

// ProgressReport mirrors one academy_progress_reports row.
type ProgressReport struct {
	ID          string         `json:"id"`
	MinorUserID string         `json:"minor_user_id"`
	Period      string         `json:"period"`
	Payload     map[string]any `json:"payload"`
	GeneratedAt time.Time      `json:"generated_at"`
}

// GenerateReportRequest — guardian POST /parent/reports/generate.
type GenerateReportRequest struct {
	MinorUserID string `json:"minor_user_id" binding:"required"`
	Period      string `json:"period" binding:"required"` // weekly | termly | YYYY-Www
}

// ── Purchase approvals ───────────────────────────────────────────────────────────

// ApprovalState mirrors academy_purchase_approvals.state CHECK.
type ApprovalState string

const (
	ApprovalPending  ApprovalState = "pending"
	ApprovalApproved ApprovalState = "approved"
	ApprovalRejected ApprovalState = "rejected"
)

// PurchaseApproval mirrors one academy_purchase_approvals row (joined to its order).
type PurchaseApproval struct {
	ID             string        `json:"id"`
	OrderID        string        `json:"order_id"`
	GuardianUserID string        `json:"guardian_user_id"`
	MinorUserID    string        `json:"minor_user_id"`
	State          ApprovalState `json:"state"`
	OrderKind      *string       `json:"order_kind,omitempty"`
	OrderAmount    *int64        `json:"order_amount_minor,omitempty"`
	OrderState     *string       `json:"order_state,omitempty"`
	DecidedAt      *time.Time    `json:"decided_at,omitempty"`
	CreatedAt      time.Time     `json:"created_at"`
}

// DecideApprovalRequest — guardian POST /parent/approvals/:id/decide.
type DecideApprovalRequest struct {
	Decision string `json:"decision" binding:"required"` // approve | reject
}

// ── Notification templates (admin) ───────────────────────────────────────────────

// NotificationTemplate mirrors one academy_notification_templates row.
type NotificationTemplate struct {
	ID      string  `json:"id"`
	Key     string  `json:"key"`
	Channel string  `json:"channel"` // push | sms | in_app | email
	Title   *string `json:"title,omitempty"`
	Body    string  `json:"body"`
	Status  string  `json:"status"`
}

// UpsertTemplateRequest — admin POST/PUT /notification-templates.
type UpsertTemplateRequest struct {
	Key     string  `json:"key" binding:"required"`
	Channel string  `json:"channel" binding:"required"`
	Title   *string `json:"title,omitempty"`
	Body    string  `json:"body" binding:"required"`
	Status  string  `json:"status,omitempty"`
}
