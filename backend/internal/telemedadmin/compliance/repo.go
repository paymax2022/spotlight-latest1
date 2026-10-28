package compliance

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repo struct{ db *pgxpool.Pool }

func NewRepo(db *pgxpool.Pool) *Repo { return &Repo{db: db} }

// latestApproval is the most recent approved verification per clinician — the one
// whose licence_expiry the sweep and the admin views judge.
const latestApproval = `
	SELECT DISTINCT ON (user_id) user_id, licence_expiry, mdcn_number
	FROM doctor_verifications
	WHERE status = 'approved'
	ORDER BY user_id, COALESCE(decided_at, reviewed_at, created_at) DESC, created_at DESC`

func (r *Repo) Summary(ctx context.Context) (*Summary, error) {
	s := &Summary{}
	const q = `
		SELECT
		  COUNT(*) FILTER (WHERE a.licence_expiry < CURRENT_DATE),
		  COUNT(*) FILTER (WHERE a.licence_expiry >= CURRENT_DATE AND a.licence_expiry <= CURRENT_DATE + 30),
		  COUNT(*) FILTER (WHERE a.licence_expiry > CURRENT_DATE + 30 AND a.licence_expiry <= CURRENT_DATE + 90)
		FROM (` + latestApproval + `) a
		WHERE a.licence_expiry IS NOT NULL`
	if err := r.db.QueryRow(ctx, q).Scan(&s.LicencesExpired, &s.LicencesExpiring30d, &s.LicencesExpiring90d); err != nil {
		return nil, fmt.Errorf("compliance: licence summary: %w", err)
	}
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM doctor_profiles WHERE verification = 'suspended'`).Scan(&s.Suspended); err != nil {
		return nil, fmt.Errorf("compliance: suspended count: %w", err)
	}
	if err := r.db.QueryRow(ctx, `
		SELECT COUNT(*) FILTER (WHERE status <> 'completed'), COUNT(*) FILTER (WHERE status = 'completed')
		FROM doctor_mandatory_training`).Scan(&s.TrainingPending, &s.TrainingCompleted); err != nil {
		return nil, fmt.Errorf("compliance: training summary: %w", err)
	}
	if err := r.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM doctor_compliance_audit WHERE created_at >= now() - interval '7 days'`).Scan(&s.AuditEvents7d); err != nil {
		return nil, fmt.Errorf("compliance: audit summary: %w", err)
	}
	return s, nil
}

// bucketPredicate maps a validated bucket to its days-to-expiry predicate.
func bucketPredicate(bucket string) (string, error) {
	switch bucket {
	case "", "all":
		return "TRUE", nil
	case "expired":
		return "(a.licence_expiry - CURRENT_DATE) < 0", nil
	case "30d":
		return "(a.licence_expiry - CURRENT_DATE) BETWEEN 0 AND 30", nil
	case "90d":
		return "(a.licence_expiry - CURRENT_DATE) BETWEEN 31 AND 90", nil
	default:
		return "", ErrValidation
	}
}

func likeArg(q string) string {
	q = strings.TrimSpace(q)
	if q == "" {
		return ""
	}
	return "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q) + "%"
}

