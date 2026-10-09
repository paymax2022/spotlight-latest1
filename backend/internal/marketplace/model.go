package marketplace

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"
)

// ListingStatus: draft,pending_review,active,paused,expired,sold,removed_policy,removed_user
type ListingStatus string

const (
	ListingDraft         ListingStatus = "draft"
	ListingPendingReview ListingStatus = "pending_review"
	ListingActive        ListingStatus = "active"
	ListingPaused        ListingStatus = "paused"
	ListingExpired       ListingStatus = "expired"
	ListingSold          ListingStatus = "sold"
	ListingRemovedPolicy ListingStatus = "removed_policy"
	ListingRemovedUser   ListingStatus = "removed_user"
)

// OrderStatus: initiated,funded,seller_accepted,in_delivery,delivered,inspection_window,released,cancelled,disputed,refunded,split_settled
type OrderStatus string

const (
	OrderInitiated        OrderStatus = "initiated"
	OrderFunded           OrderStatus = "funded"
	OrderSellerAccepted   OrderStatus = "seller_accepted"
	OrderInDelivery       OrderStatus = "in_delivery"
	OrderDelivered        OrderStatus = "delivered"
	OrderInspectionWindow OrderStatus = "inspection_window"
	OrderReleased         OrderStatus = "released"
	OrderCancelled        OrderStatus = "cancelled"
	OrderDisputed         OrderStatus = "disputed"
	OrderRefunded         OrderStatus = "refunded"
	OrderSplitSettled     OrderStatus = "split_settled"
)

// DisputeStatus: opened,evidence_window,under_review,decided,executed,closed,appealed
type DisputeStatus string

const (
	DisputeOpened         DisputeStatus = "opened"
	DisputeEvidenceWindow DisputeStatus = "evidence_window"
	DisputeUnderReview    DisputeStatus = "under_review"
	DisputeDecided        DisputeStatus = "decided"
	DisputeExecuted       DisputeStatus = "executed"
	DisputeClosed         DisputeStatus = "closed"
	DisputeAppealed       DisputeStatus = "appealed"
)

// BoostStatus: purchased,active,completed,rejected_with_reason,cancelled_by_seller,auto_refunded
type BoostStatus string

const (
	BoostPurchased          BoostStatus = "purchased"
	BoostActive             BoostStatus = "active"
	BoostCompleted          BoostStatus = "completed"
	BoostRejectedWithReason BoostStatus = "rejected_with_reason"
	// BoostCancelledBySeller is the seller-initiated counterpart to
	// BoostRejectedWithReason (admin, policy violation, mandatory reason code) —
	// same "stop an active boost early" shape, same auto_refunded destination,
	// but the seller chose to stop it, not a moderator.
	BoostCancelledBySeller BoostStatus = "cancelled_by_seller"
	BoostAutoRefunded      BoostStatus = "auto_refunded"
)

// KYCTier: tier0_browse,tier1_buy,tier2_sell,tier3_business
type KYCTier string

const (
	KYCTier0Browse   KYCTier = "tier0_browse"
	KYCTier1Buy      KYCTier = "tier1_buy"
	KYCTier2Sell     KYCTier = "tier2_sell"
	KYCTier3Business KYCTier = "tier3_business"
)

// kycRank orders KYC tiers for >= comparisons.
func kycRank(t KYCTier) int {
	switch t {
	case KYCTier1Buy:
		return 1
	case KYCTier2Sell:
		return 2
	case KYCTier3Business:
		return 3
	default:
		return 0
	}
}

// DisputeDecision values (§1 mkt_disputes.decision).
const (
	DecisionRefundBuyer   = "refund_buyer"
	DecisionReleaseSeller = "release_seller"
	DecisionSplit         = "split"
)

// DualApprovalThresholdKobo — orders above ₦500k require two admin approvers.
const DualApprovalThresholdKobo int64 = 50000000

// DefaultMarketID is the day-one market (§1: market_id default 'NG').
const DefaultMarketID = "NG"

// InspectionWindow is the buyer inspection duration after delivery (§2.2).
const InspectionWindow = 48 * time.Hour

// EvidenceWindow is the dispute evidence-collection duration (§2.3).
const EvidenceWindow = 72 * time.Hour

// Listing mirrors mkt_listings.
type Listing struct {
	ID                   string         `json:"id"`
	MarketID             string         `json:"market_id"`
	SellerID             string         `json:"seller_id"`
	CategoryID           string         `json:"category_id"`
	Title                string         `json:"title"`
	Description          string         `json:"description"`
	PriceKobo            int64          `json:"price_kobo"`
	Currency             string         `json:"currency"`
	Condition            string         `json:"condition"`
	Attrs                map[string]any `json:"attrs"`
	Status               ListingStatus  `json:"status"`
	QualityScore         float64        `json:"quality_score"`
	EscrowEligible       bool           `json:"escrow_eligible"`
	State                string         `json:"state"`
	LGA                  string         `json:"lga"`
	ModerationReasonCode *string        `json:"moderation_reason_code,omitempty"`
	ViewCount            int64          `json:"view_count"`
	SaveCount            int64          `json:"save_count"`
	CreatedAt            time.Time      `json:"created_at"`
	UpdatedAt            time.Time      `json:"updated_at"`
	ExpiresAt            time.Time      `json:"expires_at"`
	SoldAt               *time.Time     `json:"sold_at,omitempty"`
	// ThumbURL is a short-lived presigned GET for the listing's first photo, or
	// "" when it has none. The mobile ListingCard reads `thumbUrl` and has always
	// expected it; nothing ever populated it, which is why every card fell back to
	// a placeholder. Not a column — attached by Service.attachThumbs from
	// mkt_listing_media, because the objects live in a PRIVATE R2 bucket and a raw
	// object key is not fetchable by the client.
	ThumbURL string `json:"thumb_url,omitempty"`
	// Media is the full photo gallery for the LISTING DETAIL screen only (never
	// populated on search/list results — those need one card thumbnail, not a
	// whole gallery's worth of presigned URLs per row). The mobile detail screen
	// (app/marketplace/listing/[id].tsx) has always read `media` expecting this
	// shape; nothing on the backend ever populated it, so the gallery always
	// rendered its zero-photos placeholder even once ThumbURL started working
	// for cards. Attached by Service.attachFullMedia from mkt_listing_media.
	Media   []ListingMediaItem `json:"media,omitempty"`
	Version int                `json:"-"` // optimistic-lock companion (mkt_listings not shown; additive)
}

