package adminext

// Crowdfunding FEATURED / TRENDING / URGENT placement.
//
// Public discovery (internal/crowdfunding/query.go) filters its "featured",
// "trending" and "urgent" collections on campaigns.featured / .trending /
// .urgent, and sortClause("recommended") ranks on c.verified DESC, c.featured
// DESC. Those three booleans default to FALSE and, until this file, nothing in
// the product could ever set them: no creator route, no admin route, no job. So
// every one of those collections was permanently empty on the live database and
// the app's Featured/Trending rails rendered nothing.
//
// This adds the missing operator surface: list the placement candidates, patch
// the flags, and report on what is currently placed.
//
// RULE — only an ACTIVE campaign may be PROMOTED. Turning a flag ON puts the
// campaign on a public discovery rail, so it must have cleared review first;
// promoting a PENDING_REVIEW / REJECTED / FROZEN campaign would publish
// unreviewed content straight to the app's most prominent surface. Turning a
// flag OFF is always allowed regardless of status — a campaign that LEAVES
// ACTIVE (frozen for fraud, say) must remain demotable, and a status-gated
// clear would trap it on the rail exactly when it most needs removing.
//
// No migration: campaigns.featured/trending/urgent already exist (added by
// supabase/migrations/20260622000000_crowdfunding_full.sql).

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// ─── Errors ──────────────────────────────────────────────────────────────────

// ErrNoFlagsSupplied is returned when a flags PATCH body carries none of the
// three keys — there is nothing to change, and silently succeeding would let a
// typo'd field name read as a successful placement.
var ErrNoFlagsSupplied = errors.New("adminext: no placement flag supplied — send at least one of featured/trending/urgent")

// ErrCampaignNotFound is returned when the campaign id does not exist.
var ErrCampaignNotFound = errors.New("adminext: campaign not found")

// ErrCampaignNotActive is returned when a promotion (setting a flag TRUE) targets
// a campaign whose review_status is not ACTIVE.
var ErrCampaignNotActive = errors.New("adminext: only an ACTIVE campaign can be featured, trending or urgent")

// reviewStatusActive is the single review_status that permits promotion.
const reviewStatusActive = "ACTIVE"

// ─── DTOs ────────────────────────────────────────────────────────────────────

// FeaturedCampaign is the placement-console row: identity, review status and the
// four discovery booleans, plus the money figures an operator needs to judge
// whether a campaign deserves a rail. All money is BIGINT kobo.
//
// Category carries the human LABEL ("NGO", "Medical") from crowdfunding_categories;
// CategorySlug carries the raw column value ("ngo", "medical") for filtering.
type FeaturedCampaign struct {
	ID               string `json:"id"`
	Title            string `json:"title"`
	Status           string `json:"status"` // raw review_status (ACTIVE, PENDING_REVIEW, …)
	Category         string `json:"category"`
	CategorySlug     string `json:"categorySlug"`
	Featured         bool   `json:"featured"`
	Trending         bool   `json:"trending"`
	Urgent           bool   `json:"urgent"`
	Verified         bool   `json:"verified"`
	RaisedKobo       int64  `json:"raisedKobo"`
	GoalKobo         int64  `json:"goalKobo"`
	ContributorCount int    `json:"contributorCount"`
	CreatedAt        string `json:"createdAt"`
}

// FeaturedReportEntry is one line of the placement report.
type FeaturedReportEntry struct {
	ID               string `json:"id"`
	Title            string `json:"title"`
	RaisedKobo       int64  `json:"raisedKobo"`
	ContributorCount int    `json:"contributorCount"`
}

// FeaturedReport summarises current placement across the platform.
type FeaturedReport struct {
	FeaturedCount int `json:"featuredCount"`
	TrendingCount int `json:"trendingCount"`
	UrgentCount   int `json:"urgentCount"`
	ActiveCount   int `json:"activeCount"`
	// PendingRequestCount is the size of the owner feature-request queue — the
	// console badges it so an operator sees waiting requests without opening the
	// queue. Folded into the existing aggregate as a scalar subquery, so it costs
	// no extra round trip.
	PendingRequestCount int                   `json:"pendingRequestCount"`
	Featured            []FeaturedReportEntry `json:"featured"`
}

// CampaignFlagsRequest is the PATCH body. Pointers, not bools: a nil field means
// the key was ABSENT from the JSON and that flag is left untouched, which is what
// makes this a partial update. A plain bool would make every omitted key read as
// an explicit `false` and silently demote the flags the caller never mentioned.
type CampaignFlagsRequest struct {
	Featured *bool `json:"featured"`
	Trending *bool `json:"trending"`
	Urgent   *bool `json:"urgent"`
}

