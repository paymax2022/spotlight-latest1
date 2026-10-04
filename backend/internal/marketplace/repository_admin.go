package marketplace

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"spotlight/backend/go-common/dbutil"
	"spotlight/backend/go-common/jsonx"
	"spotlight/backend/go-common/strutil"
	"time"
)

// repository_admin_taxonomy.go — admin CRUD over the pre-existing mkt_categories
// table (MKT-007, taxonomy console). mkt_categories already backs the public
// GET /categories reads (repository.go ListCategories/GetCategory) and the
// risk_tier gate consumed by service_listing.go's SubmitListing auto-approve
// guard; these queries add admin-only writes over the SAME table/columns —
// no schema change, no new table.

// AdminListCategories returns ALL categories for a market (active + inactive —
// unlike the public ListCategories, which filters is_active=TRUE), plus a live
// COUNT of listings currently filed under each category (frontend's
// MktCategory.listing_count, used both for display and as the EC-007
// delete/disable-guard signal). Ordered the same way as the public list so the
// admin tree renders consistently (parents before children).
func (r *Repository) AdminListCategories(ctx context.Context, marketID string) ([]Category, error) {
	rows, err := r.db.Query(ctx, `
		SELECT c.id, c.market_id, c.parent_id, c.slug, c.name, COALESCE(c.icon,''), c.sort_order,
		       c.attribute_schema, c.risk_tier, c.commission_bps, c.is_active,
		       c.created_at, c.updated_at,
		       (SELECT count(*) FROM public.mkt_listings l WHERE l.category_id = c.id) AS listing_count
		FROM public.mkt_categories c
		WHERE c.market_id=$1
		ORDER BY c.parent_id NULLS FIRST, c.sort_order, c.name`, marketID)
	if err != nil {
		return nil, wrapInternal("admin list categories", err)
	}
	defer rows.Close()
	var out []Category
	for rows.Next() {
		c, err := scanAdminCategory(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// AdminGetCategory loads one category (active or inactive) with its live
// listing_count, timestamps included — the admin edit page's GET.
func (r *Repository) AdminGetCategory(ctx context.Context, id string) (*Category, error) {
	row := r.db.QueryRow(ctx, `
		SELECT c.id, c.market_id, c.parent_id, c.slug, c.name, COALESCE(c.icon,''), c.sort_order,
		       c.attribute_schema, c.risk_tier, c.commission_bps, c.is_active,
		       c.created_at, c.updated_at,
		       (SELECT count(*) FROM public.mkt_listings l WHERE l.category_id = c.id) AS listing_count
		FROM public.mkt_categories c WHERE c.id=$1`, id)
	c, err := scanAdminCategory(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFoundCoded("category")
		}
		return nil, wrapInternal("admin get category", err)
	}
	return c, nil
}

// AdminInsertCategory creates a category. slug is unique per (market_id, slug) —
// a duplicate slug returns ErrConflict (mirrors InsertOrder's isUniqueViolation
// mapping), which the handler surfaces as 409 rather than a raw 500.
func (r *Repository) AdminInsertCategory(ctx context.Context, c Category) (*Category, error) {
	row := r.db.QueryRow(ctx, `
		INSERT INTO public.mkt_categories
			(market_id, parent_id, slug, name, icon, sort_order, attribute_schema, risk_tier, commission_bps, is_active)
		VALUES ($1,$2,$3,$4,NULLIF($5,''),$6,$7,$8,$9,$10)
		RETURNING id, market_id, parent_id, slug, name, COALESCE(icon,''), sort_order,
		          attribute_schema, risk_tier, commission_bps, is_active, created_at, updated_at, 0`,
		strutil.Or(c.MarketID, DefaultMarketID), c.ParentID, c.Slug, c.Name, c.Icon, c.SortOrder,
		jsonx.RawOrEmptyObject(c.AttributeSchema), c.RiskTier, c.CommissionBps, c.IsActive,
	)
	out, err := scanAdminCategory(row)
	if err != nil {
		if dbutil.IsUniqueViolation(err) {
			return nil, ErrConflict
		}
		return nil, wrapInternal("insert category", err)
	}
	return out, nil
}

// AdminUpdateCategory applies a partial update to an existing category (every
// field is re-sent by the edit form, so this is a full-row SET — matching
// AdminUpsertBoostPackage's style — not a sparse PATCH-merge). Returns
// ErrNotFoundCoded when id doesn't exist, ErrConflict on a slug collision.
func (r *Repository) AdminUpdateCategory(ctx context.Context, id string, c Category) (*Category, error) {
	row := r.db.QueryRow(ctx, `
		UPDATE public.mkt_categories
		SET parent_id=$2, slug=$3, name=$4, icon=NULLIF($5,''), sort_order=$6,
		    attribute_schema=$7, risk_tier=$8, commission_bps=$9, is_active=$10, updated_at=now()
		WHERE id=$1
		RETURNING id, market_id, parent_id, slug, name, COALESCE(icon,''), sort_order,
		          attribute_schema, risk_tier, commission_bps, is_active, created_at, updated_at,
		          (SELECT count(*) FROM public.mkt_listings l WHERE l.category_id = mkt_categories.id)`,
		id, c.ParentID, c.Slug, c.Name, c.Icon, c.SortOrder,
		jsonx.RawOrEmptyObject(c.AttributeSchema), c.RiskTier, c.CommissionBps, c.IsActive,
	)
	out, err := scanAdminCategory(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFoundCoded("category")
		}
		if dbutil.IsUniqueViolation(err) {
			return nil, ErrConflict
		}
		return nil, wrapInternal("update category", err)
	}
	return out, nil
}

// AdminSetCategoryActive toggles is_active only (leaves every other column,
// including risk_tier/commission_bps, untouched — the dedicated PATCH
func (r *Repository) AdminSetCategoryActive(ctx context.Context, id string, active bool) (*Category, error) {
	row := r.db.QueryRow(ctx, `
		UPDATE public.mkt_categories SET is_active=$2, updated_at=now() WHERE id=$1
		RETURNING id, market_id, parent_id, slug, name, COALESCE(icon,''), sort_order,
		          attribute_schema, risk_tier, commission_bps, is_active, created_at, updated_at,
		          (SELECT count(*) FROM public.mkt_listings l WHERE l.category_id = mkt_categories.id)`,
		id, active)
	out, err := scanAdminCategory(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFoundCoded("category")
		}
		return nil, wrapInternal("set category active", err)
	}
	return out, nil
}

