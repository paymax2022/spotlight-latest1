package transfers

import (
	"context"
	"log"

	"spotlight/backend/internal/provider"
)

// audit writes an immutable audit trail entry for a money-path action. The ledger
// entries are the authoritative financial record (every leg carries reference +
// idempotency key); this adds an action-level breadcrumb. Best-effort + non-fatal
// (a logging failure must never abort the money path).
func (s *Service) audit(ctx context.Context, userID, action, entityID, detail string) {
	log.Printf("[audit][transfers] action=%s user=%s entity=%s detail=%s", action, userID, entityID, detail)
}

// defaultStr returns v when non-empty, else fallback.
func defaultStr(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}

// bankName resolves a display bank name from payment_banks (falls back to code).
func (s *Service) bankName(ctx context.Context, bankCode string) string {
	var name string
	err := s.db.QueryRow(ctx, `SELECT name FROM payment_banks WHERE code=$1 LIMIT 1`, bankCode).Scan(&name)
	if err != nil || name == "" {
		return bankCode
	}
	return name
}

// cachedRecipients returns a map provider→provider_recipient_code for a saved
// recipient matching the (user, bank, account), so a repeat payout skips
// CreateTransferRecipient.
func (s *Service) cachedRecipients(ctx context.Context, userID, bankCode, accountNumber string) map[string]string {
	out := map[string]string{}
	rows, err := s.db.Query(ctx,
		`SELECT provider, COALESCE(provider_recipient_code, paystack_recipient_code)
		 FROM bank_transfer_recipients
		 WHERE user_id=$1 AND bank_code=$2 AND account_number=$3`,
		userID, bankCode, accountNumber)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var prov, code string
		if rows.Scan(&prov, &code) == nil && code != "" {
			out[prov] = code
		}
	}
	return out
}

// cacheRecipient upserts a recipient code for reuse (does NOT mark a beneficiary
// favorite; that is a separate explicit save). Keyed by the migration's
// (user_id, provider, bank_code, account_number) unique index.
// cacheRecipient stores the provider recipient code in provider_recipient_code.
// The legacy paystack_recipient_code column (now nullable, but still UNIQUE) is
// left NULL to avoid a cross-provider unique collision — provider_recipient_code
// is the generalized field this module reads.
func (s *Service) cacheRecipient(ctx context.Context, userID, prov, bankCode, accountNumber, accountName, recipientCode string) {
	const q = `
		INSERT INTO bank_transfer_recipients
			(user_id, provider, bank_code, bank_name, account_number, account_name, provider_recipient_code)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (user_id, provider, bank_code, account_number)
		DO UPDATE SET provider_recipient_code=$7, account_name=$6`
	_, _ = s.db.Exec(ctx, q, userID, prov, bankCode, s.bankName(ctx, bankCode), accountNumber, accountName, recipientCode)
}

// saveBeneficiaryRow marks a destination as a saved beneficiary (favorite).
func (s *Service) saveBeneficiaryRow(ctx context.Context, userID, prov, bankCode, accountNumber, accountName, recipientCode string) {
	const q = `
		INSERT INTO bank_transfer_recipients
			(user_id, provider, bank_code, bank_name, account_number, account_name, provider_recipient_code, is_favorite)
		VALUES ($1,$2,$3,$4,$5,$6,$7,true)
		ON CONFLICT (user_id, provider, bank_code, account_number)
		DO UPDATE SET provider_recipient_code=$7, account_name=$6, is_favorite=true`
	_, _ = s.db.Exec(ctx, q, userID, prov, bankCode, s.bankName(ctx, bankCode), accountNumber, accountName, recipientCode)
}

// ---------------------------------------------------------------------------
// Banks / account resolution
// ---------------------------------------------------------------------------