// ListingMediaItem is one presigned photo on a listing's detail gallery.
// url_thumb/url_card/url_full are the same underlying object today (see
// InsertListingMedia) — each is presigned from that one key rather than
// signed three times, since a later derivative pipeline can only ever make
// the three diverge, never require three separate reads now.
type ListingMediaItem struct {
	ID        string `json:"id"`
	URLThumb  string `json:"url_thumb"`
	URLCard   string `json:"url_card"`
	URLFull   string `json:"url_full"`
	Blurhash  string `json:"blurhash"`
	SortOrder int    `json:"sort_order"`
}

// Order mirrors mkt_orders (the critical-path escrow row).
type Order struct {
	ID                 string      `json:"id"`
	MarketID           string      `json:"market_id"`
	ListingID          string      `json:"listing_id"`
	BuyerID            string      `json:"buyer_id"`
	SellerID           string      `json:"seller_id"`
	OfferID            *string     `json:"offer_id,omitempty"`
	AmountKobo         int64       `json:"amount_kobo"`
	EscrowFeeKobo      int64       `json:"escrow_fee_kobo"`
	DeliveryFeeKobo    int64       `json:"delivery_fee_kobo"`
	Status             OrderStatus `json:"status"`
	LedgerFundRef      *string     `json:"ledger_fund_ref,omitempty"`
	LedgerReleaseRef   *string     `json:"ledger_release_ref,omitempty"`
	DeliveryRef        *string     `json:"delivery_ref,omitempty"`
	PODPhotoURL        *string     `json:"pod_photo_url,omitempty"`
	IdempotencyKey     string      `json:"-"`
	InspectionDeadline *time.Time  `json:"inspection_deadline,omitempty"`
	CreatedAt          time.Time   `json:"created_at"`
	UpdatedAt          time.Time   `json:"updated_at"`
	FundedAt           *time.Time  `json:"funded_at,omitempty"`
	DeliveredAt        *time.Time  `json:"delivered_at,omitempty"`
	ReleasedAt         *time.Time  `json:"released_at,omitempty"`
	CancelledAt        *time.Time  `json:"cancelled_at,omitempty"`
}

// TotalPayableKobo is item price + escrow fee + delivery fee (§3.1 checkout).
func (o *Order) TotalPayableKobo() int64 {
	return o.AmountKobo + o.EscrowFeeKobo + o.DeliveryFeeKobo
}

// Dispute mirrors mkt_disputes.
type Dispute struct {
	ID                   string        `json:"id"`
	OrderID              string        `json:"order_id"`
	OpenedBy             string        `json:"opened_by"`
	ReasonCode           string        `json:"reason_code"`
	Status               DisputeStatus `json:"status"`
	Decision             *string       `json:"decision,omitempty"`
	DecisionNotes        *string       `json:"decision_notes,omitempty"`
	DecidedBy            *string       `json:"decided_by,omitempty"`
	SecondApproverID     *string       `json:"second_approver_id,omitempty"`
	RequiresDualApproval bool          `json:"requires_dual_approval"`
	EvidenceDeadline     time.Time     `json:"evidence_deadline"`
	CreatedAt            time.Time     `json:"created_at"`
	DecidedAt            *time.Time    `json:"decided_at,omitempty"`
	ExecutedAt           *time.Time    `json:"executed_at,omitempty"`
}

