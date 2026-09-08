package marketplace

import "time"

// model_account.go — domain structs + input DTOs for the Trust & Account gap
// endpoints (saved-items, reports, blocks, notification-prefs, safe-spots).
// All wire tags are snake_case (frozen module convention).

// ─── Saved items (mkt_saved_items) ───────────────────────────────────────────

// SavedItem is one wishlist entry: the listing plus the price it was saved at, so
// the mobile "price changed" badge can compare against the current price.
type SavedItem struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	ListingID      string    `json:"listing_id"`
	SavedPriceKobo int64     `json:"saved_price_kobo"`
	CreatedAt      time.Time `json:"created_at"`
	// Listing is the joined summary (nil on a bare insert; populated by ListSavedItems).
	Listing *Listing `json:"listing,omitempty"`
}

// ─── Reports (mkt_reports) ───────────────────────────────────────────────────

// Report mirrors mkt_reports. target_type ∈ {listing, seller, chat}.
type Report struct {
	ID          string    `json:"id"`
	ReporterID  string    `json:"reporter_id"`
	TargetType  string    `json:"target_type"`
	TargetID    string    `json:"target_id"`
	Reason      string    `json:"reason"`
	EvidenceURL *string   `json:"evidence_url,omitempty"`
	Note        *string   `json:"note,omitempty"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
}

// CreateReportInput is the POST /reports body.
type CreateReportInput struct {
	TargetType  string  `json:"target_type"`
	TargetID    string  `json:"target_id"`
	Reason      string  `json:"reason"`
	EvidenceURL *string `json:"evidence_url,omitempty"`
	Note        *string `json:"note,omitempty"`
}

// validReportTargets is the closed set of reportable target types.
var validReportTargets = map[string]bool{"listing": true, "seller": true, "chat": true}

// ─── Blocks (mkt_blocks) ─────────────────────────────────────────────────────

// Block mirrors mkt_blocks — a directed block (user_id blocked blocked_user_id).
type Block struct {
	ID            string    `json:"id"`
	UserID        string    `json:"user_id"`
	BlockedUserID string    `json:"blocked_user_id"`
	CreatedAt     time.Time `json:"created_at"`
}

// ─── Followed sellers (mkt_seller_follows, § Mobile-UX-Flows LD-005) ─────────

// FollowedSeller is a follow row enriched with the followed seller's display
// name/avatar (public.user_profiles) and live trust signals — never a stored
// snapshot, so an unfollow-refollow or a name change is always current.
type FollowedSeller struct {
	ID             string    `json:"id"`
	SellerID       string    `json:"seller_id"`
	SellerName     string    `json:"seller_name"`
	AvatarURL      *string   `json:"avatar_url,omitempty"`
	TrustScore     float64   `json:"trust_score"`
	ActiveListings int       `json:"active_listings"`
	FollowedAt     time.Time `json:"followed_at"`
}

// ─── Notification preferences (mkt_notification_prefs) ───────────────────────

// NotificationPrefs mirrors mkt_notification_prefs (one row per user). Every
// category defaults to true except promotional (opt-in). §33 per-category toggles.
type NotificationPrefs struct {
	UserID      string    `json:"user_id"`
	NewOffer    bool      `json:"new_offer"`
	PriceDrop   bool      `json:"price_drop"`
	OrderStatus bool      `json:"order_status"`
	BoostExpiry bool      `json:"boost_expiry"`
	Promotional bool      `json:"promotional"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// defaultNotificationPrefs returns the day-one defaults (all on except promotional).
func defaultNotificationPrefs(userID string) *NotificationPrefs {
	return &NotificationPrefs{
		UserID:      userID,
		NewOffer:    true,
		PriceDrop:   true,
		OrderStatus: true,
		BoostExpiry: true,
		Promotional: false,
	}
}

// NotificationPrefsPatch is the PATCH /notification-prefs body — every field is a
// pointer so a partial update only touches the toggles the client sends. The wire
// keys accept both snake_case (module convention) and the camelCase the mobile
// client sends pre-normalization; the client normalizer already snake-cases bodies,
// so snake_case is authoritative here.
type NotificationPrefsPatch struct {
	NewOffer    *bool `json:"new_offer,omitempty"`
	PriceDrop   *bool `json:"price_drop,omitempty"`
	OrderStatus *bool `json:"order_status,omitempty"`
	BoostExpiry *bool `json:"boost_expiry,omitempty"`
	Promotional *bool `json:"promotional,omitempty"`
}

// ─── Meetup safe-spots ───────────────────────────────────────────────────────

// SafeSpot is one curated verified-safe meetup location (§27 Meetup Mode). Seeded
// statically in code (no table) — a small, slowly-changing partner list.
type SafeSpot struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Kind     string  `json:"kind"` // police_station | bank_branch | mall | public_landmark
	Address  string  `json:"address"`
	State    string  `json:"state"`
	LGA      string  `json:"lga"`
	Lat      float64 `json:"lat"`
	Lng      float64 `json:"lng"`
	Verified bool    `json:"verified"`
}
