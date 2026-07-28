package creators

import (
	"context"
)

// Additive DB-backed member reads surfaced by the mobile integration agents
// (creators discovery / my-content / my-subscriptions go-live gap). All queries
// respect object-level authZ: discovery lists only APPROVED public storefronts;
// "my" reads are scoped to the calling user.

// Discover returns approved creator storefronts for the public directory,
// optionally filtered by a case-insensitive handle/display-name search.
func (s *Service) Discover(ctx context.Context, search string, limit int) ([]Profile, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	q := `SELECT user_id, handle, display_name, bio, state, storefront_url, created_at, updated_at
	      FROM creator_profiles WHERE state='APPROVED'`
	args := []any{}
	if search != "" {
		q += ` AND (handle ILIKE $1 OR display_name ILIKE $1)`
		args = append(args, "%"+search+"%")
	}
	q += ` ORDER BY updated_at DESC LIMIT ` + paramRef(len(args)+1)
	args = append(args, limit)
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Profile{}
	for rows.Next() {
		var p Profile
		var state string
		if err := rows.Scan(&p.UserID, &p.Handle, &p.DisplayName, &p.Bio, &state, &p.StorefrontURL, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		p.State = CreatorState(state)
		out = append(out, p)
	}
	return out, rows.Err()
}

// MyContent returns the calling creator's own content items (all moderation
// states — the owner may see their own drafts/pending items).
func (s *Service) MyContent(ctx context.Context, creatorID string, limit int) ([]Content, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	const q = `SELECT id, creator_id, title, body, price_kobo, age_rating, moderation_state, published, created_at
	           FROM creator_content WHERE creator_id=$1 ORDER BY created_at DESC LIMIT $2`
	rows, err := s.db.Query(ctx, q, creatorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Content{}
	for rows.Next() {
		var c Content
		var rating, mod string
		if err := rows.Scan(&c.ID, &c.CreatorID, &c.Title, &c.Body, &c.PriceKobo, &rating, &mod, &c.Published, &c.CreatedAt); err != nil {
			return nil, err
		}
		c.AgeRating = AgeRating(rating)
		c.Moderation = ModerationState(mod)
		out = append(out, c)
	}
	return out, rows.Err()
}

// SubscriptionRow is a subscription the caller holds, enriched with tier/creator
// display for the "my subscriptions" list.
type SubscriptionRow struct {
	Subscription
	TierName    string `json:"tier_name"`
	PriceKobo   int64  `json:"price_kobo"`
	CreatorName string `json:"creator_name"`
}

// MySubscriptions returns the subscriptions the caller holds as a subscriber.
func (s *Service) MySubscriptions(ctx context.Context, subscriberID string) ([]SubscriptionRow, error) {
	const q = `SELECT su.id, su.subscriber_id, su.creator_id, su.tier_id, su.state, su.job_id,
	                  COALESCE(t.name,''), COALESCE(t.price_kobo,0), COALESCE(p.display_name,'')
	           FROM creator_subscriptions su
	           LEFT JOIN creator_subscription_tiers t ON t.id = su.tier_id
	           LEFT JOIN creator_profiles p ON p.user_id = su.creator_id
	           WHERE su.subscriber_id=$1
	           ORDER BY su.created_at DESC`
	rows, err := s.db.Query(ctx, q, subscriberID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SubscriptionRow{}
	for rows.Next() {
		var r SubscriptionRow
		var state string
		if err := rows.Scan(&r.ID, &r.SubscriberID, &r.CreatorID, &r.TierID, &state, &r.JobID,
			&r.TierName, &r.PriceKobo, &r.CreatorName); err != nil {
			return nil, err
		}
		r.State = SubState(state)
		out = append(out, r)
	}
	return out, rows.Err()
}

// paramRef renders a positional query placeholder ($1, $2, …) for the given
// 1-based index without importing strconv.
func paramRef(n int) string {
	if n <= 0 {
		n = 1
	}
	var b [4]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return "$" + string(b[i:])
}
