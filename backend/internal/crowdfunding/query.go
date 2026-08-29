package crowdfunding

import (
	"fmt"
	"strings"
)

// CampaignQuery is the discovery filter parsed from request query params.
type CampaignQuery struct {
	Collection   string // featured | trending | urgent | verified | recommended | recent
	Category     string
	Type         string
	VerifiedOnly bool
	UrgentOnly   bool
	Search       string
	Sort         string // recommended | trending | newest | ending_soon | most_funded | least_funded
	Status       string // review_status filter (admin)
}

// buildDiscoveryWhere builds the WHERE clause + ordered args for a discovery query.
// startIdx is the first positional placeholder number ($1, $2, ...).
// Pure function — unit-tested without a database.
func buildDiscoveryWhere(q CampaignQuery, startIdx int) (string, []any) {
	var conds []string
	var args []any
	i := startIdx

	add := func(cond string, val any) {
		conds = append(conds, fmt.Sprintf(cond, i))
		args = append(args, val)
		i++
	}

	switch q.Collection {
	case "featured":
		conds = append(conds, "c.featured = TRUE")
	case "trending":
		conds = append(conds, "c.trending = TRUE")
	case "urgent":
		conds = append(conds, "c.urgent = TRUE")
	case "verified":
		conds = append(conds, "c.verified = TRUE")
	}

	if q.Category != "" {
		add("c.category = $%d", q.Category)
	}
	if q.Type != "" {
		add("c.type = $%d", q.Type)
	}
	if q.VerifiedOnly {
		conds = append(conds, "c.verified = TRUE")
	}
	if q.UrgentOnly {
		conds = append(conds, "c.urgent = TRUE")
	}
	// A soft-deleted campaign is gone from EVERY surface, admin listings
	// included — deleted_at is the owner's "this campaign no longer exists",
	// and the row survives only to keep its contributions/review history and
	// its ledger references resolvable.
	conds = append(conds, "c.deleted_at IS NULL")

	if q.Status != "" {
		add("c.review_status = $%d", q.Status)
	} else {
		// Public discovery only shows live campaigns — unconditionally, so an
		// unfiltered call (no collection/category/search, i.e. "give me every
		// active campaign") doesn't fall through with no review_status guard at
		// all and return PENDING_REVIEW/DRAFT/etc. campaigns to the public.
		//
		// Owner-paused campaigns drop out here too. The pause lives in
		// paused_at rather than review_status (see migration 20270112000000),
		// so it needs its own term — without it, pause would hide nothing.
		// The admin branch above deliberately does NOT filter on paused_at: an
		// operator listing by status must still see a paused campaign.
		conds = append(conds, "c.review_status = 'ACTIVE'", "c.paused_at IS NULL")
	}
	if q.Search != "" {
		// Two placeholders reference the same positional arg ($i) — valid in Postgres.
		conds = append(conds, fmt.Sprintf("(c.title ILIKE '%%' || $%d || '%%' OR c.summary ILIKE '%%' || $%d || '%%')", i, i))
		args = append(args, q.Search)
		i++
	}
	_ = i

	where := ""
	if len(conds) > 0 {
		where = "WHERE " + strings.Join(conds, " AND ")
	}
	return where, args
}

// sortClause maps a sort key to an ORDER BY clause (no user input interpolated).
func sortClause(sort string) string {
	switch sort {
	case "newest":
		return "ORDER BY c.created_at DESC"
	case "ending_soon":
		return "ORDER BY c.deadline ASC NULLS LAST"
	case "most_funded":
		return "ORDER BY raised_kobo DESC"
	case "least_funded":
		// Output-column alias used as a standalone ORDER BY term (Postgres-allowed).
		return "ORDER BY raised_kobo ASC"
	case "trending":
		return "ORDER BY c.trending DESC, c.contributor_count DESC"
	default: // recommended
		return "ORDER BY c.verified DESC, c.featured DESC, c.contributor_count DESC"
	}
}

// mobileStatus maps the internal review_status to the mobile CampaignStatus enum.
func mobileStatus(reviewStatus string) string {
	if reviewStatus == "CHANGES_REQUESTED" {
		return "PENDING_REVIEW"
	}
	return reviewStatus
}
