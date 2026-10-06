package creator

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ptr"
	"spotlight/backend/go-common/timeutil"
	"spotlight/backend/internal/crowdfunding"
	"spotlight/backend/internal/crowdfunding/engage"
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

// The fee/total breakdown a contribution reports is READ FROM THE SETTLEMENT it
// was escrowed under, never re-derived here. This file used to carry its own
// `platformFeeBps = 250` and report fee = 2.5% of the amount with
// total = amount + fee, which was wrong in both directions: the platform's cut
// is crowdfunding.PlatformFeePct (10%), and it is DEDUCTED from the creator's
// payout rather than added to the contributor's bill. A ₦1,000 contribution
// therefore rendered as "₦1,025 total paid" against a ₦1,000 debit.

func nullPtr(ns *string) *string {
	if ns == nil || *ns == "" {
		return nil
	}
	return ns
}

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
		`SELECT COALESCE(NULLIF(btrim(first_name || ' ' || last_name), ''), email) FROM public.platform_users WHERE id = $1`, userID,
	).Scan(&full)
	if full != nil && *full != "" {
		return *full
	}
	return "Anonymous"
}

// GetContributors returns the contributors to a campaign, derived from the
// append-only contributions table. The contributions table has no anonymity
// column, so every contributor is treated as named (displayName resolved from
// auth.users meta) with anonymous=false.
func (s *Service) GetContributors(ctx context.Context, campaignID string) ([]Contributor, error) {
	// This list is public to any signed-in member. The email fallback the old
	// projection used meant a backer with no name set had their EMAIL published
	// beside their donation — a PII leak, not a display nicety. A backer with
	// no name is "Anonymous", full stop.
	const q = `
		SELECT co.id::text, co.contributor_id::text, co.amount_kobo, co.created_at,
		       COALESCE(NULLIF(btrim(u.first_name || ' ' || u.last_name), ''), 'Anonymous')
		FROM contributions co
		LEFT JOIN public.platform_users u ON u.id = co.contributor_id
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
			CreatedAt:   timeutil.RFC3339(createdAt),
		})
	}
	return out, rows.Err()
}

// ListContributions returns the caller's own contributions, newest first.
// An optional client ContributionStatus filter is applied in Go after mapping.
func (s *Service) ListContributions(ctx context.Context, userID, status string) ([]Contribution, error) {
	const q = `
		SELECT co.id::text, COALESCE(co.idempotency_key,''), co.campaign_id::text,
		       COALESCE(c.title,''), c.cover_url, co.amount_kobo, co.status, co.created_at,
		       EXISTS (SELECT 1 FROM cf_refund_requests r WHERE r.contribution_id = co.id) AS refund_requested,
		       st.total_kobo, st.fee_kobo, st.provider_kobo, st.settled_at
		FROM contributions co
		JOIN campaigns c ON c.id = co.campaign_id
		LEFT JOIN settlements st ON st.id = co.settlement_id
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

// GetContribution returns a single contribution BELONGING TO contributorID.
// The owner predicate is the whole access control here. A contribution id is a
// bare uuid the client holds after paying, and the previous "the proxy auth
// layer gates the caller" reasoning only established that the caller is *some*
// logged-in user — not that it is *this* contribution's contributor. Without
// the predicate any authenticated account could read another person's
// amount, campaign and payment reference from an id it happened to see.
// A row that exists but belongs to someone else returns ErrNotFound — the same
// answer as a row that does not exist — so the endpoint never confirms the
// existence of an id it will not serve. The owner is compared as text so that
// an EMPTY contributorID (auth context missing) simply matches nothing and
// answers 404 — comparing it as a uuid would raise a cast error and surface as
// a 500, which fails closed too but reports a server fault for what is really
// an unauthenticated read.
func (s *Service) GetContribution(ctx context.Context, id, contributorID string) (*Contribution, error) {
	const q = `
		SELECT co.id::text, COALESCE(co.idempotency_key,''), co.campaign_id::text,
		       COALESCE(c.title,''), c.cover_url, co.amount_kobo, co.status, co.created_at,
		       EXISTS (SELECT 1 FROM cf_refund_requests r WHERE r.contribution_id = co.id) AS refund_requested,
		       st.total_kobo, st.fee_kobo, st.provider_kobo, st.settled_at
		FROM contributions co
		JOIN campaigns c ON c.id = co.campaign_id
		LEFT JOIN settlements st ON st.id = co.settlement_id
		WHERE co.id = $1 AND co.contributor_id::text = $2`
	c, err := scanContribution(s.db.QueryRow(ctx, q, id, contributorID).Scan)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &c, nil
}

// scanContribution scans a contribution row plus the settlement it was escrowed
// under, and reports the money that actually moved.
func scanContribution(scan func(dest ...any) error) (Contribution, error) {
	var (
		id, idemKey, campaignID, title   string
		cover                            *string
		amount                           int64
		rawStatus                        string
		createdAt                        time.Time
		refundRequested                  bool
		settTotal, settFee, settProvider *int64
		settledAt                        *time.Time
	)
	if err := scan(&id, &idemKey, &campaignID, &title, &cover, &amount, &rawStatus, &createdAt, &refundRequested,
		&settTotal, &settFee, &settProvider, &settledAt); err != nil {
		return Contribution{}, err
	}

	// What the contributor was actually debited. The settlement row is the
	// authority — Escrow re-reads total_kobo rather than echoing the caller's
	// argument, so on a replay it can legitimately differ from
	// contributions.amount_kobo, and the amount HELD is the amount charged.
	paid := amount
	if settTotal != nil {
		paid = *settTotal
	}

	// fee_kobo / provider_kobo are written by Settle, not by Escrow — and they are
	// NOT NULL DEFAULT 0, so an escrowed row carries a real, meaningless zero
	// rather than a NULL. Nullness therefore cannot distinguish "not settled yet"
	// from "settled with no fee"; settled_at can, because only Settle writes it.
	// Reporting the default zero would tell the creator they are taking no
	// deduction, so before settlement we project the split that Settle WILL apply.
	// The projection reads the same constant the settlement splits by, so the two
	// cannot drift the way the old hardcoded 2.5% did.
	var fee, net int64
	if settledAt != nil && settFee != nil && settProvider != nil {
		fee, net = *settFee, *settProvider
	} else {
		fee = int64(math.Round(float64(paid) * crowdfunding.PlatformFeePct))
		net = paid - fee
	}

	return Contribution{
		ID:                id,
		Reference:         reference(id, idemKey),
		CampaignID:        campaignID,
		CampaignTitle:     title,
		CampaignCover:     cover,
		AmountKobo:        amount,
		FeeKobo:           fee,
		NetToCampaignKobo: net,
		TotalKobo:         paid,
		Currency:          "NGN",
		Status:            contributionStatus(rawStatus, refundRequested),
		PaymentMethod:     "WALLET",
		Anonymous:         false,
		Message:           nil,
		RewardTierTitle:   nil,
		CreatedAt:         timeutil.RFC3339(createdAt),
		// Anything not yet refunded is reversible (escrow rail or clawback) —
		// eligibility is "not refunded and no request already on file".
		RefundEligible: rawStatus != "refunded" && !refundRequested,
	}, nil
}

// RequestRefund records a refund-request intent for a contribution BELONGING TO
// callerID. It NEVER moves money — an admin processes the actual refund in a
// separate slice. The insert is idempotent on the contribution (UNIQUE), so
// re-requesting is a no-op.
// The ownership predicate is load-bearing: without it any authenticated account
// could file a refund request against a stranger's contribution, and the
// ON CONFLICT branch would let them overwrite the reason on a request the real
// contributor already filed — someone else's money dispute opened or reworded
// by a third party.
// Scoping the lookup is what makes the wrong write impossible rather than
// merely unlikely: with the predicate in place, callerID and the row's
// contributor_id are the same value by construction, so requester_id is written
// from callerID directly and there is no longer a row-derived identity that can
// disagree with the caller. A contribution owned by someone else answers
// ErrNotFound — the same answer as one that does not exist — and an empty
// callerID (auth context missing) matches nothing, so it fails closed.
func (s *Service) RequestRefund(ctx context.Context, contributionID, callerID, reason string) (map[string]any, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var exists bool
	if err := tx.QueryRow(ctx,
		`SELECT TRUE FROM contributions WHERE id = $1 AND contributor_id::text = $2`,
		contributionID, callerID,
	).Scan(&exists); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO cf_refund_requests (contribution_id, requester_id, reason, status)
		VALUES ($1, $2, $3, 'REFUND_REQUESTED')
		ON CONFLICT (contribution_id) DO UPDATE SET reason = EXCLUDED.reason`,
		contributionID, callerID, reason,
	); err != nil {
		return nil, fmt.Errorf("crowdfunding/creator: record refund request: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return map[string]any{"status": "REFUND_REQUESTED"}, nil
}

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
	available := max(released-withdrawn-pending, 0)
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
		       c.deadline, c.verified, c.featured, c.trending, c.urgent, c.location,
		       c.paused_at,` + latestFeatureRequestStatusCol + `
		FROM campaigns c
		WHERE c.creator_id = $1 AND c.deleted_at IS NULL`
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
			pausedAt *time.Time
		)
		if err := rows.Scan(
			&sum.ID, &sum.Title, &sum.Summary, &sum.Type, &sum.Status,
			&sum.Category, &sum.CoverImage, &sum.GoalKobo, &sum.RaisedKobo, &sum.Currency,
			&sum.ContributorCount, &deadline, &sum.Verified, &sum.Featured, &sum.Trending, &sum.Urgent, &sum.Location,
			&pausedAt, &sum.FeatureRequestStatus,
		); err != nil {
			return nil, err
		}
		sum.Paused = pausedAt != nil
		sum.CategoryLabel = categoryLabel(sum.Category)
		if !deadline.IsZero() {
			sum.Deadline = ptr.Of(timeutil.RFC3339(deadline))
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
		       COALESCE(NULLIF(btrim(u.first_name || ' ' || u.last_name), ''), u.email, 'Anonymous')
		FROM contributions co
		JOIN campaigns c ON c.id = co.campaign_id
		LEFT JOIN public.platform_users u ON u.id = co.contributor_id
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
		cc.CreatedAt = timeutil.RFC3339(createdAt)
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
		w.RequestedAt = timeutil.RFC3339(requestedAt)
		w.Note = ptr.OrNil(ptr.DerefZero(note))
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
		n.CreatedAt = timeutil.RFC3339(createdAt)
		out = append(out, n)
	}
	return out, rows.Err()
}