func scanAdminCategory(row pgx.Row) (*Category, error) {
	var c Category
	var schema []byte
	var createdAt, updatedAt time.Time
	if err := row.Scan(&c.ID, &c.MarketID, &c.ParentID, &c.Slug, &c.Name, &c.Icon, &c.SortOrder,
		&schema, &c.RiskTier, &c.CommissionBps, &c.IsActive, &createdAt, &updatedAt, &c.ListingCount); err != nil {
		return nil, err
	}
	c.AttributeSchema = schema
	c.CreatedAt, c.UpdatedAt = &createdAt, &updatedAt
	return &c, nil
}

// repository_admin_appeals.go — pgx data layer for mkt_appeals (MKT-007
// Appeals). Status/vocab mirrors frontend-admin/src/types/marketplaceAdmin.ts
// MktAppealStatus ('opened'|'under_review'|'decided'|'executed'|'closed').

const appealCols = `id, market_id, appellant_id, target_type, target_id,
	original_action, original_reason_code, appellant_note, status, decision,
	decision_notes, decided_by, decided_at, second_approver_id, second_approved_at,
	requires_dual_approval, executed_at, created_at, updated_at`

func scanAppeal(row pgx.Row) (*Appeal, error) {
	var a Appeal
	if err := row.Scan(
		&a.ID, &a.MarketID, &a.AppellantID, &a.TargetType, &a.TargetID,
		&a.OriginalAction, &a.OriginalReasonCode, &a.AppellantNote, &a.Status, &a.Decision,
		&a.DecisionNotes, &a.DecidedBy, &a.DecidedAt, &a.SecondApproverID, &a.SecondApprovedAt,
		&a.RequiresDualApproval, &a.ExecutedAt, &a.CreatedAt, &a.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &a, nil
}

// InsertAppeal creates a new appeal in 'opened'. Member-facing (POST /appeals)
// and admin-on-behalf-of-member both call this.
func (r *Repository) InsertAppeal(ctx context.Context, marketID, appellantID, targetType, targetID, originalAction, originalReasonCode, appellantNote string) (*Appeal, error) {
	row := r.db.QueryRow(ctx, `
		INSERT INTO public.mkt_appeals
			(market_id, appellant_id, target_type, target_id, original_action, original_reason_code, appellant_note)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING `+appealCols,
		marketID, appellantID, targetType, targetID, originalAction, originalReasonCode, appellantNote)
	a, err := scanAppeal(row)
	if err != nil {
		return nil, wrapInternal("insert appeal", err)
	}
	return a, nil
}

// GetAppeal loads one appeal by id.
func (r *Repository) GetAppeal(ctx context.Context, id string) (*Appeal, error) {
	row := r.db.QueryRow(ctx, `SELECT `+appealCols+` FROM public.mkt_appeals WHERE id=$1`, id)
	a, err := scanAppeal(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAppealNotFound
		}
		return nil, wrapInternal("get appeal", err)
	}
	return a, nil
}

