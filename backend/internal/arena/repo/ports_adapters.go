package repo

import (
	"context"

	"spotlight/backend/internal/arena/service"
	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/finance/ledger"
)

// This file holds the THIN adapters that let the Arena rails reuse the finance
// primitives WITHOUT importing any signer. The Support / Play-Along / Pot rails
// receive only these ports and therefore cannot construct a merit entry (NDC-1).

// LedgerAdapter implements service.LedgerPort over the finance ledger.Service.
// It is the ONLY money capability the money rails hold.
type LedgerAdapter struct{ svc *ledger.Service }

// NewLedgerAdapter wraps a finance ledger.Service as an Arena LedgerPort.
func NewLedgerAdapter(svc *ledger.Service) *LedgerAdapter { return &LedgerAdapter{svc: svc} }

var _ service.LedgerPort = (*LedgerAdapter)(nil)

// Credit posts money into userID's wallet from a standing account.
func (l *LedgerAdapter) Credit(ctx context.Context, userID, reference, idempotencyKey, debitAccountID string, amountKobo int64) error {
	return l.svc.Credit(ctx, userID, reference, idempotencyKey, debitAccountID, amountKobo)
}

// Debit posts money out of userID's wallet into a standing account.
func (l *LedgerAdapter) Debit(ctx context.Context, userID, reference, idempotencyKey, creditAccountID string, amountKobo int64) error {
	return l.svc.Debit(ctx, userID, reference, idempotencyKey, creditAccountID, amountKobo)
}

// StandingAccountID resolves (or creates) a standing account id by type name.
func (l *LedgerAdapter) StandingAccountID(ctx context.Context, accountType string) (string, error) {
	acc, err := l.svc.GetOrCreateStandingAccount(ctx, ledger.AccountType(accountType))
	if err != nil {
		return "", err
	}
	return acc.ID, nil
}

// TierAdapter implements service.TierPort by reading the user's KYC tier from the
// finance kyc.Service (NDC-3 identity gate).
type TierAdapter struct{ svc *kyc.Service }

// NewTierAdapter wraps a finance kyc.Service as an Arena TierPort.
func NewTierAdapter(svc *kyc.Service) *TierAdapter { return &TierAdapter{svc: svc} }

var _ service.TierPort = (*TierAdapter)(nil)

// UserTier reads a user's current KYC tier. An absent profile is treated as
// tier 0 (fail-closed against the required-tier gate).
func (t *TierAdapter) UserTier(ctx context.Context, userID string) (int, error) {
	p, err := t.svc.GetProfile(ctx, userID)
	if err != nil {
		return 0, err
	}
	if p == nil {
		return 0, nil
	}
	return int(p.Tier), nil
}
