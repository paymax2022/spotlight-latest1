package connectmoderation

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// This file serves the admin console's moderation CASE views (list + detail), as a read-only
// projection of flagged messages and the moderation decisions recorded against them. It never
// returns message content: the console shows reason codes and an evidence POINTER only.

// ErrCaseNotFound is returned when the id is not a flagged message.
var ErrCaseNotFound = errors.New("connect: moderation case not found")

// CaseSummary mirrors frontend-admin ModerationCaseSummary.
type CaseSummary struct {
	ID            string   `json:"id"`
	CaseID        string   `json:"case_id"`
	ContentType   string   `json:"content_type"`
	Reason        string   `json:"reason"`
	AIReasonCodes []string `json:"ai_reason_codes"`
	ReporterID    *string  `json:"reporter_id"`
	SubjectID     string   `json:"subject_id"`
	Severity      string   `json:"severity"`
	Status        string   `json:"status"`
	CreatedAt     string   `json:"created_at"`
}

// HistoryEntry is one moderation decision in a case's history.
type HistoryEntry struct {
	At     string `json:"at"`
	Actor  string `json:"actor"`
	Action string `json:"action"`
	Note   string `json:"note,omitempty"`
}

// CaseDetail mirrors frontend-admin ModerationCaseDetail.
type CaseDetail struct {
	CaseSummary
	AIConfidence float64        `json:"ai_confidence"` // not stored: always 0 ("unknown"), never invented
	EvidenceRef  string         `json:"evidence_ref"`  // a pointer such as message:<id>, never the content
	History      []HistoryEntry `json:"history"`
	Notes        *string        `json:"notes"`
}

type caseRow struct {
	ID          string
	SenderID    string
	ReasonCodes []string
	CreatedAt   time.Time
	Status      string // derived in SQL from the latest decision
	CaseID      string
}

type decisionRow struct {
	Decision    string
	ReasonCodes []string
	Model       *string
	ReviewerID  *string
	CreatedAt   time.Time
}

var caseStatuses = map[string]bool{"all": true, "open": true, "investigating": true, "actioned": true, "dismissed": true}

func parseCaseStatus(s string) (string, bool) {
	if s == "" {
		return "all", true
	}
	if caseStatuses[s] {
		return s, true
	}
	return "", false
}

func caseLimit(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil || n <= 0 {
		return 100
	}
	if n > 200 {
		return 200
	}
	return n
}

func summaryOf(r caseRow) CaseSummary {
	codes := r.ReasonCodes
	if codes == nil {
		codes = []string{}
	}
	reason := strings.Join(codes, ", ")
	if reason == "" {
		reason = "flagged content"
	}
	return CaseSummary{
		ID: r.ID, CaseID: r.CaseID, ContentType: "message", Reason: reason, AIReasonCodes: codes,
		SubjectID: r.SenderID, Severity: "unrated", Status: r.Status, CreatedAt: r.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func detailOf(r caseRow, ds []decisionRow) CaseDetail {
	hist := make([]HistoryEntry, 0, len(ds))
	for _, d := range ds {
		actor := "system"
		switch {
		case d.ReviewerID != nil && *d.ReviewerID != "":
			actor = *d.ReviewerID
		case d.Model != nil && *d.Model != "":
			actor = "model:" + *d.Model
		}
		hist = append(hist, HistoryEntry{At: d.CreatedAt.UTC().Format(time.RFC3339), Actor: actor, Action: d.Decision, Note: strings.Join(d.ReasonCodes, ", ")})
	}
	return CaseDetail{CaseSummary: summaryOf(r), AIConfidence: 0, EvidenceRef: "message:" + r.ID, History: hist}
}

// statusExpr derives the console status from the latest decision against a message. It is the
// single source of the mapping (used for both the filter and the returned value).
const statusExpr = `CASE
	WHEN d.decision IS NULL OR d.decision = 'flagged' THEN 'open'
	WHEN d.decision = 'escalated' THEN 'investigating'
	WHEN d.decision = 'cleared' THEN 'dismissed'
	ELSE 'actioned' END`

const caseSelect = `SELECT m.id::text, m.sender_id::text, m.reason_codes, m.created_at, ` + statusExpr + `, COALESCE(d.case_id::text, '')
	FROM connect_messages m
	LEFT JOIN LATERAL (
	  SELECT decision, case_id FROM connect_moderation_decisions
	   WHERE target_type = 'message' AND target_id = m.id::text
	   ORDER BY created_at DESC, id DESC LIMIT 1
	) d ON true
	WHERE m.flagged = true`

// ListCases returns flagged messages as console cases, newest first, plus whether more exist.
func (s *Service) ListCases(ctx context.Context, status string, limit int) ([]CaseSummary, bool, error) {
	rows, err := s.db.Query(ctx, `SELECT * FROM (`+caseSelect+`) c(id, sender_id, reason_codes, created_at, status, case_id)
		WHERE $1 = 'all' OR status = $1 ORDER BY created_at DESC LIMIT $2`, status, limit+1)
	if err != nil {
		return nil, false, fmt.Errorf("connect: list moderation cases: %w", err)
	}
	defer rows.Close()
	out := make([]CaseSummary, 0, limit)
	for rows.Next() {
		var r caseRow
		if err := rows.Scan(&r.ID, &r.SenderID, &r.ReasonCodes, &r.CreatedAt, &r.Status, &r.CaseID); err != nil {
			return nil, false, err
		}
		out = append(out, summaryOf(r))
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	if len(out) > limit {
		return out[:limit], true, nil
	}
	return out, false, nil
}

// GetCase returns one flagged message's case with its decision history (oldest first).
func (s *Service) GetCase(ctx context.Context, id string) (*CaseDetail, error) {
	var r caseRow
	err := s.db.QueryRow(ctx, caseSelect+` AND m.id = $1::uuid`, id).
		Scan(&r.ID, &r.SenderID, &r.ReasonCodes, &r.CreatedAt, &r.Status, &r.CaseID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrCaseNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("connect: get moderation case: %w", err)
	}
	rows, err := s.db.Query(ctx, `SELECT decision, reason_codes, model, reviewer_id::text, created_at
		FROM connect_moderation_decisions WHERE target_type = 'message' AND target_id = $1
		ORDER BY created_at ASC, id ASC`, r.ID)
	if err != nil {
		return nil, fmt.Errorf("connect: get moderation history: %w", err)
	}
	defer rows.Close()
	var ds []decisionRow
	for rows.Next() {
		var d decisionRow
		if err := rows.Scan(&d.Decision, &d.ReasonCodes, &d.Model, &d.ReviewerID, &d.CreatedAt); err != nil {
			return nil, err
		}
		ds = append(ds, d)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	d := detailOf(r, ds)
	return &d, nil
}

// ListCases — GET /api/connect/admin/moderation?status=&limit=
func (h *Handler) ListCases(c *gin.Context) {
	status, ok := parseCaseStatus(c.Query("status"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, keyError: "invalid status"})
		return
	}
	list, more, err := h.svc.ListCases(c.Request.Context(), status, caseLimit(c.Query("limit")))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, keyError: "internal"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": list, "has_more": more})
}

// GetCase — GET /api/connect/admin/moderation/:id
func (h *Handler) GetCase(c *gin.Context) {
	if _, err := uuid.Parse(c.Param("id")); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, keyError: "not_found"})
		return
	}
	d, err := h.svc.GetCase(c.Request.Context(), c.Param("id"))
	if errors.Is(err, ErrCaseNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"success": false, keyError: "not_found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, keyError: "internal"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": d})
}
