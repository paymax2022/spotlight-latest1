package restaurant

import (
	"context"
	"strconv"
	"strings"
	"time"
)

// ─────────────────────────────────────────────────────────────────────────────
// The operator's restaurant register — GET /api/restaurant/admin/restaurants.
//
// WHY THIS EXISTS
// The admin console listed restaurants by calling the CUSTOMER discovery
// endpoint, which is `WHERE is_open = TRUE` (and, with moderation on, approved
// listings only). So the console showed 2,016 of the 2,227 rows in `restaurants`
// and the 211 it could not see were exactly the ones an operator most needs:
// closed shops, and listings still waiting on review. The page's "Restaurants"
// KPI counted that filtered list, so it read as the platform total.
//
// This is a register, not a storefront: no is_open filter, no moderation gate,
// and the moderation/KYB columns are projected so the console can say WHY a shop
// is not live. It is fail-closed behind RBAC restaurant.manage at the route.
// ─────────────────────────────────────────────────────────────────────────────

const (
	defaultAdminRestaurantLimit = 25
	maxAdminRestaurantLimit     = 200
)

// AdminRestaurantParams filters the register. The zero value returns the newest
// page of every restaurant on the platform.
type AdminRestaurantParams struct {
	Query  string // free text over name, address, cuisine
	Status string // open | closed | all (default all)
	Review string // listing_review_status filter (DRAFT|PENDING_REVIEW|APPROVED|…), "" = any
	Sort   string // newest (default) | name | rating | updated
	Limit  int
	Offset int
}

func (p AdminRestaurantParams) normalized() AdminRestaurantParams {
	out := p
	out.Query = strings.TrimSpace(p.Query)
	out.Status = strings.ToLower(strings.TrimSpace(p.Status))
	out.Review = strings.ToUpper(strings.TrimSpace(p.Review))
	if out.Status != "open" && out.Status != "closed" {
		out.Status = "all"
	}
	if out.Limit <= 0 || out.Limit > maxAdminRestaurantLimit {
		out.Limit = defaultAdminRestaurantLimit
	}
	if out.Offset < 0 {
		out.Offset = 0
	}
	switch out.Sort {
	case "name", "rating", "updated", "newest":
	default:
		out.Sort = "newest"
	}
	return out
}

// AdminRestaurantRow is one register row: the public restaurant DTO plus the
// operational columns the storefront never exposes.
type AdminRestaurantRow struct {
	Restaurant
	KYBStatus           string    `json:"kyb_status"`
	ListingReviewStatus string    `json:"listing_review_status"`
	ListingReviewReason string    `json:"listing_review_reason,omitempty"`
	UpdatedAt           time.Time `json:"updated_at"`
	// MenuItemCount answers the first question ops asks of an unfamiliar row —
	// whether the shop was ever actually set up, or is an empty shell.
	MenuItemCount int `json:"menu_item_count"`
}

// AdminRestaurantPage is one page of the register plus the totals the console
// header reports.
type AdminRestaurantPage struct {
	Restaurants []AdminRestaurantRow `json:"restaurants"`
	Total       int                  `json:"total"`      // rows matching the current filters
	OpenTotal   int                  `json:"open_total"` // is_open across the SAME filters
	Limit       int                  `json:"limit"`
	Offset      int                  `json:"offset"`
	HasMore     bool                 `json:"has_more"`
}

func buildAdminRestaurantWhere(p AdminRestaurantParams) (string, []any) {
	var args []any
	ph := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}

	var b strings.Builder
	b.WriteString("WHERE TRUE")
	switch p.Status {
	case "open":
		b.WriteString(" AND r.is_open = TRUE")
	case "closed":
		b.WriteString(" AND r.is_open = FALSE")
	}
	if p.Review != "" {
		b.WriteString(" AND r.listing_review_status = " + ph(p.Review))
	}
	if p.Query != "" {
		like := ph("%" + p.Query + "%")
		b.WriteString(" AND (r.name ILIKE " + like +
			" OR r.address ILIKE " + like +
			" OR COALESCE(r.cuisine,'') ILIKE " + like + ")")
	}
	return b.String(), args
}

// Same unique-tiebreaker rule as discovery: without it, ties in the sort column
// let Postgres reshuffle duplicates between pages.
func adminRestaurantOrderBy(sort string) string {
	switch sort {
	case "name":
		return " ORDER BY r.name ASC, r.id ASC"
	case "rating":
		return " ORDER BY r.rating DESC, r.created_at DESC, r.id DESC"
	case "updated":
		return " ORDER BY r.updated_at DESC, r.id DESC"
	default:
		return " ORDER BY r.created_at DESC, r.id DESC"
	}
}

// AdminListRestaurants returns one page of the register. Unlike discovery it
// applies NO is_open or moderation predicate — every restaurant row is visible
// to an operator.
func (s *Service) AdminListRestaurants(ctx context.Context, params AdminRestaurantParams) (*AdminRestaurantPage, error) {
	p := params.normalized()
	where, args := buildAdminRestaurantWhere(p)

	var total, openTotal int
	if err := s.db.QueryRow(ctx,
		`SELECT COUNT(*), COUNT(*) FILTER (WHERE r.is_open) FROM restaurants r `+where, args...,
	).Scan(&total, &openTotal); err != nil {
		return nil, err
	}

	full := append([]any{}, args...)
	full = append(full, p.Limit, p.Offset)
	q := `SELECT r.id, r.owner_id, r.name, COALESCE(r.description,''), r.address, r.logo_url, r.is_open, r.rating,
	             COALESCE(r.cuisine,''), r.created_at, r.min_order_kobo, r.packaging_fee_kobo, r.prep_time_minutes,
	             r.geo_lat, r.geo_lng, COALESCE(r.kyb_status,''), r.listing_review_status,
	             COALESCE(r.listing_review_reason,''), r.updated_at,
	             (SELECT COUNT(*) FROM menu_items mi WHERE mi.restaurant_id = r.id)
	      FROM restaurants r ` + where + adminRestaurantOrderBy(p.Sort) +
		" LIMIT $" + strconv.Itoa(len(full)-1) + " OFFSET $" + strconv.Itoa(len(full))

	rows, err := s.db.Query(ctx, q, full...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AdminRestaurantRow{}
	for rows.Next() {
		var a AdminRestaurantRow
		r := &a.Restaurant
		if err := rows.Scan(&r.ID, &r.OwnerID, &r.Name, &r.Description, &r.Address, &r.LogoURL, &r.IsOpen, &r.Rating,
			&r.Cuisine, &r.CreatedAt, &r.MinOrderKobo, &r.PackagingFeeKobo, &r.PrepTimeMinutes,
			&r.GeoLat, &r.GeoLng, &a.KYBStatus, &a.ListingReviewStatus,
			&a.ListingReviewReason, &a.UpdatedAt, &a.MenuItemCount); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &AdminRestaurantPage{
		Restaurants: out,
		Total:       total,
		OpenTotal:   openTotal,
		Limit:       p.Limit,
		Offset:      p.Offset,
		HasMore:     p.Offset+len(out) < total,
	}, nil
}
