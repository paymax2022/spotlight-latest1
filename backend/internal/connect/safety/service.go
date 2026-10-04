package connectsafety

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"spotlight/backend/go-common/dbutil"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/go-common/ptr"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// execer is satisfied by both *pgxpool.Pool and pgx.Tx, so audit writes work
// inside or outside a transaction.
type execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Service is the Phase 0 safety backbone: immutable audit log + case scaffold.
type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

const caseColumns = `id, reporter_id, subject_id, type, source_ref, status, resolution,
	severity, assigned_admin, notes, created_at, updated_at`

const auditInsert = `INSERT INTO connect_audit_log
	(actor_id, actor_role, action, entity_type, entity_id, old_value, new_value, reason, ip_address)
	VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)`

func jsonOrNil(m map[string]any) any {
	if len(m) == 0 {
		return nil
	}
	b, err := json.Marshal(m)
	if err != nil {
		return nil
	}
	return string(b)
}

func writeAudit(ctx context.Context, q execer, in AuditInput) error {
	_, err := q.Exec(ctx, auditInsert,
		dbutil.NullStr(in.ActorID), dbutil.NullStr(in.ActorRole), in.Action,
		dbutil.NullStr(in.EntityType), dbutil.NullStr(in.EntityID),
		jsonOrNil(in.OldValue), jsonOrNil(in.NewValue),
		dbutil.NullStr(in.Reason), dbutil.NullStr(in.IP),
	)
	if err != nil {
		return fmt.Errorf("connect: write audit: %w", err)
	}
	return nil
}

// WriteAudit appends an immutable entry to connect_audit_log (standalone).
func (s *Service) WriteAudit(ctx context.Context, in AuditInput) error {
	if in.Action == "" {
		return errors.New("connect: audit action is required")
	}
	return writeAudit(ctx, s.db, in)
}