func (r *Repo) Licences(ctx context.Context, bucket, q string, limit, offset int) (*Page[LicenceRow], error) {
	pred, err := bucketPredicate(bucket)
	if err != nil {
		return nil, err
	}
	from := `
		FROM (` + latestApproval + `) a
		JOIN doctor_profiles p ON p.user_id = a.user_id
		LEFT JOIN doctors d ON d.user_id = a.user_id
		WHERE a.licence_expiry IS NOT NULL AND ` + pred + `
		  AND ($1 = '' OR COALESCE(p.name, d.name, '') ILIKE $1 OR COALESCE(a.mdcn_number, '') ILIKE $1)`
	like := likeArg(q)
	out := &Page[LicenceRow]{Items: []LicenceRow{}}
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) `+from, like).Scan(&out.Total); err != nil {
		return nil, fmt.Errorf("compliance: count licences: %w", err)
	}
	rows, err := r.db.Query(ctx, `
		SELECT a.user_id::text, d.id::text, COALESCE(p.name, d.name, ''), COALESCE(d.specialty, p.specialty_id, ''),
		       a.mdcn_number, to_char(a.licence_expiry, 'YYYY-MM-DD'), (a.licence_expiry - CURRENT_DATE), p.verification
		`+from+` ORDER BY a.licence_expiry ASC, 3 LIMIT $2 OFFSET $3`, like, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("compliance: list licences: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var it LicenceRow
		if err := rows.Scan(&it.UserID, &it.DoctorID, &it.Name, &it.Specialty, &it.MDCNNumber,
			&it.LicenceExpiry, &it.DaysToExpiry, &it.ProfileStatus); err != nil {
			return nil, fmt.Errorf("compliance: scan licence: %w", err)
		}
		it.Bucket = Bucket(it.DaysToExpiry)
		out.Items = append(out.Items, it)
	}
	return out, rows.Err()
}

func (r *Repo) Suspended(ctx context.Context, limit, offset int) (*Page[SuspendedClinician], error) {
	out := &Page[SuspendedClinician]{Items: []SuspendedClinician{}}
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM doctor_profiles WHERE verification = 'suspended'`).Scan(&out.Total); err != nil {
		return nil, fmt.Errorf("compliance: count suspended: %w", err)
	}
	rows, err := r.db.Query(ctx, `
		SELECT p.user_id::text, d.id::text, COALESCE(p.name, d.name, ''), COALESCE(d.specialty, p.specialty_id, ''),
		       COALESCE(a.mdcn_number, p.mdcn_number), to_char(a.licence_expiry, 'YYYY-MM-DD'),
		       COALESCE(a.licence_expiry < CURRENT_DATE, false),
		       COALESCE(au.created_at, p.updated_at),
		       CASE WHEN au.id IS NOT NULL THEN 'admin'
		            WHEN a.licence_expiry < CURRENT_DATE THEN 'system' END,
		       au.detail ->> 'reason'
		FROM doctor_profiles p
		LEFT JOIN doctors d ON d.user_id = p.user_id
		LEFT JOIN (`+latestApproval+`) a ON a.user_id = p.user_id
		LEFT JOIN LATERAL (
		  SELECT id, created_at, detail FROM doctor_compliance_audit
		  WHERE user_id = p.user_id AND action = $3
		  ORDER BY created_at DESC LIMIT 1
		) au ON true
		WHERE p.verification = 'suspended'
		ORDER BY COALESCE(au.created_at, p.updated_at) DESC
		LIMIT $1 OFFSET $2`, limit, offset, ActionSuspend)
	if err != nil {
		return nil, fmt.Errorf("compliance: list suspended: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var it SuspendedClinician
		if err := rows.Scan(&it.UserID, &it.DoctorID, &it.Name, &it.Specialty, &it.MDCNNumber, &it.LicenceExpiry,
			&it.LicenceExpired, &it.SuspendedAt, &it.SuspendedBy, &it.Reason); err != nil {
			return nil, fmt.Errorf("compliance: scan suspended: %w", err)
		}
		out.Items = append(out.Items, it)
	}
	return out, rows.Err()
}