// ListAppeals filters by status (optional).
func (r *Repository) ListAppeals(ctx context.Context, marketID, status string, limit, offset int) ([]Appeal, error) {
	limit = clampLimit(limit)
	q := `SELECT ` + appealCols + ` FROM public.mkt_appeals WHERE market_id = $1`
	args := []any{marketID}
	if status != "" {
		q += ` AND status = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4`
		args = append(args, status, limit, offset)
	} else {
		q += sqlOrderByCreatedAtDescLimit
		args = append(args, limit, offset)
	}
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, wrapInternal("list appeals", err)
	}
	defer rows.Close()
	var out []Appeal
	for rows.Next() {
		a, err := scanAppeal(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// SetAppealStatus is the plain status PATCH (opened/under_review/closed — no
// decision content), used by PATCH /admin/appeals/:id/status.
func (r *Repository) SetAppealStatus(ctx context.Context, id, status string) (*Appeal, error) {
	row := r.db.QueryRow(ctx, `
		UPDATE public.mkt_appeals SET status=$2, updated_at=now() WHERE id=$1
		RETURNING `+appealCols, id, status)
	a, err := scanAppeal(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAppealNotFound
		}
		return nil, wrapInternal("set appeal status", err)
	}
	return a, nil
}

// ProposeAppealDecision is the maker step: records the proposed decision.
//   - decision='overturned': dual approval REQUIRED — status -> 'decided',
//     requires_dual_approval=true, nothing executes yet (the overturn only takes
//     effect once a different admin approves — see ApproveAppealDecision).
//   - decision='upheld': single-admin, executes IMMEDIATELY — status -> 'executed'
//     directly, since upholding denies the appeal and nothing new is applied to
//     the account/listing (the original action already stands). See migration
//     comment + PR notes for the reasoning.
func (r *Repository) ProposeAppealDecision(ctx context.Context, id, decision, reasonCode, notes, decidedBy string) (*Appeal, error) {
	requiresDual := decision == "overturned"
	nextStatus := "decided"
	executedAtClause := "NULL"
	if !requiresDual {
		nextStatus = "executed"
		executedAtClause = "now()"
	}
	row := r.db.QueryRow(ctx, `
		UPDATE public.mkt_appeals SET
			decision = $2,
			decision_notes = $3,
			decided_by = $4,
			decided_at = now(),
			status = $5,
			requires_dual_approval = $6,
			second_approver_id = NULL,
			second_approved_at = NULL,
			executed_at = `+executedAtClause+`,
			updated_at = now()
		WHERE id = $1 AND status IN ('opened','under_review')
		RETURNING `+appealCols, id, decision, dbutil.NullStrP(&notes), decidedBy, nextStatus, requiresDual)
	a, err := scanAppeal(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrConflict
		}
		return nil, wrapInternal("propose appeal decision", err)
	}
	_ = reasonCode // the appeal's own reason_code lives in original_reason_code (set at filing); the decision's justification is decision_notes
	return a, nil
}