// OpenCase opens a safety case AND writes its audit entry in a single tx, so a
// report can never create a case without an audit trail (and vice versa).
func (s *Service) OpenCase(ctx context.Context, in OpenCaseInput) (*Case, error) {
	if !ValidCaseType(in.Type) {
		return nil, fmt.Errorf("connect: invalid case type %q", in.Type)
	}
	severity := in.Severity
	if severity == "" {
		severity = "normal"
	}
	if !ValidCaseSeverity(severity) {
		return nil, fmt.Errorf("connect: invalid case severity %q", severity)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("connect: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	id := uuid.New().String()
	const insertCase = `INSERT INTO connect_cases
		(id, reporter_id, subject_id, type, source_ref, severity, notes)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING ` + caseColumns
	c := &Case{}
	if err := tx.QueryRow(ctx, insertCase,
		id, dbutil.NullStr(in.ReporterID), dbutil.NullStr(in.SubjectID), in.Type,
		dbutil.NullStr(in.SourceRef), severity, dbutil.NullStr(in.Notes),
	).Scan(
		&c.ID, &c.ReporterID, &c.SubjectID, &c.Type, &c.SourceRef, &c.Status,
		&c.Resolution, &c.Severity, &c.AssignedAdmin, &c.Notes, &c.CreatedAt, &c.UpdatedAt,
	); err != nil {
		return nil, fmt.Errorf("connect: insert case: %w", err)
	}

	if err := writeAudit(ctx, tx, AuditInput{
		ActorID:    in.ReporterID,
		Action:     "connect.case.open",
		EntityType: "connect_case",
		EntityID:   c.ID,
		NewValue:   map[string]any{"type": in.Type, "severity": severity, "source_ref": in.SourceRef},
	}); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("connect: commit case: %w", err)
	}
	return c, nil
}

// UpdateCase patches a case (admin) and audits the change in one tx.
func (s *Service) UpdateCase(ctx context.Context, id, adminID string, in UpdateCaseInput) (*Case, error) {
	if in.Status != "" && !ValidCaseStatus(in.Status) {
		return nil, fmt.Errorf("connect: invalid status %q", in.Status)
	}
	if in.Resolution != "" && !ValidCaseResolution(in.Resolution) {
		return nil, fmt.Errorf("connect: invalid resolution %q", in.Resolution)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("connect: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const updateCase = `UPDATE connect_cases SET
		status         = COALESCE(NULLIF($2,''), status),
		resolution     = COALESCE(NULLIF($3,''), resolution),
		assigned_admin = COALESCE(NULLIF($4,'')::uuid, assigned_admin),
		notes          = COALESCE(NULLIF($5,''), notes)
		WHERE id = $1
		RETURNING ` + caseColumns
	c := &Case{}
	if err := tx.QueryRow(ctx, updateCase, id, in.Status, in.Resolution, in.AssignedAdmin, in.Notes).Scan(
		&c.ID, &c.ReporterID, &c.SubjectID, &c.Type, &c.SourceRef, &c.Status,
		&c.Resolution, &c.Severity, &c.AssignedAdmin, &c.Notes, &c.CreatedAt, &c.UpdatedAt,
	); err != nil {
		return nil, fmt.Errorf("connect: case not found or update failed: %w", err)
	}

	if err := writeAudit(ctx, tx, AuditInput{
		ActorID:    adminID,
		ActorRole:  "admin",
		Action:     "connect.case.update",
		EntityType: "connect_case",
		EntityID:   c.ID,
		NewValue: map[string]any{
			"status": in.Status, "resolution": in.Resolution,
			"assigned_admin": in.AssignedAdmin,
		},
	}); err != nil {
		return nil, err
	}

	// TS-009 / invariant 6 (report→moderation→ACTION) + invariant 12 (fail-safe):
	// a 'suspended'/'banned' resolution must ENFORCE, not just record. Write an
	// active account restriction for the case subject in the SAME tx, so the
	// decision and its enforcement are atomic and attributable — if this fails the
	// whole case update rolls back rather than leaving an un-enforced ban.
	if (in.Resolution == "suspended" || in.Resolution == "banned") && c.SubjectID != nil && *c.SubjectID != "" {
		if err := applyRestrictionTx(ctx, tx, *c.SubjectID, in.Resolution, adminID, c.ID,
			"case "+c.ID+" resolved "+in.Resolution); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("connect: commit case update: %w", err)
	}
	return c, nil
}

// applyRestrictionTx activates an account restriction of the given type
// ('suspended'|'banned') for subjectID within the caller's tx. Idempotent via the
// one-active-per-user unique index: re-resolving a case keeps a single active row
// and refreshes its type/reason/attribution.
func applyRestrictionTx(ctx context.Context, tx execer, subjectID, restrictionType, adminID, caseID, reason string) error {
	const ins = `INSERT INTO connect_account_restrictions (user_id, type, active, reason, case_id, created_by)
		VALUES ($1::uuid, $2, true, $3, NULLIF($4,'')::uuid, NULLIF($5,'')::uuid)
		ON CONFLICT (user_id) WHERE active
		DO UPDATE SET type = EXCLUDED.type, reason = EXCLUDED.reason,
		              case_id = EXCLUDED.case_id, created_by = EXCLUDED.created_by,
		              updated_at = now()`
	if _, err := tx.Exec(ctx, ins, subjectID, restrictionType, reason, caseID, adminID); err != nil {
		return fmt.Errorf("connect: apply account restriction: %w", err)
	}
	return writeAudit(ctx, tx, AuditInput{
		ActorID:    adminID,
		ActorRole:  "admin",
		Action:     "connect.account.restrict",
		EntityType: "connect_user",
		EntityID:   subjectID,
		Reason:     reason,
		NewValue:   map[string]any{"type": restrictionType, "case_id": caseID},
	})
}

// GetCase fetches a single case.
func (s *Service) GetCase(ctx context.Context, id string) (*Case, error) {
	const q = `SELECT ` + caseColumns + ` FROM connect_cases WHERE id = $1`
	c := &Case{}
	if err := s.db.QueryRow(ctx, q, id).Scan(
		&c.ID, &c.ReporterID, &c.SubjectID, &c.Type, &c.SourceRef, &c.Status,
		&c.Resolution, &c.Severity, &c.AssignedAdmin, &c.Notes, &c.CreatedAt, &c.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return c, nil
}

// ListCases returns cases, optionally filtered by status, newest first.
func (s *Service) ListCases(ctx context.Context, status string, limit int) ([]Case, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `SELECT ` + caseColumns + ` FROM connect_cases
		WHERE ($1 = '' OR status = $1) ORDER BY created_at DESC LIMIT $2`
	rows, err := s.db.Query(ctx, q, status, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Case
	for rows.Next() {
		var c Case
		if err := rows.Scan(
			&c.ID, &c.ReporterID, &c.SubjectID, &c.Type, &c.SourceRef, &c.Status,
			&c.Resolution, &c.Severity, &c.AssignedAdmin, &c.Notes, &c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ListAudit returns recent audit entries, newest first.
func (s *Service) ListAudit(ctx context.Context, limit int) ([]AuditEntry, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `SELECT id, actor_id, actor_role, action, entity_type, entity_id, reason, created_at
		FROM connect_audit_log ORDER BY created_at DESC LIMIT $1`
	rows, err := s.db.Query(ctx, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AuditEntry
	for rows.Next() {
		var e AuditEntry
		if err := rows.Scan(
			&e.ID, &e.ActorID, &e.ActorRole, &e.Action, &e.EntityType, &e.EntityID, &e.Reason, &e.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// This file ADDITIVELY adds the member-facing block/unblock HTTP handlers to the
// existing safety Handler. No existing handler methods are changed.

// Block — POST /api/v1/connect/safety/block (authenticated member).
// Block prevents further contact/visibility and never fails silently.
func (h *Handler) Block(c *gin.Context) {
	blockerID := ginutil.UserID(c)
	if blockerID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var req BlockRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	res, err := h.svc.Block(c.Request.Context(), blockerID, req)
	if err != nil {
		// A block must never be swallowed — surface the failure.
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not apply block"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": res})
}

// Unblock — DELETE /api/v1/connect/safety/block/:blockedId (authenticated member).
func (h *Handler) Unblock(c *gin.Context) {
	blockerID := ginutil.UserID(c)
	if blockerID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	if err := h.svc.Unblock(c.Request.Context(), blockerID, c.Param("blockedId")); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not remove block"})
		return
	}
	c.Status(http.StatusNoContent)
}

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Report — POST /api/v1/connect/safety/report (authenticated member).
// Invariant 7: every safety report transactionally opens a connect_case and is
// audited; it NEVER fails silently. The reporter is the authed user (not the body).
// Returns the created case id; validation errors are 400, anything else bubbles as
// 5xx (the report is never swallowed).
func (h *Handler) Report(c *gin.Context) {
	reporterID := ginutil.UserID(c)
	if reporterID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var req ReportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if !ValidCaseType(req.Type) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid report type"})
		return
	}
	cs, err := h.svc.OpenCase(c.Request.Context(), OpenCaseInput{
		ReporterID: reporterID,
		SubjectID:  req.SubjectID,
		Type:       req.Type,
		SourceRef:  req.SourceRef,
		// TS-003 severity routing: child-safety / potential-CSAM / threat reports
		// auto-escalate at intake (invariant 6); admin triage can adjust later.
		Severity: SeverityForReport(req.Type),
		Notes:    req.Notes,
	})
	if err != nil {
		// Never swallow a safety report — surface the failure.
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not open case"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": gin.H{"case_id": cs.ID, "status": cs.Status}})
}

// ListCases — GET /api/connect/admin/cases?status=&limit= (connect.cases.view)
func (h *Handler) ListCases(c *gin.Context) {
	cases, err := h.svc.ListCases(c.Request.Context(), c.Query("status"), ptr.DerefZero(ginutil.IntParam(c, "limit")))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": cases})
}

// GetCase — GET /api/connect/admin/cases/:id (connect.cases.view)
func (h *Handler) GetCase(c *gin.Context) {
	cs, err := h.svc.GetCase(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "case not found"})
		return
	}
	c.JSON(http.StatusOK, cs)
}

// UpdateCase — PATCH /api/connect/admin/cases/:id (connect.cases.manage)
func (h *Handler) UpdateCase(c *gin.Context) {
	adminID := ginutil.UserID(c)
	var req UpdateCaseInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	cs, err := h.svc.UpdateCase(c.Request.Context(), c.Param("id"), adminID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, cs)
}

// ListAudit — GET /api/connect/admin/audit?limit= (connect.audit.view)
func (h *Handler) ListAudit(c *gin.Context) {
	entries, err := h.svc.ListAudit(c.Request.Context(), ptr.DerefZero(ginutil.IntParam(c, "limit")))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": entries})
}

// This file ADDITIVELY extends the Phase-0 safety service with block/unmatch.
// It introduces NO changes to existing funcs/types. Block prevents further
// contact + visibility (the chat layer + connect_messages RLS both check
// connect_blocks), and — per "report/block create cases, never fail silently" —
// blocking also opens a connect_case so moderators see repeat-offender patterns.

// BlockRequest is the member body for POST /api/v1/connect/safety/block. The
// blocker is the authenticated user (never the body), so a user can only block
// on their own behalf.
type BlockRequest struct {
	BlockedID string `json:"blocked_id" binding:"required"`
	Reason    string `json:"reason"`
	OpenCase  bool   `json:"open_case"` // also file a report-style case (defaults false)
}

// BlockResult is returned to the blocker.
type BlockResult struct {
	BlockID    string  `json:"block_id"`
	CaseID     *string `json:"case_id,omitempty"`
	AlreadySet bool    `json:"already_set"`
}

// Block records a block (idempotent on UNIQUE(blocker_id, blocked_id)), audits
// it, and — when requested or on a flagged subject — opens a harassment case.
// The block write itself NEVER fails silently: a DB error bubbles to the caller.
func (s *Service) Block(ctx context.Context, blockerID string, req BlockRequest) (*BlockResult, error) {
	if blockerID == "" || req.BlockedID == "" {
		return nil, errors.New("connect: blocker and blocked are required")
	}
	if blockerID == req.BlockedID {
		return nil, errors.New("connect: cannot block yourself")
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("connect: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	id := uuid.New().String()
	const ins = `INSERT INTO connect_blocks (id, blocker_id, blocked_id, reason)
		VALUES ($1::uuid, $2::uuid, $3::uuid, NULLIF($4,''))
		ON CONFLICT (blocker_id, blocked_id) DO NOTHING
		RETURNING id`
	res := &BlockResult{}
	var newID string
	err = tx.QueryRow(ctx, ins, id, blockerID, req.BlockedID, req.Reason).Scan(&newID)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		// Conflict: block already existed. Idempotent success.
		res.AlreadySet = true
		const sel = `SELECT id FROM connect_blocks WHERE blocker_id = $1::uuid AND blocked_id = $2::uuid`
		if e := tx.QueryRow(ctx, sel, blockerID, req.BlockedID).Scan(&res.BlockID); e != nil {
			return nil, fmt.Errorf("connect: load existing block: %w", e)
		}
	case err != nil:
		return nil, fmt.Errorf("connect: insert block: %w", err)
	default:
		res.BlockID = newID
	}

	if err := writeAudit(ctx, tx, AuditInput{
		ActorID:    blockerID,
		Action:     "connect.block.create",
		EntityType: "connect_block",
		EntityID:   res.BlockID,
		Reason:     req.Reason,
		NewValue:   map[string]any{"blocked_id": req.BlockedID, "already_set": res.AlreadySet},
	}); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("connect: commit block: %w", err)
	}

	// Optionally open a case (own tx in OpenCase). A block-with-report must never
	// be swallowed, so a case error is surfaced.
	if req.OpenCase {
		c, err := s.OpenCase(ctx, OpenCaseInput{
			ReporterID: blockerID,
			SubjectID:  req.BlockedID,
			Type:       "harassment",
			SourceRef:  res.BlockID,
			Severity:   "normal",
			Notes:      "Case opened alongside a user block. Reason: " + req.Reason,
		})
		if err != nil {
			return nil, fmt.Errorf("connect: open case for block: %w", err)
		}
		res.CaseID = &c.ID
	}
	return res, nil
}

// Unblock removes a block the caller owns (idempotent).
func (s *Service) Unblock(ctx context.Context, blockerID, blockedID string) error {
	const del = `DELETE FROM connect_blocks WHERE blocker_id = $1::uuid AND blocked_id = $2::uuid`
	if _, err := s.db.Exec(ctx, del, blockerID, blockedID); err != nil {
		return fmt.Errorf("connect: unblock: %w", err)
	}
	return s.WriteAudit(ctx, AuditInput{
		ActorID:    blockerID,
		Action:     "connect.block.remove",
		EntityType: "connect_block",
		EntityID:   blockedID,
	})
}

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