// ─── Pure helpers (unit-tested without a database) ───────────────────────────

// flagAssignment is one column := value write derived from a PATCH body.
type flagAssignment struct {
	Column string
	Value  bool
}

// flagAssignments returns, in a stable order, the column writes a body asks for.
// Absent (nil) fields produce no assignment.
func flagAssignments(req CampaignFlagsRequest) []flagAssignment {
	out := make([]flagAssignment, 0, 3)
	if req.Featured != nil {
		out = append(out, flagAssignment{Column: "featured", Value: *req.Featured})
	}
	if req.Trending != nil {
		out = append(out, flagAssignment{Column: "trending", Value: *req.Trending})
	}
	if req.Urgent != nil {
		out = append(out, flagAssignment{Column: "urgent", Value: *req.Urgent})
	}
	return out
}

// promotesAnyFlag reports whether the body turns at least one flag ON. A body that
// only clears flags does not promote and is therefore not status-gated.
func promotesAnyFlag(req CampaignFlagsRequest) bool {
	for _, a := range flagAssignments(req) {
		if a.Value {
			return true
		}
	}
	return false
}

// guardFlagPromotion enforces the ACTIVE-only rule. A body that promotes anything
// is refused unless the campaign is ACTIVE; a pure-demotion body always passes.
// The check is on the WHOLE body: a mixed {featured:true, urgent:false} patch on a
// non-ACTIVE campaign is refused outright rather than half-applied.
func guardFlagPromotion(reviewStatus string, req CampaignFlagsRequest) error {
	if !promotesAnyFlag(req) {
		return nil
	}
	if reviewStatus != reviewStatusActive {
		return fmt.Errorf("%w (campaign is %s)", ErrCampaignNotActive, reviewStatus)
	}
	return nil
}

// buildFlagsUpdate renders the partial UPDATE for a flags patch. Column names are
// fixed literals from flagAssignments (never caller input); values are bound.
// Returns ok=false when the body asks for nothing.
func buildFlagsUpdate(campaignID string, req CampaignFlagsRequest) (sql string, args []any, ok bool) {
	as := flagAssignments(req)
	if len(as) == 0 {
		return "", nil, false
	}
	sets := make([]string, 0, len(as)+1)
	args = make([]any, 0, len(as)+1)
	for i, a := range as {
		sets = append(sets, fmt.Sprintf("%s=$%d", a.Column, i+1))
		args = append(args, a.Value)
	}
	sets = append(sets, "updated_at=NOW()")
	args = append(args, campaignID)
	return fmt.Sprintf("UPDATE campaigns SET %s WHERE id=$%d", strings.Join(sets, ", "), len(args)), args, true
}

// auditFlagsTarget renders the audit target: which campaign, and exactly which
// flags moved to which values. Stable order so the log is greppable.
func auditFlagsTarget(campaignID string, req CampaignFlagsRequest) string {
	as := flagAssignments(req)
	parts := make([]string, 0, len(as))
	for _, a := range as {
		parts = append(parts, fmt.Sprintf("%s=%t", a.Column, a.Value))
	}
	return campaignID + " " + strings.Join(parts, ",")
}

// ─── Queries ─────────────────────────────────────────────────────────────────

// featuredSelectCols is the shared projection. raised_kobo is DERIVED from the
// contributions ledger on every read — never a stored balance column.
const featuredSelectCols = `
	c.id, c.title, c.review_status, COALESCE(cat.label, c.category), c.category,
	c.featured, c.trending, c.urgent, c.verified,
	COALESCE((SELECT SUM(co.amount_kobo) FROM contributions co
	          WHERE co.campaign_id = c.id AND co.status IN ('escrowed','released')), 0) AS raised_kobo,
	c.goal_kobo, c.contributor_count, c.created_at`

const featuredFrom = `
	FROM campaigns c
	LEFT JOIN crowdfunding_categories cat ON cat.slug = c.category`

func scanFeatured(scan func(dest ...any) error) (FeaturedCampaign, error) {
	var f FeaturedCampaign
	var createdAt time.Time
	err := scan(&f.ID, &f.Title, &f.Status, &f.Category, &f.CategorySlug,
		&f.Featured, &f.Trending, &f.Urgent, &f.Verified,
		&f.RaisedKobo, &f.GoalKobo, &f.ContributorCount, &createdAt)
	if err != nil {
		return f, err
	}
	f.CreatedAt = rfc3339(createdAt)
	return f, nil
}

