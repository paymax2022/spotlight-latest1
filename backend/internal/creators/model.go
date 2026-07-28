// Package creators is the Phase-3 creator monetisation module: a creator
// capability + storefront, a tip jar (via cashtag/wallet), paid-content gating with
// entitlements, recurring subscription tiers (via the shared scheduler), a creator
// earnings ledger + KYC-gated payout, plus content moderation + age controls.
//
// INVARIANTS:
//   - NL-5 perks-not-returns: creator income delivers content/perks, NEVER a
//     financial return or revenue share. There is NO yield, NO dividend, NO
//     investor share anywhere in this package — only payment-for-content/access.
//   - NL-8 ledger / NL-9 idempotent: every money move reuses the finance ledger and
//     is idempotent (tip, subscription charge, payout).
//   - NL-10 AML: payouts are KYC-gated.
//   - NL-11 content + age: content is moderation-gated and age-rated; gated content
//     is never served to under-age viewers and controls are never weakened.
//   - NL-12 audit + object-level authZ: a creator owns their storefront/content.
package creators

import "time"

// CreatorState is the capability lifecycle. A creator must be APPROVED to publish
// paid content or receive payouts.
type CreatorState string

const (
	CreatorPending   CreatorState = "PENDING"   // applied, awaiting verification
	CreatorApproved  CreatorState = "APPROVED"  // verified, may monetise
	CreatorSuspended CreatorState = "SUSPENDED" // moderation/admin hold
)

// Profile is the creator capability + storefront. One per user (object-level authZ:
// the owning user is the only writer; admin may moderate).
type Profile struct {
	UserID      string       `json:"user_id"` // FK auth.users(id)
	Handle      string       `json:"handle"`  // cashtag handle used for tips/pay
	DisplayName string       `json:"display_name"`
	Bio         string       `json:"bio"`
	State       CreatorState `json:"state"`
	StorefrontURL string     `json:"storefront_url"`
	CreatedAt   time.Time    `json:"created_at"`
	UpdatedAt   time.Time    `json:"updated_at"`
}

// ModerationState gates content visibility (NL-11). Content is PENDING until a
// moderator (or automated check) clears it; REJECTED content is never served.
type ModerationState string

const (
	ModPending  ModerationState = "PENDING"
	ModApproved ModerationState = "APPROVED"
	ModRejected ModerationState = "REJECTED"
)

// AgeRating is the content age gate (NL-11). MinAge viewers below the rating are
// refused even with a valid entitlement.
type AgeRating string

const (
	AgeAll    AgeRating = "ALL"  // general audience
	Age13     AgeRating = "13+"  // teen
	Age18     AgeRating = "18+"  // adult — strongest gate
)

// minAgeFor maps a rating to a minimum age in years.
func minAgeFor(r AgeRating) int {
	switch r {
	case Age13:
		return 13
	case Age18:
		return 18
	default:
		return 0
	}
}

// Content is a paid (or free) creator item. Visibility is the product of
// (moderation == APPROVED) AND (viewer age >= rating) AND (entitlement granted for
// paid items). Price is in kobo (NL: minor units).
type Content struct {
	ID           string          `json:"id"`
	CreatorID    string          `json:"creator_id"` // FK auth.users(id)
	Title        string          `json:"title"`
	Body         string          `json:"body"`         // or storage ref; gated server-side
	PriceKobo    int64           `json:"price_kobo"`   // 0 = free
	AgeRating    AgeRating       `json:"age_rating"`
	Moderation   ModerationState `json:"moderation_state"`
	Published    bool            `json:"published"`
	CreatedAt    time.Time       `json:"created_at"`
}

// EntitlementState tracks paid-content access. GRANTED on purchase; REVOKED on
// refund/chargeback/moderation removal.
type EntitlementState string

const (
	EntGranted EntitlementState = "GRANTED"
	EntRevoked EntitlementState = "REVOKED"
)

// Entitlement is a viewer's access grant to a piece of paid content.
type Entitlement struct {
	ID        string           `json:"id"`
	UserID    string           `json:"user_id"`    // viewer
	ContentID string           `json:"content_id"`
	State     EntitlementState `json:"state"`
	GrantedAt time.Time        `json:"granted_at"`
	RevokedAt *time.Time       `json:"revoked_at,omitempty"`
}

// SubState is the subscription lifecycle: ACTIVE → PAST_DUE (charge failed, retrying)
// → CANCELLED (terminal). PAST_DUE can recover to ACTIVE on a successful retry.
type SubState string

const (
	SubActive    SubState = "ACTIVE"
	SubPastDue   SubState = "PAST_DUE"
	SubCancelled SubState = "CANCELLED"
)

// SubscriptionTier is a creator-defined recurring plan. PriceKobo is charged every
// IntervalSecs via the shared scheduler.
type SubscriptionTier struct {
	ID           string    `json:"id"`
	CreatorID    string    `json:"creator_id"`
	Name         string    `json:"name"`
	PriceKobo    int64     `json:"price_kobo"`
	IntervalSecs int64     `json:"interval_secs"`
	Active       bool      `json:"active"`
	CreatedAt    time.Time `json:"created_at"`
}

// Subscription is a fan's enrolment in a creator tier. The scheduler drives the
// recurring charge; this row carries the lifecycle state.
type Subscription struct {
	ID         string    `json:"id"`
	SubscriberID string  `json:"subscriber_id"`
	CreatorID  string    `json:"creator_id"`
	TierID     string    `json:"tier_id"`
	State      SubState  `json:"state"`
	JobID      string    `json:"job_id"` // scheduler job driving the recurring charge
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// Tip is a one-off creator tip (via cashtag/wallet). Idempotent on the key.
type Tip struct {
	ID             string    `json:"id"`
	FromUserID     string    `json:"from_user_id"`
	CreatorID      string    `json:"creator_id"`
	AmountKobo     int64     `json:"amount_kobo"`
	IdempotencyKey string    `json:"idempotency_key"`
	CreatedAt      time.Time `json:"created_at"`
}

// EarningKind classifies a creator earnings-ledger row. ALL kinds are
// payment-for-content/access (NL-5): there is no "yield" / "return" kind.
type EarningKind string

const (
	EarnTip          EarningKind = "TIP"
	EarnContentSale  EarningKind = "CONTENT_SALE"
	EarnSubscription EarningKind = "SUBSCRIPTION"
)

// Earning is an append-only creator earnings record (projection of the money that
// already moved through the finance ledger). Net of platform fee.
type Earning struct {
	ID         string      `json:"id"`
	CreatorID  string      `json:"creator_id"`
	Kind       EarningKind `json:"kind"`
	GrossKobo  int64       `json:"gross_kobo"`
	FeeKobo    int64       `json:"fee_kobo"`
	NetKobo    int64       `json:"net_kobo"`
	Reference  string      `json:"reference"`
	CreatedAt  time.Time   `json:"created_at"`
}

// PayoutState is the payout lifecycle.
type PayoutState string

const (
	PayoutRequested PayoutState = "REQUESTED"
	PayoutPaid      PayoutState = "PAID"
	PayoutRejected  PayoutState = "REJECTED"
)

// Payout is a creator withdrawal request. KYC-gated (NL-10) before money moves.
type Payout struct {
	ID         string      `json:"id"`
	CreatorID  string      `json:"creator_id"`
	AmountKobo int64       `json:"amount_kobo"`
	State      PayoutState `json:"state"`
	CreatedAt  time.Time   `json:"created_at"`
}
