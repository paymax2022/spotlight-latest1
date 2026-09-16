package onboarding

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when a requested row does not exist.
var ErrNotFound = errors.New("onboarding: not found")

// Repository provides parameterised pgx access to onboarding tables.
type Repository struct{ db *pgxpool.Pool }

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// ─── Modules ─────────────────────────────────────────────────────────────────

func (r *Repository) ListOpenModules(ctx context.Context) ([]Module, error) {
	const q = `
		SELECT m.id, m.slug, m.name, COALESCE(m.description,''), COALESCE(m.icon,''),
		       COALESCE(m.icon_color,''), COALESCE(m.bg_color,''), m.status,
		       (SELECT COUNT(*) FROM onb_merchant_type t WHERE t.module_id = m.id AND t.status = 'open')
		FROM onb_module m
		WHERE m.status = 'open'
		ORDER BY m.sort_order, m.name`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Module
	for rows.Next() {
		var m Module
		if err := rows.Scan(&m.ID, &m.Slug, &m.Name, &m.Description, &m.Icon,
			&m.IconColor, &m.BgColor, &m.Status, &m.TypeCount); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (r *Repository) GetModule(ctx context.Context, id string) (*Module, error) {
	const q = `
		SELECT id, slug, name, COALESCE(description,''), COALESCE(icon,''),
		       COALESCE(icon_color,''), COALESCE(bg_color,''), status
		FROM onb_module WHERE id = $1`
	var m Module
	err := r.db.QueryRow(ctx, q, id).Scan(&m.ID, &m.Slug, &m.Name, &m.Description,
		&m.Icon, &m.IconColor, &m.BgColor, &m.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &m, err
}

func (r *Repository) InsertModule(ctx context.Context, req CreateModuleRequest) error {
	status := req.Status
	if status == "" {
		status = "closed"
	}
	const q = `
		INSERT INTO onb_module (id, slug, name, description, icon, icon_color, bg_color, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`
	_, err := r.db.Exec(ctx, q, req.ID, req.Slug, req.Name, req.Description,
		req.Icon, req.IconColor, req.BgColor, status)
	return err
}

// ─── Merchant types ──────────────────────────────────────────────────────────

func (r *Repository) ListMerchantTypes(ctx context.Context, moduleID string) ([]MerchantType, error) {
	const q = `
		SELECT t.id, t.module_id, m.name, t.slug, t.name, COALESCE(t.description,''),
		       COALESCE(t.icon,''), t.requirements_summary, COALESCE(t.expected_review_label,''),
		       t.required_kyc_tier, t.role_to_grant, COALESCE(t.current_form_schema_id,''), t.status,
		       COALESCE(t.requires_business,true)
		FROM onb_merchant_type t
		JOIN onb_module m ON m.id = t.module_id
		WHERE t.module_id = $1 AND t.status = 'open'
		ORDER BY t.name`
	rows, err := r.db.Query(ctx, q, moduleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanMerchantTypes(rows)
}

// GetModuleStatus returns the parent module's status for the given module id.
func (r *Repository) GetModuleStatus(ctx context.Context, moduleID string) (string, error) {
	var status string
	err := r.db.QueryRow(ctx, `SELECT status FROM onb_module WHERE id = $1`, moduleID).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return status, err
}

func (r *Repository) GetMerchantType(ctx context.Context, id string) (*MerchantType, error) {
	const q = `
		SELECT t.id, t.module_id, m.name, t.slug, t.name, COALESCE(t.description,''),
		       COALESCE(t.icon,''), t.requirements_summary, COALESCE(t.expected_review_label,''),
		       t.required_kyc_tier, t.role_to_grant, COALESCE(t.current_form_schema_id,''), t.status,
		       COALESCE(t.requires_business,true)
		FROM onb_merchant_type t
		JOIN onb_module m ON m.id = t.module_id
		WHERE t.id = $1`
	rows, err := r.db.Query(ctx, q, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list, err := scanMerchantTypes(rows)
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, ErrNotFound
	}
	return &list[0], nil
}

func scanMerchantTypes(rows pgx.Rows) ([]MerchantType, error) {
	var out []MerchantType
	for rows.Next() {
		var t MerchantType
		var reqs []byte
		if err := rows.Scan(&t.ID, &t.ModuleID, &t.ModuleName, &t.Slug, &t.Name,
			&t.Description, &t.Icon, &reqs, &t.ExpectedReviewLabel, &t.RequiredKycTier,
			&t.RoleToGrant, &t.CurrentFormSchemaID, &t.Status, &t.RequiresBusiness); err != nil {
			return nil, err
		}
		t.RequirementsSummary = []string{}
		if len(reqs) > 0 {
			_ = json.Unmarshal(reqs, &t.RequirementsSummary)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (r *Repository) InsertMerchantType(ctx context.Context, req CreateMerchantTypeRequest) error {
	status := req.Status
	if status == "" {
		status = "closed"
	}
	reqs, _ := json.Marshal(req.RequirementsSummary)
	if len(reqs) == 0 {
		reqs = []byte("[]")
	}
	const q = `
		INSERT INTO onb_merchant_type (id, module_id, slug, name, description, icon,
			requirements_summary, expected_review_label, required_kyc_tier, role_to_grant, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`
	_, err := r.db.Exec(ctx, q, req.ID, req.ModuleID, req.Slug, req.Name, req.Description,
		req.Icon, reqs, req.ExpectedReviewLabel, req.RequiredKycTier, req.RoleToGrant, status)
	return err
}

// ─── Form schemas ────────────────────────────────────────────────────────────

func (r *Repository) GetFormSchema(ctx context.Context, id string) (*FormSchema, error) {
	const q = `SELECT id, merchant_type_id, version, status, steps FROM onb_form_schema WHERE id = $1`
	return r.scanFormSchema(r.db.QueryRow(ctx, q, id))
}

// GetPublishedSchemaForType returns the merchant type's current published schema.
func (r *Repository) GetPublishedSchemaForType(ctx context.Context, merchantTypeID string) (*FormSchema, error) {
	const q = `
		SELECT id, merchant_type_id, version, status, steps
		FROM onb_form_schema
		WHERE merchant_type_id = $1 AND status = 'published'
		ORDER BY version DESC LIMIT 1`
	return r.scanFormSchema(r.db.QueryRow(ctx, q, merchantTypeID))
}

func (r *Repository) scanFormSchema(row pgx.Row) (*FormSchema, error) {
	var fs FormSchema
	var steps []byte
	err := row.Scan(&fs.ID, &fs.MerchantTypeID, &fs.Version, &fs.Status, &steps)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	fs.Steps = []Step{}
	if len(steps) > 0 {
		_ = json.Unmarshal(steps, &fs.Steps)
	}
	return &fs, nil
}

func (r *Repository) MaxSchemaVersion(ctx context.Context, merchantTypeID string) (int, error) {
	const q = `SELECT COALESCE(MAX(version),0) FROM onb_form_schema WHERE merchant_type_id = $1`
	var v int
	err := r.db.QueryRow(ctx, q, merchantTypeID).Scan(&v)
	return v, err
}

func (r *Repository) InsertFormSchema(ctx context.Context, fs FormSchema) error {
	steps, _ := json.Marshal(fs.Steps)
	const q = `
		INSERT INTO onb_form_schema (id, merchant_type_id, version, status, steps)
		VALUES ($1,$2,$3,$4,$5)`
	if _, err := r.db.Exec(ctx, q, fs.ID, fs.MerchantTypeID, fs.Version, fs.Status, steps); err != nil {
		return err
	}
	if fs.Status == "published" {
		if _, err := r.db.Exec(ctx,
			`UPDATE onb_merchant_type SET current_form_schema_id = $1, updated_at = NOW() WHERE id = $2`,
			fs.ID, fs.MerchantTypeID); err != nil {
			return err
		}
	}
	return nil
}

// ─── Applications ────────────────────────────────────────────────────────────

const appSelect = `
	SELECT a.id, a.user_id, a.merchant_type_id, t.name, t.module_id, m.name,
	       COALESCE(a.form_schema_id,''), COALESCE(a.form_schema_version,0), a.status,
	       a.data, a.checks, COALESCE(a.decision_reason,''), a.info_checklist,
	       a.created_at, a.updated_at, a.submitted_at, a.decided_at
	FROM onb_application a
	JOIN onb_merchant_type t ON t.id = a.merchant_type_id
	JOIN onb_module m ON m.id = t.module_id`

func (r *Repository) scanApplication(row pgx.Row) (*Application, error) {
	var a Application
	var data, checks, checklist []byte
	err := row.Scan(&a.ID, &a.UserID, &a.MerchantTypeID, &a.MerchantTypeName,
		&a.ModuleID, &a.ModuleName, &a.FormSchemaID, &a.FormSchemaVersion, &a.Status,
		&data, &checks, &a.DecisionReason, &checklist,
		&a.CreatedAt, &a.UpdatedAt, &a.SubmittedAt, &a.DecidedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	a.Data = map[string]interface{}{}
	if len(data) > 0 {
		_ = json.Unmarshal(data, &a.Data)
	}
	a.Checks = []Check{}
	if len(checks) > 0 {
		_ = json.Unmarshal(checks, &a.Checks)
	}
	a.InfoChecklist = []string{}
	if len(checklist) > 0 {
		_ = json.Unmarshal(checklist, &a.InfoChecklist)
	}
	return &a, nil
}

func (r *Repository) GetApplication(ctx context.Context, id string) (*Application, error) {
	return r.scanApplication(r.db.QueryRow(ctx, appSelect+` WHERE a.id = $1`, id))
}

// HasActiveApplicationOrProfile reports whether the user already has a non-terminal
// application OR an active/provisioning profile for the merchant type.
func (r *Repository) HasActiveApplicationOrProfile(ctx context.Context, userID, merchantTypeID string) (bool, error) {
	const q = `
		SELECT
		  EXISTS (SELECT 1 FROM onb_application
		          WHERE user_id = $1 AND merchant_type_id = $2
		            AND status IN ('DRAFT','SUBMITTED','UNDER_REVIEW','NEEDS_MORE_INFO'))
		  OR EXISTS (SELECT 1 FROM onb_merchant_profile
		             WHERE user_id = $1 AND merchant_type_id = $2
		               AND status IN ('PROVISIONING','ACTIVE','SUSPENDED','UNDER_REVERIFICATION'))`
	var exists bool
	err := r.db.QueryRow(ctx, q, userID, merchantTypeID).Scan(&exists)
	return exists, err
}

func (r *Repository) InsertApplication(ctx context.Context, userID, merchantTypeID string, data map[string]interface{}) (string, error) {
	raw, _ := json.Marshal(data)
	if len(raw) == 0 {
		raw = []byte("{}")
	}
	const q = `
		INSERT INTO onb_application (user_id, merchant_type_id, status, data)
		VALUES ($1,$2,'DRAFT',$3) RETURNING id`
	var id string
	err := r.db.QueryRow(ctx, q, userID, merchantTypeID, raw).Scan(&id)
	return id, err
}

func (r *Repository) UpdateDraftData(ctx context.Context, id, userID string, data map[string]interface{}) (int64, error) {
	raw, _ := json.Marshal(data)
	if len(raw) == 0 {
		raw = []byte("{}")
	}
	const q = `
		UPDATE onb_application SET data = $1, updated_at = NOW()
		WHERE id = $2 AND user_id = $3 AND status = 'DRAFT'`
	tag, err := r.db.Exec(ctx, q, raw, id, userID)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// SubmitApplication moves DRAFT->SUBMITTED, pinning the schema version. Idempotent
// on the submit key: a retry with the same key on an already-submitted row succeeds.
func (r *Repository) SubmitApplication(ctx context.Context, id, userID, schemaID string, version int, checks []Check, idemKey string) (int64, error) {
	checksJSON, _ := json.Marshal(checks)
	const q = `
		UPDATE onb_application
		SET status = 'SUBMITTED', form_schema_id = $1, form_schema_version = $2,
		    checks = $3, submit_idem_key = $4, submitted_at = NOW(), updated_at = NOW()
		WHERE id = $5 AND user_id = $6
		  AND (status = 'DRAFT'
		       OR (submit_idem_key = $4 AND status IN ('SUBMITTED','UNDER_REVIEW')))`
	tag, err := r.db.Exec(ctx, q, schemaID, version, checksJSON, idemKey, id, userID)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func (r *Repository) ResubmitApplication(ctx context.Context, id, userID string) (int64, error) {
	const q = `
		UPDATE onb_application SET status = 'UNDER_REVIEW', updated_at = NOW()
		WHERE id = $1 AND user_id = $2 AND status = 'NEEDS_MORE_INFO'`
	tag, err := r.db.Exec(ctx, q, id, userID)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// TransitionStatus performs a guarded admin status change; fromStatuses lists the
// states from which the transition is legal. Returns rows affected.
func (r *Repository) TransitionStatus(ctx context.Context, id, toStatus string, fromStatuses []string, reason string, checklist []string, decided bool) (int64, error) {
	checklistJSON, _ := json.Marshal(checklist)
	if len(checklist) == 0 {
		checklistJSON = []byte("[]")
	}
	const q = `
		UPDATE onb_application
		SET status = $1,
		    decision_reason = CASE WHEN $2 <> '' THEN $2 ELSE decision_reason END,
		    info_checklist = $3,
		    decided_at = CASE WHEN $4 THEN NOW() ELSE decided_at END,
		    updated_at = NOW()
		WHERE id = $5 AND status = ANY($6)`
	tag, err := r.db.Exec(ctx, q, toStatus, reason, checklistJSON, decided, id, fromStatuses)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// ReviewQueue lists applications in reviewable states with optional filters.
func (r *Repository) ReviewQueue(ctx context.Context, moduleID, typeID, status string, maxAgeHours int) ([]Application, error) {
	q := appSelect + ` WHERE a.status IN ('SUBMITTED','UNDER_REVIEW','NEEDS_MORE_INFO')`
	args := []any{}
	i := 1
	if moduleID != "" {
		q += " AND t.module_id = $" + strconv.Itoa(i)
		args = append(args, moduleID)
		i++
	}
	if typeID != "" {
		q += " AND a.merchant_type_id = $" + strconv.Itoa(i)
		args = append(args, typeID)
		i++
	}
	if status != "" {
		q += " AND a.status = $" + strconv.Itoa(i)
		args = append(args, status)
		i++
	}
	if maxAgeHours > 0 {
		q += " AND a.submitted_at >= $" + strconv.Itoa(i)
		args = append(args, time.Now().Add(-time.Duration(maxAgeHours)*time.Hour))
		i++
	}
	q += " ORDER BY a.submitted_at ASC NULLS LAST, a.created_at ASC LIMIT 200"
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Application
	for rows.Next() {
		a, err := r.scanApplication(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// ─── Merchant profiles ───────────────────────────────────────────────────────

func (r *Repository) ListMerchantProfiles(ctx context.Context, userID string) ([]MerchantProfile, error) {
	const q = `
		SELECT p.id, p.user_id, p.module_id, m.name, p.merchant_type_id, t.name,
		       COALESCE(t.icon,''), p.role_granted, p.status, p.activated_at, COALESCE(p.workspace_route,'')
		FROM onb_merchant_profile p
		JOIN onb_module m ON m.id = p.module_id
		JOIN onb_merchant_type t ON t.id = p.merchant_type_id
		WHERE p.user_id = $1
		ORDER BY p.created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MerchantProfile
	for rows.Next() {
		var p MerchantProfile
		if err := rows.Scan(&p.ID, &p.UserID, &p.ModuleID, &p.ModuleName,
			&p.MerchantTypeID, &p.MerchantTypeName, &p.Icon, &p.RoleGranted,
			&p.Status, &p.ActivatedAt, &p.WorkspaceRoute); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *Repository) ListActiveApplications(ctx context.Context, userID string) ([]Application, error) {
	q := appSelect + `
		WHERE a.user_id = $1
		  AND a.status IN ('DRAFT','SUBMITTED','UNDER_REVIEW','NEEDS_MORE_INFO')
		ORDER BY a.updated_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Application
	for rows.Next() {
		a, err := r.scanApplication(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}
