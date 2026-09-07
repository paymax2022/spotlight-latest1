package adminext

// Campaign directory — the "show me every campaign" surface the admin console
// never had.
//
// What existed before: GET /admin/campaigns is AdminListPending, which returns
// campaigns awaiting review (default PENDING_REVIEW), capped at 60, with no
// pagination, no funding figures and no backer counts. Every other admin route
// addresses ONE campaign by id (flags, freeze, decision). So an operator could
// moderate the queue but could not answer "what campaigns exist, who funded
// them, and how much have they raised".
//
// These routes are additive and live on their own paths. The list is deliberately
// NOT mounted at /campaigns: that path already belongs to the review queue, and
// Gin cannot register a static sibling next to the existing /campaigns/:id
// wildcard anyway.

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// ── models ──────────────────────────────────────────────────────────────────

// CampaignDirectoryRow is one line of the directory: the campaign, who owns it,
// how it is classified, and what it has actually raised.
type CampaignDirectoryRow struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Category     string `json:"category"`
	Type         string `json:"type"`
	Status       string `json:"status"`
	ReviewStatus string `json:"reviewStatus"`

	CreatorID   string `json:"creatorId"`
	CreatorName string `json:"creatorName"`

	GoalKobo      int64   `json:"goalKobo"`
	RaisedKobo    int64   `json:"raisedKobo"`
	PercentOfGoal float64 `json:"percentOfGoal"`
	// BackerCount counts DISTINCT contributors, not contributions — the same
	// person funding twice is one backer. campaigns.contributor_count is a
	// denormalised column and is reported separately so a drift is visible
	// rather than hidden behind one number.
	BackerCount            int `json:"backerCount"`
	ContributionCount      int `json:"contributionCount"`
	StoredContributorCount int `json:"storedContributorCount"`

	Verified bool `json:"verified"`
	Featured bool `json:"featured"`
	Trending bool `json:"trending"`
	Urgent   bool `json:"urgent"`
	Frozen   bool `json:"frozen"`

	RiskLevel string `json:"riskLevel"`
	RiskScore int    `json:"riskScore"`

	Deadline  string `json:"deadline"`
	CreatedAt string `json:"createdAt"`
}

// CampaignDirectoryPage carries the page plus the unfiltered-by-page total, so
// the console can show "showing 20 of 137" rather than guessing from a full page.
type CampaignDirectoryPage struct {
	Rows  []CampaignDirectoryRow `json:"rows"`
	Total int                    `json:"total"`
	Page  int                    `json:"page"`
	Limit int                    `json:"limit"`
}

// CampaignBacker is one contribution with the contributor's identity attached.
type CampaignBacker struct {
	ContributionID   string `json:"contributionId"`
	ContributorID    string `json:"contributorId"`
	ContributorName  string `json:"contributorName"`
	ContributorEmail string `json:"contributorEmail"`
	AmountKobo       int64  `json:"amountKobo"`
	Status           string `json:"status"`
	CreatedAt        string `json:"createdAt"`
}

// CampaignBackersPage is a page of backers plus the totals for the whole
// campaign, so paging never changes the headline figures.
type CampaignBackersPage struct {
	Backers     []CampaignBacker `json:"backers"`
	Total       int              `json:"total"`
	Page        int              `json:"page"`
	Limit       int              `json:"limit"`
	RaisedKobo  int64            `json:"raisedKobo"`
	BackerCount int              `json:"backerCount"`
}

// StatusBreakdown is a count+amount for one contribution status.
type StatusBreakdown struct {
	Status     string `json:"status"`
	Count      int    `json:"count"`
	AmountKobo int64  `json:"amountKobo"`
}

// CampaignFunding is the money rollup for one campaign.
//
// Refunds and settlements are ABSENT on purpose. cf_refunds has no campaign_id —
// it carries a denormalised campaign_title — and cf_settlements is platform-wide
// with no campaign link either. Joining refunds on a title would be a guess that
// breaks on two campaigns sharing a name and on any retitle, so this reports what
// the schema can actually attribute and the console says the rest lives on the
// finance pages.
type CampaignFunding struct {
	CampaignID              string `json:"campaignId"`
	GoalKobo                int64  `json:"goalKobo"`
	RaisedKobo              int64  `json:"raisedKobo"`
	BackerCount             int    `json:"backerCount"`
	ContributionCount       int    `json:"contributionCount"`
	AverageContributionKobo int64  `json:"averageContributionKobo"`
	LargestContributionKobo int64  `json:"largestContributionKobo"`
	FirstContributionAt     string `json:"firstContributionAt"`
	LastContributionAt      string `json:"lastContributionAt"`

	ByStatus []StatusBreakdown `json:"byStatus"`

	WithdrawnKobo         int64 `json:"withdrawnKobo"`
	WithdrawalCount       int   `json:"withdrawalCount"`
	PendingWithdrawalKobo int64 `json:"pendingWithdrawalKobo"`

	MilestoneCount     int `json:"milestoneCount"`
	MilestonesReleased int `json:"milestonesReleased"`
}

