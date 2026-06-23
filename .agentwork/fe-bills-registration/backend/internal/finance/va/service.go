package va

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/provider"
)

// Service manages virtual account provisioning and inbound credit.
type Service struct {
	db       *pgxpool.Pool
	ledger   *ledger.Service
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
	})
	if err != nil {
		return nil, fmt.Errorf("va: provision: %w", err)
	}

	const insert = `
		INSERT INTO virtual_accounts (user_id, provider, account_number, account_name, bank_name)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id) DO NOTHING
		RETURNING id, user_id, provider, account_number, account_name, bank_name, COALESCE(bank_code,''), provisioned_at`
	va := &VirtualAccount{}
	err = s.db.QueryRow(ctx, insert,
		userID, s.vaProvider.Name(), pva.AccountNumber, pva.AccountName, pva.BankName,
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
