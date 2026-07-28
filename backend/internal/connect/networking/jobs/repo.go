package connectjobs

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository holds the parameterized pgx queries for the jobs/company-page/bounty
// tables. Money movement is NEVER done here — the ledger/wallet own that. This layer
// only reads/writes the module's own projection + guarded state rows.
type Repository struct{ db *pgxpool.Pool }

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

var ErrNotFound = errors.New("connect: not found")

// ── Company pages ───────────────────────────────────────────────────────────

// CreateClaim inserts a company page in claim_submitted (the FSM start state).
func (r *Repository) CreateClaim(ctx context.Context, in ClaimCompanyInput) (*CompanyPage, error) {
	const q = `INSERT INTO connect_company_pages (verified_business_id, name, about, claim_state)
		VALUES (NULLIF($1,'')::uuid, $2, NULLIF($3,''), 'claim_submitted')
		RETURNING id, COALESCE(verified_business_id::text,''), name, COALESCE(about,''),
			claim_state, created_at, updated_at`
	cp := &CompanyPage{}
	if err := r.db.QueryRow(ctx, q, in.VerifiedBusinessID, in.Name, in.About).Scan(
		&cp.ID, &cp.VerifiedBusinessID, &cp.Name, &cp.About, &cp.ClaimState,
		&cp.CreatedAt, &cp.UpdatedAt); err != nil {
		return nil, fmt.Errorf("connect: create claim: %w", err)
	}
	return cp, nil
}

// GetCompanyPage loads a page and its DERIVED follower_count (never a stored column).
func (r *Repository) GetCompanyPage(ctx context.Context, id string) (*CompanyPage, error) {
	const q = `SELECT p.id, COALESCE(p.verified_business_id::text,''), p.name, COALESCE(p.about,''),
			p.claim_state, p.created_at, p.updated_at,
			(SELECT COUNT(*) FROM connect_company_followers f WHERE f.company_page_id = p.id)
		FROM connect_company_pages p WHERE p.id = $1`
	cp := &CompanyPage{}
	if err := r.db.QueryRow(ctx, q, id).Scan(&cp.ID, &cp.VerifiedBusinessID, &cp.Name,
		&cp.About, &cp.ClaimState, &cp.CreatedAt, &cp.UpdatedAt, &cp.FollowerCount); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("connect: get company page: %w", err)
	}
	return cp, nil
}

// ClaimState returns just the claim_state for the server-side PN-6 gate.
func (r *Repository) ClaimState(ctx context.Context, companyPageID string) (ClaimState, error) {
	var s string
	err := r.db.QueryRow(ctx,
		`SELECT claim_state FROM connect_company_pages WHERE id = $1`, companyPageID).Scan(&s)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("connect: claim state: %w", err)
	}
	return ClaimState(s), nil
}

// TransitionClaim performs a guarded claim_state update (the caller checks the FSM;
// the WHERE clause re-asserts the from-state so a concurrent transition is a no-op).
func (r *Repository) TransitionClaim(ctx context.Context, id string, from, to ClaimState) (bool, error) {
	ct, err := r.db.Exec(ctx,
		`UPDATE connect_company_pages SET claim_state = $3, updated_at = now()
		 WHERE id = $1 AND claim_state = $2`, id, string(from), string(to))
	if err != nil {
		return false, fmt.Errorf("connect: transition claim: %w", err)
	}
	return ct.RowsAffected() == 1, nil
}

// ── Object-scoped grants (PN-9) ─────────────────────────────────────────────

// GrantAdmin inserts (or no-ops on) an independently revocable per-page capability row.
func (r *Repository) GrantAdmin(ctx context.Context, companyPageID, userID, role string) (*CompanyAdmin, error) {
	const q = `INSERT INTO connect_company_admins (company_page_id, user_id, role)
		VALUES ($1,$2,$3)
		ON CONFLICT (company_page_id, user_id) DO UPDATE SET role = EXCLUDED.role
		RETURNING id, company_page_id, user_id, role, created_at`
	a := &CompanyAdmin{}
	if err := r.db.QueryRow(ctx, q, companyPageID, userID, role).Scan(
		&a.ID, &a.CompanyPageID, &a.UserID, &a.Role, &a.CreatedAt); err != nil {
		return nil, fmt.Errorf("connect: grant admin: %w", err)
	}
	return a, nil
}