// lock reads the clinician's profile row FOR UPDATE inside tx.
func lock(ctx context.Context, tx pgx.Tx, userID string) (profileID, status string, err error) {
	err = tx.QueryRow(ctx, `SELECT id::text, verification FROM doctor_profiles WHERE user_id = $1 FOR UPDATE`, userID).Scan(&profileID, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		var exists bool
		if e := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM doctors WHERE user_id = $1)`, userID).Scan(&exists); e == nil && exists {
			return "", "", ErrNoProfile
		}
		return "", "", ErrNotFound
	}
	return profileID, status, err
}

func audit(ctx context.Context, tx pgx.Tx, userID, action, profileID, actor string, detail map[string]any) (string, error) {
	detail["actor"] = actor
	b, _ := json.Marshal(detail)
	var id string
	err := tx.QueryRow(ctx, `
		INSERT INTO doctor_compliance_audit (user_id, action, entity_type, entity_id, detail)
		VALUES ($1, $2, 'doctor_profiles', $3, $4) RETURNING id::text`, userID, action, profileID, b).Scan(&id)
	return id, err
}

// Suspend de-lists and blocks a clinician in one transaction: profile status,
// publication flag, and the telemedicine availability flags, plus the audit row.
func (r *Repo) Suspend(ctx context.Context, userID, actor, reason string) (*StatusChange, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	profileID, status, err := lock(ctx, tx, userID)
	if err != nil {
		return nil, err
	}
	if err := CanSuspend(status); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE doctor_profiles SET verification='suspended', is_published=false, is_online=false, presence='offline', updated_at=now() WHERE user_id=$1`, userID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE doctors SET is_available=false, is_online=false WHERE user_id=$1`, userID); err != nil {
		return nil, err
	}
	auditID, err := audit(ctx, tx, userID, ActionSuspend, profileID, actor, map[string]any{"reason": reason, "previous_status": status})
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &StatusChange{UserID: userID, Status: StatusSuspended, AuditID: auditID}, nil
}

// Reinstate restores an approved, published profile. Availability is left off:
// the clinician turns themselves back on.
func (r *Repo) Reinstate(ctx context.Context, userID, actor, reason string, now time.Time) (*StatusChange, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	profileID, status, err := lock(ctx, tx, userID)
	if err != nil {
		return nil, err
	}
	var hasApproval bool
	var expiry *time.Time
	err = tx.QueryRow(ctx, `
		SELECT true, licence_expiry FROM (`+latestApproval+`) a WHERE a.user_id = $1`, userID).Scan(&hasApproval, &expiry)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if err := CanReinstate(status, hasApproval, expiry, now); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE doctor_profiles SET verification='approved', is_published=true, updated_at=now() WHERE user_id=$1`, userID); err != nil {
		return nil, err
	}
	auditID, err := audit(ctx, tx, userID, ActionReinstate, profileID, actor, map[string]any{"reason": reason, "previous_status": status})
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &StatusChange{UserID: userID, Status: StatusApproved, AuditID: auditID}, nil
}

type AuditFilter struct {
	Action, UserID string
	From, To       *time.Time
}

func (r *Repo) Audit(ctx context.Context, f AuditFilter, limit, offset int) (*Page[AuditEvent], error) {
	const where = `
		WHERE ($1 = '' OR au.action = $1)
		  AND ($2 = '' OR au.user_id::text = $2)
		  AND ($3::timestamptz IS NULL OR au.created_at >= $3)
		  AND ($4::timestamptz IS NULL OR au.created_at < $4)`
	out := &Page[AuditEvent]{Items: []AuditEvent{}}
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM doctor_compliance_audit au`+where, f.Action, f.UserID, f.From, f.To).Scan(&out.Total); err != nil {
		return nil, fmt.Errorf("compliance: count audit: %w", err)
	}
	rows, err := r.db.Query(ctx, `
		SELECT au.id::text, au.user_id::text, p.name, au.action, au.entity_type, au.entity_id, au.detail, au.created_at
		FROM doctor_compliance_audit au
		LEFT JOIN doctor_profiles p ON p.user_id = au.user_id`+where+`
		ORDER BY au.created_at DESC LIMIT $5 OFFSET $6`, f.Action, f.UserID, f.From, f.To, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("compliance: list audit: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var it AuditEvent
		if err := rows.Scan(&it.ID, &it.UserID, &it.UserName, &it.Action, &it.EntityType, &it.EntityID, &it.Detail, &it.CreatedAt); err != nil {
			return nil, fmt.Errorf("compliance: scan audit: %w", err)
		}
		out.Items = append(out.Items, it)
	}
	return out, rows.Err()
}

func (r *Repo) Training(ctx context.Context, status string, limit, offset int) (*Page[TrainingRow], error) {
	const where = `
		WHERE ($1 = '' OR ($1 = 'completed' AND t.status = 'completed') OR ($1 = 'pending' AND t.status <> 'completed'))`
	out := &Page[TrainingRow]{Items: []TrainingRow{}}
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM doctor_mandatory_training t`+where, status).Scan(&out.Total); err != nil {
		return nil, fmt.Errorf("compliance: count training: %w", err)
	}
	rows, err := r.db.Query(ctx, `
		SELECT t.id::text, t.user_id::text, p.name, t.module_id, t.title, t.status, t.completed_at,
		       GREATEST((CURRENT_DATE - t.created_at::date), 0)
		FROM doctor_mandatory_training t
		LEFT JOIN doctor_profiles p ON p.user_id = t.user_id`+where+`
		ORDER BY (t.status = 'completed'), t.created_at ASC LIMIT $2 OFFSET $3`, status, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("compliance: list training: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var it TrainingRow
		if err := rows.Scan(&it.ID, &it.UserID, &it.UserName, &it.ModuleID, &it.Title, &it.Status, &it.CompletedAt, &it.AgeDays); err != nil {
			return nil, fmt.Errorf("compliance: scan training: %w", err)
		}
		out.Items = append(out.Items, it)
	}
	return out, rows.Err()
}