// ApproveAppealDecision is the checker step: finalizes an 'overturned' decision
// to 'executed' and stamps second_approver_id. Only callable on a 'decided'
// appeal (requires_dual_approval=true implied — ProposeAppealDecision never sets
// status='decided' for an 'upheld' decision). The DB CHECK
// (mkt_appeals_no_self_approve) is the independent second line of defense
// behind the Go-layer makercheck check the service performs first.
func (r *Repository) ApproveAppealDecision(ctx context.Context, id, checkerID string) (*Appeal, error) {
	row := r.db.QueryRow(ctx, `
		UPDATE public.mkt_appeals SET
			status = 'executed',
			second_approver_id = $2,
			second_approved_at = now(),
			executed_at = now(),
			updated_at = now()
		WHERE id = $1 AND status = 'decided' AND requires_dual_approval = true
		RETURNING `+appealCols, id, checkerID)
	a, err := scanAppeal(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoPendingAction
		}
		return nil, wrapInternal("approve appeal decision", err)
	}
	return a, nil
}

// AdminAnalytics — repository_admin_analytics.go — GET /admin/analytics (MKT-007, ADM-005).
// Real, computed from actual rows: listings counts; revenue_kobo = SUM of
// retained mkt_boosts (price − refunded); contacts = mkt_contact_reveals;
// deals = mkt_threads with met_at set (ADR-023 completion signal).
// Deliberately NOT computed (returned as 0, never fabricated):
//   - GMV fields: ADR-023 retired escrow/order tracking, so the actual sale
//     price a deal closed at is unrecorded (parties transact off-platform);
//     price_kobo is an ask, not a sale price.
//   - dau: no session/activity table exists — any proxy would be fabricated.
//   - funnel.views: view_count is a lifetime cumulative counter with no
//     per-event timestamp, so it cannot be scoped to a rolling window.
type AdminAnalytics struct {
	RangeDays      int                     `json:"range_days"`
	GMVKobo        int64                   `json:"gmv_kobo"`
	GMVPrevKobo    int64                   `json:"gmv_prev_kobo"`
	RevenueKobo    int64                   `json:"revenue_kobo"`
	DAU            int64                   `json:"dau"`
	ActiveListings int64                   `json:"active_listings"`
	NewListings    int64                   `json:"new_listings"`
	Funnel         AdminAnalyticsFunnel    `json:"funnel"`
	GMVSeries      []AdminAnalyticsPoint   `json:"gmv_series"`
	TopCategories  []AdminAnalyticsCatStat `json:"top_categories"`
}

type AdminAnalyticsFunnel struct {
	Views    int64 `json:"views"`
	Contacts int64 `json:"contacts"`
	Deals    int64 `json:"deals"`
}

type AdminAnalyticsPoint struct {
	Date    string `json:"date"`
	GMVKobo int64  `json:"gmv_kobo"`
	Deals   int64  `json:"deals"`
}

type AdminAnalyticsCatStat struct {
	CategoryID     string `json:"category_id"`
	Name           string `json:"name"`
	GMVKobo        int64  `json:"gmv_kobo"`
	ActiveListings int64  `json:"active_listings"`
}

// boostRevenueStatuses mirrors AdminMetrics' retained-boost filter exactly
// (repository.go ~1655) so admin dashboard vs admin analytics never disagree
// on "how much boost revenue was retained."
const boostRevenueStatusesSQL = `status IN ('purchased','active','completed')`

