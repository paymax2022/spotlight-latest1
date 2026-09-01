package restaurant

import (
	"context"
	"strconv"
	"strings"
)

// ─────────────────────────────────────────────────────────────────────────────
// Paged customer-facing discovery.
//
// WHY THIS EXISTS
// ListOpenRestaurants selects EVERY open restaurant with no LIMIT. That was fine
// when the estate was a handful of seeded shops; it is now 2,016 open rows out of
// 2,227, and the mobile Food screen renders one card per row — ~48k DOM nodes on
// a single scroll view, over a payload that has to be parsed before anything at
// all is drawn. The client also filtered by cuisine and search text IN MEMORY,
// which only worked because it held the whole table.
//
// So the page and the filters move server-side together: paging a list the client
// then narrows locally would show "20 results" that silently exclude the match on
// page 7. Query + cuisine are applied in SQL, before LIMIT.
//
// The response keeps the `restaurants` key the old handler used, so an
// un-updated client still finds its array (it just gets the first page).
// ─────────────────────────────────────────────────────────────────────────────

const (
	defaultDiscoveryLimit = 20
	maxDiscoveryLimit     = 50
)

// DiscoveryParams are the customer-facing list filters. The zero value reproduces
// the legacy listing (open restaurants, newest first) capped at one page.
type DiscoveryParams struct {
	Query   string // free text over name + description + cuisine
	Cuisine string // exact (case-insensitive) cuisine tag; "" or "all" = no filter
	Sort    string // newest (default) | rating | name | eta | distance
	Limit   int    // page size (default 20, capped 50)
	Offset  int    // page offset
	// PromoOnly keeps only restaurants running a live offer. This backs the
	// "Offers" browse tile, which the client used to serve by filtering its
	// in-memory copy of the list on a `promo` field the discovery DTO never
	// sent — so it matched nothing and the tile always showed "no offers".
	PromoOnly bool
	// NearLat/NearLng are the customer's device coordinates. Only consulted
	// when Sort == "distance"; without them that sort falls back to the same
	// prep-time proxy "eta" uses, same as if the client never asked.
	NearLat *float64
	NearLng *float64
}

// normalized clamps caller-supplied paging/sort into the supported range. Values
// are never interpolated into SQL — clamping here is about refusing to serve an
// unbounded page, not about injection (every value below is a placeholder).
func (p DiscoveryParams) normalized() DiscoveryParams {
	out := p
	out.Query = strings.TrimSpace(p.Query)
	out.Cuisine = strings.TrimSpace(p.Cuisine)
	if strings.EqualFold(out.Cuisine, "all") {
		out.Cuisine = ""
	}
	if out.Limit <= 0 || out.Limit > maxDiscoveryLimit {
		out.Limit = defaultDiscoveryLimit
	}
	if out.Offset < 0 {
		out.Offset = 0
	}
	switch out.Sort {
	case "rating", "name", "newest", "eta", "distance":
	default:
		out.Sort = "newest"
	}
	return out
}

// RestaurantPage is one page of discovery results plus the totals a client needs
// to render "showing 20 of 2,016" and decide whether to ask for more.
type RestaurantPage struct {
	Restaurants []Restaurant `json:"restaurants"`
	Total       int          `json:"total"`
	Limit       int          `json:"limit"`
	Offset      int          `json:"offset"`
	HasMore     bool         `json:"has_more"`
}

// discoveryColumns is the single column list every restaurant read in this file
// shares, so the row scanner below stays valid for all of them.
const discoveryColumns = `r.id, r.owner_id, r.name, COALESCE(r.description,''), r.address, r.logo_url, r.is_open, r.rating, ` +
	`COALESCE(r.cuisine,''), r.created_at, r.min_order_kobo, r.packaging_fee_kobo, r.prep_time_minutes, r.geo_lat, r.geo_lng, ` +
	livePromoExists

// buildDiscoveryWhere renders the WHERE clause + its positional args. PURE (no DB)
// so the filter policy is unit-testable, and every caller-supplied value goes in
// as a placeholder — injection-safe by construction.
// livePromoExists is TRUE when the restaurant has an offer that is active RIGHT
// NOW. Shared verbatim by the projection and the PromoOnly filter so the badge a
// customer sees and the list the Offers tile pages can never disagree.
const livePromoExists = `EXISTS (SELECT 1 FROM restaurant_promos p
	WHERE p.restaurant_id = r.id AND p.active
	  AND (p.starts_at IS NULL OR p.starts_at <= NOW())
	  AND (p.ends_at IS NULL OR p.ends_at > NOW()))`

func buildDiscoveryWhere(p DiscoveryParams, moderationOn bool) (string, []any) {
	var args []any
	ph := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}

	var b strings.Builder
	b.WriteString("WHERE r.is_open = TRUE")
	// The listing gate is applied ONLY when moderation is enabled, exactly as in
	// ListOpenRestaurants — with it off the predicate is byte-identical to what
	// discovery has always run.
	if moderationOn {
		b.WriteString(" AND r.listing_review_status = 'APPROVED'")
	}
	if p.Cuisine != "" {
		b.WriteString(" AND lower(r.cuisine) = lower(" + ph(p.Cuisine) + ")")
	}
	if p.Query != "" {
		like := ph("%" + p.Query + "%")
		b.WriteString(" AND (r.name ILIKE " + like +
			" OR COALESCE(r.description,'') ILIKE " + like +
			" OR COALESCE(r.cuisine,'') ILIKE " + like + ")")
	}
	if p.PromoOnly {
		b.WriteString(" AND " + livePromoExists)
	}
	return b.String(), args
}

