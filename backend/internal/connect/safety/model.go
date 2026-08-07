// Package connectsafety holds the Phase 0 safety backbone for Paymax Connect:
// the immutable Connect audit log (public.connect_audit_log) and the case/incident
// scaffold (public.connect_cases) so every safety report can open a case that
// never fails silently. See docs/prd/dating/{compliance.md, PHASE-0-PLAN.md §P0-C}.
package connectsafety

import "time"

// Allowed enumerations — MUST match the CHECK constraints in
// supabase/migrations/20260627000100_connect_foundation.sql.
var (
	caseTypes = map[string]bool{
		"harassment": true, "scam": true, "impersonation": true, "underage": true,
		"inappropriate_media": true, "off_platform": true, "safety": true, "other": true,
	}
	caseStatuses = map[string]bool{
		"open": true, "investigating": true, "resolved": true, "closed": true,
	}
	caseResolutions = map[string]bool{
		"no_action": true, "warned": true, "restricted": true,
		"suspended": true, "banned": true, "escalated": true,
	}
	caseSeverities = map[string]bool{
		"low": true, "normal": true, "high": true, "critical": true,
	}
)

// ValidCaseType reports whether t is an allowed case type.
func ValidCaseType(t string) bool { return caseTypes[t] }

// ValidCaseStatus reports whether s is an allowed case status.
func ValidCaseStatus(s string) bool { return caseStatuses[s] }

// ValidCaseResolution reports whether r is an allowed resolution.
func ValidCaseResolution(r string) bool { return caseResolutions[r] }

// ValidCaseSeverity reports whether s is an allowed severity.
func ValidCaseSeverity(s string) bool { return caseSeverities[s] }

// SeverityForReport derives the INITIAL case severity from a member report's type
// so that child-safety and potential-CSAM categories AUTO-ESCALATE at intake
// (invariant 6: "critical reports (CSAM, threats) escalate"; TS-003 severity
// routing) instead of being filed as normal and waiting for manual triage. Admins
// can still lower/raise severity later via UpdateCase. Pure + deterministic so it
// is unit-tested without a DB; fail-safe default is "normal" for unknown types.
func SeverityForReport(caseType string) string {
	switch caseType {
	case "underage", "inappropriate_media":
		// Minor safety / potential CSAM: highest priority — hard-escalate to the
		// top of the moderation queue immediately.
		return "critical"
	case "safety":
		// Threats / violence / self-harm signals: elevated.
		return "high"
	default:
		return "normal"
	}
}

// Case mirrors a row of public.connect_cases. Nullable columns use *string so a
// SQL NULL scans cleanly (same pattern as events.Ticket.ScannedAt).
type Case struct {
	ID            string    `json:"id"`
	ReporterID    *string   `json:"reporter_id,omitempty"`
	SubjectID     *string   `json:"subject_id,omitempty"`
	Type          string    `json:"type"`
	SourceRef     *string   `json:"source_ref,omitempty"`
	Status        string    `json:"status"`
	Resolution    *string   `json:"resolution,omitempty"`
	Severity      string    `json:"severity"`
	AssignedAdmin *string   `json:"assigned_admin,omitempty"`
	Notes         *string   `json:"notes,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// OpenCaseInput is the data required to open a safety case.
type OpenCaseInput struct {
	ReporterID string `json:"reporter_id"`
	SubjectID  string `json:"subject_id"`
	Type       string `json:"type"`
	SourceRef  string `json:"source_ref"`
	Severity   string `json:"severity"`
	Notes      string `json:"notes"`
}

// ReportRequest is the member-facing body for POST /api/v1/connect/safety/report.
// The reporter is taken from the authenticated session, never the body, so a user
// can only file a report as themselves (invariant 7: every report opens a case).
type ReportRequest struct {
	SubjectID string `json:"subject_id" binding:"required"` // the user/content being reported
	Type      string `json:"type" binding:"required"`       // see caseTypes
	SourceRef string `json:"source_ref"`                    // e.g. message/profile/media id
	Notes     string `json:"notes"`
}

// UpdateCaseInput patches a case. Empty fields are left unchanged.
type UpdateCaseInput struct {
	Status        string `json:"status"`
	Resolution    string `json:"resolution"`
	AssignedAdmin string `json:"assigned_admin"`
	Notes         string `json:"notes"`
}

// AuditInput is written to the immutable connect_audit_log.
type AuditInput struct {
	ActorID    string
	ActorRole  string
	Action     string
	EntityType string
	EntityID   string
	Reason     string
	IP         string
	OldValue   map[string]any
	NewValue   map[string]any
}

// AuditEntry is a read row from connect_audit_log (list views).
type AuditEntry struct {
	ID         string    `json:"id"`
	ActorID    *string   `json:"actor_id,omitempty"`
	ActorRole  *string   `json:"actor_role,omitempty"`
	Action     string    `json:"action"`
	EntityType *string   `json:"entity_type,omitempty"`
	EntityID   *string   `json:"entity_id,omitempty"`
	Reason     *string   `json:"reason,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
}
