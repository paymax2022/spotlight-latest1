package compliance

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the parameterized data layer for the compliance tables.
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

func deref(dst *string, src *string) {
	if src != nil {
		*dst = *src
	}
}

// --- disclosures ---

const discCols = `id, slug, version, title, body, jurisdiction, active, effective_at, created_by, created_at`

func scanDisclosure(row pgx.Row) (*Disclosure, error) {
	var (
		d     Disclosure
		creBy *string
	)
	if err := row.Scan(&d.ID, &d.Slug, &d.Version, &d.Title, &d.Body, &d.Jurisdiction,
		&d.Active, &d.EffectiveAt, &creBy, &d.CreatedAt); err != nil {
		return nil, err
	}
	deref(&d.CreatedBy, creBy)
	return &d, nil
}

// PublishDisclosure publishes a new version of a disclosure slug. It deactivates
// prior active versions of the same slug+jurisdiction and inserts version
// max(version)+1, all in one transaction (versioned, additive-only — old rows are
// kept, only the active flag flips).
func (r *Repository) PublishDisclosure(ctx context.Context, in DisclosureInput, createdBy string) (*Disclosure, error) {
	jur := in.Jurisdiction
	if jur == "" {
		jur = "NG"
	}
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("compliance: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx,
		`UPDATE referral_disclosures SET active = false WHERE slug = $1 AND jurisdiction = $2 AND active = true`,
		in.Slug, jur); err != nil {
		return nil, fmt.Errorf("compliance: deactivate prior disclosure: %w", err)
	}

	const q = `
		INSERT INTO referral_disclosures (slug, version, title, body, jurisdiction, active, created_by)
		VALUES ($1,
		        COALESCE((SELECT max(version) FROM referral_disclosures WHERE slug = $1), 0) + 1,
		        $2, $3, $4, true, $5)
		RETURNING ` + discCols
	d, err := scanDisclosure(tx.QueryRow(ctx, q, in.Slug, in.Title, in.Body, jur, nullable(createdBy)))
	if err != nil {
		return nil, fmt.Errorf("compliance: insert disclosure: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("compliance: commit disclosure: %w", err)
	}
	return d, nil
}

// ListDisclosures lists disclosures, optional slug filter, newest version first.
func (r *Repository) ListDisclosures(ctx context.Context, slug string) ([]Disclosure, error) {
	q := `SELECT ` + discCols + ` FROM referral_disclosures`
	var args []any
	if slug != "" {
		q += ` WHERE slug = $1`
		args = append(args, slug)
	}
	q += ` ORDER BY slug, version DESC`
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("compliance: list disclosures: %w", err)
	}
	defer rows.Close()
	out := []Disclosure{}
	for rows.Next() {
		d, err := scanDisclosure(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *d)
	}
	return out, rows.Err()
}

// ActiveDisclosure returns the active version of a slug (member-facing).
func (r *Repository) ActiveDisclosure(ctx context.Context, slug string) (*Disclosure, error) {
	const q = `SELECT ` + discCols + ` FROM referral_disclosures
		WHERE slug = $1 AND active = true ORDER BY version DESC LIMIT 1`
	d, err := scanDisclosure(r.db.QueryRow(ctx, q, slug))
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("compliance: active disclosure: %w", err)
	}
	return d, nil
}

// --- consents ---

const consentCols = `id, user_id, disclosure_id, consent_type, granted, version, source, created_at`

func scanConsent(row pgx.Row) (*Consent, error) {
	var (
		c         Consent
		disc, src *string
		version   *int
	)
	if err := row.Scan(&c.ID, &c.UserID, &disc, &c.ConsentType, &c.Granted, &version, &src, &c.CreatedAt); err != nil {
		return nil, err
	}
	deref(&c.DisclosureID, disc)
	deref(&c.Source, src)
	if version != nil {
		c.Version = *version
	}
	return &c, nil
}

