package network

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the parameterized data layer for network/override tables. It also
// reads RB0's referral_attributions and referral_engine_events to compute the
// VERIFIED, HOUSE-EXCLUDED activity base for overrides.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

const ambCols = `id, user_id, tier, status, disclosure_text, disclosure_accepted_at,
	applied_at, approved_by, approved_at`

func scanAmbassador(row pgx.Row) (*Ambassador, error) {
	var (
		a            Ambassador
		disc, apprBy *string
	)
	if err := row.Scan(&a.ID, &a.UserID, &a.Tier, &a.Status, &disc, &a.DisclosureAcceptedAt,
		&a.AppliedAt, &apprBy, &a.ApprovedAt); err != nil {
		return nil, err
	}
	if disc != nil {
		a.DisclosureText = *disc
	}
	if apprBy != nil {
		a.ApprovedBy = *apprBy
	}
	return &a, nil
}

// GetAmbassadorByUser returns a user's ambassador profile (nil row → not found).
func (r *Repository) GetAmbassadorByUser(ctx context.Context, userID string) (*Ambassador, error) {
	q := `SELECT ` + ambCols + ` FROM referral_ambassadors WHERE user_id = $1`
	a, err := scanAmbassador(r.db.QueryRow(ctx, q, userID))
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("network: get ambassador: %w", err)
	}
	return a, nil
}

// Apply upserts an ambassador application with the stored disclosure.
func (r *Repository) Apply(ctx context.Context, userID, tier, disclosure string) (*Ambassador, error) {
	if tier == "" {
		tier = "bronze"
	}
	const q = `
		INSERT INTO referral_ambassadors (user_id, tier, status, disclosure_text, disclosure_accepted_at)
		VALUES ($1, $2, 'applied', $3, now())
		ON CONFLICT (user_id) DO UPDATE SET
			tier = EXCLUDED.tier,
			disclosure_text = EXCLUDED.disclosure_text,
			disclosure_accepted_at = now(),
			updated_at = now()
		RETURNING ` + ambCols
	return scanAmbassador(r.db.QueryRow(ctx, q, userID, tier, disclosure))
}