// RevokeAdmin deletes ONE object-scoped grant row (PN-9: independently revocable —
// removing a recruiter grant never touches the same user's other capabilities).
func (r *Repository) RevokeAdmin(ctx context.Context, companyPageID, userID string) (bool, error) {
	ct, err := r.db.Exec(ctx,
		`DELETE FROM connect_company_admins WHERE company_page_id = $1 AND user_id = $2`,
		companyPageID, userID)
	if err != nil {
		return false, fmt.Errorf("connect: revoke admin: %w", err)
	}
	return ct.RowsAffected() == 1, nil
}

// HasCompanyGrant reports whether user holds any of the given roles on the page.
// Defence-in-depth alongside the RBAC scoped middleware.
func (r *Repository) HasCompanyGrant(ctx context.Context, companyPageID, userID string, roles ...string) (bool, error) {
	var ok bool
	err := r.db.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM connect_company_admins
			WHERE company_page_id = $1 AND user_id = $2 AND role = ANY($3))`,
		companyPageID, userID, roles).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("connect: has grant: %w", err)
	}
	return ok, nil
}

// ── Jobs ────────────────────────────────────────────────────────────────────

// CreateJob inserts a draft job for a company page.
func (r *Repository) CreateJob(ctx context.Context, companyPageID, posterID string, in CreateJobInput) (*Job, error) {
	positions := in.PositionsOpen
	if positions <= 0 {
		positions = 1
	}
	const q = `INSERT INTO connect_jobs
		(company_page_id, poster_id, title, description, requirements, location, employment_type,
		 salary_min_kobo, salary_max_kobo, positions_open, fee_kobo, status)
		VALUES ($1,$2,$3,NULLIF($4,''),NULLIF($5,''),NULLIF($6,''),NULLIF($7,''),$8,$9,$10,$11,'draft')
		RETURNING id, company_page_id, poster_id, title, COALESCE(description,''),
			COALESCE(requirements,''), COALESCE(location,''), COALESCE(employment_type,''),
			salary_min_kobo, salary_max_kobo, positions_open, positions_filled, fee_kobo, status,
			created_at, updated_at`
	j := &Job{}
	if err := r.db.QueryRow(ctx, q, companyPageID, posterID, in.Title, in.Description,
		in.Requirements, in.Location, in.EmploymentType, in.SalaryMinKobo, in.SalaryMaxKobo,
		positions, in.FeeKobo).Scan(
		&j.ID, &j.CompanyPageID, &j.PosterID, &j.Title, &j.Description, &j.Requirements,
		&j.Location, &j.EmploymentType, &j.SalaryMinKobo, &j.SalaryMaxKobo, &j.PositionsOpen,
		&j.PositionsFilled, &j.FeeKobo, &j.Status, &j.CreatedAt, &j.UpdatedAt); err != nil {
		return nil, fmt.Errorf("connect: create job: %w", err)
	}
	return j, nil
}

func scanJob(row pgx.Row) (*Job, error) {
	j := &Job{}
	if err := row.Scan(&j.ID, &j.CompanyPageID, &j.PosterID, &j.Title, &j.Description,
		&j.Requirements, &j.Location, &j.EmploymentType, &j.SalaryMinKobo, &j.SalaryMaxKobo,
		&j.PositionsOpen, &j.PositionsFilled, &j.FeeKobo, &j.Status, &j.CreatedAt, &j.UpdatedAt); err != nil {
		return nil, err
	}
	return j, nil
}

const jobCols = `id, company_page_id, poster_id, title, COALESCE(description,''),
	COALESCE(requirements,''), COALESCE(location,''), COALESCE(employment_type,''),
	salary_min_kobo, salary_max_kobo, positions_open, positions_filled, fee_kobo, status,
	created_at, updated_at`

// GetJob loads one job by id.
func (r *Repository) GetJob(ctx context.Context, id string) (*Job, error) {
	j, err := scanJob(r.db.QueryRow(ctx, `SELECT `+jobCols+` FROM connect_jobs WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("connect: get job: %w", err)
	}
	return j, nil
}

