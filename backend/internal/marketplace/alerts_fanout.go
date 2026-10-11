package marketplace

import (
	"context"
	"fmt"
	"log"
	"time"
)

// Alert producers behind FEATURE_MARKETPLACE_ALERTS_ENABLED:
//
//   - new listing from a followed seller  → 'new_listing'  (mkt_seller_follows)
//   - saved item dropped below saved price → 'price_dropped' (mkt_saved_items)
//
// Guarantees, all of which the live-DB tests pin:
//   - BEST-EFFORT: runs in a detached goroutine after the listing write has
//     committed; it can neither fail nor delay that write.
//   - BOUNDED: keyset-paged in alertBatchSize chunks, capped at alertMaxRecipients
//     per event and alertTimeout wall-clock.
//   - IDEMPOTENT: every row carries a dedupe_key under a partial UNIQUE index
//     (user_id, dedupe_key) and is inserted ON CONFLICT DO NOTHING, so a replay
//     (retry, double-approve) adds nothing.
//   - SUPPRESSED: a block in EITHER direction between recipient and seller, or the
//     recipient's opt-out in mkt_notification_prefs, drops the row. Absence of a
//     prefs row = the all-on defaults.
const (
	alertBatchSize     = 500
	alertMaxRecipients = 5000
	alertTimeout       = 60 * time.Second
	zeroUUID           = "00000000-0000-0000-0000-000000000000"
)

// goAlert runs fn detached from the request: its context outlives the HTTP
// request (WithoutCancel) but is bounded by alertTimeout, and a panic is
// contained to a log line.
func (s *Service) goAlert(ctx context.Context, fn func(ctx context.Context)) {
	bg, cancel := context.WithTimeout(context.WithoutCancel(ctx), alertTimeout)
	go func() {
		defer cancel()
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[marketplace] alert producer panic: %v", r)
			}
		}()
		fn(bg)
	}()
}

// notifyFollowersOfListing is called after a listing becomes active (auto-approve
// on submit, or admin approve). No-op when the flag is off.
func (s *Service) notifyFollowersOfListing(l *Listing) {
	if !s.alerts || l == nil {
		return
	}
	snap := *l
	s.goAlert(context.Background(), func(ctx context.Context) { s.fanOutNewListing(ctx, &snap) })
}

// notifySaversOfPriceDrop is the saved-price-aware replacement for the legacy
// "everyone who saved it" broadcast.
func (s *Service) notifySaversOfPriceDrop(l *Listing, oldKobo, newKobo int64) {
	if l == nil || l.Status != ListingActive {
		return
	}
	snap := *l
	s.goAlert(context.Background(), func(ctx context.Context) { s.fanOutPriceDrop(ctx, &snap, oldKobo, newKobo) })
}

// fanOut pages one statement until exhausted or capped, returning source rows covered. Each page
// statement takes ($1 cursor, $2 page size, ...args)
// and must return (last_cursor uuid-text, page_rows int).
func (s *Service) fanOut(ctx context.Context, stmt string, args ...any) (int, error) {
	cursor, total := zeroUUID, 0
	for total < alertMaxRecipients {
		var next *string
		var n int
		a := append([]any{cursor, alertBatchSize}, args...)
		if err := s.repo.db.QueryRow(ctx, stmt, a...).Scan(&next, &n); err != nil {
			return total, err
		}
		total += n
		if n < alertBatchSize || next == nil {
			return total, nil
		}
		cursor = *next
	}
	log.Printf("[marketplace] alert fan-out hit the %d-recipient cap", alertMaxRecipients)
	return total, nil
}

const newListingFanOutSQL = `
WITH page AS (
	SELECT f.follower_id
	FROM mkt_seller_follows f
	WHERE f.seller_id = $3::uuid AND f.follower_id > $1::uuid
	ORDER BY f.follower_id
	LIMIT $2
), ins AS (
	INSERT INTO mkt_notifications (user_id, type, title, body, data, related_id, dedupe_key)
	SELECT p.follower_id, 'new_listing'::mkt_notification_type, $5, $6,
	       jsonb_build_object('listing_id', $4::text, 'seller_id', $3::text), $4::uuid,
	       'new_listing:' || $4::text
	FROM page p
	WHERE NOT EXISTS (
		SELECT 1 FROM mkt_blocks b
		WHERE (b.user_id = p.follower_id AND b.blocked_user_id = $3::uuid)
		   OR (b.user_id = $3::uuid AND b.blocked_user_id = p.follower_id))
	  AND NOT EXISTS (
		SELECT 1 FROM mkt_notification_prefs np
		WHERE np.user_id = p.follower_id AND np.new_listing = false)
	ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
	RETURNING 1
)
SELECT (SELECT follower_id::text FROM page ORDER BY follower_id DESC LIMIT 1),
       (SELECT count(*)::int FROM page)`

// fanOutNewListing notifies the seller's followers about l. Synchronous; callers
// wanting best-effort use notifyFollowersOfListing.
func (s *Service) fanOutNewListing(ctx context.Context, l *Listing) {
	body := fmt.Sprintf("“%s” — %s", l.Title, nairaFromKobo(l.PriceKobo))
	if _, err := s.fanOut(ctx, newListingFanOutSQL, l.SellerID, l.ID, "New listing from a seller you follow", body); err != nil {
		log.Printf("[marketplace] new-listing fan-out for %s failed: %v", l.ID, err)
	}
}

const priceDropFanOutSQL = `
WITH page AS (
	SELECT si.user_id
	FROM mkt_saved_items si
	WHERE si.listing_id = $4::uuid AND si.user_id > $1::uuid
	  AND si.saved_price_kobo > $5::bigint
	  AND si.user_id <> $3::uuid
	ORDER BY si.user_id
	LIMIT $2
), ins AS (
	INSERT INTO mkt_notifications (user_id, type, title, body, data, related_id, dedupe_key)
	SELECT p.user_id, 'price_dropped'::mkt_notification_type, $7, $8,
	       jsonb_build_object('listing_id', $4::text, 'old_price_kobo', $6::bigint, 'new_price_kobo', $5::bigint),
	       $4::uuid, 'price_drop:' || $4::text || ':' || $6::text || ':' || $5::text
	FROM page p
	WHERE NOT EXISTS (
		SELECT 1 FROM mkt_blocks b
		WHERE (b.user_id = p.user_id AND b.blocked_user_id = $3::uuid)
		   OR (b.user_id = $3::uuid AND b.blocked_user_id = p.user_id))
	  AND NOT EXISTS (
		SELECT 1 FROM mkt_notification_prefs np
		WHERE np.user_id = p.user_id AND np.price_drop = false)
	ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
	RETURNING 1
)
SELECT (SELECT user_id::text FROM page ORDER BY user_id DESC LIMIT 1),
       (SELECT count(*)::int FROM page)`

// fanOutPriceDrop notifies savers whose saved price is above the new price. The
// dedupe key includes old→new, so a retried edit is silent but a later, further
// drop notifies again ("once per drop").
func (s *Service) fanOutPriceDrop(ctx context.Context, l *Listing, oldKobo, newKobo int64) {
	if newKobo >= oldKobo {
		return
	}
	body := fmt.Sprintf("“%s” dropped from %s to %s.", l.Title, nairaFromKobo(oldKobo), nairaFromKobo(newKobo))
	if _, err := s.fanOut(ctx, priceDropFanOutSQL, l.SellerID, l.ID, newKobo, oldKobo, "Price drop on a saved item", body); err != nil {
		log.Printf("[marketplace] price-drop fan-out for %s failed: %v", l.ID, err)
	}
}
