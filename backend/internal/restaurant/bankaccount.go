package restaurant

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// BankAccount is a merchant's saved settlement account. The account number is
// masked to the last 4 digits on read — the full value is stored only for a
// future disbursement and never returned to clients.
type BankAccount struct {
	ID                  string    `json:"id"`
	BankName            string    `json:"bank_name"`
	BankCode            string    `json:"bank_code"`
	AccountNumberMasked string    `json:"account_number_masked"`
	AccountName         string    `json:"account_name"`
	IsVerified          bool      `json:"is_verified"`
	IsDefault           bool      `json:"is_default"`
	CreatedAt           time.Time `json:"created_at"`
}

// AddBankAccountRequest is the body for saving a settlement account.
type AddBankAccountRequest struct {
	BankName      string `json:"bank_name" binding:"required"`
	BankCode      string `json:"bank_code" binding:"required"`
	AccountNumber string `json:"account_number" binding:"required"`
	AccountName   string `json:"account_name" binding:"required"`
}

func maskAccountNumber(n string) string {
	n = strings.TrimSpace(n)
	if len(n) <= 4 {
		return n
	}
	return "****" + n[len(n)-4:]
}

func isAllDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// AddBankAccount saves a settlement bank account for the caller. This is capture
// only — NOT money-path (no ledger post, no fund movement). The first account for
// an owner becomes the default; the insert is idempotent on
// (user_id, bank_code, account_number).
func (s *Service) AddBankAccount(ctx context.Context, ownerID string, req AddBankAccountRequest) (*BankAccount, error) {
	acct := strings.TrimSpace(req.AccountNumber)
	if len(acct) != 10 || !isAllDigits(acct) {
		return nil, fmt.Errorf("restaurant: account_number must be 10 digits")
	}
	bankCode := strings.TrimSpace(req.BankCode)

	var count int
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM restaurant_bank_accounts WHERE user_id=$1`, ownerID).Scan(&count); err != nil {
		return nil, err
	}
	if _, err := s.db.Exec(ctx, `
		INSERT INTO restaurant_bank_accounts (user_id, bank_name, bank_code, account_number, account_name, is_default)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (user_id, bank_code, account_number) DO NOTHING`,
		ownerID, strings.TrimSpace(req.BankName), bankCode, acct, strings.TrimSpace(req.AccountName), count == 0); err != nil {
		return nil, err
	}

	var b BankAccount
	var num string
	if err := s.db.QueryRow(ctx, `
		SELECT id, bank_name, bank_code, account_number, account_name, is_verified, is_default, created_at
		FROM restaurant_bank_accounts WHERE user_id=$1 AND bank_code=$2 AND account_number=$3`,
		ownerID, bankCode, acct).Scan(&b.ID, &b.BankName, &b.BankCode, &num, &b.AccountName, &b.IsVerified, &b.IsDefault, &b.CreatedAt); err != nil {
		return nil, err
	}
	b.AccountNumberMasked = maskAccountNumber(num)
	return &b, nil
}

// ListBankAccounts returns the caller's saved accounts (default first), masked.
func (s *Service) ListBankAccounts(ctx context.Context, ownerID string) ([]BankAccount, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, bank_name, bank_code, account_number, account_name, is_verified, is_default, created_at
		FROM restaurant_bank_accounts WHERE user_id=$1 ORDER BY is_default DESC, created_at DESC`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []BankAccount{}
	for rows.Next() {
		var b BankAccount
		var num string
		if err := rows.Scan(&b.ID, &b.BankName, &b.BankCode, &num, &b.AccountName, &b.IsVerified, &b.IsDefault, &b.CreatedAt); err != nil {
			return nil, err
		}
		b.AccountNumberMasked = maskAccountNumber(num)
		out = append(out, b)
	}
	return out, rows.Err()
}

// SetDefaultBankAccount marks one account as the payout default (owner-scoped),
// clearing any other default first.
func (s *Service) SetDefaultBankAccount(ctx context.Context, ownerID, accountID string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx,
		`UPDATE restaurant_bank_accounts SET is_default=false, updated_at=now() WHERE user_id=$1 AND is_default`, ownerID); err != nil {
		return err
	}
	ct, err := tx.Exec(ctx,
		`UPDATE restaurant_bank_accounts SET is_default=true, updated_at=now() WHERE id=$1 AND user_id=$2`, accountID, ownerID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("restaurant: bank account not found")
	}
	return tx.Commit(ctx)
}

// DeleteBankAccount removes a saved account (owner-scoped).
func (s *Service) DeleteBankAccount(ctx context.Context, ownerID, accountID string) error {
	ct, err := s.db.Exec(ctx, `DELETE FROM restaurant_bank_accounts WHERE id=$1 AND user_id=$2`, accountID, ownerID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("restaurant: bank account not found")
	}
	return nil
}
