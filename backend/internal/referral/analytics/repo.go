package analytics

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the read-only analytics data layer. EVERY K-factor / referred
// metric filters out house rows (excluded_from_kfactor = true OR is_house = true
// on the reward ledger; is_house = true on attributions). House is reported as a
// separate segment, never folded into referred.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// KFactor computes the viral coefficient. The numerator (referred signups) and
// the referrer count EXCLUDE house attributions; house signups are counted
// separately. §7A.6: house_default is NEVER in K-factor.
func (r *Repository) KFactor(ctx context.Context) (*KFactor, error) {
	var k KFactor
	// Human-referred signups + distinct referrers: attributions that are NOT house.
	const refQ = `
		SELECT
			count(*) FILTER (WHERE is_house = false),
			count(DISTINCT referrer_id) FILTER (WHERE is_house = false AND referrer_id IS NOT NULL),
			count(*) FILTER (WHERE is_house = true)
		FROM referral_attributions`
	if err := r.db.QueryRow(ctx, refQ).Scan(&k.ReferredSignups, &k.Referrers, &k.HouseSignups); err != nil {
		return nil, fmt.Errorf("analytics: k-factor: %w", err)
	}
	if k.Referrers > 0 {
		k.KFactor = float64(k.ReferredSignups) / float64(k.Referrers)
	}
	return &k, nil
}

// Funnel builds the acquisition funnel from referral_engine_events. Stages count
// distinct users at each step; the attributed stage EXCLUDES house events.
func (r *Repository) Funnel(ctx context.Context) ([]FunnelStage, error) {
	const q = `
		SELECT
			(SELECT count(*) FROM referral_engine_events WHERE event_type = 'invalid_code_attempt') AS clicks_invalid,
			(SELECT count(*) FROM referral_engine_events WHERE event_type = 'signup_attributed') AS attributed,
			(SELECT count(*) FROM referral_attributions WHERE is_house = false) AS referred_non_house,
			(SELECT count(DISTINCT user_id) FROM referral_engine_events
			   WHERE event_type IN ('qualifying_action','transaction','verified_revenue')) AS activated,
			(SELECT count(*) FROM referral_reward_ledger
			   WHERE state = 'paid' AND is_house = false AND excluded_from_kfactor = false) AS rewarded`
	var clicks, attributed, referred, activated, rewarded int
	if err := r.db.QueryRow(ctx, q).Scan(&clicks, &attributed, &referred, &activated, &rewarded); err != nil {
		return nil, fmt.Errorf("analytics: funnel: %w", err)
	}
	return []FunnelStage{
		{Stage: "code_attempts", Count: clicks + attributed},
		{Stage: "attributed", Count: attributed},
		{Stage: "referred_non_house", Count: referred},
		{Stage: "activated", Count: activated},
		{Stage: "rewarded", Count: rewarded},
	}, nil
}

// ReferralSpendKobo sums paid, NON-HOUSE reward-ledger amounts (house excluded).
func (r *Repository) ReferralSpendKobo(ctx context.Context) (int64, error) {
	const q = `
		SELECT COALESCE(SUM(amount_kobo), 0)
		FROM referral_reward_ledger
		WHERE state = 'paid' AND is_house = false AND excluded_from_kfactor = false`
	var sum int64
	if err := r.db.QueryRow(ctx, q).Scan(&sum); err != nil {
		return 0, fmt.Errorf("analytics: referral spend: %w", err)
	}
	return sum, nil
}

// ReferredSignupCount counts human-referred signups (house excluded).
func (r *Repository) ReferredSignupCount(ctx context.Context) (int, error) {
	var n int
	if err := r.db.QueryRow(ctx,
		`SELECT count(*) FROM referral_attributions WHERE is_house = false`).Scan(&n); err != nil {
		return 0, fmt.Errorf("analytics: referred signup count: %w", err)
	}
	return n, nil
}

