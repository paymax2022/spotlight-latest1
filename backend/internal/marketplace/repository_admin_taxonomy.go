package marketplace

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
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
		orStr(c.MarketID, DefaultMarketID), c.ParentID, c.Slug, c.Name, c.Icon, c.SortOrder,
		nullableJSON(c.AttributeSchema), c.RiskTier, c.CommissionBps, c.IsActive,
	)
	out, err := scanAdminCategory(row)
	if err != nil {
		if isUniqueViolation(err) {
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
		nullableJSON(c.AttributeSchema), c.RiskTier, c.CommissionBps, c.IsActive,
	)
	out, err := scanAdminCategory(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFoundCoded("category")
		}
		if isUniqueViolation(err) {
			return nil, ErrConflict
		}
		return nil, wrapInternal("update category", err)
	}
	return out, nil
}

// AdminSetCategoryActive toggles is_active only (leaves every other column,
// including risk_tier/commission_bps, untouched — the dedicated PATCH
// .../active route is deliberately narrower than the full update above).
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

// nullableJSON stores an empty/nil attribute_schema as SQL NULL, which the
// column default ('{}'::jsonb via json.RawMessage("{}")) — Postgres coalesces
// via the column's own default only on INSERT; on our explicit column list we
// pass an empty JSON object directly so `properties`/`required` are never NULL
// for a category with no schema author yet.
func nullableJSON(b []byte) []byte {
	if len(b) == 0 {
		return []byte(`{}`)
	}
	return b
}