// ListActiveJobs returns the public jobs feed (JB-01), newest first.
func (r *Repository) ListActiveJobs(ctx context.Context, limit int) ([]Job, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := r.db.Query(ctx,
		`SELECT `+jobCols+` FROM connect_jobs WHERE status = 'active' ORDER BY created_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("connect: list jobs: %w", err)
	}
	defer rows.Close()
	var out []Job
	for rows.Next() {
		j, err := scanJob(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *j)
	}
	return out, rows.Err()
}

// SetJobStatus performs a guarded status update (from-state re-asserted in WHERE).
func (r *Repository) SetJobStatus(ctx context.Context, id string, from, to JobStatus) (bool, error) {
	ct, err := r.db.Exec(ctx,
		`UPDATE connect_jobs SET status = $3, updated_at = now() WHERE id = $1 AND status = $2`,
		id, string(from), string(to))
	if err != nil {
		return false, fmt.Errorf("connect: set job status: %w", err)
	}
	return ct.RowsAffected() == 1, nil
}

// ── Applications ────────────────────────────────────────────────────────────

const appCols = `id, job_id, applicant_user_id, COALESCE(resume_ref,''), COALESCE(cover_note,''),
	state, created_at, updated_at`

func scanApp(row pgx.Row) (*JobApplication, error) {
	a := &JobApplication{}
	if err := row.Scan(&a.ID, &a.JobID, &a.ApplicantUserID, &a.ResumeRef, &a.CoverNote,
		&a.State, &a.CreatedAt, &a.UpdatedAt); err != nil {
		return nil, err
	}
	return a, nil
}

// CreateApplication inserts a submitted application. The UNIQUE (job_id,
// applicant_user_id) constraint makes a second application per user unreachable.
func (r *Repository) CreateApplication(ctx context.Context, jobID, userID string, in ApplyInput) (*JobApplication, error) {
	const q = `INSERT INTO connect_job_applications (job_id, applicant_user_id, resume_ref, cover_note, state)
		VALUES ($1,$2,NULLIF($3,''),NULLIF($4,''),'submitted')
		RETURNING ` + appCols
	a, err := scanApp(r.db.QueryRow(ctx, q, jobID, userID, in.ResumeRef, in.CoverNote))
	if err != nil {
		return nil, err // UNIQUE violation bubbles up → mapped to 409 (one active app per user)
	}
	return a, nil
}

// GetApplication loads one application.
func (r *Repository) GetApplication(ctx context.Context, id string) (*JobApplication, error) {
	a, err := scanApp(r.db.QueryRow(ctx, `SELECT `+appCols+` FROM connect_job_applications WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("connect: get application: %w", err)
	}
	return a, nil
}

