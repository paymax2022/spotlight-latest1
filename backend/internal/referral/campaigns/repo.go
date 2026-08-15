package campaigns

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the parameterized data access layer for campaign tables.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

const campaignCols = `id, name, slug, description, status, reward_model, reward_config,
	vesting_schedule_id, starts_at, ends_at, funding_source, merchant_campaign_id,
	created_by, created_at, updated_at`

func scanCampaign(row pgx.Row) (*Campaign, error) {
	var (
		c                            Campaign
		desc, vest, merch, createdBy *string
		rawCfg                       []byte
	)
	if err := row.Scan(&c.ID, &c.Name, &c.Slug, &desc, &c.Status, &c.RewardModel, &rawCfg,
		&vest, &c.StartsAt, &c.EndsAt, &c.FundingSource, &merch, &createdBy,
		&c.CreatedAt, &c.UpdatedAt); err != nil {
		return nil, err
	}
	if desc != nil {
		c.Description = *desc
	}
	if vest != nil {
		c.VestingScheduleID = *vest
	}
	if merch != nil {
		c.MerchantCampaignID = *merch
	}
	if createdBy != nil {
		c.CreatedBy = *createdBy
	}
	c.RewardConfig = decodeJSON(rawCfg)
	return &c, nil
}

func decodeJSON(raw []byte) map[string]any {
	out := map[string]any{}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &out)
	}
	return out
}

// ListActive returns active campaigns for the member view.
func (r *Repository) ListActive(ctx context.Context) ([]Campaign, error) {
	q := `SELECT ` + campaignCols + ` FROM referral_campaigns
		WHERE status = 'active'
		  AND (starts_at IS NULL OR starts_at <= now())
		  AND (ends_at IS NULL OR ends_at >= now())
		ORDER BY created_at DESC`
	return r.queryCampaigns(ctx, q)
}

// ListAll returns all campaigns for the admin view.
func (r *Repository) ListAll(ctx context.Context) ([]Campaign, error) {
	q := `SELECT ` + campaignCols + ` FROM referral_campaigns ORDER BY created_at DESC LIMIT 500`
	return r.queryCampaigns(ctx, q)
}

