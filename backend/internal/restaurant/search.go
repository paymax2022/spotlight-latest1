package restaurant

import (
	"context"
	"strconv"
	"strings"
	"time"
)

// SearchParams are the customer-facing restaurant discovery filters. Every field is
// optional; the zero value reproduces the legacy listing (open restaurants, newest
// first). Values are validated/clamped in buildSearchQuery so a hand-crafted request
// can't inject SQL or ask for an unbounded page.
type SearchParams struct {
	Query     string   // free text over name + description
	Cuisine   string   // exact (case-insensitive) cuisine tag
	MinRating float64  // rating >= this
	OpenNow   bool     // only restaurants open right now (honors business hours)
	NearLat   *float64 // near-me centre (both lat+lng required to activate)
	NearLng   *float64
	RadiusKm  float64 // near-me radius (default 5km, capped)
	Sort      string  // relevance | rating | distance | newest
	Limit     int     // page size (default 20, capped 50)
	Offset    int     // page offset
}

const (
	defaultSearchLimit = 20
	maxSearchLimit     = 50
	defaultRadiusKm    = 5.0
	maxRadiusKm        = 50.0
)

// buildSearchQuery renders the discovery query + its positional args. It is PURE (no
// DB) so the whole filter/sort/pagination policy is unit-testable, and it uses ONLY
// parameterized placeholders for caller-supplied values — no string interpolation of
// user input — so it is injection-safe by construction.
//
// The result always selects the same fixed column list (…, distance_m) so the scanner
// is stable whether or not a near-me point was supplied (distance is NULL without one).
// open_now mirrors hours.go's windowContains exactly, evaluated at `now` in `loc`.
func buildSearchQuery(p SearchParams, now time.Time, loc *time.Location) (string, []any) {
	var args []any
	ph := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}

	// Near-me point (only when BOTH coordinates are present). Built once; the same
	// placeholders are reused by the distance projection and the radius filter.
	nearActive := p.NearLat != nil && p.NearLng != nil
	pointExpr := ""
	distExpr := "NULL::float8"
	if nearActive {
		lng := ph(*p.NearLng)
		lat := ph(*p.NearLat)
		pointExpr = "ST_SetSRID(ST_MakePoint(" + lng + "," + lat + "),4326)::geography"
		distExpr = "ST_Distance(ml.geog, " + pointExpr + ")"
	}

	var b strings.Builder
	b.WriteString(`SELECT r.id, r.owner_id, r.name, COALESCE(r.description,''), r.address, r.logo_url, r.is_open, r.rating, COALESCE(r.cuisine,''), r.created_at, `)
	b.WriteString(distExpr)
	b.WriteString(` AS distance_m
		FROM restaurants r
		LEFT JOIN merchant_locations ml ON ml.entity_id = r.id::text AND ml.entity_type = 'restaurant'
		WHERE r.is_open = TRUE`)

	if q := strings.TrimSpace(p.Query); q != "" {
		like := ph("%" + q + "%")
		b.WriteString(" AND (r.name ILIKE " + like + " OR r.description ILIKE " + like + ")")
	}
	if c := strings.TrimSpace(p.Cuisine); c != "" {
		b.WriteString(" AND lower(r.cuisine) = lower(" + ph(c) + ")")
	}
	if p.MinRating > 0 {
		b.WriteString(" AND r.rating >= " + ph(p.MinRating))
	}
	if nearActive {
		radiusKm := p.RadiusKm
		if radiusKm <= 0 {
			radiusKm = defaultRadiusKm
		}
		if radiusKm > maxRadiusKm {
			radiusKm = maxRadiusKm
		}
		b.WriteString(" AND ml.geog IS NOT NULL AND ST_DWithin(ml.geog, " + pointExpr + ", " + ph(radiusKm*1000) + ")")
	}
	if p.OpenNow {
		lt := now.In(loc)
		wd := ph(int(lt.Weekday()))
		yd := ph((int(lt.Weekday()) + 6) % 7) // yesterday, for overnight windows that spill into today
		m := ph(lt.Hour()*60 + lt.Minute())
		// Mirrors hours.go windowContains: a restaurant with NO schedule is governed by
		// is_open alone (already filtered), else it must match a same-day or overnight
		// window right now.
		b.WriteString(" AND (NOT EXISTS (SELECT 1 FROM restaurant_business_hours h WHERE h.restaurant_id = r.id)")
		b.WriteString(" OR EXISTS (SELECT 1 FROM restaurant_business_hours h WHERE h.restaurant_id = r.id AND (")
		b.WriteString("(h.close_minute > h.open_minute AND h.day_of_week = " + wd + " AND " + m + " >= h.open_minute AND " + m + " < h.close_minute)")
		b.WriteString(" OR (h.close_minute < h.open_minute AND ((h.day_of_week = " + wd + " AND " + m + " >= h.open_minute) OR (h.day_of_week = " + yd + " AND " + m + " < h.close_minute)))")
		b.WriteString(")))")
	}

	// Sort. distance requires a near point (otherwise falls back to rating). relevance
	// prefers proximity when available, then rating.
	switch p.Sort {
	case "newest":
		b.WriteString(" ORDER BY r.created_at DESC")
	case "rating":
		b.WriteString(" ORDER BY r.rating DESC, r.created_at DESC")
	case "distance":
		if nearActive {
			b.WriteString(" ORDER BY distance_m ASC NULLS LAST")
		} else {
			b.WriteString(" ORDER BY r.rating DESC, r.created_at DESC")
		}
	default: // relevance
		if nearActive {
			b.WriteString(" ORDER BY distance_m ASC NULLS LAST, r.rating DESC")
		} else {
			b.WriteString(" ORDER BY r.rating DESC, r.created_at DESC")
		}
	}

	limit := p.Limit
	if limit <= 0 || limit > maxSearchLimit {
		limit = defaultSearchLimit
	}
	offset := p.Offset
	if offset < 0 {
		offset = 0
	}
	b.WriteString(" LIMIT " + ph(limit) + " OFFSET " + ph(offset))
	return b.String(), args
}

