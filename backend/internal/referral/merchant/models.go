// Package merchant implements merchant-funded referral campaigns and the partner
// API surface (FR-MERCH, §8B A-MER).
//
// Funding moves real money: the merchant's funding wallet is debited (kobo, with
// an Idempotency-Key) and the campaign-escrow standing account is credited via the
// finance ledger — never a direct balance write. Settlement to the merchant is
// modelled behind a SettlementHook interface (nil stub here, wired later).
// Partner API keys are HASHED at rest (sha256), scoped, and the plaintext is shown
// exactly once at issuance.
package merchant

import "time"

// Merchant statuses.
const (
	StatusActive    = "active"
	StatusSuspended = "suspended"
)

// Merchant campaign statuses.
const (
	MCDraft   = "draft"
	MCFunded  = "funded"
	MCActive  = "active"
	MCSettled = "settled"
	MCEnded   = "ended"
)

// Merchant is a brand/partner funding referral campaigns.
type Merchant struct {
	ID                  string    `json:"id"`
	OwnerUserID         string    `json:"owner_user_id,omitempty"`
	Name                string    `json:"name"`
	Slug                string    `json:"slug"`
	Status              string    `json:"status"`
	FundingWalletUserID string    `json:"funding_wallet_user_id,omitempty"`
	CreatedAt           time.Time `json:"created_at"`
}

// MerchantCampaign is a merchant-funded campaign envelope.
type MerchantCampaign struct {
	ID          string    `json:"id"`
	MerchantID  string    `json:"merchant_id"`
	CampaignID  string    `json:"campaign_id,omitempty"`
	Name        string    `json:"name"`
	FundedKobo  int64     `json:"funded_kobo"`
	SettledKobo int64     `json:"settled_kobo"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
}

// PartnerKey is an issued (hashed) partner API key record.
type PartnerKey struct {
	ID         string         `json:"id"`
	MerchantID string         `json:"merchant_id"`
	KeyPrefix  string         `json:"key_prefix"`
	Scopes     []string       `json:"scopes"`
	Status     string         `json:"status"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

// CreateMerchantInput is the admin merchant-create payload.
type CreateMerchantInput struct {
	Name                string `json:"name"`
	Slug                string `json:"slug"`
	OwnerUserID         string `json:"owner_user_id"`
	FundingWalletUserID string `json:"funding_wallet_user_id"`
}

// CreateMCInput creates a merchant-funded campaign envelope.
type CreateMCInput struct {
	MerchantID string `json:"merchant_id"`
	CampaignID string `json:"campaign_id"`
	Name       string `json:"name"`
}

// FundInput funds a merchant campaign from the merchant's wallet (kobo).
type FundInput struct {
	AmountKobo int64 `json:"amount_kobo"`
}

// IssueKeyInput requests a new scoped partner API key.
type IssueKeyInput struct {
	MerchantID string   `json:"merchant_id"`
	Scopes     []string `json:"scopes"`
}

// IssuedKey is the one-time response carrying the plaintext key.
type IssuedKey struct {
	ID        string   `json:"id"`
	KeyPrefix string   `json:"key_prefix"`
	PlainKey  string   `json:"plain_key"` // shown ONCE; never stored in plaintext
	Scopes    []string `json:"scopes"`
}
