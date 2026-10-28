package discovery

import (
	"context"
	"time"
)

// RecentListing is an active direct listing with a rate, shaped for the home
// "Recently added" rail. CoverURL is a presigned read URL (empty when the listing
// has no photo yet or photo storage is not configured).
type RecentListing struct {
	ID            string    `json:"id"`
	SupplierCode  string    `json:"supplier_code"`
	SupplierRef   string    `json:"supplier_ref"`
	Name          string    `json:"name"`
	City          string    `json:"city"`
	Star          int       `json:"star"`
	PropertyType  string    `json:"property_type"`
	CoverURL      string    `json:"cover_url"`
	LeadPriceKobo int64     `json:"lead_price_kobo"`
	Currency      string    `json:"currency"`
	CreatedAt     time.Time `json:"created_at"`
}

// WithCoverURL sets how a stored photo key becomes a viewable URL.
func (h *Handler) WithCoverURL(f func(key string) string) *Handler {
	h.coverURL = f
	return h
}

// recentListings returns the newest active listings that have at least one rate
// plan, newest first. A listing with no rate has no price to show, so it is left out.
func (h *Handler) recentListings(ctx context.Context, limit int) ([]RecentListing, error) {
	rows, err := h.db.Query(ctx, `
		SELECT p.id::text, p.supplier_code, p.supplier_property_ref, p.name, p.city, p.star_rating, p.property_type,
		       COALESCE((SELECT ph.storage_key FROM public.stays_property_photo ph
		                 WHERE ph.property_id = p.id
		                 ORDER BY ph.is_cover DESC, ph.sort_order LIMIT 1), ''),
		       MIN(rp.base_sell_rate_kobo), COALESCE(MIN(rp.currency), 'NGN'), p.created_at
		FROM public.stays_property p
		JOIN public.stays_room_type rt ON rt.property_id = p.id
		JOIN public.stays_rate_plan rp ON rp.room_type_id = rt.id
		WHERE p.status = 'ACTIVE' AND p.source_rail = 'DIRECT'
		GROUP BY p.id
		ORDER BY p.created_at DESC
		LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []RecentListing{}
	for rows.Next() {
		var rl RecentListing
		var photoKey string
		if err := rows.Scan(&rl.ID, &rl.SupplierCode, &rl.SupplierRef, &rl.Name, &rl.City, &rl.Star, &rl.PropertyType,
			&photoKey, &rl.LeadPriceKobo, &rl.Currency, &rl.CreatedAt); err != nil {
			return nil, err
		}
		if photoKey != "" && h.coverURL != nil {
			rl.CoverURL = h.coverURL(photoKey)
		}
		out = append(out, rl)
	}
	return out, rows.Err()
}
