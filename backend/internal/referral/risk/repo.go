package risk

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the parameterized data layer for the risk tables. It also reads
// RB0's referral_attributions / referral_reward_ledger and finance KYC hashes for
// dedup, all via parameterized queries.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// --- rules ---

const ruleCols = `id, code, name, rule_type, enabled, action, params, severity, created_at, updated_at`

func scanRule(row pgx.Row) (*Rule, error) {
	var (
		r   Rule
		raw []byte
	)
	if err := row.Scan(&r.ID, &r.Code, &r.Name, &r.RuleType, &r.Enabled,
		&r.Action, &raw, &r.Severity, &r.CreatedAt, &r.UpdatedAt); err != nil {
		return nil, err
	}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &r.Params)
	}
	return &r, nil
}

// ListRules returns all configured rules.
func (r *Repository) ListRules(ctx context.Context) ([]Rule, error) {
	rows, err := r.db.Query(ctx, `SELECT `+ruleCols+` FROM referral_risk_rules ORDER BY rule_type, code`)
	if err != nil {
		return nil, fmt.Errorf("risk: list rules: %w", err)
	}
	defer rows.Close()
	var out []Rule
	for rows.Next() {
		rule, err := scanRule(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *rule)
	}
	return out, rows.Err()
}

// EnabledRules returns only enabled rules (evaluation path).
func (r *Repository) EnabledRules(ctx context.Context) ([]Rule, error) {
	rows, err := r.db.Query(ctx, `SELECT `+ruleCols+` FROM referral_risk_rules WHERE enabled = true ORDER BY rule_type`)
	if err != nil {
		return nil, fmt.Errorf("risk: enabled rules: %w", err)
	}
	defer rows.Close()
	var out []Rule
	for rows.Next() {
		rule, err := scanRule(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *rule)
	}
	return out, rows.Err()
}

// UpsertRule creates or updates a rule keyed by code.
func (r *Repository) UpsertRule(ctx context.Context, in RuleInput) (*Rule, error) {
	params := in.Params
	if params == nil {
		params = map[string]any{}
	}
	raw, err := json.Marshal(params)
	if err != nil {
		return nil, fmt.Errorf("risk: marshal params: %w", err)
	}
	enabled := true
	if in.Enabled != nil {
		enabled = *in.Enabled
	}
	action := in.Action
	if action == "" {
		action = ActionReview
	}
	severity := in.Severity
	if severity == "" {
		severity = "medium"
	}
	const q = `
		INSERT INTO referral_risk_rules (code, name, rule_type, enabled, action, params, severity)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (code) DO UPDATE SET
			name = EXCLUDED.name,
			rule_type = EXCLUDED.rule_type,
			enabled = EXCLUDED.enabled,
			action = EXCLUDED.action,
			params = EXCLUDED.params,
			severity = EXCLUDED.severity,
			updated_at = now()
		RETURNING ` + ruleCols
	return scanRule(r.db.QueryRow(ctx, q, in.Code, in.Name, in.RuleType, enabled, action, raw, severity))
}