// Boost mirrors mkt_boosts.
type Boost struct {
	ID                  string      `json:"id"`
	ListingID           string      `json:"listing_id"`
	SellerID            string      `json:"seller_id"`
	Tier                string      `json:"tier"`
	DurationDays        int         `json:"duration_days"`
	PriceKobo           int64       `json:"price_kobo"`
	Weight              float64     `json:"weight"`
	LedgerChargeRef     string      `json:"ledger_charge_ref"`
	Status              BoostStatus `json:"status"`
	RejectionReasonCode *string     `json:"rejection_reason_code,omitempty"`
	RefundRef           *string     `json:"refund_ref,omitempty"`
	// RefundedKobo is the ACTUAL amount refunded, set only once a refund has
	// posted. Not always PriceKobo: RejectBoost (admin) refunds in full, but
	// CancelBoost (seller) prorates for the unused days — the client must read
	// this, not assume PriceKobo, once Status is BoostAutoRefunded.
	RefundedKobo *int64     `json:"refunded_kobo,omitempty"`
	StartsAt     *time.Time `json:"starts_at,omitempty"`
	EndsAt       *time.Time `json:"ends_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
}

// BoostPackage mirrors mkt_boost_packages — the admin-editable catalog of
// preset boost tiers (ADM-002/MO-002). Mirrors frontend-admin's MktBoostPackage
// (types/marketplaceAdmin.ts) field-for-field so the pricing console renders
// the backend response unchanged.
type BoostPackage struct {
	Tier         string     `json:"tier"`
	Label        string     `json:"label"`
	DurationDays int        `json:"duration_days"`
	PriceKobo    int64      `json:"price_kobo"`
	Weight       float64    `json:"weight"`
	IsActive     bool       `json:"is_active"`
	UpdatedAt    *time.Time `json:"updated_at,omitempty"`
	UpdatedBy    *string    `json:"updated_by,omitempty"`
	CreatedAt    *time.Time `json:"created_at,omitempty"`
}

// BoostDailyRate mirrors mkt_boost_daily_rate — the single admin-set ₦/day
// rate used to price a custom (non-package) date-range boost.
type BoostDailyRate struct {
	DailyRateKobo int64      `json:"daily_rate_kobo"`
	UpdatedAt     *time.Time `json:"updated_at,omitempty"`
	UpdatedBy     *string    `json:"updated_by,omitempty"`
}

// BoostQuote is the authoritative, server-computed price for a would-be boost
// purchase — returned by both GET /boosts/quote (preview) and internally by
// PurchaseBoost, from the SAME ComputeBoostQuote call, so the two can never
// price the same request differently.
type BoostQuote struct {
	Mode         string    `json:"mode"` // "package" | "custom"
	Tier         string    `json:"tier,omitempty"`
	DurationDays int       `json:"duration_days"`
	PriceKobo    int64     `json:"price_kobo"`
	Weight       float64   `json:"weight"`
	StartsAt     time.Time `json:"starts_at"`
	EndsAt       time.Time `json:"ends_at"`
}

// Offer mirrors mkt_offers. RESPONSE JSON is camelCase, which is harmless: the
// mobile client deep-camels every response, so either casing arrives correctly.
// Do NOT copy this casing onto a REQUEST struct — the same client deep-SNAKES
// every outbound body, so a camelCase request field can never be populated.
// Doing exactly that silently broke offers/counter/threads (see handler.go).
type Offer struct {
	ID             string    `json:"id"`
	ListingID      string    `json:"listingId"`
	BuyerID        string    `json:"buyerId"`
	OfferPriceKobo int64     `json:"offerPriceKobo"`
	Status         string    `json:"status"`
	ParentOfferID  *string   `json:"parentOfferId,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
	ExpiresAt      time.Time `json:"expiresAt"`
}

// Review mirrors mkt_reviews.
type Review struct {
	ID              string    `json:"id"`
	OrderID         string    `json:"order_id"`
	ReviewerID      string    `json:"reviewer_id"`
	RevieweeID      string    `json:"reviewee_id"`
	Rating          *int      `json:"rating,omitempty"`
	Comment         *string   `json:"comment,omitempty"`
	SellerReply     *string   `json:"seller_reply,omitempty"`
	IsPlaceholder   bool      `json:"is_placeholder"`
	ModerationState string    `json:"moderation_state"`
	CreatedAt       time.Time `json:"created_at"`
}

// SavedSearch mirrors mkt_saved_searches.
type SavedSearch struct {
	ID           string         `json:"id"`
	UserID       string         `json:"user_id"`
	MarketID     string         `json:"market_id"`
	Query        *string        `json:"query,omitempty"`
	Filters      map[string]any `json:"filters"`
	AlertEnabled bool           `json:"alert_enabled"`
	CreatedAt    time.Time      `json:"created_at"`
}

// Category mirrors mkt_categories (subset consumed by the API).
type Category struct {
	ID       string  `json:"id"`
	MarketID string  `json:"market_id"`
	ParentID *string `json:"parent_id,omitempty"`
	Slug     string  `json:"slug"`
	Name     string  `json:"name"`
	// Icon is a LUCIDE ICON NAME (e.g. "Car"), not a URL or a glyph: the client
	// renders it as Icons[icon]. Empty means the client's Package fallback.
	Icon string `json:"icon,omitempty"`
	// SortOrder places a category within its parent. Ordering by name alone put
	// Agriculture first and buried Vehicles and Property mid-alphabet.
	SortOrder       int             `json:"sort_order"`
	AttributeSchema json.RawMessage `json:"attribute_schema"`
	RiskTier        int             `json:"risk_tier"`
	CommissionBps   int             `json:"commission_bps"`
	IsActive        bool            `json:"is_active"`
	// ListingCount/CreatedAt/UpdatedAt are populated by the admin taxonomy
	// routes (repository_admin_taxonomy.go) — the EC-007 delete-guard count and
	// audit timestamps the admin console's taxonomy page needs. Not populated
	// by the member-facing ListCategories query.
	ListingCount int        `json:"listing_count,omitempty"`
	CreatedAt    *time.Time `json:"created_at,omitempty"`
	UpdatedAt    *time.Time `json:"updated_at,omitempty"`
}