// ListApplicationsForUser is the "my applications" tracker (JB-04).
func (r *Repository) ListApplicationsForUser(ctx context.Context, userID string) ([]JobApplication, error) {
	rows, err := r.db.Query(ctx,
		`SELECT `+appCols+` FROM connect_job_applications WHERE applicant_user_id = $1 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("connect: list my applications: %w", err)
	}
	defer rows.Close()
	return collectApps(rows)
}

// ListApplicationsForJob is the recruiter pipeline (JB-06).
func (r *Repository) ListApplicationsForJob(ctx context.Context, jobID string) ([]JobApplication, error) {
	rows, err := r.db.Query(ctx,
		`SELECT `+appCols+` FROM connect_job_applications WHERE job_id = $1 ORDER BY created_at DESC`, jobID)
	if err != nil {
		return nil, fmt.Errorf("connect: list job applications: %w", err)
	}
	defer rows.Close()
	return collectApps(rows)
}

func collectApps(rows pgx.Rows) ([]JobApplication, error) {
	var out []JobApplication
	for rows.Next() {
		a, err := scanApp(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// SetApplicationState performs a guarded state update (from-state re-asserted in WHERE).
// Used for every transition EXCEPT hired, which goes through HireApplicant (atomic).
func (r *Repository) SetApplicationState(ctx context.Context, id string, from, to AppState) (bool, error) {
	ct, err := r.db.Exec(ctx,
		`UPDATE connect_job_applications SET state = $3, updated_at = now() WHERE id = $1 AND state = $2`,
		id, string(from), string(to))
	if err != nil {
		return false, fmt.Errorf("connect: set application state: %w", err)
	}
	return ct.RowsAffected() == 1, nil
}

// HireApplicant performs the HIRED transition ATOMICALLY in one tx (§4):
//  (a) application from → hired;
//  (b) increment positions_filled, and close the job when positions_filled == positions_open;
//  (c) transition any linked ReferralBounty (referred|application_linked) → hire_confirmed.
//
// It returns the linked bounty id (empty if none) so the caller can run the
// ledger-writing BOUNTY_PAYABLE → PAID payout keyed by that id (PN-10). The payout is
// deliberately a separate step: it's ledger-idempotent by bounty id, so a crash between
// this tx committing and the payout is safe to retry.
func (r *Repository) HireApplicant(ctx context.Context, appID string, from AppState) (bountyID string, err error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	// (a) guarded application → hired; capture job id.
	var jobID string
	err = tx.QueryRow(ctx,
		`UPDATE connect_job_applications SET state = 'hired', updated_at = now()
		 WHERE id = $1 AND state = $2 RETURNING job_id`, appID, string(from)).Scan(&jobID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound // from-state no longer holds → illegal/stale transition
	}
	if err != nil {
		return "", fmt.Errorf("connect: hire: application: %w", err)
	}

	// (b) increment positions_filled; close if full. Guarded so we never over-fill.
	if _, err = tx.Exec(ctx,
		`UPDATE connect_jobs
		 SET positions_filled = positions_filled + 1,
		     status = CASE WHEN positions_filled + 1 >= positions_open AND status = 'active'
		                   THEN 'closed' ELSE status END,
		     updated_at = now()
		 WHERE id = $1 AND positions_filled < positions_open`, jobID); err != nil {
		return "", fmt.Errorf("connect: hire: positions: %w", err)
	}

	// (c) linked bounty → hire_confirmed (guarded from the two legal pre-states).
	err = tx.QueryRow(ctx,
		`UPDATE connect_referral_bounties SET state = 'hire_confirmed', updated_at = now()
		 WHERE job_application_id = $1 AND state IN ('referred','application_linked')
		 RETURNING id`, appID).Scan(&bountyID)
	if errors.Is(err, pgx.ErrNoRows) {
		bountyID = "" // no linked bounty — fine
	} else if err != nil {
		return "", fmt.Errorf("connect: hire: bounty: %w", err)
	}

	if err = tx.Commit(ctx); err != nil {
		return "", err
	}
	return bountyID, nil
}

// ── Referral bounties (single-level, PN-2) ──────────────────────────────────

const bountyCols = `id, referrer_user_id, COALESCE(job_application_id::text,''), amount_kobo, state,
	COALESCE(ledger_entry_ref,''), created_at, updated_at`

func scanBounty(row pgx.Row) (*ReferralBounty, error) {
	b := &ReferralBounty{}
	if err := row.Scan(&b.ID, &b.ReferrerUserID, &b.JobApplicationID, &b.AmountKobo,
		&b.State, &b.LedgerEntryRef, &b.CreatedAt, &b.UpdatedAt); err != nil {
		return nil, err
	}
	return b, nil
}

// CreateBounty records a single-level referral tied to ONE application. There is no
// parent/chain field, so a referral-of-referral cannot be created (PN-2).
func (r *Repository) CreateBounty(ctx context.Context, referrerID, jobApplicationID string, amountKobo int64) (*ReferralBounty, error) {
	const q = `INSERT INTO connect_referral_bounties (referrer_user_id, job_application_id, amount_kobo, state)
		VALUES ($1, NULLIF($2,'')::uuid, $3, 'application_linked')
		RETURNING ` + bountyCols
	b, err := scanBounty(r.db.QueryRow(ctx, q, referrerID, jobApplicationID, amountKobo))
	if err != nil {
		return nil, fmt.Errorf("connect: create bounty: %w", err)
	}
	return b, nil
}

// GetBounty loads one bounty.
func (r *Repository) GetBounty(ctx context.Context, id string) (*ReferralBounty, error) {
	b, err := scanBounty(r.db.QueryRow(ctx, `SELECT `+bountyCols+` FROM connect_referral_bounties WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("connect: get bounty: %w", err)
	}
	return b, nil
}