// SetRuleEnabled toggles a rule by id.
func (r *Repository) SetRuleEnabled(ctx context.Context, id string, enabled bool) error {
	tag, err := r.db.Exec(ctx,
		`UPDATE referral_risk_rules SET enabled = $2, updated_at = now() WHERE id = $1`, id, enabled)
	if err != nil {
		return fmt.Errorf("risk: set rule enabled: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("risk: rule not found")
	}
	return nil
}

// --- alerts ---

const alertCols = `id, subject_id, rule_code, reason_code, severity, reward_id,
	attribution_id, identity_hash, device_hash, window_count, status, case_id, created_at`

func scanAlert(row pgx.Row) (*Alert, error) {
	var (
		a                                        Alert
		subj, reward, attrib, ident, dev, caseID *string
	)
	if err := row.Scan(&a.ID, &subj, &a.RuleCode, &a.ReasonCode, &a.Severity,
		&reward, &attrib, &ident, &dev, &a.WindowCount, &a.Status, &caseID, &a.CreatedAt); err != nil {
		return nil, err
	}
	deref(&a.SubjectID, subj)
	deref(&a.RewardID, reward)
	deref(&a.AttributionID, attrib)
	deref(&a.IdentityHash, ident)
	deref(&a.DeviceHash, dev)
	deref(&a.CaseID, caseID)
	return &a, nil
}

func deref(dst *string, src *string) {
	if src != nil {
		*dst = *src
	}
}

// InsertAlert appends a fraud alert (idempotent is not required — append-only).
func (r *Repository) InsertAlert(ctx context.Context, a Alert) (*Alert, error) {
	const q = `
		INSERT INTO referral_risk_alerts
			(subject_id, rule_code, reason_code, severity, reward_id, attribution_id,
			 identity_hash, device_hash, window_count, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open')
		RETURNING ` + alertCols
	return scanAlert(r.db.QueryRow(ctx, q,
		nullable(a.SubjectID), a.RuleCode, a.ReasonCode, a.Severity,
		nullable(a.RewardID), nullable(a.AttributionID),
		nullable(a.IdentityHash), nullable(a.DeviceHash), a.WindowCount))
}

// ListAlerts lists alerts, optional status filter.
func (r *Repository) ListAlerts(ctx context.Context, status string, limit int) ([]Alert, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	q := `SELECT ` + alertCols + ` FROM referral_risk_alerts`
	var args []any
	if status != "" {
		q += ` WHERE status = $1`
		args = append(args, status)
		q += ` ORDER BY created_at DESC LIMIT $2`
		args = append(args, limit)
	} else {
		q += ` ORDER BY created_at DESC LIMIT $1`
		args = append(args, limit)
	}
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("risk: list alerts: %w", err)
	}
	defer rows.Close()
	var out []Alert
	for rows.Next() {
		a, err := scanAlert(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// AlertsBySubject returns a user's own alerts (for fraud-status; PII-free).
func (r *Repository) AlertsBySubject(ctx context.Context, subjectID string) ([]Alert, error) {
	rows, err := r.db.Query(ctx,
		`SELECT `+alertCols+` FROM referral_risk_alerts WHERE subject_id = $1 ORDER BY created_at DESC LIMIT 200`, subjectID)
	if err != nil {
		return nil, fmt.Errorf("risk: alerts by subject: %w", err)
	}
	defer rows.Close()
	var out []Alert
	for rows.Next() {
		a, err := scanAlert(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// SetAlertStatus updates an alert's status (and optional case link).
func (r *Repository) SetAlertStatus(ctx context.Context, id, status, caseID string) error {
	const q = `UPDATE referral_risk_alerts SET status = $2, case_id = COALESCE($3::uuid, case_id) WHERE id = $1`
	tag, err := r.db.Exec(ctx, q, id, status, nullable(caseID))
	if err != nil {
		return fmt.Errorf("risk: set alert status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("risk: alert not found")
	}
	return nil
}

// --- cases ---

const caseCols = `id, subject_id, status, reason_codes, resolution, opened_by, resolved_by, notes, created_at, updated_at, resolved_at`

func scanCase(row pgx.Row) (*Case, error) {
	var (
		c                            Case
		subj, res, openBy, resBy, nt *string
	)
	if err := row.Scan(&c.ID, &subj, &c.Status, &c.ReasonCodes, &res,
		&openBy, &resBy, &nt, &c.CreatedAt, &c.UpdatedAt, &c.ResolvedAt); err != nil {
		return nil, err
	}
	deref(&c.SubjectID, subj)
	deref(&c.Resolution, res)
	deref(&c.OpenedBy, openBy)
	deref(&c.ResolvedBy, resBy)
	deref(&c.Notes, nt)
	return &c, nil
}

// OpenCase creates an investigation case.
func (r *Repository) OpenCase(ctx context.Context, subjectID string, reasonCodes []string, openedBy, notes string) (*Case, error) {
	if reasonCodes == nil {
		reasonCodes = []string{}
	}
	const q = `
		INSERT INTO referral_cases (subject_id, status, reason_codes, opened_by, notes)
		VALUES ($1,'open',$2,$3,$4)
		RETURNING ` + caseCols
	return scanCase(r.db.QueryRow(ctx, q, nullable(subjectID), reasonCodes, nullable(openedBy), nullable(notes)))
}

// ListCases lists cases, optional status filter.
func (r *Repository) ListCases(ctx context.Context, status string, limit int) ([]Case, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	q := `SELECT ` + caseCols + ` FROM referral_cases`
	var args []any
	if status != "" {
		q += ` WHERE status = $1 ORDER BY created_at DESC LIMIT $2`
		args = append(args, status, limit)
	} else {
		q += ` ORDER BY created_at DESC LIMIT $1`
		args = append(args, limit)
	}
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("risk: list cases: %w", err)
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

// GetCase returns one case by id.
func (r *Repository) GetCase(ctx context.Context, id string) (*Case, error) {
	c, err := scanCase(r.db.QueryRow(ctx, `SELECT `+caseCols+` FROM referral_cases WHERE id = $1`, id))
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("risk: get case: %w", err)
	}
	return c, nil
}

// UpdateCaseStatus advances a case's status; resolution/resolved_by/resolved_at
// are set when moving to resolved.
func (r *Repository) UpdateCaseStatus(ctx context.Context, id, status, resolution, resolvedBy string) error {
	const q = `
		UPDATE referral_cases
		SET status = $2,
		    resolution = COALESCE(NULLIF($3,''), resolution),
		    resolved_by = CASE WHEN $2 = 'resolved' THEN $4::uuid ELSE resolved_by END,
		    resolved_at = CASE WHEN $2 = 'resolved' THEN now() ELSE resolved_at END,
		    updated_at = now()
		WHERE id = $1`
	tag, err := r.db.Exec(ctx, q, id, status, resolution, nullable(resolvedBy))
	if err != nil {
		return fmt.Errorf("risk: update case status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("risk: case not found")
	}
	return nil
}

// CaseAlerts returns alerts linked to a case (workbench).
func (r *Repository) CaseAlerts(ctx context.Context, caseID string) ([]Alert, error) {
	rows, err := r.db.Query(ctx,
		`SELECT `+alertCols+` FROM referral_risk_alerts WHERE case_id = $1 ORDER BY created_at DESC`, caseID)
	if err != nil {
		return nil, fmt.Errorf("risk: case alerts: %w", err)
	}
	defer rows.Close()
	var out []Alert
	for rows.Next() {
		a, err := scanAlert(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// --- blocklist ---

const blCols = `id, list_type, entry_type, entry_value, reason, added_by, active, created_at`

func scanBlocklist(row pgx.Row) (*BlocklistEntry, error) {
	var (
		b             BlocklistEntry
		reason, addBy *string
	)
	if err := row.Scan(&b.ID, &b.ListType, &b.EntryType, &b.EntryValue, &reason, &addBy, &b.Active, &b.CreatedAt); err != nil {
		return nil, err
	}
	deref(&b.Reason, reason)
	deref(&b.AddedBy, addBy)
	return &b, nil
}

// AddBlocklist inserts (or reactivates) a block/allow entry.
func (r *Repository) AddBlocklist(ctx context.Context, in BlocklistInput, addedBy string) (*BlocklistEntry, error) {
	listType := in.ListType
	if listType == "" {
		listType = "block"
	}
	const q = `
		INSERT INTO referral_blocklist (list_type, entry_type, entry_value, reason, added_by, active)
		VALUES ($1,$2,$3,$4,$5,true)
		ON CONFLICT (list_type, entry_type, entry_value) DO UPDATE SET
			reason = EXCLUDED.reason,
			added_by = EXCLUDED.added_by,
			active = true
		RETURNING ` + blCols
	return scanBlocklist(r.db.QueryRow(ctx, q, listType, in.EntryType, in.EntryValue, nullable(in.Reason), nullable(addedBy)))
}

// DeactivateBlocklist soft-removes an entry (active=false). Additive-only model.
func (r *Repository) DeactivateBlocklist(ctx context.Context, id string) error {
	tag, err := r.db.Exec(ctx, `UPDATE referral_blocklist SET active = false WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("risk: deactivate blocklist: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("risk: blocklist entry not found")
	}
	return nil
}

// ListBlocklist lists entries, optional list_type filter.
func (r *Repository) ListBlocklist(ctx context.Context, listType string) ([]BlocklistEntry, error) {
	q := `SELECT ` + blCols + ` FROM referral_blocklist`
	var args []any
	if listType != "" {
		q += ` WHERE list_type = $1`
		args = append(args, listType)
	}
	q += ` ORDER BY created_at DESC LIMIT 1000`
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("risk: list blocklist: %w", err)
	}
	defer rows.Close()
	var out []BlocklistEntry
	for rows.Next() {
		b, err := scanBlocklist(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *b)
	}
	return out, rows.Err()
}

// IsListed reports whether an (entry_type, entry_value) is on an active list of
// the given list_type. Used to fail closed on blocked identities/devices.
func (r *Repository) IsListed(ctx context.Context, listType, entryType, entryValue string) (bool, error) {
	if entryValue == "" {
		return false, nil
	}
	const q = `SELECT EXISTS (
		SELECT 1 FROM referral_blocklist
		WHERE list_type = $1 AND entry_type = $2 AND entry_value = $3 AND active = true)`
	var exists bool
	if err := r.db.QueryRow(ctx, q, listType, entryType, entryValue).Scan(&exists); err != nil {
		return false, fmt.Errorf("risk: is listed: %w", err)
	}
	return exists, nil
}

// --- review queue ---

const rqCols = `id, reward_id, subject_id, alert_id, reason_code, status, decided_by, decided_at, created_at`

func scanReview(row pgx.Row) (*ReviewItem, error) {
	var (
		it                       ReviewItem
		reward, subj, alert, dby *string
	)
	if err := row.Scan(&it.ID, &reward, &subj, &alert, &it.ReasonCode, &it.Status, &dby, &it.DecidedAt, &it.CreatedAt); err != nil {
		return nil, err
	}
	deref(&it.RewardID, reward)
	deref(&it.SubjectID, subj)
	deref(&it.AlertID, alert)
	deref(&it.DecidedBy, dby)
	return &it, nil
}

// Enqueue holds a reward in the review queue (the RB0 ledger row stays pending).
func (r *Repository) Enqueue(ctx context.Context, rewardID, subjectID, alertID, reasonCode string) (*ReviewItem, error) {
	const q = `
		INSERT INTO referral_review_queue (reward_id, subject_id, alert_id, reason_code, status)
		VALUES ($1,$2,$3,$4,'queued')
		RETURNING ` + rqCols
	return scanReview(r.db.QueryRow(ctx, q, nullable(rewardID), nullable(subjectID), nullable(alertID), reasonCode))
}

// ListReviewQueue lists items, optional status filter.
func (r *Repository) ListReviewQueue(ctx context.Context, status string) ([]ReviewItem, error) {
	q := `SELECT ` + rqCols + ` FROM referral_review_queue`
	var args []any
	if status != "" {
		q += ` WHERE status = $1`
		args = append(args, status)
	}
	q += ` ORDER BY created_at DESC LIMIT 500`
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("risk: list review queue: %w", err)
	}
	defer rows.Close()
	var out []ReviewItem
	for rows.Next() {
		it, err := scanReview(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *it)
	}
	return out, rows.Err()
}

// GetReviewItem returns one review item by id.
func (r *Repository) GetReviewItem(ctx context.Context, id string) (*ReviewItem, error) {
	it, err := scanReview(r.db.QueryRow(ctx, `SELECT `+rqCols+` FROM referral_review_queue WHERE id = $1`, id))
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("risk: get review item: %w", err)
	}
	return it, nil
}

// DecideReview records a queue decision (approved/rejected/clawed_back).
func (r *Repository) DecideReview(ctx context.Context, id, status, decidedBy string) error {
	const q = `
		UPDATE referral_review_queue
		SET status = $2, decided_by = $3::uuid, decided_at = now()
		WHERE id = $1 AND status = 'queued'`
	tag, err := r.db.Exec(ctx, q, id, status, nullable(decidedBy))
	if err != nil {
		return fmt.Errorf("risk: decide review: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("risk: review item not found or already decided")
	}
	return nil
}

// HeldRewardCount returns how many queued review items a subject has.
func (r *Repository) HeldRewardCount(ctx context.Context, subjectID string) (int, error) {
	var n int
	err := r.db.QueryRow(ctx,
		`SELECT count(*) FROM referral_review_queue WHERE subject_id = $1 AND status = 'queued'`, subjectID).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("risk: held reward count: %w", err)
	}
	return n, nil
}

// --- dedup / detection helpers (read RB0 + finance KYC) ---

// IdentityHashOf returns a user's deterministic KYC identity hash derived from
// the finance KYC bvn_hash/nin_hash columns on user_profiles. Empty when no KYC
// identity is on file. Reuses the finance hash — one earning identity per human.
func (r *Repository) IdentityHashOf(ctx context.Context, userID string) (string, error) {
	const q = `SELECT COALESCE(bvn_hash, nin_hash, '') FROM user_profiles WHERE id = $1`
	var h string
	err := r.db.QueryRow(ctx, q, userID).Scan(&h)
	if err == pgx.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("risk: identity hash of: %w", err)
	}
	return h, nil
}

// IdentityDupCount counts how many DISTINCT users share the given KYC identity
// hash, excluding the subject. >0 means another human already earns under this
// identity (one earning identity per human).
func (r *Repository) IdentityDupCount(ctx context.Context, identityHash, excludeUserID string) (int, error) {
	if identityHash == "" {
		return 0, nil
	}
	const q = `
		SELECT count(*) FROM user_profiles
		WHERE (bvn_hash = $1 OR nin_hash = $1) AND id <> $2::uuid`
	var n int
	if err := r.db.QueryRow(ctx, q, identityHash, excludeUserID).Scan(&n); err != nil {
		return 0, fmt.Errorf("risk: identity dup count: %w", err)
	}
	return n, nil
}

// DeviceAccountCount counts DISTINCT subjects that have raised alerts under the
// same device hash (proxy for shared-device account count). Device hashes are the
// only place device fingerprints persist — never the raw fingerprint.
func (r *Repository) DeviceAccountCount(ctx context.Context, deviceHash, excludeUserID string) (int, error) {
	if deviceHash == "" {
		return 0, nil
	}
	const q = `
		SELECT count(DISTINCT subject_id) FROM referral_risk_alerts
		WHERE device_hash = $1 AND subject_id IS NOT NULL AND subject_id <> $2::uuid`
	var n int
	if err := r.db.QueryRow(ctx, q, deviceHash, excludeUserID).Scan(&n); err != nil {
		return 0, fmt.Errorf("risk: device account count: %w", err)
	}
	return n, nil
}

// ReferrerSignupVelocity counts attributions to a referrer within windowHours.
func (r *Repository) ReferrerSignupVelocity(ctx context.Context, referrerID string, windowHours int) (int, error) {
	if referrerID == "" {
		return 0, nil
	}
	if windowHours <= 0 {
		windowHours = 24
	}
	const q = `
		SELECT count(*) FROM referral_attributions
		WHERE referrer_id = $1::uuid
		  AND created_at >= now() - make_interval(hours => $2)`
	var n int
	if err := r.db.QueryRow(ctx, q, referrerID, windowHours).Scan(&n); err != nil {
		return 0, fmt.Errorf("risk: referrer signup velocity: %w", err)
	}
	return n, nil
}

// AttributionRiskFlag returns the RB0 attribution risk_flag for a user (e.g.
// 'self_referral') and whether an attribution row exists.
func (r *Repository) AttributionRiskFlag(ctx context.Context, userID string) (string, bool, error) {
	const q = `SELECT COALESCE(risk_flag, '') FROM referral_attributions WHERE referred_user_id = $1`
	var flag string
	err := r.db.QueryRow(ctx, q, userID).Scan(&flag)
	if err == pgx.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("risk: attribution risk flag: %w", err)
	}
	return flag, true, nil
}

// Dashboard counts (admin risk dashboard).
type DashboardCounts struct {
	OpenAlerts    int `json:"open_alerts"`
	OpenCases     int `json:"open_cases"`
	QueuedReviews int `json:"queued_reviews"`
	ActiveBlocks  int `json:"active_blocks"`
}

// Dashboard returns headline risk counts.
func (r *Repository) Dashboard(ctx context.Context) (*DashboardCounts, error) {
	var d DashboardCounts
	const q = `
		SELECT
			(SELECT count(*) FROM referral_risk_alerts WHERE status = 'open'),
			(SELECT count(*) FROM referral_cases WHERE status IN ('open','investigating')),
			(SELECT count(*) FROM referral_review_queue WHERE status = 'queued'),
			(SELECT count(*) FROM referral_blocklist WHERE list_type = 'block' AND active = true)`
	if err := r.db.QueryRow(ctx, q).Scan(&d.OpenAlerts, &d.OpenCases, &d.QueuedReviews, &d.ActiveBlocks); err != nil {
		return nil, fmt.Errorf("risk: dashboard: %w", err)
	}
	return &d, nil
}

// ReferrerOf returns the user's currently attributed referrer, or "" when they
// have no attribution or are attributed to the house.
//
// Used to resolve the target of a member abuse report: the report is about
// whoever referred the reporter, and the client neither knows nor should send
// that id — letting a client name an arbitrary target would make it trivial to
// open fraud alerts against any account.
func (r *Repository) ReferrerOf(ctx context.Context, userID string) (string, error) {
	var referrer *string
	err := r.db.QueryRow(ctx, `
		SELECT referrer_id::text
		FROM referral_attributions
		WHERE referred_user_id = $1 AND COALESCE(is_house, false) = false
		ORDER BY id DESC
		LIMIT 1`, userID).Scan(&referrer)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("risk: resolve referrer: %w", err)
	}
	if referrer == nil {
		return "", nil
	}
	return *referrer, nil
}
