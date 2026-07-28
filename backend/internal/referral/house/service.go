// Package house resolves the governed system/Super-Admin house account that
// captures the referrer-side bonus for no-code / organic signups (§7A.1 step 5,
// §7A.2). The house is a dedicated SYSTEM account the Super Admin owns — never an
// individual's personal wallet. House ledger accruals are non-withdrawable,
// excluded_from_override and excluded_from_kfactor (§7A.2, §10).
//
// Resolution order (env-overridable, falling back to the seeded global row):
//  1. SUPER_ADMIN_REFERRAL_CODE → the house row with that code.
//  2. SUPER_ADMIN_USER_ID        → that user's house row (owner_user_id).
//  3. the seeded global row       → code 'SPOT-HOUSE'.
package house

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Env var names used for runtime house resolution.
const (
	EnvSuperAdminReferralCode = "SUPER_ADMIN_REFERRAL_CODE"
	EnvSuperAdminUserID       = "SUPER_ADMIN_USER_ID"
	DefaultGlobalHouseCode    = "SPOT-HOUSE"
)

// Account is a governed house/system referral capture account.
type Account struct {
	ID              string    `json:"id"`
	Scope           string    `json:"scope"`
	Region          *string   `json:"region,omitempty"`
	OwnerUserID     *string   `json:"owner_user_id,omitempty"`
	Code            string    `json:"code"`
	NonWithdrawable bool      `json:"non_withdrawable"`
	CreatedAt       time.Time `json:"created_at"`
}

// Service resolves and reads house accounts.
type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

const selectCols = `id, scope, region, owner_user_id, code, non_withdrawable, created_at`

func scanAccount(row pgx.Row) (*Account, error) {
	var a Account
	if err := row.Scan(&a.ID, &a.Scope, &a.Region, &a.OwnerUserID, &a.Code, &a.NonWithdrawable, &a.CreatedAt); err != nil {
		return nil, err
	}
	return &a, nil
}

// GetOrCreateGlobalHouse resolves the system house account per the env override
// chain, ensuring the seeded global row always exists as the last resort.
func (s *Service) GetOrCreateGlobalHouse(ctx context.Context) (*Account, error) {
	// 1. Explicit house code via env.
	if code := os.Getenv(EnvSuperAdminReferralCode); code != "" {
		if a, err := s.byCode(ctx, code); err == nil {
			return a, nil
		}
	}
	// 2. Super-admin user id → their owned house row.
	if uid := os.Getenv(EnvSuperAdminUserID); uid != "" {
		if a, err := s.byOwner(ctx, uid); err == nil {
			return a, nil
		}
	}
	// 3. Seeded global row (ensure it exists).
	if a, err := s.byCode(ctx, DefaultGlobalHouseCode); err == nil {
		return a, nil
	}
	// The migration seeds SPOT-HOUSE; create it defensively if missing.
	const ins = `
		INSERT INTO referral_house_accounts (scope, code, non_withdrawable)
		VALUES ('global', $1, true)
		ON CONFLICT (code) DO NOTHING
		RETURNING ` + selectCols
	a, err := scanAccount(s.db.QueryRow(ctx, ins, DefaultGlobalHouseCode))
	if err == nil {
		return a, nil
	}
	// Race: another writer inserted it — fetch.
	return s.byCode(ctx, DefaultGlobalHouseCode)
}

// ByCode resolves a house account by its unique code.
func (s *Service) byCode(ctx context.Context, code string) (*Account, error) {
	const q = `SELECT ` + selectCols + ` FROM referral_house_accounts WHERE code = $1`
	a, err := scanAccount(s.db.QueryRow(ctx, q, code))
	if err != nil {
		return nil, fmt.Errorf("referral/house: by code %q: %w", code, err)
	}
	return a, nil
}

// byOwner resolves the house account owned by a given (super-admin) user.
func (s *Service) byOwner(ctx context.Context, ownerUserID string) (*Account, error) {
	const q = `
		SELECT ` + selectCols + `
		FROM referral_house_accounts
		WHERE owner_user_id = $1
		ORDER BY created_at ASC
		LIMIT 1`
	a, err := scanAccount(s.db.QueryRow(ctx, q, ownerUserID))
	if err != nil {
		return nil, fmt.Errorf("referral/house: by owner %q: %w", ownerUserID, err)
	}
	return a, nil
}

// GetByID fetches a house account by id.
func (s *Service) GetByID(ctx context.Context, id string) (*Account, error) {
	const q = `SELECT ` + selectCols + ` FROM referral_house_accounts WHERE id = $1`
	a, err := scanAccount(s.db.QueryRow(ctx, q, id))
	if err != nil {
		return nil, fmt.Errorf("referral/house: by id %q: %w", id, err)
	}
	return a, nil
}