// ListBountiesForReferrer is the GM-04 referral tracker (single-level only).
func (r *Repository) ListBountiesForReferrer(ctx context.Context, referrerID string) ([]ReferralBounty, error) {
	rows, err := r.db.Query(ctx,
		`SELECT `+bountyCols+` FROM connect_referral_bounties WHERE referrer_user_id = $1 ORDER BY created_at DESC`, referrerID)
	if err != nil {
		return nil, fmt.Errorf("connect: list bounties: %w", err)
	}
	defer rows.Close()
	var out []ReferralBounty
	for rows.Next() {
		b, err := scanBounty(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *b)
	}
	return out, rows.Err()
}

// MarkBountyPaid stamps the ledger_entry_ref and advances the bounty to PAID iff it is
// currently in hire_confirmed or bounty_payable (guarded). A second call after the row
// is already PAID affects 0 rows → returns transitioned=false, so the payout is idempotent
// at the projection layer even though the ledger credit itself is the true idempotency
// boundary (keyed by bounty id).
func (r *Repository) MarkBountyPaid(ctx context.Context, id, ledgerEntryRef string) (transitioned bool, err error) {
	ct, err := r.db.Exec(ctx,
		`UPDATE connect_referral_bounties
		 SET state = 'paid', ledger_entry_ref = $2, updated_at = now()
		 WHERE id = $1 AND state IN ('hire_confirmed','bounty_payable')`, id, ledgerEntryRef)
	if err != nil {
		return false, fmt.Errorf("connect: mark bounty paid: %w", err)
	}
	return ct.RowsAffected() == 1, nil
}

// ── Followers & open-to-work ────────────────────────────────────────────────

// Follow adds an idempotent follow row (follower_count is derived from these).
func (r *Repository) Follow(ctx context.Context, companyPageID, userID string) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO connect_company_followers (company_page_id, user_id) VALUES ($1,$2)
		 ON CONFLICT (company_page_id, user_id) DO NOTHING`, companyPageID, userID)
	if err != nil {
		return fmt.Errorf("connect: follow: %w", err)
	}
	return nil
}

// SetOpenToWork upserts the profile-level Open to Work signal (JB-07).
func (r *Repository) SetOpenToWork(ctx context.Context, userID string, in OpenToWorkInput) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO connect_open_to_work (user_id, open, headline) VALUES ($1,$2,NULLIF($3,''))
		 ON CONFLICT (user_id) DO UPDATE SET open = EXCLUDED.open, headline = EXCLUDED.headline, updated_at = now()`,
		userID, in.Open, in.Headline)
	if err != nil {
		return fmt.Errorf("connect: set open to work: %w", err)
	}
	return nil
}
