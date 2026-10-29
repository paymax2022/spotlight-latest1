// Package support is the telemedicine admin console's support & safety surface:
// support tickets, support disputes, call disputes, safety issues and emergency
// cases/escalations raised from the doctor app. Reads sit behind
// telemedicine.admin.view, mutations behind telemedicine.admin.manage; every
// mutation commits together with a doctor_compliance_audit row.
package support

import (
	"errors"
	"sort"
	"time"
)

var (
	ErrNotFound          = errors.New("support: not found")
	ErrValidation        = errors.New("support: invalid request")
	ErrInvalidTransition = errors.New("support: status transition not allowed")
	ErrClosed            = errors.New("support: thread is closed")
)

// Kind identifies one of the six queues.
type Kind string

const (
	KindTicket     Kind = "ticket"
	KindDispute    Kind = "dispute"
	KindCall       Kind = "call_dispute"
	KindSafety     Kind = "safety_issue"
	KindCase       Kind = "emergency_case"
	KindEscalation Kind = "emergency_escalation"
)

// spec holds the trusted, compile-time SQL fragments and state machine of a
// kind. Nothing here ever comes from a request.
type spec struct {
	kind        Kind
	table       string
	entityType  string // doctor_compliance_audit.entity_type
	notifType   string // doctor_notifications.notif_type
	noun        string // used in doctor-facing notification copy
	ref         string // SQL expressions over alias t
	subject     string
	category    string
	severity    string
	patient     string
	updated     string
	hasMessages bool
	hasDetail   bool
	hasUpdated  bool
	transitions map[string][]string
}

// normalise folds legacy spellings onto the stored vocabulary.
func (s spec) normalise(status string) string {
	if s.kind == KindSafety && status == "submitted" {
		return "open"
	}
	return status
}

func (s spec) allowed(from string) []string {
	out := append([]string{}, s.transitions[s.normalise(from)]...)
	sort.Strings(out)
	return out
}

// canMove reports whether from -> to is a legal admin transition.
func (s spec) canMove(from, to string) bool {
	for _, n := range s.transitions[s.normalise(from)] {
		if n == to {
			return true
		}
	}
	return false
}

func (s spec) knownStatus(status string) bool {
	if _, ok := s.transitions[status]; ok {
		return true
	}
	for _, tos := range s.transitions {
		for _, n := range tos {
			if n == status {
				return true
			}
		}
	}
	return false
}

var specs = map[Kind]spec{
	KindTicket: {
		kind: KindTicket, table: "doctor_support_tickets", entityType: "support_ticket",
		notifType: "support_response", noun: "support ticket",
		ref: "COALESCE(t.ref,'')", subject: "COALESCE(t.subject,'')", category: "COALESCE(t.category,'')",
		severity: "''", patient: "''", updated: "t.updated_at",
		hasMessages: true, hasUpdated: true,
		transitions: map[string][]string{
			"open":        {"in_progress", "resolved", "closed"},
			"in_progress": {"resolved", "closed"},
			"resolved":    {"open", "closed"},
			"closed":      {},
		},
	},
	KindDispute: {
		kind: KindDispute, table: "doctor_support_disputes", entityType: "support_dispute",
		notifType: "support_response", noun: "dispute",
		ref: "'DSP-'||left(t.id::text,8)", subject: "COALESCE(t.subject,'')", category: "''",
		severity: "''", patient: "''", updated: "t.updated_at",
		hasMessages: true, hasDetail: true, hasUpdated: true,
		transitions: map[string][]string{
			"open":              {"under_review", "awaiting_response", "resolved", "rejected"},
			"under_review":      {"awaiting_response", "resolved", "rejected"},
			"awaiting_response": {"under_review", "resolved", "rejected"},
			"resolved":          {},
			"rejected":          {},
		},
	},
	KindCall: {
		kind: KindCall, table: "doctor_call_disputes", entityType: "call_dispute",
		notifType: "support_response", noun: "call dispute",
		ref: "'CAL-'||left(t.id::text,8)", subject: "COALESCE(NULLIF(t.reason,''),'Call dispute')", category: "''",
		severity: "''", patient: "''", updated: "t.updated_at",
		hasDetail: true, hasUpdated: true,
		transitions: map[string][]string{
			"open":         {"under_review", "resolved", "rejected"},
			"under_review": {"resolved", "rejected"},
			"resolved":     {},
			"rejected":     {},
		},
	},
	KindSafety: {
		kind: KindSafety, table: "doctor_safety_issues", entityType: "safety_issue",
		notifType: "compliance", noun: "safety report",
		ref: "'SAF-'||left(t.id::text,8)", subject: "COALESCE(t.subject,'')", category: "''",
		severity: "t.severity", patient: "''", updated: "t.updated_at",
		hasDetail: true, hasUpdated: true,
		transitions: map[string][]string{
			"open":          {"acknowledged", "investigating", "closed"},
			"acknowledged":  {"investigating", "closed"},
			"investigating": {"closed"},
			"closed":        {},
		},
	},
	KindCase: {
		kind: KindCase, table: "doctor_emergency_cases", entityType: "emergency_case",
		notifType: "compliance", noun: "emergency case",
		ref: "'EMR-'||left(t.id::text,6)", subject: "COALESCE(t.summary,'')", category: "''",
		severity: "''", patient: "COALESCE(t.patient_id,'')", updated: "t.updated_at",
		hasDetail: true, hasUpdated: true,
		transitions: map[string][]string{
			"open":         {"acknowledged", "resolved"},
			"acknowledged": {"resolved"},
			"resolved":     {},
		},
	},
	KindEscalation: {
		kind: KindEscalation, table: "doctor_emergency_escalations", entityType: "emergency_escalation",
		notifType: "compliance", noun: "emergency escalation",
		ref: "'ESC-'||left(t.id::text,6)", subject: "t.escalation_type", category: "t.escalation_type",
		severity: "''", patient: "COALESCE(t.patient_id,'')", updated: "t.created_at",
		hasDetail: true,
		transitions: map[string][]string{
			"initiated":    {"notified", "acknowledged", "cancelled"},
			"notified":     {"acknowledged", "cancelled"},
			"acknowledged": {},
			"cancelled":    {},
		},
	},
}