// Flag mirrors mkt_flags (admin moderation).
type Flag struct {
	ID         string     `json:"id"`
	TargetType string     `json:"target_type"`
	TargetID   string     `json:"target_id"`
	ReporterID string     `json:"reporter_id"`
	ReasonCode string     `json:"reason_code"`
	Notes      *string    `json:"notes,omitempty"`
	Status     string     `json:"status"`
	ReviewedBy *string    `json:"reviewed_by,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	ReviewedAt *time.Time `json:"reviewed_at,omitempty"`
}

// TrustProfile mirrors mkt_trust_scores (seller profile card).
type TrustProfile struct {
	UserID                string  `json:"user_id"`
	MarketID              string  `json:"market_id"`
	KYCTier               KYCTier `json:"kyc_tier"`
	VerifiedIDBadge       bool    `json:"verified_id_badge"`
	VerifiedBusinessBadge bool    `json:"verified_business_badge"`
	CompletedEscrowCount  int     `json:"completed_escrow_count"`
	DisputeCount          int     `json:"dispute_count"`
	TrustScore            float64 `json:"trust_score"`
}

// OutboxRow mirrors mkt_listings_outbox — the CDC source Agent B (search) drains.
type OutboxRow struct {
	ID          int64           `json:"id"`
	ListingID   string          `json:"listing_id"`
	Op          string          `json:"op"` // "upsert" | "delete"
	Payload     json.RawMessage `json:"payload"`
	ProcessedAt *time.Time      `json:"processed_at,omitempty"`
	CreatedAt   time.Time       `json:"created_at"`
}

// Outbox ops.
const (
	OutboxUpsert = "upsert"
	OutboxDelete = "delete"
)

// CreateOrderInput is the create-escrow-order request body (§3.1).
type CreateOrderInput struct {
	ListingID      string  `json:"listing_id"`
	OfferID        *string `json:"offer_id,omitempty"`
	DeliveryOption string  `json:"delivery_option"` // pickup | rider_delivery
}

// FundInput is the fund-order request body (§3.1).
type FundInput struct {
	PaymentMethod string `json:"payment_method"` // wallet | card | bank_transfer
}

// DisputeInput is the open-dispute request body (§3.1).
type DisputeInput struct {
	ReasonCode  string          `json:"reason_code"`
	Description string          `json:"description"`
	Evidence    []EvidenceInput `json:"evidence"`
}

// EvidenceInput is one attached piece of dispute evidence.
type EvidenceInput struct {
	Type      string `json:"type"` // photo | chat_excerpt | document
	URLOrText string `json:"url_or_text"`
}

// CreateListingInput is the create-listing request body (§3.2).
type CreateListingInput struct {
	CategoryID     string         `json:"category_id"`
	Title          string         `json:"title"`
	Description    string         `json:"description"`
	PriceKobo      int64          `json:"price_kobo"`
	Condition      string         `json:"condition"`
	Attrs          map[string]any `json:"attrs"`
	MediaIDs       []string       `json:"media_ids"`
	State          string         `json:"state"`
	LGA            string         `json:"lga"`
	EscrowEligible *bool          `json:"escrow_eligible,omitempty"`
}

// UpdateListingInput is the mutable subset of a listing.
type UpdateListingInput struct {
	Title       *string        `json:"title,omitempty"`
	Description *string        `json:"description,omitempty"`
	PriceKobo   *int64         `json:"price_kobo,omitempty"`
	Attrs       map[string]any `json:"attrs,omitempty"`
}

// CreateBoostInput is the purchase-boost request body (§2.4). Exactly ONE of
// Tier (a preset package) or EndsAt (a custom date-range boost, priced by the
// admin-set ₦/day rate) is expected — ComputeBoostQuote is the single place
// that resolves and validates which.
type CreateBoostInput struct {
	ListingID string     `json:"listing_id"`
	Tier      string     `json:"tier,omitempty"`
	EndsAt    *time.Time `json:"ends_at,omitempty"`
}

// DecideDisputeInput is the admin dispute-decision body (§6.3).
type DecideDisputeInput struct {
	Decision   string `json:"decision"` // refund_buyer | release_seller | split
	ReasonCode string `json:"reason_code"`
	Notes      string `json:"notes"`
	// SplitBuyerKobo is only read when Decision == split; the seller receives the
	// remainder (amount − split_buyer). Ignored otherwise.
	SplitBuyerKobo int64 `json:"split_buyer_kobo,omitempty"`
}

// model_account.go — domain structs + input DTOs for the Trust & Account gap
// endpoints (saved-items, reports, blocks, notification-prefs, safe-spots).
// All wire tags are snake_case (frozen module convention).

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
var validReportTargets = map[string]bool{string(AppealTargetListing): true, "seller": true, "chat": true}

// Block mirrors mkt_blocks — a directed block (user_id blocked blocked_user_id).
type Block struct {
	ID            string    `json:"id"`
	UserID        string    `json:"user_id"`
	BlockedUserID string    `json:"blocked_user_id"`
	CreatedAt     time.Time `json:"created_at"`
}

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

// ListingInsights is the seller-facing performance summary for ONE listing.
// Every figure is counted from the table that actually records the event, not
// from a denormalised counter — mkt_listings.save_count is never written by this
// backend, so trusting it would report 0 saves forever.
// Views are the exception and are read from mkt_listings.view_count, because
// there is no per-view event table. See Repository.IncrementListingView.
type ListingInsights struct {
	ListingID string `json:"listing_id"`

	Views          int64 `json:"views"`
	Saves          int64 `json:"saves"`           // mkt_saved_items
	Enquiries      int64 `json:"enquiries"`       // mkt_threads — buyers who opened a chat
	Offers         int64 `json:"offers"`          // mkt_offers
	ContactReveals int64 `json:"contact_reveals"` // mkt_contact_reveals — strongest intent signal
	Orders         int64 `json:"orders"`          // mkt_orders

	// BestOfferKobo is the highest LIVE offer (nil when none stands). Minor units,
	// int64 — never a float.
	BestOfferKobo *int64 `json:"best_offer_kobo,omitempty"`

	// Boost state, so the seller can see whether promotion is running and until when.
	BoostActive bool       `json:"boost_active"`
	BoostTier   *string    `json:"boost_tier,omitempty"`
	BoostEndsAt *time.Time `json:"boost_ends_at,omitempty"`
	ListedAt    time.Time  `json:"listed_at"`
	ExpiresAt   *time.Time `json:"expires_at,omitempty"`
}

// model_admin_users.go — MKT-007 Users/Trust&Safety + Appeals + Fraud-signals
// admin surface. Field names/vocab mirror frontend-admin/src/types/
// marketplaceAdmin.ts (MktUserAdmin, MktAppeal, MktFraudSignal, and the
// request types) VERBATIM — that file, not the service-layer USE_FIXTURES
// blocks, is the authoritative contract; the fixtures in
// marketplaceAdminService.ts are a partial/older subset of these fields.

// UserModerationStatus mirrors mkt_user_moderation.status / MktUserStatus.
type UserModerationStatus string

const (
	UserStatusActive    UserModerationStatus = "active"
	UserStatusSuspended UserModerationStatus = "suspended"
	UserStatusBanned    UserModerationStatus = "banned"
)

// UserAction mirrors MktUserAction — the verb the admin proposes; status is the
// resulting noun (ban -> banned, suspend -> suspended, reinstate -> active).
type UserAction string

const (
	UserActionSuspend   UserAction = "suspend"
	UserActionBan       UserAction = "ban"
	UserActionReinstate UserAction = "reinstate"
)

// dualApprovalRequiredFor is the ONE place the severity split lives (PR note:
// mirrors ADR-005's amount threshold, translated from money to action
// severity). Only 'ban' can silently and severely cut off a real account's
// ability to transact — it requires a second, independent admin. 'suspend' and
// 'reinstate' execute immediately under a single admin, same posture as this
// module's existing single-admin flag/listing moderation actions.
func dualApprovalRequiredFor(action UserAction) bool {
	return action == UserActionBan
}

// resultingStatus maps a proposed action to the status it produces once applied.
func resultingStatus(action UserAction) UserModerationStatus {
	switch action {
	case UserActionBan:
		return UserStatusBanned
	case UserActionSuspend:
		return UserStatusSuspended
	default:
		return UserStatusActive
	}
}

// UserAdminView is the GET /admin/users/:id (and one row of GET /admin/users)
// response shape — matches MktUserAdmin field-for-field.
type UserAdminView struct {
	ID                    string     `json:"id"`
	DisplayName           string     `json:"display_name"`
	EmailMasked           string     `json:"email_masked"`
	PhoneMasked           string     `json:"phone_masked"`
	Status                string     `json:"status"`
	KYCTier               string     `json:"kyc_tier"`
	KYCPending            bool       `json:"kyc_pending"`
	TrustScore            float64    `json:"trust_score"`
	VerifiedIDBadge       bool       `json:"verified_id_badge"`
	VerifiedBusinessBadge bool       `json:"verified_business_badge"`
	ActiveListings        int        `json:"active_listings"`
	CompletedDeals        int        `json:"completed_deals"`
	OpenFlags             int        `json:"open_flags"`
	FraudScore            float64    `json:"fraud_score"`
	SuspensionReasonCode  *string    `json:"suspension_reason_code,omitempty"`
	PendingAction         *string    `json:"pending_action,omitempty"`
	PendingActionBy       *string    `json:"pending_action_by,omitempty"`
	RequiresDualApproval  bool       `json:"requires_dual_approval"`
	CreatedAt             time.Time  `json:"created_at"`
	LastActiveAt          *time.Time `json:"last_active_at,omitempty"`
}

// SetUserStatusInput is the POST /admin/users/:id/status body (propose/maker) —
// matches MktUserActionRequest.
type SetUserStatusInput struct {
	Action     string `json:"action"` // suspend|ban|reinstate
	ReasonCode string `json:"reason_code"`
}

// KycReviewInput matches MktKycReviewRequest.
type KycReviewInput struct {
	Decision   string  `json:"decision"` // approve|reject
	ReasonCode string  `json:"reason_code"`
	GrantTier  *string `json:"grant_tier,omitempty"`
}

// BlacklistInput matches MktBlacklistRequest.
type BlacklistInput struct {
	Type       string `json:"type"` // device|phone|ip|email
	Value      string `json:"value"`
	ReasonCode string `json:"reason_code"`
}

// UserModerationRow mirrors mkt_user_moderation exactly (repository scan target).
type UserModerationRow struct {
	UserID               string
	MarketID             string
	Status               string
	SuspensionReasonCode *string
	Blacklisted          bool
	BlacklistReasonCode  *string
	KYCTier              string
	KYCPending           bool
	PendingAction        *string
	PendingReasonCode    *string
	ProposedBy           *string
	ProposedAt           *time.Time
	RequiresDualApproval bool
	SecondApproverID     *string
	SecondApprovedAt     *time.Time
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

// AppealTargetType mirrors mkt_appeals.target_type / MktAppealTargetType.
type AppealTargetType string

const (
	AppealTargetListing AppealTargetType = "listing"
	AppealTargetBoost   AppealTargetType = "boost"
	AppealTargetUser    AppealTargetType = "user"
)

// Appeal mirrors mkt_appeals / MktAppeal field-for-field.
type Appeal struct {
	ID                   string     `json:"id"`
	MarketID             string     `json:"-"` // internal scoping only; not in MktAppeal
	TargetType           string     `json:"target_type"`
	TargetID             string     `json:"target_id"`
	AppellantID          string     `json:"appellant_id"`
	OriginalAction       string     `json:"original_action"`
	OriginalReasonCode   string     `json:"original_reason_code"`
	AppellantNote        string     `json:"appellant_note"`
	Status               string     `json:"status"`
	Decision             *string    `json:"decision,omitempty"`
	DecisionNotes        *string    `json:"decision_notes,omitempty"`
	DecidedBy            *string    `json:"decided_by,omitempty"`
	DecidedAt            *time.Time `json:"decided_at,omitempty"`
	SecondApproverID     *string    `json:"second_approver_id,omitempty"`
	SecondApprovedAt     *time.Time `json:"-"` // internal; not part of MktAppeal's wire shape
	RequiresDualApproval bool       `json:"requires_dual_approval"`
	ExecutedAt           *time.Time `json:"executed_at,omitempty"`
	CreatedAt            time.Time  `json:"created_at"`
	UpdatedAt            time.Time  `json:"-"` // internal; not part of MktAppeal's wire shape
}

// CreateAppealInput is the member-facing POST /appeals body.
type CreateAppealInput struct {
	TargetType         string `json:"target_type"`
	TargetID           string `json:"target_id"`
	OriginalAction     string `json:"original_action"`
	OriginalReasonCode string `json:"original_reason_code"`
	AppellantNote      string `json:"appellant_note"`
}

// DecideAppealInput is the POST /admin/appeals/:id/decide body (propose/maker) —
// matches MktAppealDecideRequest. NOTE the request vocab is 'uphold'/'overturn'
// (verb) while the STORED/rendered Appeal.Decision is 'upheld'/'overturned'
// (past participle) — the service maps one to the other; see decisionPastTense.
type DecideAppealInput struct {
	Decision   string `json:"decision"` // uphold|overturn
	ReasonCode string `json:"reason_code"`
	Notes      string `json:"notes"`
}

func decisionPastTense(verb string) (string, bool) {
	switch verb {
	case "uphold":
		return "upheld", true
	case "overturn":
		return "overturned", true
	default:
		return "", false
	}
}

// FraudSignal is one derived, read-only risk signal (GET /admin/fraud/signals) —
// matches MktFraudSignal. Every field is traceable to a real row; see
// service_admin_fraud.go for the exact queries backing each Kind.
type FraudSignal struct {
	ID              string    `json:"id"`
	Kind            string    `json:"kind"`
	UserID          string    `json:"user_id"`
	UserDisplayName string    `json:"user_display_name"`
	Severity        string    `json:"severity"` // low|medium|high
	Detail          string    `json:"detail"`
	RelatedUserIDs  []string  `json:"related_user_ids"`
	CreatedAt       time.Time `json:"created_at"`
}

// CodedError is the uniform marketplace error shape. It carries a machine code
// (§3 taxonomy), a human message, an optional field (for validation errors), and
// the HTTP status the handler should emit. The wire shape is:
//
//	{"error":{"code","message","field","request_id"}}
//
// request_id is stamped by the handler from the gin request context, not here.
type CodedError struct {
	Status  int    `json:"-"`
	Code    string `json:"code"`
	Message string `json:"message"`
	Field   string `json:"field,omitempty"`
}

func (e *CodedError) Error() string { return e.Code + ": " + e.Message }

// newErr constructs a CodedError.
func newErr(status int, code, message string) *CodedError {
	return &CodedError{Status: status, Code: code, Message: message}
}

// fieldErr constructs a 400 validation CodedError bound to a field.
func fieldErr(code, message, field string) *CodedError {
	return &CodedError{Status: http.StatusBadRequest, Code: code, Message: message, Field: field}
}

// asCoded unwraps err to a *CodedError, or synthesizes a 500 for anything else.
// Sentinel ledger/redis errors are mapped to their marketplace-domain code here so
// the service layer can return raw ledger errors and still produce a clean shape.
func asCoded(err error) *CodedError {
	if err == nil {
		return nil
	}
	if ce, ok := errors.AsType[*CodedError](err); ok {
		return ce
	}
	return &CodedError{Status: http.StatusInternalServerError, Code: CodeInternal, Message: err.Error()}
}

// wrapInternal preserves a coded error, otherwise wraps a raw error as an internal
// CodedError with context. Used inside the service to keep the taxonomy intact.
func wrapInternal(ctx string, err error) error {
	if err == nil {
		return nil
	}
	if ce, ok := errors.AsType[*CodedError](err); ok {
		return ce
	}
	return &CodedError{Status: http.StatusInternalServerError, Code: CodeInternal, Message: fmt.Sprintf("%s: %v", ctx, err)}
}

const (
	CodeInternal        = "INTERNAL_ERROR"
	CodeUnauthenticated = "UNAUTHENTICATED"
	CodeValidation      = "SCHEMA_VALIDATION_FAILED"

	// CodeListingNotFound — Listings
	CodeListingNotFound          = "LISTING_NOT_FOUND"
	CodeListingHasHistory        = "LISTING_HAS_HISTORY"
	CodeListingNotActive         = "LISTING_NOT_ACTIVE"
	CodeListingNotEscrowElig     = "LISTING_NOT_ESCROW_ELIGIBLE"
	CodeDescriptionTooShort      = "DESCRIPTION_TOO_SHORT"
	CodeInsufficientPhotos       = "INSUFFICIENT_PHOTOS"
	CodePriceOutOfBand           = "PRICE_OUT_OF_BAND"
	CodeDuplicatePhotoDetected   = "DUPLICATE_PHOTO_DETECTED"
	CodeListingHasActiveOrder    = "LISTING_HAS_ACTIVE_ORDER"
	CodeInvalidListingTransition = "INVALID_LISTING_TRANSITION"
	CodeContactRevealLimit       = "CONTACT_REVEAL_LIMIT"
	CodeSellerHasNoPhone         = "SELLER_HAS_NO_PHONE"

	// CodeInvalidDeliveryOption — Orders / escrow
	CodeInvalidDeliveryOption  = "INVALID_DELIVERY_OPTION"
	CodeBuyerKYCInsufficient   = "BUYER_KYC_TIER_INSUFFICIENT"
	CodeSelfPurchaseNotAllowed = "SELF_PURCHASE_NOT_ALLOWED"
	CodeOrderNotFound          = "ORDER_NOT_FOUND"
	CodeOrderNotInitiated      = "ORDER_NOT_IN_INITIATED_STATE"
	CodeOrderAlreadyFunded     = "ORDER_ALREADY_FUNDED"
	CodeOrderExpired           = "ORDER_EXPIRED"
	CodeInsufficientWallet     = "INSUFFICIENT_WALLET_BALANCE"
	CodeOrderNotInspection     = "ORDER_NOT_IN_INSPECTION_WINDOW"
	CodeInspectionDeadlinePast = "INSPECTION_DEADLINE_PASSED"
	CodeOrderNotAcceptable     = "ORDER_NOT_ACCEPTABLE"
	CodeOrderNotCancellable    = "ORDER_NOT_CANCELLABLE"
	CodeOrderNotDisputable     = "ORDER_NOT_DISPUTABLE"
	CodeInvalidOrderTransition = "INVALID_ORDER_TRANSITION"
	CodeNotOrderBuyer          = "NOT_ORDER_BUYER"
	CodeNotOrderSeller         = "NOT_ORDER_SELLER"
	CodeNotOrderParty          = "NOT_ORDER_PARTY"

	// CodeDisputeNotFound — Disputes
	CodeDisputeNotFound          = "DISPUTE_NOT_FOUND"
	CodeDisputeAlreadyOpen       = "DISPUTE_ALREADY_OPEN_FOR_ORDER"
	CodeInvalidDisputeTransition = "INVALID_DISPUTE_TRANSITION"
	CodeReasonCodeRequired       = "REASON_CODE_REQUIRED"
	CodeAwaitingSecondApproval   = "AWAITING_SECOND_APPROVAL"
	CodeSameApproverNotAllowed   = "SAME_APPROVER_NOT_ALLOWED"

	// CodeNoAppealableAction — Appeals (MKT-007): the claim has no standing
	// moderation action on the target to contest.
	CodeNoAppealableAction = "NO_APPEALABLE_ACTION"

	// CodeBoostNotFound — Boosts
	CodeBoostNotFound          = "BOOST_NOT_FOUND"
	CodeInvalidBoostTransition = "INVALID_BOOST_TRANSITION"
	CodeInvalidBoostTier       = "INVALID_BOOST_TIER"
	CodeInvalidBoostRange      = "INVALID_BOOST_DATE_RANGE"
	CodeTierLimitExceeded      = "TIER_LIMIT_EXCEEDED"
	CodeTierGateUnwired        = "TIER_GATE_UNWIRED"

	// CodeOfferNotFound — Offers / reviews / misc
	CodeOfferNotFound  = "OFFER_NOT_FOUND"
	CodeReviewNotFound = "REVIEW_NOT_FOUND"
	CodeReviewExists   = "REVIEW_ALREADY_EXISTS"
	CodeNotFound       = "NOT_FOUND"

	// CodeThreadNotFound — Messaging (ADR-023 listings-and-connect "connect" model; non-money metadata)
	CodeThreadNotFound      = "THREAD_NOT_FOUND"
	CodeCannotMessageSelf   = "CANNOT_MESSAGE_SELF"
	CodeMessageBodyRequired = "MESSAGE_BODY_REQUIRED"
	CodeMessageBodyTooLong  = "MESSAGE_BODY_TOO_LONG"
	// CodeDealNotMet — Deal reviews (ADR-023: thread-keyed reviews behind the "mark met" signal).
	CodeDealNotMet = "DEAL_NOT_MARKED_MET"

	// CodeForbidden — Cross-cutting
	CodeForbidden           = "FORBIDDEN"
	CodeIdempotencyReplay   = "IDEMPOTENCY_KEY_REPLAY"
	CodeIdempotencyMissing  = "IDEMPOTENCY_KEY_REQUIRED"
	CodeConflict            = "CONFLICT"
	CodeWebhookBadSignature = "WEBHOOK_BAD_SIGNATURE"
	CodeSearchNotWired      = "SEARCH_NOT_WIRED"
	CodeNotImplemented      = "NOT_IMPLEMENTED"

	// CodeUploadsNotConfigured — Account / trust gap endpoints (media presign, saved-items, reports, blocks,
	// notification prefs, meetup safe-spots).
	CodeUploadsNotConfigured = "UPLOADS_NOT_CONFIGURED"
	CodeAlreadySaved         = "ALREADY_SAVED"
	CodeSavedItemNotFound    = "SAVED_ITEM_NOT_FOUND"
	CodeAlreadyBlocked       = "ALREADY_BLOCKED"
	CodeBlockNotFound        = "BLOCK_NOT_FOUND"
	CodeCannotBlockSelf      = "CANNOT_BLOCK_SELF"
	CodeInvalidReportTarget  = "INVALID_REPORT_TARGET"
	CodeCannotFollowSelf     = "CANNOT_FOLLOW_SELF"
)

// Constructor helpers for the most common coded errors.
var (
	ErrForbidden            = newErr(http.StatusForbidden, CodeForbidden, "you may not act on this resource")
	ErrUnauthenticated      = newErr(http.StatusUnauthorized, CodeUnauthenticated, "authentication required")
	ErrListingNotFound      = newErr(http.StatusNotFound, CodeListingNotFound, "listing not found")
	ErrOrderNotFound        = newErr(http.StatusNotFound, CodeOrderNotFound, "order not found")
	ErrDisputeNotFound      = newErr(http.StatusNotFound, CodeDisputeNotFound, "dispute not found")
	ErrBoostNotFound        = newErr(http.StatusNotFound, CodeBoostNotFound, "boost not found")
	ErrBoostPackageNotFound = newErr(http.StatusBadRequest, CodeInvalidBoostTier, "unknown boost tier")
	ErrOfferNotFound        = newErr(http.StatusNotFound, CodeOfferNotFound, "offer not found")
	ErrThreadNotFound       = newErr(http.StatusNotFound, CodeThreadNotFound, "thread not found")
	ErrReviewExists         = newErr(http.StatusConflict, CodeReviewExists, "you have already reviewed this deal")
	ErrCannotMessageSelf    = newErr(422, CodeCannotMessageSelf, "you cannot start a conversation with yourself")
	ErrCannotFollowSelf     = newErr(422, CodeCannotFollowSelf, "you cannot follow yourself")
	ErrReasonRequired       = newErr(http.StatusBadRequest, CodeReasonCodeRequired, "reason_code is required")
	ErrIdemMissing          = newErr(http.StatusBadRequest, CodeIdempotencyMissing, "Idempotency-Key header required")
	ErrConflict             = newErr(http.StatusConflict, CodeConflict, "conflicting concurrent write")
	// ErrNotFound is a generic 404 for admin sub-resources (MKT-007 users/appeals)
	// that don't warrant their own dedicated CodedError constant.
	ErrNotFound = newErr(http.StatusNotFound, CodeNotFound, "not found")
	// ErrAppealNotFound — MKT-007 appeals admin.
	ErrAppealNotFound = newErr(http.StatusNotFound, CodeNotFound, "appeal not found")
	// ErrNoAppealableAction — POST /appeals: the target exists and belongs to the
	// appellant, but no moderation action currently stands on it (e.g. claiming
	// 'removed_policy' on a listing that was never moderated, or appealing a
	// boost the seller cancelled themself). 422 — same class as
	// ErrCannotMessageSelf: the entity is real, the claim is unprocessable.
	ErrNoAppealableAction = newErr(422, CodeNoAppealableAction, "no appealable moderation action is recorded on this target")
	// ErrNoPendingAction — MKT-007 maker-checker second-sign attempted with
	// nothing PENDING (already approved/rejected, or never proposed).
	ErrNoPendingAction = newErr(http.StatusConflict, CodeConflict, "no pending action awaiting approval")
	// ErrSameApproverNotAllowed — MKT-007 maker-checker: the checker must be a
	// DIFFERENT admin than the maker who proposed the action (four-eyes). Reuses
	// the CodeSameApproverNotAllowed taxonomy entry this module already defines
	// for disputes (§ Disputes error codes above) so the wire shape is identical
	// across both dual-approval flows in this module.
	ErrSameApproverNotAllowed = newErr(http.StatusConflict, CodeSameApproverNotAllowed, "the approver must be a different admin than the one who proposed this action")
	// ErrInvalidUserAction — action value outside {suspend,ban,reinstate}.
	ErrInvalidUserAction = newErr(http.StatusBadRequest, CodeValidation, "action must be one of suspend, ban, reinstate")
	// ErrInvalidAppealDecision — decision value outside {uphold,overturn}.
	ErrInvalidAppealDecision = newErr(http.StatusBadRequest, CodeValidation, "decision must be one of uphold, overturn")
	// ErrTierGateUnwired is returned by PurchaseBoost when the Service was built
	// without a TierEnforcer. A nil gate is a deployment misconfiguration, not a
	// dev-mode bypass: CLAUDE.md's iron rule requires every money mutation to pass
	// a fail-closed tier-limit check, so "no gate wired" must mean "no boost
	// purchase" rather than "the limit is unlimited". Mirrors
	// internal/restaurant's ErrTierGateUnwired. 503: server misconfiguration, not
	// the caller's fault, and retryable once wired.
	ErrTierGateUnwired = newErr(http.StatusServiceUnavailable, CodeTierGateUnwired, "boost purchase is temporarily unavailable (tier gate not wired)")
	// ErrListingNotActiveRace is returned by InsertOrderAtomic when the DB-level
	// optimistic lock finds the listing is no longer purchasable (status flipped, or
	// another buyer's order already holds this single-quantity listing). The service
	// maps it to 422 LISTING_NOT_ACTIVE so the race-loser gets a clean, correct code.
	ErrListingNotActiveRace = newErr(422, CodeListingNotActive, "listing is not active")
)
