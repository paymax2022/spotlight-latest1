package feesexport

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store is the data-access contract for the compliance-export log. It is defined as an
// in-package interface so export_test.go can substitute an in-memory fake (no live DB),
// mirroring feesinvoice / edupay isolation.
//
// APPEND-ONLY STRUCTURAL GUARANTEE (SF-11): this interface exposes ONLY AppendExport and
// ListExports. There is DELIBERATELY no UpdateExport / DeleteExport method — the compliance
// log is immutable. public.academy_compliance_exports has no UPDATE/DELETE path in this
// package. A caller cannot mutate a logged export because no such method exists.
type Store interface {
	// AppendExport inserts one IMMUTABLE compliance-export row and returns it.
	AppendExport(ctx context.Context, e ComplianceExport) (*ComplianceExport, error)
	// ListExports returns a school's export history (audit trail), newest first.
	ListExports(ctx context.Context, schoolID string) ([]ComplianceExport, error)
	// WriteAudit records the export action to public.audit_logs (module 'academy.fees').
	WriteAudit(ctx context.Context, actorID, action, entityID string, detail any) error
}

// OptInStore reads a school's per-category opt-in for regulator sharing (SF-11).
//
// NOTE (integration gap): the migration 20260918000000_academy_fees_edtech.sql records the
// opted-in categories ON the export row (academy_compliance_exports.data_categories) but does
// NOT provide a per-school opt-in configuration table. A dedicated per-school opt-in store
// (e.g. academy_school_compliance_optins(school_id, data_category, opted_in_at, opted_in_by))
// SHOULD be added so opt-in is a durable school setting rather than asserted per request. Until
// then, the service falls back to the explicit OptInCategories passed on the trigger request
// (recorded on the immutable export row for audit). This interface is the seam for that store.
type OptInStore interface {
	// HasOptedIn reports whether the school has opted in to share the given data category.
	HasOptedIn(ctx context.Context, schoolID string, category DataCategory) (bool, error)
}

// SchoolVerifier reads a school's verification tier (SF-10 eligibility gate). Reuses
// academy_schools.verification_tier (added by the fees migration). A school is eligible for a
// full self-service export only when verified/premium.
type SchoolVerifier interface {
	VerificationTier(ctx context.Context, schoolID string) (string, error)
}

// Repository is the pgx implementation of Store.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository builds the pgx-backed Store.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// AppendExport inserts one immutable row into public.academy_compliance_exports. There is no
// corresponding UPDATE/DELETE — the log is append-only (SF-11).
func (r *Repository) AppendExport(ctx context.Context, e ComplianceExport) (*ComplianceExport, error) {
	id := uuid.New().String()
	now := time.Now()
	const q = `INSERT INTO academy_compliance_exports
	    (id, school_id, report_type, period, data_categories, requested_by, generated_at, payload_ref)
	    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`
	if _, err := r.db.Exec(ctx, q, id, e.SchoolID, e.ReportType, nullStr(deref(e.Period)),
		categoriesToText(e.DataCategories), nullUUID(e.RequestedBy), now, nullStr(deref(e.PayloadRef))); err != nil {
		return nil, err
	}
	out := e
	out.ID = id
	out.GeneratedAt = now
	return &out, nil
}

// ListExports returns a school's export history (audit trail), newest first.
func (r *Repository) ListExports(ctx context.Context, schoolID string) ([]ComplianceExport, error) {
	const q = `SELECT id, school_id, report_type, period, data_categories, requested_by, generated_at, payload_ref
	           FROM academy_compliance_exports WHERE school_id = $1 ORDER BY generated_at DESC`
	rows, err := r.db.Query(ctx, q, schoolID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ComplianceExport{}
	for rows.Next() {
		var e ComplianceExport
		var period, requestedBy, payloadRef *string
		var cats []string
		if err := rows.Scan(&e.ID, &e.SchoolID, &e.ReportType, &period, &cats, &requestedBy, &e.GeneratedAt, &payloadRef); err != nil {
			return nil, err
		}
		e.Period = period
		e.PayloadRef = payloadRef
		if requestedBy != nil {
			e.RequestedBy = *requestedBy
		}
		e.DataCategories = textToCategories(cats)
		out = append(out, e)
	}
	return out, rows.Err()
}

// WriteAudit records to public.audit_logs (module 'academy.fees') — reuses the shared audit
// store per REUSE-MAP.md (do not build a parallel audit store). Column shape matches the
// existing academy/schools WriteAudit (actor_user_id, action, module, resource_type,
// resource_id, new_values).
func (r *Repository) WriteAudit(ctx context.Context, actorID, action, entityID string, detail any) error {
	const ins = `INSERT INTO public.audit_logs (actor_user_id, action, module, resource_type, resource_id, new_values)
	             VALUES ($1,$2,'academy.fees','academy_compliance_export',$3,$4)`
	_, err := r.db.Exec(ctx, ins, nullUUID(actorID), action, nullStr(entityID), toJSON(detail))
	return err
}

// ── pgx opt-in store (best-effort; NOTE: table not yet in migrations) ────────────

// PgxOptInStore reads per-school opt-in from a (not-yet-migrated) opt-in table. Until the
// migration exists this returns (false, nil) so the service falls back to the explicit
// request-carried opt-in. Wired only when the integration task adds the table.
type PgxOptInStore struct {
	db *pgxpool.Pool
}

func NewPgxOptInStore(db *pgxpool.Pool) *PgxOptInStore { return &PgxOptInStore{db: db} }

// HasOptedIn queries academy_school_compliance_optins if present; missing table ⇒ (false,nil).
func (s *PgxOptInStore) HasOptedIn(ctx context.Context, schoolID string, category DataCategory) (bool, error) {
	const q = `SELECT to_regclass('public.academy_school_compliance_optins')`
	var reg *string
	if err := s.db.QueryRow(ctx, q).Scan(&reg); err != nil || reg == nil {
		return false, nil // table not migrated yet → defer to request-carried opt-in
	}
	const sel = `SELECT EXISTS(
	    SELECT 1 FROM academy_school_compliance_optins
	    WHERE school_id = $1 AND data_category = $2)`
	var ok bool
	if err := s.db.QueryRow(ctx, sel, schoolID, string(category)).Scan(&ok); err != nil {
		return false, err
	}
	return ok, nil
}

// PgxSchoolVerifier reads academy_schools.verification_tier.
type PgxSchoolVerifier struct {
	db *pgxpool.Pool
}

func NewPgxSchoolVerifier(db *pgxpool.Pool) *PgxSchoolVerifier { return &PgxSchoolVerifier{db: db} }

func (s *PgxSchoolVerifier) VerificationTier(ctx context.Context, schoolID string) (string, error) {
	const q = `SELECT verification_tier FROM academy_schools WHERE id = $1`
	var tier string
	err := s.db.QueryRow(ctx, q, schoolID).Scan(&tier)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return tier, nil
}

// ── helpers ─────────────────────────────────────────────────────────────────────

func categoriesToText(cs []DataCategory) []string {
	out := make([]string, 0, len(cs))
	for _, c := range cs {
		out = append(out, string(c))
	}
	return out
}

func textToCategories(ss []string) []DataCategory {
	out := make([]DataCategory, 0, len(ss))
	for _, s := range ss {
		out = append(out, DataCategory(s))
	}
	return out
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullUUID(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func toJSON(v any) []byte {
	if v == nil {
		return []byte("{}")
	}
	b, err := json.Marshal(v)
	if err != nil {
		return []byte("{}")
	}
	return b
}