func (r *Repository) queryCampaigns(ctx context.Context, q string, args ...any) ([]Campaign, error) {
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("campaigns: query: %w", err)
	}
	defer rows.Close()
	out := []Campaign{}
	for rows.Next() {
		c, err := scanCampaign(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// Get returns one campaign by id.
func (r *Repository) Get(ctx context.Context, id string) (*Campaign, error) {
	q := `SELECT ` + campaignCols + ` FROM referral_campaigns WHERE id = $1`
	return scanCampaign(r.db.QueryRow(ctx, q, id))
}

// Create inserts a campaign and its (zeroed) budget row.
func (r *Repository) Create(ctx context.Context, in CreateInput, createdBy string) (*Campaign, error) {
	cfg, err := json.Marshal(in.RewardConfig)
	if err != nil {
		return nil, fmt.Errorf("campaigns: marshal reward_config: %w", err)
	}
	if len(cfg) == 0 || string(cfg) == "null" {
		cfg = []byte("{}")
	}
	const q = `
		INSERT INTO referral_campaigns
			(name, slug, description, status, reward_model, reward_config,
			 vesting_schedule_id, starts_at, ends_at, funding_source, created_by)
		VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9,$10)
		RETURNING ` + campaignCols
	c, err := scanCampaign(r.db.QueryRow(ctx, q,
		in.Name, in.Slug, nullable(in.Description), in.RewardModel, cfg,
		nullable(in.VestingScheduleID), in.StartsAt, in.EndsAt,
		defaultStr(in.FundingSource, FundingHouse), nullable(createdBy)))
	if err != nil {
		return nil, fmt.Errorf("campaigns: create: %w", err)
	}
	if _, err := r.db.Exec(ctx,
		`INSERT INTO referral_campaign_budgets (campaign_id) VALUES ($1)
		 ON CONFLICT (campaign_id) DO NOTHING`, c.ID); err != nil {
		return nil, fmt.Errorf("campaigns: init budget: %w", err)
	}
	return c, nil
}

// Update patches mutable campaign fields.
func (r *Repository) Update(ctx context.Context, id string, in UpdateInput) (*Campaign, error) {
	var rawCfg []byte
	if in.RewardConfig != nil {
		b, err := json.Marshal(*in.RewardConfig)
		if err != nil {
			return nil, fmt.Errorf("campaigns: marshal reward_config: %w", err)
		}
		rawCfg = b
	}
	const q = `
		UPDATE referral_campaigns SET
			name         = COALESCE($2, name),
			description  = COALESCE($3, description),
			reward_model = COALESCE($4, reward_model),
			reward_config = COALESCE($5, reward_config),
			starts_at    = COALESCE($6, starts_at),
			ends_at      = COALESCE($7, ends_at),
			updated_at   = now()
		WHERE id = $1
		RETURNING ` + campaignCols
	var cfgArg any
	if rawCfg != nil {
		cfgArg = rawCfg
	}
	return scanCampaign(r.db.QueryRow(ctx, q, id, in.Name, in.Description,
		in.RewardModel, cfgArg, in.StartsAt, in.EndsAt))
}

// SetStatus moves a campaign to a new lifecycle status.
func (r *Repository) SetStatus(ctx context.Context, id, status string) error {
	tag, err := r.db.Exec(ctx,
		`UPDATE referral_campaigns SET status = $2, updated_at = now() WHERE id = $1`, id, status)
	if err != nil {
		return fmt.Errorf("campaigns: set status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("campaigns: not found: %s", id)
	}
	return nil
}

// GetBudget returns the budget governor row.
func (r *Repository) GetBudget(ctx context.Context, campaignID string) (*Budget, error) {
	const q = `
		SELECT campaign_id, total_budget_kobo, spent_kobo, per_user_cap_kobo, daily_cap_kobo,
		       max_cac_kobo, fraud_pause_bps, auto_paused, auto_pause_reason, throttle_pct
		FROM referral_campaign_budgets WHERE campaign_id = $1`
	var (
		b      Budget
		reason *string
	)
	if err := r.db.QueryRow(ctx, q, campaignID).Scan(
		&b.CampaignID, &b.TotalBudgetKobo, &b.SpentKobo, &b.PerUserCapKobo, &b.DailyCapKobo,
		&b.MaxCACKobo, &b.FraudPauseBps, &b.AutoPaused, &reason, &b.ThrottlePct); err != nil {
		return nil, fmt.Errorf("campaigns: get budget: %w", err)
	}
	if reason != nil {
		b.AutoPauseReason = *reason
	}
	return &b, nil
}

// SetBudget upserts the budget governor configuration.
func (r *Repository) SetBudget(ctx context.Context, campaignID string, in BudgetInput) (*Budget, error) {
	const q = `
		INSERT INTO referral_campaign_budgets
			(campaign_id, total_budget_kobo, per_user_cap_kobo, daily_cap_kobo, max_cac_kobo, fraud_pause_bps)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (campaign_id) DO UPDATE SET
			total_budget_kobo = EXCLUDED.total_budget_kobo,
			per_user_cap_kobo = EXCLUDED.per_user_cap_kobo,
			daily_cap_kobo    = EXCLUDED.daily_cap_kobo,
			max_cac_kobo      = EXCLUDED.max_cac_kobo,
			fraud_pause_bps   = EXCLUDED.fraud_pause_bps,
			updated_at        = now()`
	if _, err := r.db.Exec(ctx, q, campaignID, in.TotalBudgetKobo, in.PerUserCapKobo,
		in.DailyCapKobo, in.MaxCACKobo, in.FraudPauseBps); err != nil {
		return nil, fmt.Errorf("campaigns: set budget: %w", err)
	}
	return r.GetBudget(ctx, campaignID)
}

// SetThrottle sets the throttle percentage (0-100) on a campaign budget.
func (r *Repository) SetThrottle(ctx context.Context, campaignID string, pct int) error {
	_, err := r.db.Exec(ctx,
		`UPDATE referral_campaign_budgets SET throttle_pct = $2, updated_at = now() WHERE campaign_id = $1`,
		campaignID, pct)
	if err != nil {
		return fmt.Errorf("campaigns: set throttle: %w", err)
	}
	return nil
}

// SetAutoPause flips the governor's auto-pause flag with a reason.
func (r *Repository) SetAutoPause(ctx context.Context, campaignID string, paused bool, reason string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE referral_campaign_budgets SET auto_paused = $2, auto_pause_reason = $3, updated_at = now()
		 WHERE campaign_id = $1`, campaignID, paused, nullable(reason))
	if err != nil {
		return fmt.Errorf("campaigns: set auto pause: %w", err)
	}
	return nil
}

// AddSpend increments spent_kobo (used by the governor when a reward is charged
// against a campaign). Returns the new spent total.
func (r *Repository) AddSpend(ctx context.Context, campaignID string, amountKobo int64) (int64, error) {
	var spent int64
	err := r.db.QueryRow(ctx,
		`UPDATE referral_campaign_budgets SET spent_kobo = spent_kobo + $2, updated_at = now()
		 WHERE campaign_id = $1 RETURNING spent_kobo`, campaignID, amountKobo).Scan(&spent)
	if err != nil {
		return 0, fmt.Errorf("campaigns: add spend: %w", err)
	}
	return spent, nil
}

// RewardStats returns count + distinct beneficiaries + summed amount for a
// campaign's reward-ledger rows (analytics burn input). Reads RB0's table.
func (r *Repository) RewardStats(ctx context.Context, campaignID string) (count, beneficiaries, sumKobo int64, err error) {
	const q = `
		SELECT COUNT(*), COUNT(DISTINCT beneficiary_id), COALESCE(SUM(amount_kobo),0)
		FROM referral_reward_ledger
		WHERE campaign_id = $1 AND state <> 'clawed_back'`
	if err = r.db.QueryRow(ctx, q, campaignID).Scan(&count, &beneficiaries, &sumKobo); err != nil {
		return 0, 0, 0, fmt.Errorf("campaigns: reward stats: %w", err)
	}
	return count, beneficiaries, sumKobo, nil
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func defaultStr(s, def string) string {
	if s == "" {
		return def
	}
	return s
}
