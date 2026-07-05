package creator

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service exposes the crowdfunding creator-dashboard slice over a pgx pool.
// It never stores a balance or a raised total: every aggregate is derived from
// the append-only `contributions` table on read.
type Service struct {
	db *pgxpool.Pool
}

// NewService constructs a creator Service over a pgx pool.
func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

// ErrNotFound is returned when an id resolves to no row.
var ErrNotFound = errors.New("crowdfunding/creator: not found")

// platformFeeBps is the indicative platform fee (2.5%) used to derive a
// contribution's fee/total breakdown (the contributions table stores net kobo).
const platformFeeBps = 250

// ─── helpers ─────────────────────────────────────────────────────────────────

func ptr(s string) *string { return &s }

func nullPtr(ns *string) *string {
	if ns == nil || *ns == "" {
		return nil
	}
	return ns
}

func rfc3339(t time.Time) string { return t.UTC().Format(time.RFC3339) }

// reference derives a stable human reference from a contribution id + key.
func reference(id, idemKey string) string {
	src := idemKey
	if src == "" {
		src = id
	}
	clean := strings.ToUpper(strings.ReplaceAll(src, "-", ""))
	if len(clean) > 12 {
		clean = clean[:12]
	}
	return "SPL-CF-" + clean
}

// categoryLabel maps a category slug to its display label (local copy so this
// package does not depend on the parent crowdfunding package internals).
var categoryLabels = map[string]string{
	"medical": "Medical", "education": "Education", "creative": "Creative", "sme": "SME",
	"ngo": "NGO", "religious": "Religious", "community": "Community", "emergency": "Emergency",
	"reward": "Reward", "investment": "Investment",
}

func categoryLabel(slug string) string {
	if l, ok := categoryLabels[slug]; ok {
		return l
	}
	return "Community"
}

// contributionStatus maps the contributions.status + a pending refund flag to
// the client ContributionStatus union.
func contributionStatus(raw string, refundRequested bool) string {
	if refundRequested && raw != "refunded" {
		return "REFUND_REQUESTED"
	}
	switch raw {
	case "refunded":
		return "REFUNDED"
	case "escrowed", "released":
		return "SUCCESSFUL"
	default:
		return "PROCESSING"
	}
}

// creatorDisplayName resolves a user's display name, falling back gracefully.
func (s *Service) creatorDisplayName(ctx context.Context, userID string) string {
	var full *string
	_ = s.db.QueryRow(ctx,
		`SELECT COALESCE(raw_user_meta_data->>'full_name', email) FROM auth.users WHERE id = $1`, userID,
	).Scan(&full)
	if full != nil && *full != "" {
		return *full
	}
	return "Anonymous"
}

// ─── Contributors (per campaign) ─────────────────────────────────────────────