// SetAmbassadorStatus approves/suspends/rejects an ambassador (admin).
func (r *Repository) SetAmbassadorStatus(ctx context.Context, ambID, status, approvedBy string) error {
	const q = `
		UPDATE referral_ambassadors
		SET status = $2,
		    approved_by = CASE WHEN $2 = 'approved' THEN $3::uuid ELSE approved_by END,
		    approved_at = CASE WHEN $2 = 'approved' THEN now() ELSE approved_at END,
		    updated_at = now()
		WHERE id = $1`
	tag, err := r.db.Exec(ctx, q, ambID, status, nullable(approvedBy))
	if err != nil {
		return fmt.Errorf("network: set ambassador status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("network: ambassador not found")
	}
	return nil
}

// ListAmbassadors returns the ambassador directory (admin), optional status filter.
func (r *Repository) ListAmbassadors(ctx context.Context, status string) ([]Ambassador, error) {
	q := `SELECT ` + ambCols + ` FROM referral_ambassadors`
	var args []any
	if status != "" {
		q += ` WHERE status = $1`
		args = append(args, status)
	}
	q += ` ORDER BY applied_at DESC LIMIT 500`
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("network: list ambassadors: %w", err)
	}
	defer rows.Close()
	out := []Ambassador{}
	for rows.Next() {
		a, err := scanAmbassador(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// NetworksByLead returns networks led by a user (team dashboard).
func (r *Repository) NetworksByLead(ctx context.Context, leadUserID string) ([]Network, error) {
	const q = `
		SELECT id, lead_user_id, name, network_type, status, created_at
		FROM referral_agent_networks WHERE lead_user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, leadUserID)
	if err != nil {
		return nil, fmt.Errorf("network: networks by lead: %w", err)
	}
	defer rows.Close()
	out := []Network{}
	for rows.Next() {
		var n Network
		if err := rows.Scan(&n.ID, &n.LeadUserID, &n.Name, &n.NetworkType, &n.Status, &n.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// GetNetwork returns one network by id.
func (r *Repository) GetNetwork(ctx context.Context, id string) (*Network, error) {
	const q = `SELECT id, lead_user_id, name, network_type, status, created_at
		FROM referral_agent_networks WHERE id = $1`
	var n Network
	if err := r.db.QueryRow(ctx, q, id).Scan(
		&n.ID, &n.LeadUserID, &n.Name, &n.NetworkType, &n.Status, &n.CreatedAt); err != nil {
		return nil, fmt.Errorf("network: get network: %w", err)
	}
	return &n, nil
}

// ListMembers returns a network's members (team dashboard).
func (r *Repository) ListMembers(ctx context.Context, networkID string) ([]Member, error) {
	const q = `
		SELECT id, network_id, member_user_id, is_house_attributed, status, joined_at
		FROM referral_network_members WHERE network_id = $1 AND status = 'active'
		ORDER BY joined_at DESC`
	rows, err := r.db.Query(ctx, q, networkID)
	if err != nil {
		return nil, fmt.Errorf("network: list members: %w", err)
	}
	defer rows.Close()
	out := []Member{}
	for rows.Next() {
		var m Member
		if err := rows.Scan(&m.ID, &m.NetworkID, &m.MemberUserID, &m.IsHouseAttributed, &m.Status, &m.JoinedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// GetMember returns one network membership (network + member pair).
func (r *Repository) GetMember(ctx context.Context, networkID, memberUserID string) (*Member, error) {
	const q = `
		SELECT id, network_id, member_user_id, is_house_attributed, status, joined_at
		FROM referral_network_members WHERE network_id = $1 AND member_user_id = $2`
	var m Member
	err := r.db.QueryRow(ctx, q, networkID, memberUserID).Scan(
		&m.ID, &m.NetworkID, &m.MemberUserID, &m.IsHouseAttributed, &m.Status, &m.JoinedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("network: get member: %w", err)
	}
	return &m, nil
}

// IsHouseAttributed reports whether a user's signup was house-attributed,
// reading RB0's referral_attributions.is_house. House signups are EXCLUDED from
// the override base (§7A.2). A missing attribution row is treated as house-like
// (excluded) to fail closed.
func (r *Repository) IsHouseAttributed(ctx context.Context, userID string) (bool, error) {
	const q = `SELECT is_house FROM referral_attributions WHERE referred_user_id = $1`
	var isHouse bool
	err := r.db.QueryRow(ctx, q, userID).Scan(&isHouse)
	if err == pgx.ErrNoRows {
		return true, nil // no attribution → exclude (fail closed)
	}
	if err != nil {
		return false, fmt.Errorf("network: is house attributed: %w", err)
	}
	return isHouse, nil
}

// VerifiedActivityKobo sums a user's VERIFIED activity/revenue from RB0's
// referral_engine_events qualifying-action / transaction events. The event
// payload carries the activity value in minor units under "value_kobo". Only
// verified, value-bearing events count toward an override base — recruitment
// events (e.g. plain signups) carry no value and contribute nothing.
func (r *Repository) VerifiedActivityKobo(ctx context.Context, userID string) (int64, error) {
	const q = `
		SELECT COALESCE(SUM((payload->>'value_kobo')::bigint), 0)
		FROM referral_engine_events
		WHERE user_id = $1
		  AND event_type IN ('qualifying_action','transaction','verified_revenue')
		  AND (payload->>'value_kobo') IS NOT NULL`
	var sum int64
	if err := r.db.QueryRow(ctx, q, userID).Scan(&sum); err != nil {
		return 0, fmt.Errorf("network: verified activity: %w", err)
	}
	if sum < 0 {
		sum = 0
	}
	return sum, nil
}

// MonthlyOverrideTotal sums a beneficiary's override accruals in the current
// calendar month (for the monthly cap check).
func (r *Repository) MonthlyOverrideTotal(ctx context.Context, beneficiaryID string) (int64, error) {
	const q = `
		SELECT COALESCE(SUM(amount_kobo), 0)
		FROM referral_overrides
		WHERE beneficiary_id = $1 AND created_at >= date_trunc('month', now())`
	var sum int64
	if err := r.db.QueryRow(ctx, q, beneficiaryID).Scan(&sum); err != nil {
		return 0, fmt.Errorf("network: monthly override total: %w", err)
	}
	return sum, nil
}

// RecordOverride inserts an override accrual row (idempotent on idempotency_key).
// Returns the row id and whether it was newly created.
func (r *Repository) RecordOverride(ctx context.Context, o Override, idemKey string) (string, bool, error) {
	const q = `
		INSERT INTO referral_overrides
			(beneficiary_id, network_id, source_user_id, campaign_id, activity_base_kobo,
			 override_bps, amount_kobo, cap_applied_kobo, reward_ledger_id, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		ON CONFLICT (idempotency_key) DO NOTHING
		RETURNING id`
	var id string
	err := r.db.QueryRow(ctx, q,
		o.BeneficiaryID, nullable(o.NetworkID), nullable(o.SourceUserID), nullable(o.CampaignID),
		o.ActivityBaseKobo, o.OverrideBps, o.AmountKobo, o.CapAppliedKobo,
		nullable(o.RewardLedgerID), idemKey).Scan(&id)
	if err == pgx.ErrNoRows {
		var existing string
		if e := r.db.QueryRow(ctx, `SELECT id FROM referral_overrides WHERE idempotency_key = $1`, idemKey).Scan(&existing); e != nil {
			return "", false, fmt.Errorf("network: record override (dup lookup): %w", e)
		}
		return existing, false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("network: record override: %w", err)
	}
	return id, true, nil
}

// SetOverrideLedgerID backfills the reward-ledger id after RB0 accrual.
func (r *Repository) SetOverrideLedgerID(ctx context.Context, overrideID, ledgerID string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE referral_overrides SET reward_ledger_id = $2 WHERE id = $1`, overrideID, nullable(ledgerID))
	if err != nil {
		return fmt.Errorf("network: set override ledger id: %w", err)
	}
	return nil
}

// OverridesByBeneficiary returns a beneficiary's override ledger.
func (r *Repository) OverridesByBeneficiary(ctx context.Context, beneficiaryID string, limit int) ([]Override, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	const q = `
		SELECT id, beneficiary_id, network_id, source_user_id, campaign_id, activity_base_kobo,
		       override_bps, amount_kobo, cap_applied_kobo, reward_ledger_id, created_at
		FROM referral_overrides WHERE beneficiary_id = $1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Query(ctx, q, beneficiaryID, limit)
	if err != nil {
		return nil, fmt.Errorf("network: overrides by beneficiary: %w", err)
	}
	defer rows.Close()
	out := []Override{}
	for rows.Next() {
		var (
			o              Override
			net, src, camp *string
			ledger         *string
		)
		if err := rows.Scan(&o.ID, &o.BeneficiaryID, &net, &src, &camp, &o.ActivityBaseKobo,
			&o.OverrideBps, &o.AmountKobo, &o.CapAppliedKobo, &ledger, &o.CreatedAt); err != nil {
			return nil, err
		}
		if net != nil {
			o.NetworkID = *net
		}
		if src != nil {
			o.SourceUserID = *src
		}
		if camp != nil {
			o.CampaignID = *camp
		}
		if ledger != nil {
			o.RewardLedgerID = *ledger
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// GetPolicy returns the per-tier override policy (nil row → not found).
func (r *Repository) GetPolicy(ctx context.Context, tier string) (*OverridePolicy, error) {
	const q = `SELECT id, tier, override_bps, per_member_cap_kobo, monthly_cap_kobo, is_active
		FROM referral_override_policies WHERE tier = $1`
	var p OverridePolicy
	err := r.db.QueryRow(ctx, q, tier).Scan(
		&p.ID, &p.Tier, &p.OverrideBps, &p.PerMemberCapKobo, &p.MonthlyCapKobo, &p.IsActive)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("network: get policy: %w", err)
	}
	return &p, nil
}

// ListPolicies returns all per-tier override policies.
func (r *Repository) ListPolicies(ctx context.Context) ([]OverridePolicy, error) {
	const q = `SELECT id, tier, override_bps, per_member_cap_kobo, monthly_cap_kobo, is_active
		FROM referral_override_policies ORDER BY tier`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("network: list policies: %w", err)
	}
	defer rows.Close()
	out := []OverridePolicy{}
	for rows.Next() {
		var p OverridePolicy
		if err := rows.Scan(&p.ID, &p.Tier, &p.OverrideBps, &p.PerMemberCapKobo, &p.MonthlyCapKobo, &p.IsActive); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// UpsertPolicy sets a per-tier override policy (admin).
func (r *Repository) UpsertPolicy(ctx context.Context, in PolicyInput) (*OverridePolicy, error) {
	const q = `
		INSERT INTO referral_override_policies (tier, override_bps, per_member_cap_kobo, monthly_cap_kobo, is_active)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (tier) DO UPDATE SET
			override_bps = EXCLUDED.override_bps,
			per_member_cap_kobo = EXCLUDED.per_member_cap_kobo,
			monthly_cap_kobo = EXCLUDED.monthly_cap_kobo,
			is_active = EXCLUDED.is_active,
			updated_at = now()
		RETURNING id, tier, override_bps, per_member_cap_kobo, monthly_cap_kobo, is_active`
	var p OverridePolicy
	if err := r.db.QueryRow(ctx, q, in.Tier, in.OverrideBps, in.PerMemberCapKobo, in.MonthlyCapKobo, in.IsActive).Scan(
		&p.ID, &p.Tier, &p.OverrideBps, &p.PerMemberCapKobo, &p.MonthlyCapKobo, &p.IsActive); err != nil {
		return nil, fmt.Errorf("network: upsert policy: %w", err)
	}
	return &p, nil
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// NetworkSummary is a network with its member count, for the admin directory.
// The count comes from the same members table the override base draws on, so
// what an admin sees matches what actually accrues.
type NetworkSummary struct {
	Network
	MemberCount int `json:"member_count"`
	// HouseAttributedCount members are excluded from override chains (§7A.2);
	// surfacing it lets an admin see how much of a network cannot pay overrides.
	HouseAttributedCount int `json:"house_attributed_count"`
}

// ListNetworks returns every agent network with member counts, newest first.
// status is optional ("" = all).
func (r *Repository) ListNetworks(ctx context.Context, status string) ([]NetworkSummary, error) {
	const q = `
		SELECT n.id, n.lead_user_id, n.name, n.network_type, n.status, n.created_at,
		       COALESCE(m.total, 0)  AS member_count,
		       COALESCE(m.house, 0)  AS house_count
		FROM referral_agent_networks n
		LEFT JOIN (
			SELECT network_id,
			       COUNT(*)                                      AS total,
			       COUNT(*) FILTER (WHERE is_house_attributed)    AS house
			FROM referral_network_members
			GROUP BY network_id
		) m ON m.network_id = n.id
		WHERE ($1 = '' OR n.status = $1)
		ORDER BY n.created_at DESC`

	rows, err := r.db.Query(ctx, q, status)
	if err != nil {
		return nil, fmt.Errorf("network: list networks: %w", err)
	}
	defer rows.Close()

	out := []NetworkSummary{}
	for rows.Next() {
		var n NetworkSummary
		if err := rows.Scan(&n.ID, &n.LeadUserID, &n.Name, &n.NetworkType, &n.Status,
			&n.CreatedAt, &n.MemberCount, &n.HouseAttributedCount); err != nil {
			return nil, fmt.Errorf("network: scan network summary: %w", err)
		}
		out = append(out, n)
	}
	return out, rows.Err()
}
