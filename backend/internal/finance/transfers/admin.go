package transfers

import (
	"context"
	"fmt"
	"time"
)

// AdminTransferFilter narrows the admin transfer list.
type AdminTransferFilter struct {
	Status     string
	Provider   string
	SourceType string
	Limit      int
	Offset     int
}

// AdminTransferDetail is a transfer plus its associated ledger entry IDs.
type AdminTransferDetail struct {
	Transfer       *BankTransfer `json:"transfer"`
	LedgerEntryIDs []string      `json:"ledger_entry_ids"`
}

// ProviderHealth reports a provider's configured + reachability status.
type ProviderHealth struct {
	Provider  string `json:"provider"`
	Default   bool   `json:"default"`
	Healthy   bool   `json:"healthy"`
	BankCount int    `json:"bank_count"`
	Detail    string `json:"detail,omitempty"`
}

// AdminListTransfers lists bank transfers with optional status/provider/type filters.
func (s *Service) AdminListTransfers(ctx context.Context, f AdminTransferFilter) ([]BankTransfer, error) {
	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := `
		SELECT id, user_id, amount_kobo, fee_kobo, account_number_last4, account_name, bank_code,
		       reference, status, idempotency_key, provider, source_type,
		       provider_recipient_code, provider_transfer_ref, failover_from,
		       funding_reference, funding_status, created_at
		FROM bank_transfers WHERE 1=1`
	args := []any{}
	i := 1
	if f.Status != "" {
		q += fmt.Sprintf(" AND status=$%d", i)
		args = append(args, f.Status)
		i++
	}
	if f.Provider != "" {
		q += fmt.Sprintf(" AND provider=$%d", i)
		args = append(args, f.Provider)
		i++
	}
	if f.SourceType != "" {
		q += fmt.Sprintf(" AND source_type=$%d", i)
		args = append(args, f.SourceType)
		i++
	}
	q += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", i, i+1)
	args = append(args, limit, f.Offset)

	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BankTransfer
	for rows.Next() {
		bt, err := s.scanBankTransfer(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *bt)
	}
	return out, rows.Err()
}

// AdminGetTransfer returns a transfer with the IDs of its ledger entries.
func (s *Service) AdminGetTransfer(ctx context.Context, id string) (*AdminTransferDetail, error) {
	bt, err := s.getBankTransfer(ctx, id)
	if err != nil {
		return nil, ErrRecipientNotFound
	}
	var ids []string
	rows, err := s.db.Query(ctx, `SELECT id FROM ledger_entries WHERE reference=$1 ORDER BY created_at`, bt.Reference)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var lid string
			if rows.Scan(&lid) == nil {
				ids = append(ids, lid)
			}
		}
	}
	return &AdminTransferDetail{Transfer: bt, LedgerEntryIDs: ids}, nil
}

// AdminRetry re-attempts a stuck transfer's payout leg (allowing provider
// failover). Only valid from a held state (funds_reserved / funded /
// provider_initiated) — never from a terminal state, so no double-spend.
func (s *Service) AdminRetry(ctx context.Context, id, actorID string) (*BankTransfer, error) {
	bt, err := s.getBankTransfer(ctx, id)
	if err != nil {
		return nil, ErrRecipientNotFound
	}
	switch bt.Status {
	case BankTransferFundsReserved, BankTransferFunded, BankTransferProviderInitiated:
		// allowed
	default:
		return nil, fmt.Errorf("transfers admin: cannot retry from status %q", bt.Status)
	}
	s.audit(ctx, actorID, "transfer.admin.retry", bt.ID, string(bt.Status))
	// Re-run the disburse leg; failover allowed (preferred="" → registry default chain).
	s.initiatePayoutLeg(ctx, bt, false, "", "")
	return s.getBankTransfer(ctx, id)
}

// AdminReverse manually reverses a held transfer back to its source. Only valid
// before settlement (never from successful/failed/reversed). Posts the same
// REVERSAL_DEBIT/CREDIT pair as a failed webhook (idempotent).
func (s *Service) AdminReverse(ctx context.Context, id, actorID string) (*BankTransfer, error) {
	bt, err := s.getBankTransfer(ctx, id)
	if err != nil {
		return nil, ErrRecipientNotFound
	}
	if bt.Status == BankTransferSuccessful || bt.Status == BankTransferFailed || bt.Status == BankTransferReversed {
		return nil, fmt.Errorf("transfers admin: cannot reverse from terminal status %q", bt.Status)
	}
	s.audit(ctx, actorID, "transfer.admin.reverse", bt.ID, string(bt.Status))
	if err := s.settleTransfer(ctx, bt, BankTransferReversed); err != nil {
		return nil, err
	}
	return s.getBankTransfer(ctx, id)
}

// AdminProviderHealth probes each configured provider's ListBanks reachability.
func (s *Service) AdminProviderHealth(ctx context.Context) ([]ProviderHealth, error) {
	if s.registry == nil {
		return nil, ErrProviderUnavailable
	}
	out := []ProviderHealth{}
	def := s.registry.Default()
	for _, name := range s.registry.Names() {
		h := ProviderHealth{Provider: name, Default: name == def}
		if p, ok := s.registry.ByName(name); ok {
			pctx, cancel := context.WithTimeout(ctx, 5*time.Second)
			banks, err := p.ListBanks(pctx)
			cancel()
			if err != nil {
				h.Healthy = false
				h.Detail = err.Error()
			} else {
				h.Healthy = true
				h.BankCount = len(banks)
			}
		}
		out = append(out, h)
	}
	return out, nil
}