// CampaignDirectoryFilter is what the console can narrow by.
type CampaignDirectoryFilter struct {
	Status       string
	ReviewStatus string
	Category     string
	Search       string
	Flag         string // featured | verified | frozen | trending | urgent
	Sort         string // recent | raised | goal | backers | deadline
	Page         int
	Limit        int
}

// ── service ─────────────────────────────────────────────────────────────────

// ListCampaignDirectory returns one page of campaigns with their funding
// aggregates.
//
// The aggregates are computed in a LATERAL subquery rather than a GROUP BY over
// a join: a campaign with no contributions must still appear (a LEFT JOIN with
// GROUP BY would too, but the LATERAL keeps the row shape flat and lets the
// count be DISTINCT contributors without also collapsing the campaign columns).
func (s *Service) ListCampaignDirectory(ctx context.Context, f CampaignDirectoryFilter) (CampaignDirectoryPage, error) {
	page := f.Page
	if page < 1 {
		page = 1
	}
	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 25
	}
	offset := (page - 1) * limit

	where := []string{"c.deleted_at IS NULL"}
	args := []any{}
	add := func(clause string, val any) {
		args = append(args, val)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}

	if v := strings.TrimSpace(f.Status); v != "" {
		add("c.status = $%d", v)
	}
	if v := strings.TrimSpace(f.ReviewStatus); v != "" {
		add("c.review_status = $%d", v)
	}
	if v := strings.TrimSpace(f.Category); v != "" {
		add("c.category = $%d", v)
	}
	if v := strings.TrimSpace(f.Search); v != "" {
		// One placeholder referenced twice, so this is built directly rather than
		// through add(), which assumes a single reference. Title match or an exact
		// creator id, which is how an operator arrives from the users console.
		// The leading wildcard cannot use a btree index; acceptable for an
		// operator console, and the row cap keeps it bounded.
		args = append(args, v)
		where = append(where, fmt.Sprintf(
			"(c.title ILIKE '%%' || $%d || '%%' OR c.creator_id::text = $%d)", len(args), len(args)))
	}
	switch strings.ToLower(strings.TrimSpace(f.Flag)) {
	case "featured":
		where = append(where, "c.featured IS TRUE")
	case "verified":
		where = append(where, "c.verified IS TRUE")
	case "trending":
		where = append(where, "c.trending IS TRUE")
	case "urgent":
		where = append(where, "c.urgent IS TRUE")
	case "frozen":
		// Two mechanisms exist and both mean frozen. SetCampaignFreeze writes
		// review_status='FROZEN' (adminext/service.go) while the public discovery
		// query gates on paused_at (query.go, migration 20270112000000). Checking
		// only paused_at would have shown every admin-frozen campaign as live.
		where = append(where, "(c.review_status = 'FROZEN' OR c.paused_at IS NOT NULL)")
	}

	order := "c.created_at DESC"
	switch strings.ToLower(strings.TrimSpace(f.Sort)) {
	case "raised":
		order = "agg.raised_kobo DESC NULLS LAST"
	case "goal":
		order = "c.goal_kobo DESC NULLS LAST"
	case "backers":
		order = "agg.backer_count DESC NULLS LAST"
	case "deadline":
		order = "c.deadline ASC NULLS LAST"
	}

	whereSQL := "WHERE " + strings.Join(where, " AND ")

	q := fmt.Sprintf(`
		SELECT c.id::text, c.title, COALESCE(c.category,''), COALESCE(c.type,''),
		       COALESCE(c.status,''), COALESCE(c.review_status,''),
		       c.creator_id::text, COALESCE(up.full_name, up.email, ''),
		       COALESCE(c.goal_kobo,0), COALESCE(agg.raised_kobo,0),
		       COALESCE(agg.backer_count,0), COALESCE(agg.contribution_count,0),
		       COALESCE(c.contributor_count,0),
		       COALESCE(c.verified,false), COALESCE(c.featured,false),
		       COALESCE(c.trending,false), COALESCE(c.urgent,false),
		       (c.review_status = 'FROZEN' OR c.paused_at IS NOT NULL),
		       COALESCE(c.risk_level,''), COALESCE(c.risk_score,0),
		       c.deadline, c.created_at,
		       COUNT(*) OVER() AS total
		  FROM campaigns c
		  LEFT JOIN user_profiles up ON up.id = c.creator_id
		  LEFT JOIN LATERAL (
		        SELECT COALESCE(SUM(k.amount_kobo),0)          AS raised_kobo,
		               COUNT(DISTINCT k.contributor_id)         AS backer_count,
		               COUNT(*)                                 AS contribution_count
		          FROM contributions k
		         WHERE k.campaign_id = c.id
		  ) agg ON TRUE
		  %s
		 ORDER BY %s
		 LIMIT %d OFFSET %d`, whereSQL, order, limit, offset)

	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return CampaignDirectoryPage{}, err
	}
	defer rows.Close()

	out := CampaignDirectoryPage{Rows: []CampaignDirectoryRow{}, Page: page, Limit: limit}
	for rows.Next() {
		var r CampaignDirectoryRow
		var deadline, createdAt *time.Time
		var total int
		if err := rows.Scan(&r.ID, &r.Title, &r.Category, &r.Type, &r.Status, &r.ReviewStatus,
			&r.CreatorID, &r.CreatorName, &r.GoalKobo, &r.RaisedKobo,
			&r.BackerCount, &r.ContributionCount, &r.StoredContributorCount,
			&r.Verified, &r.Featured, &r.Trending, &r.Urgent, &r.Frozen,
			&r.RiskLevel, &r.RiskScore, &deadline, &createdAt, &total); err != nil {
			return CampaignDirectoryPage{}, err
		}
		if deadline != nil {
			r.Deadline = rfc3339(*deadline)
		}
		if createdAt != nil {
			r.CreatedAt = rfc3339(*createdAt)
		}
		if r.GoalKobo > 0 {
			r.PercentOfGoal = float64(r.RaisedKobo) / float64(r.GoalKobo) * 100
		}
		out.Total = total
		out.Rows = append(out.Rows, r)
	}
	return out, rows.Err()
}

