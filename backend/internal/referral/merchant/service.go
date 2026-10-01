package merchant

import (
	"context"
	"fmt"
	"time"

	"spotlight/backend/go-common/cryptox"
	financeledger "spotlight/backend/internal/finance/ledger"
)

// SettlementHook abstracts merchant settlement (paying the merchant back / out).
// A nil hook is a no-op stub; a concrete implementation is wired later.
type SettlementHook interface {
	Settle(ctx context.Context, merchantID, merchantCampaignID string, amountKobo int64, idempotencyKey string) error
}

// Service manages merchants, merchant-funded campaigns and partner keys. Funding
// moves real money via the finance ledger (kobo + Idempotency-Key); settlement is
// delegated to the (optional) SettlementHook.
type Service struct {
	repo       *Repository
	finance    *financeledger.Service
	settlement SettlementHook
}

func NewService(repo *Repository, finance *financeledger.Service, settlement SettlementHook) *Service {
	return &Service{repo: repo, finance: finance, settlement: settlement}
}

func (s *Service) CreateMerchant(ctx context.Context, in CreateMerchantInput) (*Merchant, error) {
	if in.Name == "" || in.Slug == "" {
		return nil, fmt.Errorf("merchant: name and slug required")
	}
	return s.repo.CreateMerchant(ctx, in)
}

func (s *Service) ListMerchants(ctx context.Context) ([]Merchant, error) {
	return s.repo.ListMerchants(ctx)
}

func (s *Service) GetMerchant(ctx context.Context, id string) (*Merchant, error) {
	return s.repo.GetMerchant(ctx, id)
}

// GetMerchantByOwner returns the merchant owned by a user (member self-view).
func (s *Service) GetMerchantByOwner(ctx context.Context, ownerUserID string) (*Merchant, error) {
	return s.repo.GetMerchantByOwner(ctx, ownerUserID)
}

func (s *Service) CreateCampaign(ctx context.Context, in CreateMCInput) (*MerchantCampaign, error) {
	if in.MerchantID == "" || in.Name == "" {
		return nil, fmt.Errorf("merchant: merchant_id and name required")
	}
	return s.repo.CreateMC(ctx, in)
}

func (s *Service) ListCampaigns(ctx context.Context, merchantID string) ([]MerchantCampaign, error) {
	return s.repo.ListMCByMerchant(ctx, merchantID)
}

// Fund debits the merchant's funding wallet (kobo, idempotent) and credits the
// campaign-escrow standing account, then records the funding on the campaign.
// Requires an Idempotency-Key (passed through). Never writes a balance directly —
// the finance ledger posts a balanced double-entry.
func (s *Service) Fund(ctx context.Context, mcID string, amountKobo int64, idempotencyKey string) (*MerchantCampaign, error) {
	if idempotencyKey == "" {
		return nil, fmt.Errorf("merchant: Idempotency-Key required to fund")
	}
	if amountKobo <= 0 {
		return nil, fmt.Errorf("merchant: funding amount must be positive")
	}
	mc, err := s.repo.GetMC(ctx, mcID)
	if err != nil {
		return nil, fmt.Errorf("merchant: campaign not found")
	}
	m, err := s.repo.GetMerchant(ctx, mc.MerchantID)
	if err != nil {
		return nil, err
	}
	if m.FundingWalletUserID == "" {
		return nil, fmt.Errorf("merchant: no funding wallet configured")
	}
	if s.finance == nil {
		return nil, fmt.Errorf("merchant: finance ledger unavailable")
	}

	// Credit the campaign-escrow standing account; debit the merchant wallet.
	escrow, err := s.finance.GetOrCreateStandingAccount(ctx, financeledger.AccountEscrow)
	if err != nil {
		return nil, err
	}
	ref := "referral:merchant:fund:" + mcID
	if err := s.finance.Debit(ctx, m.FundingWalletUserID, ref, idempotencyKey, escrow.ID, amountKobo); err != nil {
		if err == financeledger.ErrDuplicate {
			// Already processed under this key — return current state idempotently.
			return s.repo.GetMC(ctx, mcID)
		}
		if err == financeledger.ErrInsufficientFunds {
			return nil, fmt.Errorf("merchant: insufficient wallet balance")
		}
		return nil, fmt.Errorf("merchant: fund debit: %w", err)
	}
	return s.repo.AddFunding(ctx, mcID, amountKobo)
}