// RecordConsent appends a consent decision. Each grant or withdrawal is its own
// row; current state is the most recent row per (user, consent type).
func (r *Repository) RecordConsent(ctx context.Context, userID string, in ConsentInput) (*Consent, error) {
	granted := true
	if in.Granted != nil {
		granted = *in.Granted
	}
	var version any
	if in.Version > 0 {
		version = in.Version
	}
	// Append-only: every grant and withdrawal is its own row. The previous
	// upsert on (user_id, consent_type, version) overwrote the prior record, so
	// a withdrawal erased the evidence of what had been agreed. Corrections are
	// made by appending, the way the ledger corrects with reversing entries.
	// The DB enforces this too — UPDATE/DELETE are blocked by trigger.
	const q = `
		INSERT INTO referral_consents (user_id, disclosure_id, consent_type, granted, version, source)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING ` + consentCols
	return scanConsent(r.db.QueryRow(ctx, q,
		userID, nullable(in.DisclosureID), in.ConsentType, granted, version, nullable(in.Source)))
}

// ConsentsByUser returns a user's consents.
func (r *Repository) ConsentsByUser(ctx context.Context, userID string) ([]Consent, error) {
	rows, err := r.db.Query(ctx,
		// seq, not created_at: now() is transaction-constant, so consents written
		// together share a timestamp and created_at cannot order them.
		`SELECT `+consentCols+` FROM referral_consents WHERE user_id = $1 ORDER BY seq DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("compliance: consents by user: %w", err)
	}
	defer rows.Close()
	out := []Consent{}
	for rows.Next() {
		c, err := scanConsent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// --- AML flags ---

const amlCols = `id, subject_id, reason_code, amount_kobo, window_count, status, reward_id, reported_ref, created_at`

func scanAML(row pgx.Row) (*AMLFlag, error) {
	var (
		f                  AMLFlag
		subj, reward, repd *string
	)
	if err := row.Scan(&f.ID, &subj, &f.ReasonCode, &f.AmountKobo, &f.WindowCount, &f.Status, &reward, &repd, &f.CreatedAt); err != nil {
		return nil, err
	}
	deref(&f.SubjectID, subj)
	deref(&f.RewardID, reward)
	deref(&f.ReportedRef, repd)
	return &f, nil
}

// RaiseAML appends an AML flag.
func (r *Repository) RaiseAML(ctx context.Context, in AMLFlagInput) (*AMLFlag, error) {
	const q = `
		INSERT INTO referral_aml_flags (subject_id, reason_code, amount_kobo, window_count, status, reward_id)
		VALUES ($1,$2,$3,$4,'open',$5)
		RETURNING ` + amlCols
	wc := in.WindowCount
	if wc <= 0 {
		wc = 1
	}
	return scanAML(r.db.QueryRow(ctx, q, nullable(in.SubjectID), in.ReasonCode, in.AmountKobo, wc, nullable(in.RewardID)))
}

// ListAML lists AML flags, optional status filter.
func (r *Repository) ListAML(ctx context.Context, status string) ([]AMLFlag, error) {
	q := `SELECT ` + amlCols + ` FROM referral_aml_flags`
	var args []any
	if status != "" {
		q += ` WHERE status = $1`
		args = append(args, status)
	}
	q += ` ORDER BY created_at DESC LIMIT 500`
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("compliance: list aml: %w", err)
	}
	defer rows.Close()
	out := []AMLFlag{}
	for rows.Next() {
		f, err := scanAML(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *f)
	}
	return out, rows.Err()
}

// SetAMLStatus updates an AML flag's status; reportedRef set when reporting.
func (r *Repository) SetAMLStatus(ctx context.Context, id, status, reportedRef string) error {
	const q = `
		UPDATE referral_aml_flags
		SET status = $2,
		    reported_ref = CASE WHEN $2 = 'reported' THEN NULLIF($3,'') ELSE reported_ref END
		WHERE id = $1`
	tag, err := r.db.Exec(ctx, q, id, status, reportedRef)
	if err != nil {
		return fmt.Errorf("compliance: set aml status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("compliance: aml flag not found")
	}
	return nil
}

// --- policy ---

// GetPolicy returns the structural policy singleton.
func (r *Repository) GetPolicy(ctx context.Context) (*Policy, error) {
	const q = `
		SELECT max_pyramid_depth, tier_cap_kobo, require_activity, allowed_jurisdictions, updated_by, updated_at
		FROM referral_policy WHERE id = true`
	var (
		p     Policy
		updBy *string
	)
	err := r.db.QueryRow(ctx, q).Scan(
		&p.MaxPyramidDepth, &p.TierCapKobo, &p.RequireActivity, &p.AllowedJurisdictions, &updBy, &p.UpdatedAt)
	if err == pgx.ErrNoRows {
		return &Policy{MaxPyramidDepth: 2, RequireActivity: true, AllowedJurisdictions: []string{"NG"}}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("compliance: get policy: %w", err)
	}
	deref(&p.UpdatedBy, updBy)
	return &p, nil
}

// UpdatePolicy updates the structural policy singleton (upsert on the id=true row).
func (r *Repository) UpdatePolicy(ctx context.Context, in PolicyInput, updatedBy string) (*Policy, error) {
	cur, err := r.GetPolicy(ctx)
	if err != nil {
		return nil, err
	}
	if in.MaxPyramidDepth != nil {
		cur.MaxPyramidDepth = *in.MaxPyramidDepth
	}
	if in.TierCapKobo != nil {
		cur.TierCapKobo = *in.TierCapKobo
	}
	if in.RequireActivity != nil {
		cur.RequireActivity = *in.RequireActivity
	}
	if in.AllowedJurisdictions != nil {
		cur.AllowedJurisdictions = in.AllowedJurisdictions
	}
	const q = `
		INSERT INTO referral_policy (id, max_pyramid_depth, tier_cap_kobo, require_activity, allowed_jurisdictions, updated_by, updated_at)
		VALUES (true, $1, $2, $3, $4, $5, now())
		ON CONFLICT (id) DO UPDATE SET
			max_pyramid_depth = EXCLUDED.max_pyramid_depth,
			tier_cap_kobo = EXCLUDED.tier_cap_kobo,
			require_activity = EXCLUDED.require_activity,
			allowed_jurisdictions = EXCLUDED.allowed_jurisdictions,
			updated_by = EXCLUDED.updated_by,
			updated_at = now()`
	if _, err := r.db.Exec(ctx, q,
		cur.MaxPyramidDepth, cur.TierCapKobo, cur.RequireActivity, cur.AllowedJurisdictions, nullable(updatedBy)); err != nil {
		return nil, fmt.Errorf("compliance: update policy: %w", err)
	}
	return r.GetPolicy(ctx)
}

// --- earnings-claim review (read referral_review_queue) ---

// ClaimReview returns held/queued reward rows for earnings-claim review.
func (r *Repository) ClaimReview(ctx context.Context, status string) ([]ClaimReviewItem, error) {
	q := `SELECT id, reward_id, subject_id, reason_code, status, created_at FROM referral_review_queue`
	var args []any
	if status != "" {
		q += ` WHERE status = $1`
		args = append(args, status)
	} else {
		q += ` WHERE status = 'queued'`
	}
	q += ` ORDER BY created_at DESC LIMIT 500`
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("compliance: claim review: %w", err)
	}
	defer rows.Close()
	out := []ClaimReviewItem{}
	for rows.Next() {
		var (
			it           ClaimReviewItem
			reward, subj *string
		)
		if err := rows.Scan(&it.ID, &reward, &subj, &it.ReasonCode, &it.Status, &it.CreatedAt); err != nil {
			return nil, err
		}
		deref(&it.RewardID, reward)
		deref(&it.SubjectID, subj)
		out = append(out, it)
	}
	return out, rows.Err()
}

// --- regulatory reporting export ---

// RegulatoryExport returns AML rows for a reporting period (regulatory export).
func (r *Repository) RegulatoryExport(ctx context.Context, since, until string) ([]RegulatoryExportRow, error) {
	const q = `
		SELECT subject_id, reason_code, amount_kobo, status, reported_ref, created_at
		FROM referral_aml_flags
		WHERE ($1 = '' OR created_at >= $1::timestamptz)
		  AND ($2 = '' OR created_at <  $2::timestamptz)
		ORDER BY created_at DESC LIMIT 5000`
	rows, err := r.db.Query(ctx, q, since, until)
	if err != nil {
		return nil, fmt.Errorf("compliance: regulatory export: %w", err)
	}
	defer rows.Close()
	out := []RegulatoryExportRow{}
	for rows.Next() {
		var (
			row        RegulatoryExportRow
			subj, repd *string
		)
		if err := rows.Scan(&subj, &row.ReasonCode, &row.AmountKobo, &row.Status, &repd, &row.CreatedAt); err != nil {
			return nil, err
		}
		deref(&row.SubjectID, subj)
		deref(&row.ReportedRef, repd)
		out = append(out, row)
	}
	return out, rows.Err()
}
