package marketplace

import (
	"context"
	"time"
)

// SellerContact is what a reveal returns: the number and who it belongs to.
type SellerContact struct {
	SellerID string `json:"seller_id"`
	Phone    string `json:"phone"`
}

// sellerPhoneForListing reads the listing owner's phone from user_profiles.
//
// user_profiles is the only place a phone actually lives — auth.users.phone is
// empty for every row on this deployment, and handle_new_user() has never copied
// the number across. An empty string is a legitimate answer (most sellers have
// no number on file) and the service turns it into a typed error rather than
// revealing a blank.
func (r *Repository) sellerPhoneForListing(ctx context.Context, listingID string) (SellerContact, error) {
	var c SellerContact
	err := r.db.QueryRow(ctx, `
		SELECT l.seller_id::text, COALESCE(NULLIF(btrim(p.phone), ''), '')
		  FROM public.mkt_listings l
		  LEFT JOIN public.user_profiles p ON p.id = l.seller_id
		 WHERE l.id = $1`, listingID).Scan(&c.SellerID, &c.Phone)
	if err != nil {
		return SellerContact{}, wrapInternal("seller contact", err)
	}
	return c, nil
}

// countDistinctRevealsSince counts how many DIFFERENT listings a viewer has
// revealed since `since`.
//
// DISTINCT is the point: re-opening a listing you already revealed must not
// spend budget, or a user who backgrounds the app loses their quota to the same
// number they have already seen. Charging per listing keeps the limit aimed at
// breadth — a scraper harvesting many sellers — rather than at ordinary use.
func (r *Repository) countDistinctRevealsSince(ctx context.Context, viewerID string, since time.Time) (int, error) {
	var n int
	err := r.db.QueryRow(ctx, `
		SELECT count(DISTINCT listing_id)
		  FROM public.mkt_contact_reveals
		 WHERE viewer_id = $1 AND revealed_at >= $2`, viewerID, since).Scan(&n)
	if err != nil {
		return 0, wrapInternal("reveal count", err)
	}
	return n, nil
}

// hasRevealedListing reports whether this viewer already revealed this listing
// inside the window, so a repeat look can skip the budget check.
func (r *Repository) hasRevealedListing(ctx context.Context, viewerID, listingID string, since time.Time) (bool, error) {
	var ok bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM public.mkt_contact_reveals
			 WHERE viewer_id = $1 AND listing_id = $2 AND revealed_at >= $3)`,
		viewerID, listingID, since).Scan(&ok)
	if err != nil {
		return false, wrapInternal("reveal lookup", err)
	}
	return ok, nil
}

// recordReveal writes the audit row. Repeat reveals are recorded too — the
// second look is a separate event and belongs in the answer to "who was given
// my number".
func (r *Repository) recordReveal(ctx context.Context, listingID, viewerID, sellerID string) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.mkt_contact_reveals (listing_id, viewer_id, seller_id)
		VALUES ($1, $2, $3)`, listingID, viewerID, sellerID)
	if err != nil {
		return wrapInternal("record reveal", err)
	}
	return nil
}