// nullIfEmpty maps "" → nil so an unset optional text column stays NULL (and the
// case-insensitive cuisine index / filter behave as expected).
func nullIfEmpty(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

// UpdateProfileRequest lets an owner set discovery-facing fields on their restaurant.
// Only non-nil fields are updated (partial PATCH).
type UpdateProfileRequest struct {
	Cuisine     *string `json:"cuisine,omitempty"`
	Description *string `json:"description,omitempty"`
	LogoURL     *string `json:"logo_url,omitempty"`
}

// UpdateRestaurantProfile updates an owner's restaurant discovery fields (owner only).
func (s *Service) UpdateRestaurantProfile(ctx context.Context, restaurantID, userID string, req UpdateProfileRequest) error {
	if err := s.assertOwner(ctx, restaurantID, userID); err != nil {
		return err
	}
	if req.Cuisine != nil {
		if _, err := s.db.Exec(ctx, `UPDATE restaurants SET cuisine=$1, updated_at=NOW() WHERE id=$2`, nullIfEmpty(*req.Cuisine), restaurantID); err != nil {
			return err
		}
	}
	if req.Description != nil {
		if _, err := s.db.Exec(ctx, `UPDATE restaurants SET description=$1, updated_at=NOW() WHERE id=$2`, *req.Description, restaurantID); err != nil {
			return err
		}
	}
	if req.LogoURL != nil {
		if _, err := s.db.Exec(ctx, `UPDATE restaurants SET logo_url=$1, updated_at=NOW() WHERE id=$2`, nullIfEmpty(*req.LogoURL), restaurantID); err != nil {
			return err
		}
	}
	return nil
}

// SearchRestaurants runs the discovery query and returns matching restaurants. When a
// near-me point was supplied, each result carries its DistanceMeters (nearest first by
// default). Evaluated in Africa/Lagos for the open_now filter.
func (s *Service) SearchRestaurants(ctx context.Context, p SearchParams) ([]Restaurant, error) {
	sql, args := buildSearchQuery(p, time.Now(), lagosTZ)
	rows, err := s.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Restaurant{}
	for rows.Next() {
		var r Restaurant
		var dist *float64
		if err := rows.Scan(&r.ID, &r.OwnerID, &r.Name, &r.Description, &r.Address, &r.LogoURL,
			&r.IsOpen, &r.Rating, &r.Cuisine, &r.CreatedAt, &dist); err != nil {
			return nil, err
		}
		r.DistanceMeters = dist
		out = append(out, r)
	}
	return out, rows.Err()
}