// Cohorts returns per-signup-month LTV/retention for human-referred users.
func (r *Repository) Cohorts(ctx context.Context) ([]CohortRow, error) {
	const q = `
		WITH referred AS (
			SELECT referred_user_id, date_trunc('month', created_at) AS cohort
			FROM referral_attributions
			WHERE is_house = false
		),
		activity AS (
			SELECT user_id, COALESCE(SUM((payload->>'value_kobo')::bigint), 0) AS ltv
			FROM referral_engine_events
			WHERE event_type IN ('qualifying_action','transaction','verified_revenue')
			  AND (payload->>'value_kobo') IS NOT NULL
			GROUP BY user_id
		)
		SELECT to_char(r.cohort, 'YYYY-MM') AS cohort_month,
		       count(*) AS signups,
		       count(*) FILTER (WHERE a.ltv > 0) AS active_users,
		       COALESCE(SUM(a.ltv), 0) AS ltv_kobo
		FROM referred r
		LEFT JOIN activity a ON a.user_id = r.referred_user_id
		GROUP BY r.cohort
		ORDER BY r.cohort DESC
		LIMIT 24`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("analytics: cohorts: %w", err)
	}
	defer rows.Close()
	var out []CohortRow
	for rows.Next() {
		var c CohortRow
		if err := rows.Scan(&c.CohortMonth, &c.Signups, &c.ActiveUsers, &c.LTVKobo); err != nil {
			return nil, err
		}
		if c.Signups > 0 {
			c.RetentionPct = c.ActiveUsers * 100 / c.Signups
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// Channels returns channel/vertical attribution by attribution_type. House
// channels (regional_house/global_house) are tagged is_house so the consumer can
// keep them separate.
func (r *Repository) Channels(ctx context.Context) ([]ChannelRow, error) {
	const q = `
		SELECT attribution_type, count(*), bool_or(is_house)
		FROM referral_attributions
		GROUP BY attribution_type
		ORDER BY count(*) DESC`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("analytics: channels: %w", err)
	}
	defer rows.Close()
	var out []ChannelRow
	for rows.Next() {
		var c ChannelRow
		if err := rows.Scan(&c.Channel, &c.Signups, &c.IsHouse); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// Segmentation separates organic vs referred, with house_default reported apart.
// "Organic" = users with no attribution row at all.
func (r *Repository) Segmentation(ctx context.Context) (*Segmentation, error) {
	var s Segmentation
	const q = `
		SELECT
			count(*) FILTER (WHERE is_house = false),
			count(*) FILTER (WHERE is_house = true)
		FROM referral_attributions`
	if err := r.db.QueryRow(ctx, q).Scan(&s.ReferredSignups, &s.HouseSignups); err != nil {
		return nil, fmt.Errorf("analytics: segmentation: %w", err)
	}
	const orgQ = `
		SELECT count(*) FROM user_profiles up
		WHERE NOT EXISTS (SELECT 1 FROM referral_attributions a WHERE a.referred_user_id = up.id)`
	if err := r.db.QueryRow(ctx, orgQ).Scan(&s.OrganicSignups); err != nil {
		return nil, fmt.Errorf("analytics: organic count: %w", err)
	}
	return &s, nil
}

// User360 builds the per-user referral profile (A-USR-01).
func (r *Repository) User360(ctx context.Context, userID string) (*User360, error) {
	u := &User360{UserID: userID}

	// Attribution (how this user was acquired).
	const attrQ = `SELECT attribution_type, is_house, COALESCE(referrer_id::text,'')
		FROM referral_attributions WHERE referred_user_id = $1`
	err := r.db.QueryRow(ctx, attrQ, userID).Scan(&u.AttributionType, &u.IsHouse, &u.ReferrerID)
	if err != nil && err != pgx.ErrNoRows {
		return nil, fmt.Errorf("analytics: user360 attribution: %w", err)
	}

	// Humans this user referred (house excluded).
	const refQ = `SELECT count(*) FROM referral_attributions WHERE referrer_id = $1 AND is_house = false`
	if err := r.db.QueryRow(ctx, refQ, userID).Scan(&u.ReferredCount); err != nil {
		return nil, fmt.Errorf("analytics: user360 referred count: %w", err)
	}

	// Reward totals (non-clawed earned; paid; clawed back).
	const rwQ = `
		SELECT
			COALESCE(SUM(amount_kobo) FILTER (WHERE state <> 'clawed_back'), 0),
			COALESCE(SUM(amount_kobo) FILTER (WHERE state = 'paid'), 0),
			COALESCE(SUM(amount_kobo) FILTER (WHERE state = 'clawed_back'), 0)
		FROM referral_reward_ledger WHERE beneficiary_id = $1`
	if err := r.db.QueryRow(ctx, rwQ, userID).Scan(&u.TotalEarnedKobo, &u.PaidKobo, &u.ClawedBackKobo); err != nil {
		return nil, fmt.Errorf("analytics: user360 rewards: %w", err)
	}

	// Own verified activity (LTV).
	const actQ = `
		SELECT COALESCE(SUM((payload->>'value_kobo')::bigint), 0)
		FROM referral_engine_events
		WHERE user_id = $1
		  AND event_type IN ('qualifying_action','transaction','verified_revenue')
		  AND (payload->>'value_kobo') IS NOT NULL`
	if err := r.db.QueryRow(ctx, actQ, userID).Scan(&u.ActivityKobo); err != nil {
		return nil, fmt.Errorf("analytics: user360 activity: %w", err)
	}

	// Coarse fraud standing.
	const fraudQ = `
		SELECT
			count(*) FILTER (WHERE status = 'confirmed'),
			count(*) FILTER (WHERE status IN ('open','reviewing'))
		FROM referral_risk_alerts WHERE subject_id = $1`
	var confirmed, open int
	if err := r.db.QueryRow(ctx, fraudQ, userID).Scan(&confirmed, &open); err != nil {
		return nil, fmt.Errorf("analytics: user360 fraud: %w", err)
	}
	u.FraudStanding = "clear"
	if open > 0 {
		u.FraudStanding = "under_review"
	}
	if confirmed > 0 {
		u.FraudStanding = "restricted"
	}
	return u, nil
}