// Settle invokes the settlement hook (nil → no-op stub) and records the settled
// amount on the campaign envelope.
func (s *Service) Settle(ctx context.Context, mcID string, amountKobo int64, idempotencyKey string) error {
	if idempotencyKey == "" {
		return fmt.Errorf("merchant: Idempotency-Key required to settle")
	}
	mc, err := s.repo.GetMC(ctx, mcID)
	if err != nil {
		return fmt.Errorf("merchant: campaign not found")
	}
	if s.settlement != nil {
		if err := s.settlement.Settle(ctx, mc.MerchantID, mcID, amountKobo, idempotencyKey); err != nil {
			return fmt.Errorf("merchant: settlement hook: %w", err)
		}
	}
	return s.repo.AddSettlement(ctx, mcID, amountKobo)
}

// IssueKey mints a partner API key: a random secret is generated, only its
// sha256 hash + a non-secret prefix are stored, and the plaintext is returned
// once for the caller to copy.
func (s *Service) IssueKey(ctx context.Context, in IssueKeyInput) (*IssuedKey, error) {
	if in.MerchantID == "" {
		return nil, fmt.Errorf("merchant: merchant_id required")
	}
	if _, err := s.repo.GetMerchant(ctx, in.MerchantID); err != nil {
		return nil, fmt.Errorf("merchant: merchant not found")
	}
	secret, prefix := generateKey()
	plain := prefix + "." + secret
	hash := cryptox.SHA256Hex(plain)

	id, err := s.repo.InsertPartnerKey(ctx, in.MerchantID, prefix, hash, in.Scopes)
	if err != nil {
		return nil, err
	}
	return &IssuedKey{
		ID:        id,
		KeyPrefix: prefix,
		PlainKey:  plain,
		Scopes:    in.Scopes,
	}, nil
}

func (s *Service) ListKeys(ctx context.Context, merchantID string) ([]PartnerKey, error) {
	return s.repo.ListPartnerKeys(ctx, merchantID)
}

func (s *Service) RevokeKey(ctx context.Context, id string) error {
	return s.repo.RevokePartnerKey(ctx, id)
}

// AuthenticateKey verifies a presented partner key ("prefix.secret"): it looks up
// the active key by prefix and compares the sha256 hash. Returns the merchant id
// and scopes when valid. (Wiring of a partner-API middleware is deferred.)
func (s *Service) AuthenticateKey(ctx context.Context, presented string) (merchantID string, scopes []string, ok bool, err error) {
	prefix := presented
	for i := 0; i < len(presented); i++ {
		if presented[i] == '.' {
			prefix = presented[:i]
			break
		}
	}
	if prefix == "" || prefix == presented {
		return "", nil, false, nil
	}
	mid, hash, sc, err := s.repo.LookupActiveKeyByPrefix(ctx, prefix)
	if err != nil || mid == "" {
		return "", nil, false, err
	}
	if !cryptox.ConstantTimeEqual(cryptox.SHA256Hex(presented), hash) {
		return "", nil, false, nil
	}
	return mid, sc, true, nil
}

// generateKey returns a random 32-byte secret (hex) plus an 8-char prefix.
func generateKey() (string, string) {
	return cryptox.RandHex(32), "pk_" + cryptox.RandHex(4)
}

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
	ID         string     `json:"id"`
	MerchantID string     `json:"merchant_id"`
	KeyPrefix  string     `json:"key_prefix"`
	Scopes     []string   `json:"scopes"`
	Status     string     `json:"status"`
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
