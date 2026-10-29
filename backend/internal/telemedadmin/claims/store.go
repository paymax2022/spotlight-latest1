package claims

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

var (
	// ErrNotFound is returned for an unknown (or malformed) record id.
	ErrNotFound = errors.New("claims: not found")
	// ErrInvalid marks a rejected input.
	ErrInvalid = errors.New("claims: invalid input")
)

// dbx is the slice of *pgxpool.Pool the store needs.
type dbx interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Begin(ctx context.Context) (pgx.Tx, error)
}

type store struct{ db dbx }

// doctorJoin resolves the owning doctor's display name from the row's user_id.
const doctorJoin = `LEFT JOIN LATERAL (
		SELECT id::text AS id, name FROM doctors WHERE user_id = %s.user_id ORDER BY created_at LIMIT 1
	) d ON true`

func join(alias string) string { return fmt.Sprintf(doctorJoin, alias) }

const (
	entityClaim   = "doctor_hmo_claim"
	entityWarning = "doctor_hmo_fraud_warning"

	actionClaimReview = "admin.hmo_claim.reviewed"
	actionWarningAck  = "admin.hmo_fraud_warning.acknowledged"

	likeEscape = ` ESCAPE '\'`
)

func validID(id string) bool { return uuidRe.MatchString(id) }

func searchPattern(q string) string {
	if q == "" {
		return ""
	}
	return likePattern(q)
}

// ───────────────────────── claims ─────────────────────────

const claimCols = `c.id::text, c.ref, d.id, c.user_id::text, COALESCE(d.name, 'Unknown clinician'),
	c.patient_id, c.appointment_id::text, c.status, c.amount_kobo, c.created_at, c.updated_at`

func scanClaim(r pgx.Row) (HmoClaim, error) {
	var c HmoClaim
	var pid *string
	err := r.Scan(&c.ID, &c.Ref, &c.DoctorID, &c.DoctorUserID, &c.DoctorName,
		&pid, &c.AppointmentID, &c.Status, &c.AmountKobo, &c.CreatedAt, &c.UpdatedAt)
	c.PatientMasked = maskPatient(pid)
	return c, err
}