// ListBanks returns the provider bank list (registry, with payment_banks fallback).
func (s *Service) ListBanks(ctx context.Context, preferred string) ([]provider.Bank, error) {
	if s.registry != nil {
		if banks, _, err := s.registry.ListBanksFailover(ctx, preferred); err == nil && len(banks) > 0 {
			return banks, nil
		}
	}
	// Fallback: payment_banks reference table.
	rows, err := s.db.Query(ctx, `SELECT code, name, COALESCE(slug,'') FROM payment_banks WHERE active=true ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var banks []provider.Bank
	for rows.Next() {
		var b provider.Bank
		if rows.Scan(&b.Code, &b.Name, &b.Slug) == nil {
			banks = append(banks, b)
		}
	}
	return banks, rows.Err()
}

// ResolveAccount performs a NUBAN name enquiry via the registry.
func (s *Service) ResolveAccount(ctx context.Context, req ResolveAccountRequest) (*provider.AccountResolution, error) {
	if !looksLikeNUBAN(req.AccountNumber) || req.BankCode == "" {
		return nil, ErrInvalidAccount
	}
	if s.registry == nil {
		return nil, ErrProviderUnavailable
	}
	res, _, err := s.registry.ResolveAccountFailover(ctx, req.Provider, req.BankCode, req.AccountNumber)
	if err != nil || res == nil {
		return nil, ErrInvalidAccount
	}
	return res, nil
}

// ---------------------------------------------------------------------------
// Beneficiaries
// ---------------------------------------------------------------------------

// ListBeneficiaries returns the user's saved payout destinations.
func (s *Service) ListBeneficiaries(ctx context.Context, userID string) ([]Beneficiary, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, user_id, provider, bank_code, account_number, account_name, provider_recipient_code, created_at
		 FROM bank_transfer_recipients WHERE user_id=$1 AND is_favorite=true ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Beneficiary
	for rows.Next() {
		var b Beneficiary
		if err := rows.Scan(&b.ID, &b.UserID, &b.Provider, &b.BankCode, &b.AccountNumber, &b.AccountName, &b.ProviderRecipientCode, &b.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// SaveBeneficiary resolves the account name and saves a beneficiary (registry
// recipient created lazily on the first payout). Returns the saved row.
func (s *Service) SaveBeneficiary(ctx context.Context, userID string, req SaveBeneficiaryRequest) (*Beneficiary, error) {
	if !looksLikeNUBAN(req.AccountNumber) || req.BankCode == "" {
		return nil, ErrInvalidAccount
	}
	if s.registry == nil {
		return nil, ErrProviderUnavailable
	}
	prov := defaultStr(req.Provider, s.registry.Default())
	res, _, err := s.registry.ResolveAccountFailover(ctx, req.Provider, req.BankCode, req.AccountNumber)
	if err != nil || res == nil {
		return nil, ErrInvalidAccount
	}
	const q = `
		INSERT INTO bank_transfer_recipients
			(user_id, provider, bank_code, bank_name, account_number, account_name, is_favorite)
		VALUES ($1,$2,$3,$4,$5,$6,true)
		ON CONFLICT (user_id, provider, bank_code, account_number)
		DO UPDATE SET account_name=$6, is_favorite=true
		RETURNING id, created_at`
	b := &Beneficiary{
		UserID: userID, Provider: prov, BankCode: req.BankCode,
		AccountNumber: req.AccountNumber, AccountName: res.AccountName,
	}
	if err := s.db.QueryRow(ctx, q, userID, prov, req.BankCode, s.bankName(ctx, req.BankCode), req.AccountNumber, res.AccountName).
		Scan(&b.ID, &b.CreatedAt); err != nil {
		return nil, err
	}
	s.audit(ctx, userID, "transfer.beneficiary.save", b.ID, req.AccountNumber)
	return b, nil
}

// DeleteBeneficiary removes a saved beneficiary owned by the user.
func (s *Service) DeleteBeneficiary(ctx context.Context, userID, id string) error {
	const q = `DELETE FROM bank_transfer_recipients WHERE id=$1 AND user_id=$2`
	ct, err := s.db.Exec(ctx, q, id, userID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrRecipientNotFound
	}
	s.audit(ctx, userID, "transfer.beneficiary.delete", id, "")
	return nil
}

// ---------------------------------------------------------------------------
// Transaction PIN
// ---------------------------------------------------------------------------

// SetPin sets or replaces the user's transaction PIN. When one already exists the
// caller must supply the correct current PIN.
func (s *Service) SetPin(ctx context.Context, userID, newPIN, currentPIN string) error {
	if !validPinFormat(newPIN) {
		return ErrPinInvalid
	}
	has, err := s.pins.Has(ctx, userID)
	if err != nil {
		return err
	}
	if has {
		// Refuse BEFORE Verify. Verify scores a wrong PIN against the lockout
		// counter, so passing an empty current PIN through would let a caller
		// that simply omitted the field burn the user's 5 attempts and lock
		// them out of transfers. A missing field is a bad request, not a guess.
		if currentPIN == "" {
			return ErrPinCurrentRequired
		}
		if err := s.pins.Verify(ctx, userID, currentPIN); err != nil {
			return err
		}
	}
	if err := s.pins.Set(ctx, userID, newPIN); err != nil {
		return err
	}
	s.audit(ctx, userID, "transfer.pin.set", userID, "")
	return nil
}

// VerifyPin verifies a PIN (used by the UI to gate a confirm step).
func (s *Service) VerifyPin(ctx context.Context, userID, pin string) error {
	return s.pins.Verify(ctx, userID, pin)
}

// HasPin reports whether the user has set a transaction PIN.
func (s *Service) HasPin(ctx context.Context, userID string) (bool, error) {
	return s.pins.Has(ctx, userID)
}

// ---------------------------------------------------------------------------
// Webhook routing helpers
// ---------------------------------------------------------------------------

// ProviderByName exposes a registered disbursement provider (for webhook verify).
func (s *Service) ProviderByName(name string) (provider.DisbursementProvider, bool) {
	if s.registry == nil {
		return nil, false
	}
	return s.registry.ByName(name)
}