// discoveryOrderBy always ends in a unique tiebreaker (id). Without one, paging a
// column with ties — and the seeded estate has thousands of rows sharing a
// created_at to the microsecond — lets Postgres order the duplicates differently
// per query, so the same restaurant can appear on two pages while another is
// never returned at all.
//
// "distance" needs two extra bound params (the device's lat/lng) that the WHERE
// clause never uses, so they cannot ride in buildDiscoveryWhere's args — nextParam
// is the next free placeholder index, i.e. len(whereArgs)+1, and the returned args
// are appended after whereArgs and before LIMIT/OFFSET by the caller.
func discoveryOrderBy(sort string, nearLat, nearLng *float64, nextParam int) (string, []any) {
	switch sort {
	case "rating":
		return " ORDER BY r.rating DESC, r.created_at DESC, r.id DESC", nil
	case "name":
		return " ORDER BY r.name ASC, r.id ASC", nil
	case "distance":
		if nearLat != nil && nearLng != nil {
			latPh := "$" + strconv.Itoa(nextParam)
			lngPh := "$" + strconv.Itoa(nextParam+1)
			// Restaurants without a pin (geo_lat/geo_lng NULL) sort last rather
			// than being excluded — an owner who hasn't set a location yet
			// shouldn't vanish from discovery entirely.
			return " ORDER BY (r.geo_lat IS NULL OR r.geo_lng IS NULL) ASC, " +
					"ST_Distance(ST_SetSRID(ST_MakePoint(r.geo_lng, r.geo_lat), 4326)::geography, " +
					"ST_SetSRID(ST_MakePoint(" + lngPh + ", " + latPh + "), 4326)::geography) ASC, " +
					"r.rating DESC, r.id ASC",
				[]any{*nearLat, *nearLng}
		}
		// No coords supplied — same honest fallback "eta" uses below.
		fallthrough
	case "eta":
		// Backs the "Nearby" tile when the device has no location (or the caller
		// asked for "distance" without one). Prep time is what the ETA the cards
		// show is derived from, so it is the honest proxy available without it.
		return " ORDER BY r.prep_time_minutes ASC, r.rating DESC, r.id ASC", nil
	default:
		return " ORDER BY r.created_at DESC, r.id DESC", nil
	}
}

// queryRestaurants runs a restaurant SELECT over discoveryColumns. limit <= 0
// means "no LIMIT clause" — that is how the unpaged ListOpenRestaurants shares
// this one scanner instead of keeping a second copy of the column list.
// orderArgs are whatever discoveryOrderBy needed beyond whereArgs (e.g. the
// device coordinates for a distance sort) — kept separate from whereArgs so
// the COUNT query, which never runs orderBy, doesn't carry unused params.
func (s *Service) queryRestaurants(ctx context.Context, where, orderBy string, whereArgs, orderArgs []any, limit, offset int) ([]Restaurant, error) {
	q := `SELECT ` + discoveryColumns + ` FROM restaurants r ` + where + orderBy
	// Copy before appending: the caller reuses `whereArgs` for the COUNT query,
	// and append may write through to its backing array.
	full := append([]any{}, whereArgs...)
	full = append(full, orderArgs...)
	if limit > 0 {
		full = append(full, limit, offset)
		q += " LIMIT $" + strconv.Itoa(len(full)-1) + " OFFSET $" + strconv.Itoa(len(full))
	}

	rows, err := s.db.Query(ctx, q, full...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	// Non-nil so the handler serialises `[]` rather than `null` on an empty
	// result — a JSON null breaks array-typed clients.
	out := []Restaurant{}
	for rows.Next() {
		var r Restaurant
		if err := rows.Scan(&r.ID, &r.OwnerID, &r.Name, &r.Description, &r.Address, &r.LogoURL, &r.IsOpen, &r.Rating, &r.Cuisine, &r.CreatedAt,
			&r.MinOrderKobo, &r.PackagingFeeKobo, &r.PrepTimeMinutes, &r.GeoLat, &r.GeoLng, &r.HasPromo); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ListOpenRestaurantsPage returns one page of the discovery list plus the total
// number of restaurants matching the same filters (so a client can show progress
// and stop paging without an extra empty request).
func (s *Service) ListOpenRestaurantsPage(ctx context.Context, params DiscoveryParams) (*RestaurantPage, error) {
	p := params.normalized()
	where, args := buildDiscoveryWhere(p, s.moderationOn)

	var total int
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM restaurants r `+where, args...).Scan(&total); err != nil {
		return nil, err
	}

	orderBy, orderArgs := discoveryOrderBy(p.Sort, p.NearLat, p.NearLng, len(args)+1)
	list, err := s.queryRestaurants(ctx, where, orderBy, args, orderArgs, p.Limit, p.Offset)
	if err != nil {
		return nil, err
	}
	return &RestaurantPage{
		Restaurants: list,
		Total:       total,
		Limit:       p.Limit,
		Offset:      p.Offset,
		HasMore:     p.Offset+len(list) < total,
	}, nil
}
