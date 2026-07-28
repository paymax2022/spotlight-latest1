package connectaml

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository handles connect_aml_alerts + connect_aml_cases over a pgx pool.
// Alerts are insert-only; cases are insert + forward-only status update (file).
// All queries are parameterized; no raw PII is ever written.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository builds an AML repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// InsertAlert appends an immutable alert row.
func (r *Repository) InsertAlert(ctx context.Context, a *Alert) (*Alert, error) {
	const ins = `INSERT INTO connect_aml_alerts
		(subject_id, event_kind, reason_code, amount_kobo, window_count, ledger_ref)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING id, subject_id, event_kind, reason_code, amount_kobo, window_count, ledger_ref, case_id, created_at`
	out := &Alert{}
	if err := r.db.QueryRow(ctx, ins,
		a.SubjectID, string(a.EventKind), string(a.ReasonCode), a.AmountKobo, a.WindowCount, a.LedgerRef,
	).Scan(
		&out.ID, &out.SubjectID, &out.EventKind, &out.ReasonCode, &out.AmountKobo,
		&out.WindowCount, &out.LedgerRef, &out.CaseID, &out.CreatedAt,
	); err != nil {
		return nil, fmt.Errorf("aml: insert alert: %w", err)
	}
	return out, nil
}

// SumRecent returns (count, total kobo) of money events for a subject of a given
// kind since `since` — the input to velocity + structuring scoring. It reads the
// AML alert/event projection table, which records every flagged candidate.
func (r *Repository) SumRecent(ctx context.Context, subjectID string, kind EventKind, since time.Time) (int, int64, error) {
	const q = `SELECT COUNT(*), COALESCE(SUM(amount_kobo),0)
		FROM connect_aml_events
		WHERE subject_id = $1 AND event_kind = $2 AND created_at >= $3`
	var n int
	var total int64
	if err := r.db.QueryRow(ctx, q, subjectID, string(kind), since).Scan(&n, &total); err != nil {
		return 0, 0, fmt.Errorf("aml: sum recent: %w", err)
	}
	return n, total, nil
}

// RecordEvent appends the raw money-event projection used for scoring (subject +
// kind + amount + ledger ref only — never counterpart PII).
func (r *Repository) RecordEvent(ctx context.Context, subjectID string, kind EventKind, amountKobo int64, ledgerRef string) error {
	const ins = `INSERT INTO connect_aml_events (subject_id, event_kind, amount_kobo, ledger_ref)
		VALUES ($1,$2,$3,$4)`
	if _, err := r.db.Exec(ctx, ins, subjectID, string(kind), amountKobo, ledgerRef); err != nil {
		return fmt.Errorf("aml: record event: %w", err)
	}
	return nil
}

const caseColumns = `id, subject_id, report_type, status, reason_codes, narrative,
	opened_by, filed_by, filed_ref, filed_at, created_at, updated_at`

// OpenCase appends an immutable STR/SAR case in 'open' status.
func (r *Repository) OpenCase(ctx context.Context, subjectID, reportType string, reasonCodes []string, openedBy *string) (*Case, error) {
	const ins = `INSERT INTO connect_aml_cases
		(subject_id, report_type, status, reason_codes, opened_by)
		VALUES ($1,$2,'open',$3,$4)
		RETURNING ` + caseColumns
	return scanCase(r.db.QueryRow(ctx, ins, subjectID, reportType, reasonCodes, openedBy))
}

// FileSTR transitions a case to 'filed' (forward-only) and stamps the NFIU
// acknowledgement reference + compliance narrative. Refuses to re-file.
func (r *Repository) FileSTR(ctx context.Context, id, filedBy string, req FileSTRRequest) (*Case, error) {
	const upd = `UPDATE connect_aml_cases SET
			status     = 'filed',
			filed_by   = $2,
			filed_ref  = NULLIF($3,''),
			narrative  = COALESCE(NULLIF($4,''), narrative),
			filed_at   = now(),
			updated_at = now()
		WHERE id = $1 AND status = 'open'
		RETURNING ` + caseColumns
	return scanCase(r.db.QueryRow(ctx, upd, id, filedBy, req.FiledRef, req.Narrative))
}

// ListAlerts returns recent alerts, newest first.
func (r *Repository) ListAlerts(ctx context.Context, limit int) ([]Alert, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `SELECT id, subject_id, event_kind, reason_code, amount_kobo, window_count, ledger_ref, case_id, created_at
		FROM connect_aml_alerts ORDER BY created_at DESC LIMIT $1`
	rows, err := r.db.Query(ctx, q, limit)
	if err != nil {
		return nil, fmt.Errorf("aml: list alerts: %w", err)
	}
	defer rows.Close()
	var out []Alert
	for rows.Next() {
		var a Alert
		if err := rows.Scan(&a.ID, &a.SubjectID, &a.EventKind, &a.ReasonCode,
			&a.AmountKobo, &a.WindowCount, &a.LedgerRef, &a.CaseID, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ListCases returns recent cases, newest first.
func (r *Repository) ListCases(ctx context.Context, limit int) ([]Case, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `SELECT ` + caseColumns + ` FROM connect_aml_cases ORDER BY created_at DESC LIMIT $1`
	rows, err := r.db.Query(ctx, q, limit)
	if err != nil {
		return nil, fmt.Errorf("aml: list cases: %w", err)
	}
	defer rows.Close()
	var out []Case
	for rows.Next() {
		c, err := scanCase(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// rowScanner abstracts pgx.Row / pgx.Rows for the shared case scan.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanCase(s rowScanner) (*Case, error) {
	c := &Case{}
	if err := s.Scan(
		&c.ID, &c.SubjectID, &c.ReportType, &c.Status, &c.ReasonCodes, &c.Narrative,
		&c.OpenedBy, &c.FiledBy, &c.FiledRef, &c.FiledAt, &c.CreatedAt, &c.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return c, nil
}