// ListFeaturedCandidates returns the placement pool: every ACTIVE campaign (i.e.
// everything eligible to be promoted) PLUS anything currently carrying a flag even
// if it has since left ACTIVE — otherwise a campaign frozen while featured would
// vanish from the console while still occupying a public rail, with no way to
// clear it.
func (s *Service) ListFeaturedCandidates(ctx context.Context) ([]FeaturedCampaign, error) {
	q := `SELECT ` + featuredSelectCols + featuredFrom + `
		WHERE c.review_status = $1 OR c.featured OR c.trending OR c.urgent
		ORDER BY (c.featured OR c.trending OR c.urgent) DESC,
		         c.contributor_count DESC, c.created_at DESC
		LIMIT 200`
	rows, err := s.db.Query(ctx, q, reviewStatusActive)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []FeaturedCampaign{}
	for rows.Next() {
		f, err := scanFeatured(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// getFeaturedCampaign reads one campaign in the placement shape. q is a pool or a
// tx, so the post-update read can run inside the mutating transaction.
func getFeaturedCampaign(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, campaignID string) (*FeaturedCampaign, error) {
	sql := `SELECT ` + featuredSelectCols + featuredFrom + ` WHERE c.id = $1`
	f, err := scanFeatured(q.QueryRow(ctx, sql, campaignID).Scan)
	if err != nil {
		return nil, ErrCampaignNotFound
	}
	return &f, nil
}

// SetCampaignFlags applies a PARTIAL placement patch: only the keys present in the
// body change. Transactional, row-locked, ACTIVE-gated for promotions, and audited
// in the same tx as the write.
func (s *Service) SetCampaignFlags(ctx context.Context, campaignID, adminID string, req CampaignFlagsRequest) (*FeaturedCampaign, error) {
	if strings.TrimSpace(campaignID) == "" {
		return nil, ErrCampaignNotFound
	}
	updateSQL, args, ok := buildFlagsUpdate(campaignID, req)
	if !ok {
		return nil, ErrNoFlagsSupplied
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Lock the row so the status we gate on is the status we write against — a
	// concurrent review decision cannot slip an ACTIVE→REJECTED between the two.
	var reviewStatus string
	if err := tx.QueryRow(ctx,
		`SELECT review_status FROM campaigns WHERE id=$1 FOR UPDATE`, campaignID).Scan(&reviewStatus); err != nil {
		return nil, ErrCampaignNotFound
	}
	if err := guardFlagPromotion(reviewStatus, req); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, updateSQL, args...); err != nil {
		return nil, err
	}
	if err := s.audit(ctx, tx, adminID, "campaign.flags.update", auditFlagsTarget(campaignID, req)); err != nil {
		return nil, err
	}

	// Read back INSIDE the tx so the response is exactly what was committed.
	out, err := getFeaturedCampaign(ctx, tx, campaignID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return out, nil
}

// GetFeaturedReport returns placement counters plus the currently-featured list.
func (s *Service) GetFeaturedReport(ctx context.Context) (*FeaturedReport, error) {
	out := &FeaturedReport{Featured: []FeaturedReportEntry{}}

	if err := s.db.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE featured),
			COUNT(*) FILTER (WHERE trending),
			COUNT(*) FILTER (WHERE urgent),
			COUNT(*) FILTER (WHERE review_status=$1),
			(SELECT COUNT(*) FROM cf_feature_requests fr
			 JOIN campaigns fc ON fc.id = fr.campaign_id
			 WHERE fr.status='PENDING' AND fc.deleted_at IS NULL)
		FROM campaigns`, reviewStatusActive).Scan(
		&out.FeaturedCount, &out.TrendingCount, &out.UrgentCount, &out.ActiveCount,
		&out.PendingRequestCount); err != nil {
		return nil, err
	}

	rows, err := s.db.Query(ctx, `
		SELECT c.id, c.title,
		       COALESCE((SELECT SUM(co.amount_kobo) FROM contributions co
		                 WHERE co.campaign_id = c.id AND co.status IN ('escrowed','released')), 0),
		       c.contributor_count
		FROM campaigns c
		WHERE c.featured
		ORDER BY c.contributor_count DESC, c.created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var e FeaturedReportEntry
		if err := rows.Scan(&e.ID, &e.Title, &e.RaisedKobo, &e.ContributorCount); err != nil {
			return nil, err
		}
		out.Featured = append(out.Featured, e)
	}
	return out, rows.Err()
}