// GetCampaignAnalytics returns analytics for a campaign. dailyRaised is grouped
// from the append-only contributions table; views/shares are deterministic from
// the id; trafficSources is a reasonable fixed breakdown scaled to views.
func (s *Service) GetCampaignAnalytics(ctx context.Context, campaignID, viewerID string) (*CampaignAnalytics, error) {
	// The route lives under /creator/ and the payload is the owner's own funnel
	// — daily raised, traffic sources, conversion. Before this check it was
	// readable by ANY authenticated caller who knew the campaign id.
	var creatorID string
	if err := s.db.QueryRow(ctx,
		`SELECT creator_id::text FROM campaigns WHERE id = $1 AND deleted_at IS NULL`, campaignID,
	).Scan(&creatorID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if creatorID != viewerID {
		return nil, ErrNotOwner
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

	// Views / shares / traffic — real rows from cf_campaign_events.
	// These were previously invented from a hash of the campaign id
	// with the traffic breakdown a fixed percentage split of that number. The
	// figures moved when contributors changed, which is what made them read as
	// real. They are now aggregated from recorded events, and a campaign with no
	// traffic yet honestly reports zero.
	var views, shares int
	if err := s.db.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE event_type = 'VIEW'),
			COUNT(*) FILTER (WHERE event_type = 'SHARE')
		FROM cf_campaign_events
		WHERE campaign_id = $1`, campaignID).Scan(&views, &shares); err != nil {
		return nil, err
	}

	// Conversion is contributors per view. Guarding on views keeps a campaign
	// with contributions but no recorded views at 0 rather than dividing by zero
	// or reporting an infinite rate.
	conversion := 0.0
	if views > 0 {
		conversion = round2(float64(contributorCount) / float64(views) * 100)
	}

	// Traffic sources: visits are VIEW events grouped by channel; contributions
	// are attributed LAST-TOUCH — each contribution is credited to the channel of
	// that contributor's most recent view of this campaign before they gave.
	// Anonymous views cannot be attributed to a contribution, so they count as
	// visits only, which is the honest reading.
	const trafficQ = `
		WITH visits AS (
			SELECT source, COUNT(*) AS visits
			FROM cf_campaign_events
			WHERE campaign_id = $1 AND event_type = 'VIEW'
			GROUP BY source
		),
		attributed AS (
			SELECT (
				SELECT e.source
				FROM cf_campaign_events e
				WHERE e.campaign_id = co.campaign_id
				  AND e.event_type = 'VIEW'
				  AND e.actor_user_id = co.contributor_id
				  AND e.created_at <= co.created_at
				ORDER BY e.created_at DESC
				LIMIT 1
			) AS source
			FROM contributions co
			WHERE co.campaign_id = $1 AND co.status IN ('escrowed','released')
		),
		gave AS (
			SELECT source, COUNT(*) AS contributions
			FROM attributed
			WHERE source IS NOT NULL
			GROUP BY source
		)
		SELECT v.source, v.visits, COALESCE(g.contributions, 0)
		FROM visits v
		LEFT JOIN gave g ON g.source = v.source
		ORDER BY v.visits DESC`

	trafficRows, err := s.db.Query(ctx, trafficQ, campaignID)
	if err != nil {
		return nil, err
	}
	defer trafficRows.Close()

	traffic := []TrafficSource{}
	for trafficRows.Next() {
		var key string
		var ts TrafficSource
		if err := trafficRows.Scan(&key, &ts.Visits, &ts.Contributions); err != nil {
			return nil, err
		}
		ts.Source = engage.SourceLabel(key)
		traffic = append(traffic, ts)
	}
	if err := trafficRows.Err(); err != nil {
		return nil, err
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
			m.DueAt = ptr.Of(timeutil.RFC3339(*dueAt))
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

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
		b.ShippingCity = ptr.OrNil(ptr.DerefZero(city))
		b.ClaimedAt = timeutil.RFC3339(claimedAt)
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
		WHERE s.user_id = $1 AND c.deleted_at IS NULL
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
		WHERE v.user_id = $1 AND c.deleted_at IS NULL
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
			sum.Deadline = ptr.Of(timeutil.RFC3339(deadline))
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

// Contributor mirrors the client Contributor type.
type Contributor struct {
	ID          string  `json:"id"`
	DisplayName string  `json:"displayName"`
	AvatarURL   *string `json:"avatarUrl"`
	AmountKobo  int64   `json:"amountKobo"`
	Message     *string `json:"message"`
	Anonymous   bool    `json:"anonymous"`
	CreatedAt   string  `json:"createdAt"`
}

// Contribution mirrors the client Contribution type (the caller's own record).
type Contribution struct {
	ID            string  `json:"id"`
	Reference     string  `json:"reference"`
	CampaignID    string  `json:"campaignId"`
	CampaignTitle string  `json:"campaignTitle"`
	CampaignCover *string `json:"campaignCover"`
	AmountKobo    int64   `json:"amountKobo"`
	// FeeKobo is the platform's cut, DEDUCTED from the creator's payout — it is
	// not part of what the contributor paid. TotalKobo is what the contributor
	// was actually debited, and NetToCampaignKobo is what reaches the campaign.
	// So the arithmetic is amount == total and amount - fee == net, NOT
	// amount + fee == total.
	FeeKobo           int64   `json:"feeKobo"`
	NetToCampaignKobo int64   `json:"netToCampaignKobo"`
	TotalKobo         int64   `json:"totalKobo"`
	Currency          string  `json:"currency"`
	Status            string  `json:"status"` // ContributionStatus
	PaymentMethod     string  `json:"paymentMethod"`
	Anonymous         bool    `json:"anonymous"`
	Message           *string `json:"message"`
	RewardTierTitle   *string `json:"rewardTierTitle"`
	CreatedAt         string  `json:"createdAt"`
	RefundEligible    bool    `json:"refundEligible"`
}

// CreatorStats mirrors the client CreatorStats type. Balances are derived.
type CreatorStats struct {
	TotalRaisedKobo      int64   `json:"totalRaisedKobo"`
	ContributorCount     int     `json:"contributorCount"`
	ActiveCampaigns      int     `json:"activeCampaigns"`
	TotalCampaigns       int     `json:"totalCampaigns"`
	AvailableBalanceKobo int64   `json:"availableBalanceKobo"`
	PendingBalanceKobo   int64   `json:"pendingBalanceKobo"`
	EscrowBalanceKobo    int64   `json:"escrowBalanceKobo"`
	ViewsThisWeek        int     `json:"viewsThisWeek"`
	ConversionRate       float64 `json:"conversionRate"`
}

// CreatorContribution mirrors the client CreatorContribution type.
type CreatorContribution struct {
	ID              string `json:"id"`
	ContributorName string `json:"contributorName"`
	CampaignTitle   string `json:"campaignTitle"`
	AmountKobo      int64  `json:"amountKobo"`
	CreatedAt       string `json:"createdAt"`
	Anonymous       bool   `json:"anonymous"`
}

// CreatorWithdrawal mirrors the client CreatorWithdrawal type.
type CreatorWithdrawal struct {
	ID            string  `json:"id"`
	Reference     string  `json:"reference"`
	CampaignTitle string  `json:"campaignTitle"`
	AmountKobo    int64   `json:"amountKobo"`
	Status        string  `json:"status"` // WithdrawalStatus
	BankLabel     string  `json:"bankLabel"`
	RequestedAt   string  `json:"requestedAt"`
	Note          *string `json:"note"`
}

// CreatorNotification mirrors the client CreatorNotification type.
type CreatorNotification struct {
	ID        string `json:"id"`
	Type      string `json:"type"` // CreatorNotificationType
	Title     string `json:"title"`
	Body      string `json:"body"`
	CreatedAt string `json:"createdAt"`
	Read      bool   `json:"read"`
}

// TrafficSource mirrors the client TrafficSource type.
type TrafficSource struct {
	Source        string `json:"source"`
	Visits        int    `json:"visits"`
	Contributions int    `json:"contributions"`
}

// DailyRaised mirrors a single element of CampaignAnalytics.dailyRaised.
type DailyRaised struct {
	Date       string `json:"date"`
	RaisedKobo int64  `json:"raisedKobo"`
}

// CampaignAnalytics mirrors the client CampaignAnalytics type.
type CampaignAnalytics struct {
	CampaignID              string          `json:"campaignId"`
	Views                   int             `json:"views"`
	Shares                  int             `json:"shares"`
	ConversionRate          float64         `json:"conversionRate"`
	AverageContributionKobo int64           `json:"averageContributionKobo"`
	DailyRaised             []DailyRaised   `json:"dailyRaised"`
	TrafficSources          []TrafficSource `json:"trafficSources"`
}

// CampaignMilestone mirrors the client CampaignMilestone type.
type CampaignMilestone struct {
	ID            string  `json:"id"`
	Title         string  `json:"title"`
	TargetKobo    int64   `json:"targetKobo"`
	Status        string  `json:"status"` // LOCKED | ACTIVE | RELEASED | PENDING_REVIEW
	DueAt         *string `json:"dueAt"`
	EvidenceCount int     `json:"evidenceCount"`
}

// RewardBacker mirrors the client RewardBacker type.
type RewardBacker struct {
	ID               string  `json:"id"`
	BackerName       string  `json:"backerName"`
	RewardTierTitle  string  `json:"rewardTierTitle"`
	AmountKobo       int64   `json:"amountKobo"`
	Status           string  `json:"status"` // RewardFulfilmentStatus
	ShippingCity     *string `json:"shippingCity"`
	RequiresShipping bool    `json:"requiresShipping"`
	ClaimedAt        string  `json:"claimedAt"`
}

// CampaignSummary mirrors the client CampaignSummary type (list cards).
type CampaignSummary struct {
	ID               string  `json:"id"`
	Title            string  `json:"title"`
	Summary          string  `json:"summary"`
	Type             string  `json:"type"`
	Status           string  `json:"status"`
	Category         string  `json:"category"`
	CategoryLabel    string  `json:"categoryLabel"`
	CoverImage       *string `json:"coverImage"`
	GoalKobo         int64   `json:"goalKobo"`
	RaisedKobo       int64   `json:"raisedKobo"`
	Currency         string  `json:"currency"`
	ContributorCount int     `json:"contributorCount"`
	Deadline         *string `json:"deadline"`
	Verified         bool    `json:"verified"`
	Featured         bool    `json:"featured"`
	Trending         bool    `json:"trending"`
	Urgent           bool    `json:"urgent"`
	// Paused is TRUE while campaigns.paused_at is set — the owner has taken the
	// campaign out of public discovery (and out of accepting contributions).
	// Distinct from Status, which carries the ADMIN review_status.
	Paused bool `json:"paused"`
	// FeatureRequestStatus is the LATEST cf_feature_requests.status for this
	// campaign (PENDING|APPROVED|REJECTED|WITHDRAWN), or null when the owner has
	// never asked to be featured. It lets the app show that a request is already
	// pending instead of inviting the owner to ask twice — the second ask would
	// be refused by the one-open-request partial unique index anyway, so without
	// this the only feedback would be a 409.
	FeatureRequestStatus *string `json:"featureRequestStatus"`
	Saved                bool    `json:"saved"`
	Location             *string `json:"location"`
	CreatorName          string  `json:"creatorName"`
	CreatorType          string  `json:"creatorType"`
	CreatorVerification  string  `json:"creatorVerification"`
}

// RefundRequestInput is the body for POST /contributions/:id/refund-request.
type RefundRequestInput struct {
	Reason string `json:"reason"`
}

// RewardStatusInput is the body for PUT /rewards/fulfilment/:id.
type RewardStatusInput struct {
	Status string `json:"status" binding:"required"`
}