// AdminAnalytics computes the whole payload in a handful of round trips (no
// single giant CTE — easier to unit-test each figure and to see in an EXPLAIN
// which piece is slow later). windowStart is the caller's now()-range_days
// cutoff; prevStart..windowStart is the same-length preceding window used for
// gmv_prev_kobo's delta (currently always 0 — see the package doc above — but
// wired through so a real signal can be dropped in later without touching the
// handler).
func (r *Repository) AdminAnalytics(ctx context.Context, marketID string, rangeDays int) (*AdminAnalytics, error) {
	if rangeDays <= 0 {
		rangeDays = 30
	}
	a := &AdminAnalytics{RangeDays: rangeDays}
	windowStart := time.Now().AddDate(0, 0, -rangeDays)

	err := r.db.QueryRow(ctx, `
		SELECT
			(SELECT count(*) FROM public.mkt_listings WHERE market_id=$1 AND status='active'),
			(SELECT count(*) FROM public.mkt_listings WHERE market_id=$1 AND created_at >= $2),
			(SELECT COALESCE(sum(price_kobo - COALESCE(refunded_kobo,0)), 0) FROM public.mkt_boosts
				WHERE market_id=$1 AND `+boostRevenueStatusesSQL+` AND created_at >= $2),
			(SELECT count(*) FROM public.mkt_contact_reveals cr
				JOIN public.mkt_listings l ON l.id = cr.listing_id
				WHERE l.market_id=$1 AND cr.revealed_at >= $2),
			(SELECT count(*) FROM public.mkt_threads t
				JOIN public.mkt_listings l ON l.id = t.listing_id
				WHERE l.market_id=$1 AND t.met_at IS NOT NULL AND t.met_at >= $2)
	`, marketID, windowStart).Scan(
		&a.ActiveListings, &a.NewListings, &a.RevenueKobo,
		&a.Funnel.Contacts, &a.Funnel.Deals,
	)
	if err != nil {
		return nil, wrapInternal("admin analytics summary", err)
	}

	series, err := r.adminAnalyticsSeries(ctx, marketID, rangeDays, windowStart)
	if err != nil {
		return nil, err
	}
	a.GMVSeries = series

	top, err := r.adminAnalyticsTopCategories(ctx, marketID)
	if err != nil {
		return nil, err
	}
	a.TopCategories = top

	return a, nil
}

// adminAnalyticsSeries returns one row per day in [windowStart, now], real
// deals-per-day (mkt_threads.met_at), gmv_kobo always 0 (see package doc).
// generate_series + a LEFT JOIN so days with zero deals still appear (a bar
// chart with silently missing days would misread as "no data returned" rather
// than "zero that day").
func (r *Repository) adminAnalyticsSeries(ctx context.Context, marketID string, rangeDays int, windowStart time.Time) ([]AdminAnalyticsPoint, error) {
	rows, err := r.db.Query(ctx, `
		WITH days AS (
			SELECT generate_series(date_trunc('day', $2::timestamptz), date_trunc('day', now()), interval '1 day')::date AS d
		)
		SELECT days.d,
		       COALESCE(count(t.id), 0) AS deals
		FROM days
		LEFT JOIN public.mkt_threads t
		       ON t.met_at IS NOT NULL
		      AND date_trunc('day', t.met_at) = days.d
		      AND t.listing_id IN (SELECT id FROM public.mkt_listings WHERE market_id=$1)
		GROUP BY days.d
		ORDER BY days.d`, marketID, windowStart)
	if err != nil {
		return nil, wrapInternal("admin analytics series", err)
	}
	defer rows.Close()
	out := make([]AdminAnalyticsPoint, 0, rangeDays+1)
	for rows.Next() {
		var d time.Time
		var deals int64
		if err := rows.Scan(&d, &deals); err != nil {
			return nil, err
		}
		out = append(out, AdminAnalyticsPoint{Date: d.Format("2006-01-02"), GMVKobo: 0, Deals: deals})
	}
	return out, rows.Err()
}

// adminAnalyticsTopCategories ranks categories by CURRENT active-listing count
// (real) — gmv_kobo is 0 per category for the same structural reason as the
// top-level figure. Top 5, active-only, ties broken by name for a stable order.
func (r *Repository) adminAnalyticsTopCategories(ctx context.Context, marketID string) ([]AdminAnalyticsCatStat, error) {
	rows, err := r.db.Query(ctx, `
		SELECT c.id, c.name, count(l.id) AS active_listings
		FROM public.mkt_categories c
		LEFT JOIN public.mkt_listings l ON l.category_id = c.id AND l.status = 'active'
		WHERE c.market_id = $1 AND c.is_active = TRUE
		GROUP BY c.id, c.name
		ORDER BY active_listings DESC, c.name ASC
		LIMIT 5`, marketID)
	if err != nil {
		return nil, wrapInternal("admin analytics top categories", err)
	}
	defer rows.Close()
	out := make([]AdminAnalyticsCatStat, 0, 5)
	for rows.Next() {
		var s AdminAnalyticsCatStat
		if err := rows.Scan(&s.CategoryID, &s.Name, &s.ActiveListings); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