// ListCampaignBackers returns who funded a campaign, newest first.
func (s *Service) ListCampaignBackers(ctx context.Context, campaignID string, page, limit int) (CampaignBackersPage, error) {
	if page < 1 {
		page = 1
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	offset := (page - 1) * limit

	q := `
		SELECT k.id::text, k.contributor_id::text,
		       COALESCE(up.full_name,''), COALESCE(up.email,''),
		       k.amount_kobo, COALESCE(k.status,''), k.created_at,
		       COUNT(*) OVER() AS total
		  FROM contributions k
		  LEFT JOIN user_profiles up ON up.id = k.contributor_id
		 WHERE k.campaign_id = $1
		 ORDER BY k.created_at DESC
		 LIMIT $2 OFFSET $3`
	rows, err := s.db.Query(ctx, q, campaignID, limit, offset)
	if err != nil {
		return CampaignBackersPage{}, err
	}
	defer rows.Close()

	out := CampaignBackersPage{Backers: []CampaignBacker{}, Page: page, Limit: limit}
	for rows.Next() {
		var b CampaignBacker
		var createdAt time.Time
		var total int
		if err := rows.Scan(&b.ContributionID, &b.ContributorID, &b.ContributorName,
			&b.ContributorEmail, &b.AmountKobo, &b.Status, &createdAt, &total); err != nil {
			return CampaignBackersPage{}, err
		}
		b.CreatedAt = rfc3339(createdAt)
		out.Total = total
		out.Backers = append(out.Backers, b)
	}
	if err := rows.Err(); err != nil {
		return CampaignBackersPage{}, err
	}

	// Campaign-wide totals, independent of the page being viewed.
	if err := s.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_kobo),0), COUNT(DISTINCT contributor_id)
		  FROM contributions WHERE campaign_id = $1`, campaignID).
		Scan(&out.RaisedKobo, &out.BackerCount); err != nil {
		return CampaignBackersPage{}, err
	}
	return out, nil
}

// CampaignFundingRollup answers "where does this campaign's money stand".
func (s *Service) CampaignFundingRollup(ctx context.Context, campaignID string) (CampaignFunding, error) {
	f := CampaignFunding{CampaignID: campaignID, ByStatus: []StatusBreakdown{}}

	if err := s.db.QueryRow(ctx, `SELECT COALESCE(goal_kobo,0) FROM campaigns WHERE id=$1`, campaignID).
		Scan(&f.GoalKobo); err != nil {
		return CampaignFunding{}, err
	}

	var first, last *time.Time
	if err := s.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_kobo),0), COUNT(DISTINCT contributor_id), COUNT(*),
		       COALESCE(MAX(amount_kobo),0), MIN(created_at), MAX(created_at)
		  FROM contributions WHERE campaign_id=$1`, campaignID).
		Scan(&f.RaisedKobo, &f.BackerCount, &f.ContributionCount,
			&f.LargestContributionKobo, &first, &last); err != nil {
		return CampaignFunding{}, err
	}
	if f.ContributionCount > 0 {
		f.AverageContributionKobo = f.RaisedKobo / int64(f.ContributionCount)
	}
	if first != nil {
		f.FirstContributionAt = rfc3339(*first)
	}
	if last != nil {
		f.LastContributionAt = rfc3339(*last)
	}

	rows, err := s.db.Query(ctx, `
		SELECT COALESCE(status,''), COUNT(*), COALESCE(SUM(amount_kobo),0)
		  FROM contributions WHERE campaign_id=$1 GROUP BY status ORDER BY 3 DESC`, campaignID)
	if err != nil {
		return CampaignFunding{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var b StatusBreakdown
		if err := rows.Scan(&b.Status, &b.Count, &b.AmountKobo); err != nil {
			return CampaignFunding{}, err
		}
		f.ByStatus = append(f.ByStatus, b)
	}
	if err := rows.Err(); err != nil {
		return CampaignFunding{}, err
	}

	// Withdrawals DO carry campaign_id, so payouts are attributable. Paid vs
	// still-queued is split because "withdrawn" must not include money an
	// operator has not approved yet.
	if err := s.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_kobo) FILTER (WHERE status IN ('PAID','APPROVED','paid','approved')),0),
		       COUNT(*),
		       COALESCE(SUM(amount_kobo) FILTER (WHERE status IN ('REQUESTED','PENDING','requested','pending')),0)
		  FROM cf_withdrawals WHERE campaign_id=$1`, campaignID).
		Scan(&f.WithdrawnKobo, &f.WithdrawalCount, &f.PendingWithdrawalKobo); err != nil {
		return CampaignFunding{}, err
	}

	if err := s.db.QueryRow(ctx, `
		SELECT COUNT(*), COUNT(*) FILTER (WHERE status IN ('RELEASED','released'))
		  FROM cf_campaign_milestones WHERE campaign_id=$1`, campaignID).
		Scan(&f.MilestoneCount, &f.MilestonesReleased); err != nil {
		return CampaignFunding{}, err
	}

	return f, nil
}

// ── handlers ────────────────────────────────────────────────────────────────

func atoiOr(s string, def int) int {
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return n
}

// CampaignDirectory — GET /campaign-directory
func (h *Handler) CampaignDirectory(c *gin.Context) {
	f := CampaignDirectoryFilter{
		Status:       c.Query("status"),
		ReviewStatus: c.Query("reviewStatus"),
		Category:     c.Query("category"),
		Search:       c.Query("q"),
		Flag:         c.Query("flag"),
		Sort:         c.Query("sort"),
		Page:         atoiOr(c.Query("page"), 1),
		Limit:        atoiOr(c.Query("limit"), 25),
	}
	out, err := h.svc.ListCampaignDirectory(c.Request.Context(), f)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, out)
}

// CampaignBackers — GET /campaigns/:id/backers
func (h *Handler) CampaignBackers(c *gin.Context) {
	out, err := h.svc.ListCampaignBackers(c.Request.Context(), c.Param("id"),
		atoiOr(c.Query("page"), 1), atoiOr(c.Query("limit"), 50))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, out)
}

// CampaignFundingHandler — GET /campaigns/:id/funding
func (h *Handler) CampaignFundingHandler(c *gin.Context) {
	out, err := h.svc.CampaignFundingRollup(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, out)
}
