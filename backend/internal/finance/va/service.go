package va

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/provider"
)

// Errors surfaced by provisioning so callers (handler / KYC trigger) can map them.
var (
	// ErrTierTooLow means the user has not reached Tier 1 (BVN verified). A
	// dedicated NGN virtual account is a regulated product and requires it.
	ErrTierTooLow = errors.New("va: KYC tier 1 (BVN) required to provision a virtual account")
	// ErrProviderUnavailable means no VA provider is configured (no Paystack/
	// Maplerad key). Routes stay mounted but cannot provision until configured.
	ErrProviderUnavailable = errors.New("va: virtual account provider not configured")
)

// Service manages virtual account provisioning and inbound credit.
type Service struct {
	db         *pgxpool.Pool
	ledger     *ledger.Service
	vaProvider provider.VirtualAccountProvider
}

func NewService(db *pgxpool.Pool, ledger *ledger.Service, vaProvider provider.VirtualAccountProvider) *Service {
	return &Service{db: db, ledger: ledger, vaProvider: vaProvider}
}

// GetOrProvision returns the user's virtual account, provisioning one if needed.
// Idempotent — safe to call on every KYC-tier-1 event.
func (s *Service) GetOrProvision(ctx context.Context, userID string) (*VirtualAccount, error) {
	// Fast path: already provisioned.
	existing, err := s.get(ctx, userID)
	if err == nil {
		return existing, nil
	}
	if err != pgx.ErrNoRows {
		return nil, fmt.Errorf("va: get existing: %w", err)
	}

	// Gate: a dedicated NGN account is regulated — require at least Tier 1 (BVN).
	// This is the same condition the KYC tier-upgrade path triggers on.
	var tier int
	if err := s.db.QueryRow(ctx,
		`SELECT COALESCE(kyc_tier, 0) FROM user_profiles WHERE id = $1`, userID,
	).Scan(&tier); err != nil {
		return nil, fmt.Errorf("va: read tier: %w", err)
	}
	if tier < 1 {
		return nil, ErrTierTooLow
	}
	if s.vaProvider == nil {
		return nil, ErrProviderUnavailable
	}

	// Fetch user info for provisioning.
	type userInfo struct {
		Email     string
		FirstName string
		LastName  string
		Phone     string
	}
	var u userInfo
	const q = `SELECT email, split_part(full_name,' ',1), split_part(full_name,' ',2), COALESCE(phone,'') FROM user_profiles WHERE id=$1`
	if err := s.db.QueryRow(ctx, q, userID).Scan(&u.Email, &u.FirstName, &u.LastName, &u.Phone); err != nil {
		return nil, fmt.Errorf("va: fetch user info: %w", err)
	}

	pva, err := s.vaProvider.ProvisionVirtualAccount(ctx, provider.ProvisionVARequest{
		UserID:      userID,
		Email:       u.Email,
		FirstName:   u.FirstName,
		LastName:    u.LastName,
		PhoneNumber: u.Phone,
		// NOTE: BVN is required by providers for LIVE NGN DVAs. We only persist a
		// one-way bvn_hash, so plaintext is not available here. In live mode the
		// provider must receive the BVN (capture it at provision time or store it
		// reversibly under NDPA controls). Left empty for sandbox/test provisioning.
	})
	if err != nil {
		return nil, fmt.Errorf("va: provision: %w", err)
	}

	// Persist the provider's account mapping. bank_code is NOT NULL in the schema
	// and the row is keyed by the real unique constraint (user_id, provider,
	// currency) for idempotent re-provisioning.
	const insert = `
		INSERT INTO virtual_accounts (user_id, provider, account_number, account_name, bank_name, bank_code, currency)
		VALUES ($1, $2, $3, $4, $5, $6, 'NGN')
		ON CONFLICT (user_id, provider, currency) DO NOTHING
		RETURNING id, user_id, provider, account_number, account_name, bank_name, COALESCE(bank_code,''), provisioned_at`
	va := &VirtualAccount{}
	err = s.db.QueryRow(ctx, insert,
		userID, s.vaProvider.Name(), pva.AccountNumber, pva.AccountName, pva.BankName, pva.BankCode,
	).Scan(&va.ID, &va.UserID, &va.Provider, &va.AccountNumber, &va.AccountName, &va.BankName, &va.BankCode, &va.ProvisionedAt)
	if err == pgx.ErrNoRows {
		// Race — another goroutine won; fetch the winner.
		return s.get(ctx, userID)
	}
	if err != nil {
		return nil, fmt.Errorf("va: insert: %w", err)
	}
	return va, nil
}

// ProvisionForUser idempotently provisions the user's NGN virtual account and
// returns only an error. It is the hook the KYC tier-upgrade path calls when a
// user reaches Tier 1, keeping the kyc package decoupled from this one.
func (s *Service) ProvisionForUser(ctx context.Context, userID string) error {
	_, err := s.GetOrProvision(ctx, userID)
	return err
}

// CreditInbound processes an inbound transfer webhook event.
// Idempotent — safe to replay; the ledger idempotency key prevents double-credit.
func (s *Service) CreditInbound(ctx context.Context, t InboundTransfer) error {
	// Look up user by account number.
	const q = `SELECT user_id FROM virtual_accounts WHERE account_number=$1 LIMIT 1`
	var userID string
	if err := s.db.QueryRow(ctx, q, t.AccountNumber).Scan(&userID); err != nil {
		return fmt.Errorf("va: credit inbound: no account for %s: %w", t.AccountNumber, err)
	}

	clearingAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		return err
	}
	return s.ledger.Credit(ctx, userID, "inbound:"+t.Reference, t.IdempotencyKey, clearingAcc.ID, t.AmountKobo)
}

func (s *Service) get(ctx context.Context, userID string) (*VirtualAccount, error) {
	const q = `SELECT id, user_id, provider, account_number, account_name, bank_name, COALESCE(bank_code,''), provisioned_at FROM virtual_accounts WHERE user_id=$1`
	va := &VirtualAccount{}
	return va, s.db.QueryRow(ctx, q, userID).Scan(
		&va.ID, &va.UserID, &va.Provider, &va.AccountNumber, &va.AccountName, &va.BankName, &va.BankCode, &va.ProvisionedAt,
	)
}