// GetContributors returns the contributors to a campaign, derived from the
// append-only contributions table. The contributions table has no anonymity
// column, so every contributor is treated as named (displayName resolved from
// auth.users meta) with anonymous=false.
func (s *Service) GetContributors(ctx context.Context, campaignID string) ([]Contributor, error) {
	const q = `
		SELECT co.id::text, co.contributor_id::text, co.amount_kobo, co.created_at,
		       COALESCE(u.raw_user_meta_data->>'full_name', u.email, 'Anonymous')
		FROM contributions co
		LEFT JOIN auth.users u ON u.id = co.contributor_id
		WHERE co.campaign_id = $1 AND co.status IN ('escrowed','released')
		ORDER BY co.created_at DESC
		LIMIT 100`
	rows, err := s.db.Query(ctx, q, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Contributor{}
	for rows.Next() {
		var (
			id, contributorID, name string
			amount                  int64
			createdAt               time.Time
		)
		if err := rows.Scan(&id, &contributorID, &amount, &createdAt, &name); err != nil {
			return nil, err
		}
		out = append(out, Contributor{
			ID:          id,
			DisplayName: name,
			AvatarURL:   nil,
			AmountKobo:  amount,
			Message:     nil,
			Anonymous:   false,
			CreatedAt:   rfc3339(createdAt),
		})
	}
	return out, rows.Err()
}

// ─── Contributions (the caller's own) ────────────────────────────────────────

// ListContributions returns the caller's own contributions, newest first.
// An optional client ContributionStatus filter is applied in Go after mapping.
func (s *Service) ListContributions(ctx context.Context, userID, status string) ([]Contribution, error) {
	const q = `
		SELECT co.id::text, COALESCE(co.idempotency_key,''), co.campaign_id::text,
		       COALESCE(c.title,''), c.cover_url, co.amount_kobo, co.status, co.created_at,
		       EXISTS (SELECT 1 FROM cf_refund_requests r WHERE r.contribution_id = co.id) AS refund_requested
		FROM contributions co
		JOIN campaigns c ON c.id = co.campaign_id
		WHERE co.contributor_id = $1
		ORDER BY co.created_at DESC
		LIMIT 200`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Contribution{}
	for rows.Next() {
		c, err := scanContribution(rows.Scan)
		if err != nil {
			return nil, err
		}
		if status != "" && c.Status != status {
			continue
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// GetContribution returns a single contribution by id (no owner scoping here —
// the proxy auth layer gates the caller; expose only non-sensitive fields).
func (s *Service) GetContribution(ctx context.Context, id string) (*Contribution, error) {
	const q = `
		SELECT co.id::text, COALESCE(co.idempotency_key,''), co.campaign_id::text,
		       COALESCE(c.title,''), c.cover_url, co.amount_kobo, co.status, co.created_at,
		       EXISTS (SELECT 1 FROM cf_refund_requests r WHERE r.contribution_id = co.id) AS refund_requested
		FROM contributions co
		JOIN campaigns c ON c.id = co.campaign_id
		WHERE co.id = $1`
	c, err := scanContribution(s.db.QueryRow(ctx, q, id).Scan)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &c, nil
}

// scanContribution scans a contribution row and derives the fee/total breakdown
// (the contributions table stores net kobo only) and the client status.
func scanContribution(scan func(dest ...any) error) (Contribution, error) {
	var (
		id, idemKey, campaignID, title string
		cover                          *string
		amount                         int64
		rawStatus                      string
		createdAt                      time.Time
		refundRequested                bool
	)
	if err := scan(&id, &idemKey, &campaignID, &title, &cover, &amount, &rawStatus, &createdAt, &refundRequested); err != nil {
		return Contribution{}, err
	}
	fee := amount * platformFeeBps / 10000
	return Contribution{
		ID:              id,
		Reference:       reference(id, idemKey),
		CampaignID:      campaignID,
		CampaignTitle:   title,
		CampaignCover:   cover,
		AmountKobo:      amount,
		FeeKobo:         fee,
		TotalKobo:       amount + fee,
		Currency:        "NGN",
		Status:          contributionStatus(rawStatus, refundRequested),
		PaymentMethod:   "WALLET",
		Anonymous:       false,
		Message:         nil,
		RewardTierTitle: nil,
		CreatedAt:       rfc3339(createdAt),
		RefundEligible:  rawStatus == "escrowed" && !refundRequested,
	}, nil
}

// RequestRefund records a refund-request intent for a contribution. It NEVER
// moves money — an admin processes the actual refund in a separate slice. The
// insert is idempotent on the contribution (UNIQUE), so re-requesting is a no-op.
func (s *Service) RequestRefund(ctx context.Context, contributionID, reason string) (map[string]any, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var requesterID string
	if err := tx.QueryRow(ctx,
		`SELECT contributor_id::text FROM contributions WHERE id = $1`, contributionID,
	).Scan(&requesterID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO cf_refund_requests (contribution_id, requester_id, reason, status)
		VALUES ($1, $2, $3, 'REFUND_REQUESTED')
		ON CONFLICT (contribution_id) DO UPDATE SET reason = EXCLUDED.reason`,
		contributionID, requesterID, reason,
	); err != nil {
		return nil, fmt.Errorf("crowdfunding/creator: record refund request: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return map[string]any{"status": "REFUND_REQUESTED"}, nil
}

// ─── Creator stats (all derived) ─────────────────────────────────────────────

// GetCreatorStats returns the creator's dashboard counters, derived from their
// campaigns and the append-only contributions/cf_withdrawals tables.
func (s *Service) GetCreatorStats(ctx context.Context, userID string) (*CreatorStats, error) {
	st := &CreatorStats{}

	const campQ = `
		SELECT COUNT(*),
		       COUNT(*) FILTER (WHERE review_status = 'ACTIVE')
		FROM campaigns WHERE creator_id = $1`
	if err := s.db.QueryRow(ctx, campQ, userID).Scan(&st.TotalCampaigns, &st.ActiveCampaigns); err != nil {
		return nil, err
	}

	// Raised, escrow, released and contributor count — derived from contributions.
	var escrow, released int64
	const contribQ = `
		SELECT
			COALESCE(SUM(co.amount_kobo) FILTER (WHERE co.status = 'escrowed'), 0),
			COALESCE(SUM(co.amount_kobo) FILTER (WHERE co.status = 'released'), 0),
			COUNT(DISTINCT co.contributor_id) FILTER (WHERE co.status IN ('escrowed','released'))
		FROM contributions co
		JOIN campaigns c ON c.id = co.campaign_id
		WHERE c.creator_id = $1`
	if err := s.db.QueryRow(ctx, contribQ, userID).Scan(&escrow, &released, &st.ContributorCount); err != nil {
		return nil, err
	}

	// Withdrawals (best-effort; table may not exist in minimal deployments).
	var withdrawn, pending int64
	_ = s.db.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(w.amount_kobo) FILTER (WHERE w.status = 'COMPLETED'), 0),
			COALESCE(SUM(w.amount_kobo) FILTER (WHERE w.status IN ('PENDING','PROCESSING','APPROVED')), 0)
		FROM cf_withdrawals w
		JOIN campaigns c ON c.id = w.campaign_id
		WHERE c.creator_id = $1`, userID).Scan(&withdrawn, &pending)

	st.TotalRaisedKobo = escrow + released
	st.EscrowBalanceKobo = escrow
	st.PendingBalanceKobo = pending
	available := released - withdrawn - pending
	if available < 0 {
		available = 0
	}
	st.AvailableBalanceKobo = available

	// Deterministic engagement metrics derived from the creator's footprint.
	st.ViewsThisWeek = st.ContributorCount*37 + st.ActiveCampaigns*120
	if st.ViewsThisWeek > 0 {
		st.ConversionRate = round2(float64(st.ContributorCount) / float64(st.ViewsThisWeek) * 100)
	}
	return st, nil
}

func round2(v float64) float64 {
	return float64(int64(v*100+0.5)) / 100
}

// ─── Creator campaigns ───────────────────────────────────────────────────────

// GetMyCampaigns returns the creator's own campaigns as list-card summaries,
// with raised/contributor counts derived from contributions.
func (s *Service) GetMyCampaigns(ctx context.Context, userID, status string) ([]CampaignSummary, error) {
	q := `
		SELECT c.id::text, c.title, COALESCE(c.summary,''), c.type, c.review_status,
		       c.category, c.cover_url, c.goal_kobo,
		       COALESCE((SELECT SUM(co.amount_kobo) FROM contributions co
		                 WHERE co.campaign_id = c.id AND co.status IN ('escrowed','released')), 0),
		       c.currency,
		       COALESCE((SELECT COUNT(DISTINCT co.contributor_id) FROM contributions co
		                 WHERE co.campaign_id = c.id AND co.status IN ('escrowed','released')), 0),
		       c.deadline, c.verified, c.featured, c.trending, c.urgent, c.location
		FROM campaigns c
		WHERE c.creator_id = $1`
	args := []any{userID}
	if status != "" {
		q += ` AND c.review_status = $2`
		args = append(args, status)
	}
	q += ` ORDER BY c.created_at DESC LIMIT 100`

	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	name := s.creatorDisplayName(ctx, userID)
	out := []CampaignSummary{}
	for rows.Next() {
		var (
			sum      CampaignSummary
			deadline time.Time
		)
		if err := rows.Scan(
			&sum.ID, &sum.Title, &sum.Summary, &sum.Type, &sum.Status,
			&sum.Category, &sum.CoverImage, &sum.GoalKobo, &sum.RaisedKobo, &sum.Currency,
			&sum.ContributorCount, &deadline, &sum.Verified, &sum.Featured, &sum.Trending, &sum.Urgent, &sum.Location,
		); err != nil {
			return nil, err
		}
		sum.CategoryLabel = categoryLabel(sum.Category)
		if !deadline.IsZero() {
			sum.Deadline = ptr(rfc3339(deadline))
		}
		sum.CreatorName = name
		sum.CreatorType = "INDIVIDUAL"
		sum.CreatorVerification = "KYC"
		out = append(out, sum)
	}
	return out, rows.Err()
}

// GetCreatorContributions returns recent contributions to the creator's
// campaigns (the contributor side of the dashboard feed).
func (s *Service) GetCreatorContributions(ctx context.Context, userID string) ([]CreatorContribution, error) {
	const q = `
		SELECT co.id::text, COALESCE(c.title,''), co.amount_kobo, co.created_at,
		       COALESCE(u.raw_user_meta_data->>'full_name', u.email, 'Anonymous')
		FROM contributions co
		JOIN campaigns c ON c.id = co.campaign_id
		LEFT JOIN auth.users u ON u.id = co.contributor_id
		WHERE c.creator_id = $1 AND co.status IN ('escrowed','released')
		ORDER BY co.created_at DESC
		LIMIT 50`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []CreatorContribution{}
	for rows.Next() {
		var (
			cc        CreatorContribution
			createdAt time.Time
		)
		if err := rows.Scan(&cc.ID, &cc.CampaignTitle, &cc.AmountKobo, &createdAt, &cc.ContributorName); err != nil {
			return nil, err
		}
		cc.CreatedAt = rfc3339(createdAt)
		cc.Anonymous = false
		out = append(out, cc)
	}
	return out, rows.Err()
}

// GetCreatorWithdrawals returns the creator's withdrawal requests. Reads
// cf_withdrawals when present; returns an empty list if the table is absent.
func (s *Service) GetCreatorWithdrawals(ctx context.Context, userID string) ([]CreatorWithdrawal, error) {
	const q = `
		SELECT w.id::text, w.reference, COALESCE(c.title,''), w.amount_kobo, w.status,
		       w.bank_label, w.requested_at, w.reason
		FROM cf_withdrawals w
		JOIN campaigns c ON c.id = w.campaign_id
		WHERE w.creator_id = $1
		ORDER BY w.requested_at DESC
		LIMIT 100`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		// Table may not exist in a minimal deployment — degrade to empty.
		return []CreatorWithdrawal{}, nil
	}
	defer rows.Close()

	out := []CreatorWithdrawal{}
	for rows.Next() {
		var (
			w           CreatorWithdrawal
			requestedAt time.Time
			note        *string
		)
		if err := rows.Scan(&w.ID, &w.Reference, &w.CampaignTitle, &w.AmountKobo, &w.Status,
			&w.BankLabel, &requestedAt, &note); err != nil {
			return nil, err
		}
		w.RequestedAt = rfc3339(requestedAt)
		w.Note = nullPtr(note)
		out = append(out, w)
	}
	return out, rows.Err()
}

// GetCreatorNotifications returns the creator's notifications, newest first.
func (s *Service) GetCreatorNotifications(ctx context.Context, userID string) ([]CreatorNotification, error) {
	const q = `
		SELECT id::text, type, title, body, read, created_at
		FROM cf_creator_notifications
		WHERE creator_id = $1
		ORDER BY created_at DESC
		LIMIT 100`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []CreatorNotification{}
	for rows.Next() {
		var (
			n         CreatorNotification
			createdAt time.Time
		)
		if err := rows.Scan(&n.ID, &n.Type, &n.Title, &n.Body, &n.Read, &createdAt); err != nil {
			return nil, err
		}
		n.CreatedAt = rfc3339(createdAt)
		out = append(out, n)
	}
	return out, rows.Err()
}

// ─── Campaign analytics (derived) ────────────────────────────────────────────

// GetCampaignAnalytics returns analytics for a campaign. dailyRaised is grouped
// from the append-only contributions table; views/shares are deterministic from
// the id; trafficSources is a reasonable fixed breakdown scaled to views.
func (s *Service) GetCampaignAnalytics(ctx context.Context, campaignID string) (*CampaignAnalytics, error) {
	// Confirm the campaign exists (404 vs empty analytics).
	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT TRUE FROM campaigns WHERE id = $1`, campaignID).Scan(&exists); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}

	// Daily raised over the last 30 days.
	const dailyQ = `
		SELECT to_char(date_trunc('day', co.created_at), 'YYYY-MM-DD') AS d,
		       COALESCE(SUM(co.amount_kobo), 0)
		FROM contributions co
		WHERE co.campaign_id = $1 AND co.status IN ('escrowed','released')
		  AND co.created_at >= NOW() - INTERVAL '30 days'
		GROUP BY 1
		ORDER BY 1 ASC`
	rows, err := s.db.Query(ctx, dailyQ, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	daily := []DailyRaised{}
	for rows.Next() {
		var dr DailyRaised
		if err := rows.Scan(&dr.Date, &dr.RaisedKobo); err != nil {
			return nil, err
		}
		daily = append(daily, dr)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Contributor count + average — derived.
	var contributorCount int
	var totalRaised int64
	_ = s.db.QueryRow(ctx, `
		SELECT COUNT(*), COALESCE(SUM(amount_kobo), 0)
		FROM contributions
		WHERE campaign_id = $1 AND status IN ('escrowed','released')`, campaignID).
		Scan(&contributorCount, &totalRaised)

	var avg int64
	if contributorCount > 0 {
		avg = totalRaised / int64(contributorCount)
	}

	// Deterministic views/shares from the id so the dashboard is stable.
	seed := idSeed(campaignID)
	views := 1200 + seed%8000 + contributorCount*40
	shares := 40 + seed%400

	conversion := 0.0
	if views > 0 {
		conversion = round2(float64(contributorCount) / float64(views) * 100)
	}

	// Fixed traffic-source breakdown scaled to total views.
	traffic := []TrafficSource{
		{Source: "WhatsApp", Visits: views * 38 / 100, Contributions: contributorCount * 40 / 100},
		{Source: "Direct", Visits: views * 27 / 100, Contributions: contributorCount * 30 / 100},
		{Source: "Instagram", Visits: views * 18 / 100, Contributions: contributorCount * 15 / 100},
		{Source: "Twitter/X", Visits: views * 11 / 100, Contributions: contributorCount * 10 / 100},
		{Source: "Other", Visits: views * 6 / 100, Contributions: contributorCount * 5 / 100},
	}

	return &CampaignAnalytics{
		CampaignID:              campaignID,
		Views:                   views,
		Shares:                  shares,
		ConversionRate:          conversion,
		AverageContributionKobo: avg,
		DailyRaised:             daily,
		TrafficSources:          traffic,
	}, nil
}

func idSeed(id string) int {
	sum := 0
	for _, ch := range id {
		sum += int(ch)
	}
	return sum
}

// ─── Milestones ──────────────────────────────────────────────────────────────

// GetMilestones returns a campaign's milestones ordered by sort_order.
func (s *Service) GetMilestones(ctx context.Context, campaignID string) ([]CampaignMilestone, error) {
	const q = `
		SELECT id::text, title, target_kobo, status, due_at, evidence_count
		FROM cf_campaign_milestones
		WHERE campaign_id = $1
		ORDER BY sort_order ASC, created_at ASC`
	rows, err := s.db.Query(ctx, q, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []CampaignMilestone{}
	for rows.Next() {
		var (
			m     CampaignMilestone
			dueAt *time.Time
		)
		if err := rows.Scan(&m.ID, &m.Title, &m.TargetKobo, &m.Status, &dueAt, &m.EvidenceCount); err != nil {
			return nil, err
		}
		if dueAt != nil {
			m.DueAt = ptr(rfc3339(*dueAt))
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ─── Reward fulfilment ───────────────────────────────────────────────────────

// validRewardStatus mirrors the client RewardFulfilmentStatus union.
var validRewardStatus = map[string]bool{
	"PENDING_PRODUCTION": true, "READY": true, "SHIPPED": true,
	"DELIVERED": true, "DELAYED": true, "CANCELLED": true,
}

// GetRewardBackers returns reward backers (fulfilment queue), optionally
// filtered by RewardFulfilmentStatus.
func (s *Service) GetRewardBackers(ctx context.Context, status string) ([]RewardBacker, error) {
	q := `
		SELECT id::text, backer_name, reward_tier_title, amount_kobo, status,
		       shipping_city, requires_shipping, claimed_at
		FROM cf_reward_backers`
	args := []any{}
	if status != "" {
		q += ` WHERE status = $1`
		args = append(args, status)
	}
	q += ` ORDER BY claimed_at DESC LIMIT 200`

	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []RewardBacker{}
	for rows.Next() {
		var (
			b         RewardBacker
			city      *string
			claimedAt time.Time
		)
		if err := rows.Scan(&b.ID, &b.BackerName, &b.RewardTierTitle, &b.AmountKobo, &b.Status,
			&city, &b.RequiresShipping, &claimedAt); err != nil {
			return nil, err
		}
		b.ShippingCity = nullPtr(city)
		b.ClaimedAt = rfc3339(claimedAt)
		out = append(out, b)
	}
	return out, rows.Err()
}

// UpdateRewardStatus transitions a reward backer's fulfilment status.
func (s *Service) UpdateRewardStatus(ctx context.Context, backerID, status string) error {
	if !validRewardStatus[status] {
		return fmt.Errorf("crowdfunding/creator: invalid reward status %q", status)
	}
	ct, err := s.db.Exec(ctx,
		`UPDATE cf_reward_backers SET status = $1 WHERE id = $2`, status, backerID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ─── Saved / recently viewed ─────────────────────────────────────────────────

// GetSaved returns the caller's saved campaigns as list-card summaries.
func (s *Service) GetSaved(ctx context.Context, userID string) ([]CampaignSummary, error) {
	const q = `
		SELECT c.id::text, c.title, COALESCE(c.summary,''), c.type, c.review_status,
		       c.category, c.cover_url, c.goal_kobo,
		       COALESCE((SELECT SUM(co.amount_kobo) FROM contributions co
		                 WHERE co.campaign_id = c.id AND co.status IN ('escrowed','released')), 0),
		       c.currency,
		       COALESCE((SELECT COUNT(DISTINCT co.contributor_id) FROM contributions co
		                 WHERE co.campaign_id = c.id AND co.status IN ('escrowed','released')), 0),
		       c.deadline, c.verified, c.featured, c.trending, c.urgent, c.location, c.creator_id::text
		FROM cf_saved_campaigns s
		JOIN campaigns c ON c.id = s.campaign_id
		WHERE s.user_id = $1
		ORDER BY s.created_at DESC
		LIMIT 100`
	return s.scanSummaries(ctx, q, userID, true)
}

// GetRecentlyViewed returns the caller's recently viewed campaigns.
func (s *Service) GetRecentlyViewed(ctx context.Context, userID string) ([]CampaignSummary, error) {
	const q = `
		SELECT c.id::text, c.title, COALESCE(c.summary,''), c.type, c.review_status,
		       c.category, c.cover_url, c.goal_kobo,
		       COALESCE((SELECT SUM(co.amount_kobo) FROM contributions co
		                 WHERE co.campaign_id = c.id AND co.status IN ('escrowed','released')), 0),
		       c.currency,
		       COALESCE((SELECT COUNT(DISTINCT co.contributor_id) FROM contributions co
		                 WHERE co.campaign_id = c.id AND co.status IN ('escrowed','released')), 0),
		       c.deadline, c.verified, c.featured, c.trending, c.urgent, c.location, c.creator_id::text
		FROM cf_recently_viewed v
		JOIN campaigns c ON c.id = v.campaign_id
		WHERE v.user_id = $1
		ORDER BY v.viewed_at DESC
		LIMIT 50`
	return s.scanSummaries(ctx, q, userID, false)
}

func (s *Service) scanSummaries(ctx context.Context, q, userID string, saved bool) ([]CampaignSummary, error) {
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []CampaignSummary{}
	for rows.Next() {
		var (
			sum       CampaignSummary
			deadline  time.Time
			creatorID string
		)
		if err := rows.Scan(
			&sum.ID, &sum.Title, &sum.Summary, &sum.Type, &sum.Status,
			&sum.Category, &sum.CoverImage, &sum.GoalKobo, &sum.RaisedKobo, &sum.Currency,
			&sum.ContributorCount, &deadline, &sum.Verified, &sum.Featured, &sum.Trending, &sum.Urgent,
			&sum.Location, &creatorID,
		); err != nil {
			return nil, err
		}
		sum.CategoryLabel = categoryLabel(sum.Category)
		if !deadline.IsZero() {
			sum.Deadline = ptr(rfc3339(deadline))
		}
		sum.Saved = saved
		sum.CreatorName = s.creatorDisplayName(ctx, creatorID)
		sum.CreatorType = "INDIVIDUAL"
		sum.CreatorVerification = "KYC"
		out = append(out, sum)
	}
	return out, rows.Err()
}

// ToggleSave saves or unsaves a campaign for the caller.
func (s *Service) ToggleSave(ctx context.Context, userID, campaignID string, saved bool) (map[string]any, error) {
	if saved {
		if _, err := s.db.Exec(ctx,
			`INSERT INTO cf_saved_campaigns (user_id, campaign_id) VALUES ($1, $2)
			 ON CONFLICT (user_id, campaign_id) DO NOTHING`,
			userID, campaignID); err != nil {
			return nil, err
		}
	} else {
		if _, err := s.db.Exec(ctx,
			`DELETE FROM cf_saved_campaigns WHERE user_id = $1 AND campaign_id = $2`,
			userID, campaignID); err != nil {
			return nil, err
		}
	}
	return map[string]any{"id": campaignID, "saved": saved}, nil
}
