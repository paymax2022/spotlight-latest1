package connectsafety

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
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

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

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
		nullStr(in.ActorID), nullStr(in.ActorRole), in.Action,
		nullStr(in.EntityType), nullStr(in.EntityID),
		jsonOrNil(in.OldValue), jsonOrNil(in.NewValue),
		nullStr(in.Reason), nullStr(in.IP),
	)
	if err != nil {
		return fmt.Errorf("connect: write audit: %w", err)
	}
	return nil
}

// WriteAudit appends an immutable entry to connect_audit_log (standalone).
func (s *Service) WriteAudit(ctx context.Context, in AuditInput) error {
	if in.Action == "" {
		return fmt.Errorf("connect: audit action is required")
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
	defer tx.Rollback(ctx)

	id := uuid.New().String()
	const insertCase = `INSERT INTO connect_cases
		(id, reporter_id, subject_id, type, source_ref, severity, notes)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING ` + caseColumns
	c := &Case{}
	if err := tx.QueryRow(ctx, insertCase,
		id, nullStr(in.ReporterID), nullStr(in.SubjectID), in.Type,
		nullStr(in.SourceRef), severity, nullStr(in.Notes),
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
	defer tx.Rollback(ctx)

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

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("connect: commit case update: %w", err)
	}
	return c, nil
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