func (s *store) listClaims(ctx context.Context, q ListQuery) ([]HmoClaim, int, error) {
	where := `WHERE ($1::text = '' OR c.status = $1)
		AND ($2::text = '' OR c.ref ILIKE $2` + likeEscape + ` OR d.name ILIKE $2` + likeEscape + ` OR c.id::text ILIKE $2` + likeEscape + `)`
	pat := searchPattern(q.Q)
	var total int
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM doctor_hmo_claims c `+join("c")+` `+where, q.Status, pat).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("claims: count: %w", err)
	}
	rows, err := s.db.Query(ctx, `SELECT `+claimCols+` FROM doctor_hmo_claims c `+join("c")+` `+where+
		` ORDER BY c.created_at DESC LIMIT $3 OFFSET $4`, q.Status, pat, q.Limit, q.Offset)
	if err != nil {
		return nil, 0, fmt.Errorf("claims: list: %w", err)
	}
	defer rows.Close()
	out := []HmoClaim{}
	for rows.Next() {
		c, err := scanClaim(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("claims: scan: %w", err)
		}
		out = append(out, c)
	}
	return out, total, rows.Err()
}

func (s *store) getClaim(ctx context.Context, id string) (*HmoClaimDetail, error) {
	if !validID(id) {
		return nil, ErrNotFound
	}
	var det HmoClaimDetail
	var pid *string
	var raw []byte
	err := s.db.QueryRow(ctx, `SELECT `+claimCols+`, c.detail FROM doctor_hmo_claims c `+join("c")+` WHERE c.id = $1`, id).
		Scan(&det.ID, &det.Ref, &det.DoctorID, &det.DoctorUserID, &det.DoctorName,
			&pid, &det.AppointmentID, &det.Status, &det.AmountKobo, &det.CreatedAt, &det.UpdatedAt, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("claims: get: %w", err)
	}
	det.PatientMasked = maskPatient(pid)
	det.Detail = sanitizeDetail(raw)
	if det.Audit, err = s.auditFor(ctx, entityClaim, id); err != nil {
		return nil, err
	}
	return &det, nil
}

func (s *store) auditFor(ctx context.Context, entityType, id string) ([]AuditEntry, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id::text, action, COALESCE(detail->>'admin_id', ''), COALESCE(detail->>'note', ''), created_at
		FROM doctor_compliance_audit
		WHERE entity_type = $1 AND entity_id = $2 AND action LIKE 'admin.%'
		ORDER BY created_at DESC LIMIT 50`, entityType, id)
	if err != nil {
		return nil, fmt.Errorf("claims: audit read: %w", err)
	}
	defer rows.Close()
	out := []AuditEntry{}
	for rows.Next() {
		var a AuditEntry
		if err := rows.Scan(&a.ID, &a.Action, &a.ActorID, &a.Note, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// reviewClaim stamps an admin review note into the claim's detail and appends an
// audit row in the same transaction. The claim's status is deliberately untouched:
// status transitions belong to the HMO and the submitting doctor.
func (s *store) reviewClaim(ctx context.Context, adminID, id, note string) (*HmoClaimDetail, error) {
	note = strings.TrimSpace(note)
	if n := len([]rune(note)); n < 3 || n > 1000 {
		return nil, fmt.Errorf("%w: note must be 3-1000 characters", ErrInvalid)
	}
	if adminID == "" {
		return nil, fmt.Errorf("%w: missing reviewer", ErrInvalid)
	}
	if !validID(id) {
		return nil, ErrNotFound
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("claims: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var ownerID, status string
	if err := tx.QueryRow(ctx, `SELECT user_id::text, status FROM doctor_hmo_claims WHERE id = $1 FOR UPDATE`, id).
		Scan(&ownerID, &status); errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	} else if err != nil {
		return nil, fmt.Errorf("claims: lock: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE doctor_hmo_claims
		SET detail = detail || jsonb_build_object('admin_review',
			jsonb_build_object('note', $2::text, 'reviewer', $3::text,
				'reviewed_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
		    updated_at = now()
		WHERE id = $1`, id, note, adminID); err != nil {
		return nil, fmt.Errorf("claims: stamp review: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO doctor_compliance_audit (user_id, action, entity_type, entity_id, detail)
		VALUES ($1::uuid, $2, $3, $4, jsonb_build_object('admin_id', $5::text, 'note', $6::text, 'status', $7::text))`,
		ownerID, actionClaimReview, entityClaim, id, adminID, note, status); err != nil {
		return nil, fmt.Errorf("claims: audit write: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("claims: commit: %w", err)
	}
	return s.getClaim(ctx, id)
}

// ───────────────────────── pre-auth ─────────────────────────

const preCols = `p.id::text, p.user_id::text, COALESCE(d.name, 'Unknown clinician'), p.patient_id,
	p.appointment_id::text, p.status, (COALESCE(p.auth_code, '') <> ''), p.amount_kobo, p.created_at, p.updated_at`

func (s *store) listPreAuth(ctx context.Context, q ListQuery) ([]PreAuth, int, error) {
	where := `WHERE ($1::text = '' OR p.status = $1)
		AND ($2::text = '' OR d.name ILIKE $2` + likeEscape + ` OR p.id::text ILIKE $2` + likeEscape + `)`
	pat := searchPattern(q.Q)
	var total int
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM doctor_hmo_preauth_requests p `+join("p")+` `+where, q.Status, pat).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("claims: count preauth: %w", err)
	}
	rows, err := s.db.Query(ctx, `SELECT `+preCols+` FROM doctor_hmo_preauth_requests p `+join("p")+` `+where+
		` ORDER BY p.created_at DESC LIMIT $3 OFFSET $4`, q.Status, pat, q.Limit, q.Offset)
	if err != nil {
		return nil, 0, fmt.Errorf("claims: list preauth: %w", err)
	}
	defer rows.Close()
	out := []PreAuth{}
	for rows.Next() {
		var p PreAuth
		var pid *string
		if err := rows.Scan(&p.ID, &p.DoctorUserID, &p.DoctorName, &pid, &p.AppointmentID, &p.Status,
			&p.AuthCodePresent, &p.AmountKobo, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, 0, fmt.Errorf("claims: scan preauth: %w", err)
		}
		p.PatientMasked = maskPatient(pid)
		out = append(out, p)
	}
	return out, total, rows.Err()
}

func (s *store) getPreAuth(ctx context.Context, id string) (*PreAuthDetail, error) {
	if !validID(id) {
		return nil, ErrNotFound
	}
	var p PreAuthDetail
	var pid *string
	var raw []byte
	err := s.db.QueryRow(ctx, `SELECT `+preCols+`, p.detail FROM doctor_hmo_preauth_requests p `+join("p")+` WHERE p.id = $1`, id).
		Scan(&p.ID, &p.DoctorUserID, &p.DoctorName, &pid, &p.AppointmentID, &p.Status,
			&p.AuthCodePresent, &p.AmountKobo, &p.CreatedAt, &p.UpdatedAt, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("claims: get preauth: %w", err)
	}
	p.PatientMasked = maskPatient(pid)
	p.Detail = sanitizeDetail(raw)
	return &p, nil
}

// ───────────────────────── fraud warnings ─────────────────────────

const warnCols = `w.id::text, w.user_id::text, COALESCE(d.name, 'Unknown clinician'), w.severity,
	w.acknowledged, w.acknowledged_at, w.detail, w.created_at`

func scanWarning(r pgx.Row) (FraudWarning, error) {
	var w FraudWarning
	var raw []byte
	if err := r.Scan(&w.ID, &w.DoctorUserID, &w.DoctorName, &w.Severity, &w.Acknowledged, &w.AcknowledgedAt, &raw, &w.CreatedAt); err != nil {
		return w, err
	}
	w.Summary = warningSummary(raw)
	return w, nil
}

func (s *store) listWarnings(ctx context.Context, ack *bool, severity string, limit, offset int) ([]FraudWarning, int, error) {
	where := `WHERE ($1::boolean IS NULL OR w.acknowledged = $1) AND ($2::text = '' OR lower(w.severity) = $2)`
	var total int
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM doctor_hmo_fraud_warnings w `+where, ack, severity).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("claims: count warnings: %w", err)
	}
	rows, err := s.db.Query(ctx, `SELECT `+warnCols+` FROM doctor_hmo_fraud_warnings w `+join("w")+` `+where+
		` ORDER BY w.acknowledged, w.created_at DESC LIMIT $3 OFFSET $4`, ack, severity, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("claims: list warnings: %w", err)
	}
	defer rows.Close()
	out := []FraudWarning{}
	for rows.Next() {
		w, err := scanWarning(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("claims: scan warning: %w", err)
		}
		out = append(out, w)
	}
	return out, total, rows.Err()
}

func (s *store) getWarning(ctx context.Context, id string) (*FraudWarning, error) {
	if !validID(id) {
		return nil, ErrNotFound
	}
	w, err := scanWarning(s.db.QueryRow(ctx, `SELECT `+warnCols+` FROM doctor_hmo_fraud_warnings w `+join("w")+` WHERE w.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("claims: get warning: %w", err)
	}
	return &w, nil
}

// acknowledgeWarning is idempotent: a warning already acknowledged is returned
// as-is with no second audit row.
func (s *store) acknowledgeWarning(ctx context.Context, adminID, id string) (*FraudWarning, error) {
	if adminID == "" {
		return nil, fmt.Errorf("%w: missing reviewer", ErrInvalid)
	}
	if !validID(id) {
		return nil, ErrNotFound
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("claims: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var ownerID, severity string
	var acked bool
	if err := tx.QueryRow(ctx, `SELECT user_id::text, severity, acknowledged FROM doctor_hmo_fraud_warnings WHERE id = $1 FOR UPDATE`, id).
		Scan(&ownerID, &severity, &acked); errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	} else if err != nil {
		return nil, fmt.Errorf("claims: lock warning: %w", err)
	}
	if !acked {
		if _, err := tx.Exec(ctx, `UPDATE doctor_hmo_fraud_warnings SET acknowledged = true, acknowledged_at = now() WHERE id = $1`, id); err != nil {
			return nil, fmt.Errorf("claims: acknowledge: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO doctor_compliance_audit (user_id, action, entity_type, entity_id, detail)
			VALUES ($1::uuid, $2, $3, $4, jsonb_build_object('admin_id', $5::text, 'severity', $6::text))`,
			ownerID, actionWarningAck, entityWarning, id, adminID, severity); err != nil {
			return nil, fmt.Errorf("claims: audit write: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("claims: commit: %w", err)
	}
	return s.getWarning(ctx, id)
}

// ───────────────────────── summaries ─────────────────────────

func (s *store) groupCounts(ctx context.Context, sql string) (map[string]int, int, error) {
	rows, err := s.db.Query(ctx, sql)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	m, total := map[string]int{}, 0
	for rows.Next() {
		var st string
		var n int
		if err := rows.Scan(&st, &n); err != nil {
			return nil, 0, err
		}
		m[st] = n
		total += n
	}
	return m, total, rows.Err()
}

func (s *store) claimsSummary(ctx context.Context) (*ClaimsSummary, error) {
	var out ClaimsSummary
	var err error
	if out.ClaimsByStatus, out.ClaimsTotal, err = s.groupCounts(ctx, `SELECT status, COUNT(*)::int FROM doctor_hmo_claims GROUP BY status`); err != nil {
		return nil, fmt.Errorf("claims: summary claims: %w", err)
	}
	if err = s.db.QueryRow(ctx, `SELECT COALESCE(SUM(amount_kobo), 0)::bigint FROM doctor_hmo_claims`).Scan(&out.ClaimsAmountKobo); err != nil {
		return nil, fmt.Errorf("claims: summary amount: %w", err)
	}
	if out.PreauthByStatus, out.PreauthTotal, err = s.groupCounts(ctx, `SELECT status, COUNT(*)::int FROM doctor_hmo_preauth_requests GROUP BY status`); err != nil {
		return nil, fmt.Errorf("claims: summary preauth: %w", err)
	}
	if err = s.db.QueryRow(ctx, `
		SELECT COUNT(*) FILTER (WHERE NOT acknowledged)::int,
		       COUNT(*) FILTER (WHERE NOT acknowledged AND lower(severity) IN ('high', 'critical'))::int
		FROM doctor_hmo_fraud_warnings`).Scan(&out.FraudWarningsOpen, &out.FraudWarningsHighOpen); err != nil {
		return nil, fmt.Errorf("claims: summary warnings: %w", err)
	}
	return &out, nil
}
