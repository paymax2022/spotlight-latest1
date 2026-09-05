package marketplace

import (
	"encoding/json"
	"time"
)

// ─── Enums (mirror the SQL ENUMs exactly; §1 schema) ─────────────────────────

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

// BoostStatus: purchased,active,completed,rejected_with_reason,auto_refunded
type BoostStatus string

const (
	BoostPurchased          BoostStatus = "purchased"
	BoostActive             BoostStatus = "active"
	BoostCompleted          BoostStatus = "completed"
	BoostRejectedWithReason BoostStatus = "rejected_with_reason"
	BoostAutoRefunded       BoostStatus = "auto_refunded"
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

// ─── Domain structs (frozen interface; §1 columns) ───────────────────────────

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
	StartsAt            *time.Time  `json:"starts_at,omitempty"`
	EndsAt              *time.Time  `json:"ends_at,omitempty"`
	CreatedAt           time.Time   `json:"created_at"`
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

// Offer mirrors mkt_offers. JSON is camelCase to match the mobile Offer type
// (src/features/marketplace/types.ts) — the only consumer of this shape.
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

// ─── Input DTOs ──────────────────────────────────────────────────────────────

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
