package csr

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service implements the corporate CSR / matching domain over a pgx pool.
// Pattern mirrors the discovery/admin crowdfunding services: pgxpool + guarded,
// transactional state transitions. All money is BIGINT kobo.
type Service struct {
	db *pgxpool.Pool
}

// NewService constructs a CSR service.
func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

// ErrNotFound is returned when a requested resource does not exist.
var ErrNotFound = errors.New("csr: not found")

// impactTags maps campaign categories to a human impact tag for the CSR UI.
var impactTags = map[string]string{
	"medical":    "Health",
	"education":  "Education",
	"creative":   "Creative",
	"sme":        "Economic",
	"ngo":        "Social",
	"religious":  "Community",
	"community":  "Community",
	"emergency":  "Emergency",
	"reward":     "Innovation",
	"investment": "Economic",
}

func impactTag(category string) string {
	if t, ok := impactTags[category]; ok {
		return t
	}
	return "Community"
}

func rfc3339(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

// GetProfile returns the sponsor's CSR profile, defaulting an empty row when the
// sponsor has not been onboarded yet (so the dashboard always renders).
func (s *Service) GetProfile(ctx context.Context, userID string) (*CsrProfile, error) {
	p := &CsrProfile{}
	const q = `
		SELECT company_name, verified, annual_budget_kobo, committed_kobo,
		       matched_kobo, campaigns_supported, employees_giving
		FROM cf_csr_profiles WHERE user_id = $1`
	err := s.db.QueryRow(ctx, q, userID).Scan(
		&p.CompanyName, &p.Verified, &p.AnnualBudgetKobo, &p.CommittedKobo,
		&p.MatchedKobo, &p.CampaignsSupported, &p.EmployeesGiving,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		// Default (un-onboarded) sponsor profile.
		return &CsrProfile{}, nil
	}
	if err != nil {
		return nil, err
	}
	return p, nil
}

// matchableSelect is the shared projection for matchable-campaign queries.
// raised_kobo is derived from the contributions ledger (never a stored balance).
const matchableSelect = `
	c.id, c.title, c.category, c.cover_url,
	COALESCE((SELECT SUM(co.amount_kobo) FROM contributions co WHERE co.campaign_id = c.id AND co.status IN ('escrowed','released')), 0) AS raised_kobo,
	c.goal_kobo, c.contributor_count, c.verified`

func scanMatchable(scan func(dest ...any) error) (*MatchableCampaign, error) {
	m := &MatchableCampaign{}
	var category string
	if err := scan(
		&m.ID, &m.Title, &category, &m.CoverImage,
		&m.RaisedKobo, &m.GoalKobo, &m.ContributorCount, &m.Verified,
	); err != nil {
		return nil, err
	}
	m.Category = category
	m.ImpactTag = impactTag(category)
	return m, nil
}

// GetMatchableCampaigns returns active, verified campaigns a sponsor can match.
func (s *Service) GetMatchableCampaigns(ctx context.Context) ([]MatchableCampaign, error) {
	sql := fmt.Sprintf(`
		SELECT %s FROM campaigns c
		WHERE c.review_status = 'ACTIVE' AND c.verified = TRUE
		ORDER BY c.created_at DESC
		LIMIT 60`, matchableSelect)
	rows, err := s.db.Query(ctx, sql)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MatchableCampaign{}
	for rows.Next() {
		m, err := scanMatchable(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

// GetMatchableCampaign returns a single matchable campaign by id.
func (s *Service) GetMatchableCampaign(ctx context.Context, id string) (*MatchableCampaign, error) {
	sql := fmt.Sprintf(`
		SELECT %s FROM campaigns c
		WHERE c.id = $1 AND c.review_status = 'ACTIVE' AND c.verified = TRUE`, matchableSelect)
	m, err := scanMatchable(s.db.QueryRow(ctx, sql, id).Scan)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return m, nil
}

func scanMatch(scan func(dest ...any) error) (*CsrMatch, error) {
	m := &CsrMatch{}
	var startedAt time.Time
	if err := scan(
		&m.ID, &m.CampaignID, &m.CampaignTitle, &m.Ratio, &m.CapKobo,
		&m.MatchedKobo, &m.Status, &startedAt, &m.Visibility,
	); err != nil {
		return nil, err
	}
	m.StartedAt = rfc3339(startedAt)
	return m, nil
}

const matchSelect = `
	id, campaign_id, campaign_title, ratio, cap_kobo, matched_kobo, status, started_at, visibility`

// GetMatches returns the sponsor's match offers, newest first.
func (s *Service) GetMatches(ctx context.Context, sponsorID string) ([]CsrMatch, error) {
	sql := fmt.Sprintf(`SELECT %s FROM cf_csr_matches WHERE sponsor_id = $1 ORDER BY created_at DESC`, matchSelect)
	rows, err := s.db.Query(ctx, sql, sponsorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CsrMatch{}
	for rows.Next() {
		m, err := scanMatch(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

// SetupMatch creates a match offer in PENDING_APPROVAL, reserving `capKobo` of
// the sponsor's annual budget transactionally. Idempotent on idemKey: a repeat
// call with the same key returns the existing match without re-reserving budget.
//
// IRON RULES: reserving budget mutates money → requires an Idempotency-Key;
// matches start PENDING_APPROVAL and must be explicitly approved before ACTIVE.
func (s *Service) SetupMatch(ctx context.Context, sponsorID string, in MatchSetupInput, idemKey string) (*CsrMatch, error) {
	if idemKey == "" {
		return nil, fmt.Errorf("csr: Idempotency-Key is required")
	}
	if in.CapKobo < 100 {
		return nil, fmt.Errorf("csr: capKobo must be at least 100")
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Idempotency: short-circuit if a match already exists for this key.
	if existing, ok, err := s.findByIdemKey(ctx, tx, idemKey); err != nil {
		return nil, err
	} else if ok {
		return existing, nil
	}

	// Resolve the campaign (must be active + verified) and snapshot its title.
	var campaignTitle string
	err = tx.QueryRow(ctx,
		`SELECT title FROM campaigns WHERE id = $1 AND review_status = 'ACTIVE' AND verified = TRUE`,
		in.CampaignID,
	).Scan(&campaignTitle)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("csr: campaign is not available for matching")
	}
	if err != nil {
		return nil, err
	}

	// Ensure a profile row exists (default), then reserve cap from the budget.
	if _, err := tx.Exec(ctx,
		`INSERT INTO cf_csr_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
		sponsorID,
	); err != nil {
		return nil, err
	}

	var budget, committed int64
	if err := tx.QueryRow(ctx,
		`SELECT annual_budget_kobo, committed_kobo FROM cf_csr_profiles WHERE user_id = $1 FOR UPDATE`,
		sponsorID,
	).Scan(&budget, &committed); err != nil {
		return nil, err
	}
	if committed+in.CapKobo > budget {
		return nil, fmt.Errorf("csr: cap exceeds remaining annual budget")
	}

	if _, err := tx.Exec(ctx,
		`UPDATE cf_csr_profiles
		 SET committed_kobo = committed_kobo + $1, updated_at = NOW()
		 WHERE user_id = $2`,
		in.CapKobo, sponsorID,
	); err != nil {
		return nil, err
	}

	const ins = `
		INSERT INTO cf_csr_matches
			(sponsor_id, campaign_id, campaign_title, ratio, cap_kobo, status, visibility, message, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,'PENDING_APPROVAL',$6,$7,$8)
		RETURNING ` + matchSelect
	m, err := scanMatch(tx.QueryRow(ctx, ins,
		sponsorID, in.CampaignID, campaignTitle, in.Ratio, in.CapKobo, in.Visibility, in.Message, idemKey,
	).Scan)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return m, nil
}

func (s *Service) findByIdemKey(ctx context.Context, tx pgx.Tx, idemKey string) (*CsrMatch, bool, error) {
	sql := fmt.Sprintf(`SELECT %s FROM cf_csr_matches WHERE idempotency_key = $1`, matchSelect)
	m, err := scanMatch(tx.QueryRow(ctx, sql, idemKey).Scan)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return m, true, nil
}

// ApproveMatch applies the guarded PENDING_APPROVAL → ACTIVE transition and bumps
// the sponsor's campaigns_supported counter. Scoped to the owning sponsor.
func (s *Service) ApproveMatch(ctx context.Context, sponsorID, matchID string) (*CsrMatch, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var current string
	err = tx.QueryRow(ctx,
		`SELECT status FROM cf_csr_matches WHERE id = $1 AND sponsor_id = $2 FOR UPDATE`,
		matchID, sponsorID,
	).Scan(&current)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if current != "PENDING_APPROVAL" {
		return nil, fmt.Errorf("csr: cannot approve a match in %s state", current)
	}

	sql := fmt.Sprintf(`
		UPDATE cf_csr_matches
		SET status = 'ACTIVE', started_at = NOW(), updated_at = NOW()
		WHERE id = $1
		RETURNING %s`, matchSelect)
	m, err := scanMatch(tx.QueryRow(ctx, sql, matchID).Scan)
	if err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx,
		`UPDATE cf_csr_profiles
		 SET campaigns_supported = campaigns_supported + 1, updated_at = NOW()
		 WHERE user_id = $1`,
		sponsorID,
	); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return m, nil
}

// GetInvoices returns the sponsor's billing records, newest first.
func (s *Service) GetInvoices(ctx context.Context, sponsorID string) ([]CsrInvoice, error) {
	const q = `
		SELECT id, reference, description, amount_kobo, vat_kobo, total_kobo, status, issued_at
		FROM cf_csr_invoices WHERE sponsor_id = $1 ORDER BY issued_at DESC`
	rows, err := s.db.Query(ctx, q, sponsorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CsrInvoice{}
	for rows.Next() {
		var inv CsrInvoice
		var issuedAt time.Time
		if err := rows.Scan(&inv.ID, &inv.Reference, &inv.Description, &inv.AmountKobo,
			&inv.VatKobo, &inv.TotalKobo, &inv.Status, &issuedAt); err != nil {
			return nil, err
		}
		inv.IssuedAt = rfc3339(issuedAt)
		out = append(out, inv)
	}
	return out, rows.Err()
}

// GetImpactSummary derives a CSR impact roll-up from the sponsor's matches.
// livesImpacted is an indicative estimate (1 life per ~₦5,000 / 500,000 kobo).
func (s *Service) GetImpactSummary(ctx context.Context, sponsorID string) (*CsrImpactSummary, error) {
	out := &CsrImpactSummary{ByCategory: []CategoryMatched{}, Monthly: []MonthlyMatched{}}

	// Total matched + distinct campaigns supported (ACTIVE/COMPLETED only).
	if err := s.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(matched_kobo),0), COUNT(DISTINCT campaign_id)
		FROM cf_csr_matches
		WHERE sponsor_id = $1 AND status IN ('ACTIVE','COMPLETED')`,
		sponsorID,
	).Scan(&out.TotalMatchedKobo, &out.CampaignsSupported); err != nil {
		return nil, err
	}
	out.LivesImpacted = int(out.TotalMatchedKobo / 500000)

	// By category (joins the campaign's category).
	catRows, err := s.db.Query(ctx, `
		SELECT COALESCE(c.category,'community') AS category, SUM(m.matched_kobo) AS matched
		FROM cf_csr_matches m
		JOIN campaigns c ON c.id = m.campaign_id
		WHERE m.sponsor_id = $1 AND m.status IN ('ACTIVE','COMPLETED')
		GROUP BY c.category
		ORDER BY matched DESC`, sponsorID)
	if err != nil {
		return nil, err
	}
	defer catRows.Close()
	for catRows.Next() {
		var cm CategoryMatched
		if err := catRows.Scan(&cm.Category, &cm.MatchedKobo); err != nil {
			return nil, err
		}
		if out.TopCategory == "" {
			out.TopCategory = cm.Category
		}
		out.ByCategory = append(out.ByCategory, cm)
	}
	if err := catRows.Err(); err != nil {
		return nil, err
	}

	// Monthly trend (last 6 months with activity).
	monRows, err := s.db.Query(ctx, `
		SELECT to_char(date_trunc('month', started_at), 'YYYY-MM') AS month, SUM(matched_kobo) AS matched
		FROM cf_csr_matches
		WHERE sponsor_id = $1 AND status IN ('ACTIVE','COMPLETED')
		GROUP BY 1
		ORDER BY 1 DESC
		LIMIT 6`, sponsorID)
	if err != nil {
		return nil, err
	}
	defer monRows.Close()
	for monRows.Next() {
		var mm MonthlyMatched
		if err := monRows.Scan(&mm.Month, &mm.MatchedKobo); err != nil {
			return nil, err
		}
		out.Monthly = append(out.Monthly, mm)
	}
	return out, monRows.Err()
}

// GetEmployeeGiving returns the sponsor's employee-giving payroll campaigns.
func (s *Service) GetEmployeeGiving(ctx context.Context, sponsorID string) ([]EmployeeGivingCampaign, error) {
	const q = `
		SELECT id, title, goal_kobo, raised_kobo, participants, ends_at, company_match_ratio
		FROM cf_employee_giving WHERE sponsor_id = $1 ORDER BY created_at DESC`
	rows, err := s.db.Query(ctx, q, sponsorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []EmployeeGivingCampaign{}
	for rows.Next() {
		var e EmployeeGivingCampaign
		var endsAt *time.Time
		if err := rows.Scan(&e.ID, &e.Title, &e.GoalKobo, &e.RaisedKobo,
			&e.Participants, &endsAt, &e.CompanyMatchRatio); err != nil {
			return nil, err
		}
		if endsAt != nil {
			e.EndsAt = rfc3339(*endsAt)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