func (r *Repo) Quality(ctx context.Context, limit, offset int) (*Page[QualityRow], error) {
	const latest = `SELECT DISTINCT ON (user_id) user_id, score, period_label, updated_at FROM doctor_quality_scores ORDER BY user_id, created_at DESC`
	out := &Page[QualityRow]{Items: []QualityRow{}}
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM (`+latest+`) q`).Scan(&out.Total); err != nil {
		return nil, fmt.Errorf("compliance: count quality: %w", err)
	}
	rows, err := r.db.Query(ctx, `
		SELECT q.user_id::text, p.name, q.score::float8, q.period_label, q.updated_at
		FROM (`+latest+`) q LEFT JOIN doctor_profiles p ON p.user_id = q.user_id
		ORDER BY q.score ASC, q.updated_at DESC LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("compliance: list quality: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var it QualityRow
		if err := rows.Scan(&it.UserID, &it.UserName, &it.Score, &it.PeriodLabel, &it.UpdatedAt); err != nil {
			return nil, fmt.Errorf("compliance: scan quality: %w", err)
		}
		out.Items = append(out.Items, it)
	}
	return out, rows.Err()
}

// RecordAccess is read-only and never returns the raw patient id or the detail
// payload — only a masked reference — to keep PHI out of the admin console.
func (r *Repo) RecordAccess(ctx context.Context, userID, action string, limit, offset int) (*Page[RecordAccessRow], error) {
	const where = ` WHERE ($1 = '' OR l.user_id::text = $1) AND ($2 = '' OR l.action = $2)`
	out := &Page[RecordAccessRow]{Items: []RecordAccessRow{}}
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM doctor_record_access_log l`+where, userID, action).Scan(&out.Total); err != nil {
		return nil, fmt.Errorf("compliance: count record access: %w", err)
	}
	rows, err := r.db.Query(ctx, `
		SELECT l.id::text, l.user_id::text, p.name,
		       CASE WHEN l.patient_id IS NULL OR l.patient_id = '' THEN NULL ELSE left(l.patient_id, 8) || '...' END,
		       l.action, l.created_at
		FROM doctor_record_access_log l LEFT JOIN doctor_profiles p ON p.user_id = l.user_id`+where+`
		ORDER BY l.created_at DESC LIMIT $3 OFFSET $4`, userID, action, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("compliance: list record access: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var it RecordAccessRow
		if err := rows.Scan(&it.ID, &it.UserID, &it.UserName, &it.PatientRef, &it.Action, &it.CreatedAt); err != nil {
			return nil, fmt.Errorf("compliance: scan record access: %w", err)
		}
		out.Items = append(out.Items, it)
	}
	return out, rows.Err()
}

func (r *Repo) DocAccess(ctx context.Context, limit, offset int) (*Page[DocAccessRow], error) {
	out := &Page[DocAccessRow]{Items: []DocAccessRow{}}
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM doctor_verification_doc_access_log`).Scan(&out.Total); err != nil {
		return nil, fmt.Errorf("compliance: count doc access: %w", err)
	}
	rows, err := r.db.Query(ctx, `
		SELECT id::text, doc_id::text, accessor_id::text, basis, accessed_at
		FROM doctor_verification_doc_access_log ORDER BY accessed_at DESC LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("compliance: list doc access: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var it DocAccessRow
		if err := rows.Scan(&it.ID, &it.DocID, &it.AccessorID, &it.Basis, &it.AccessedAt); err != nil {
			return nil, fmt.Errorf("compliance: scan doc access: %w", err)
		}
		out.Items = append(out.Items, it)
	}
	return out, rows.Err()
}