var severities = map[string]bool{"low": true, "medium": true, "high": true, "critical": true}

// Item is one row of any queue.
type Item struct {
	ID           string    `json:"id"`
	Kind         Kind      `json:"kind"`
	Ref          string    `json:"ref"`
	DoctorUserID string    `json:"doctor_user_id"`
	DoctorName   string    `json:"doctor_name"`
	Subject      string    `json:"subject"`
	Category     string    `json:"category"`
	Severity     string    `json:"severity"`
	Status       string    `json:"status"`
	PatientRef   string    `json:"patient_ref"`
	AssigneeID   *string   `json:"assignee_id"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// Message is one entry of a ticket/dispute thread.
type Message struct {
	ID        string    `json:"id"`
	Author    string    `json:"author"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"created_at"`
}

// HistoryEntry is one admin action recorded in the audit trail.
type HistoryEntry struct {
	Action    string    `json:"action"`
	AdminID   string    `json:"admin_id,omitempty"`
	From      string    `json:"from,omitempty"`
	To        string    `json:"to,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// ItemDetail is Item plus the kind-specific body.
type ItemDetail struct {
	Item
	AllowedStatuses []string       `json:"allowed_statuses"`
	Body            string         `json:"body,omitempty"`
	Detail          map[string]any `json:"detail,omitempty"`
	Evidence        []any          `json:"evidence,omitempty"`
	Messages        []Message      `json:"messages,omitempty"`
	Escalations     []Item         `json:"escalations,omitempty"`
	History         []HistoryEntry `json:"history"`
}

// ListQuery is the validated filter set of a list call.
type ListQuery struct {
	Status   string
	Severity string
	Category string
	Q        string
	Assigned string // "", "unassigned", "me" or an admin uuid
	Limit    int
	Offset   int
}

// KindSummary is one queue's KPI block.
type KindSummary struct {
	Total          int            `json:"total"`
	ByStatus       map[string]int `json:"by_status"`
	UnassignedOpen int            `json:"unassigned_open"`
}

// Facility is a doctor-saved emergency facility (read-only reference).
type Facility struct {
	ID           string         `json:"id"`
	DoctorUserID string         `json:"doctor_user_id"`
	Name         string         `json:"name"`
	FacilityType string         `json:"facility_type"`
	Location     map[string]any `json:"location"`
	CreatedAt    time.Time      `json:"created_at"`
}

// isOpenStatus is the "still needs an admin" set used for unassigned_open.
func (s spec) isOpenStatus(status string) bool {
	switch s.kind {
	case KindTicket:
		return status == "open" || status == "in_progress"
	case KindDispute:
		return status == "open" || status == "under_review" || status == "awaiting_response"
	case KindCall:
		return status == "open" || status == "under_review"
	case KindSafety:
		return status == "open" || status == "acknowledged" || status == "investigating"
	case KindCase:
		return status == "open" || status == "acknowledged"
	case KindEscalation:
		return status == "initiated" || status == "notified"
	}
	return false
}
