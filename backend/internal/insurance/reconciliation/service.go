package reconciliation

import (
	"context"
	"errors"
	"fmt"

	"spotlight/backend/internal/finance/ledger"
)

// Service is the premium↔provider-statement matcher + commission confirm/reverse
// workbench. It REUSES the finance ledger: a commission reversal posts a balanced
// reversing entry on the SEPARATE commission account IB0 used
// (ledger.AccountCommission), never an UPDATE to a balance.
type Service struct {
	repo   *Repository
	ledger *ledger.Service
}

// NewService constructs the reconciliation service.
func NewService(repo *Repository, ledgerSvc *ledger.Service) *Service {
	return &Service{repo: repo, ledger: ledgerSvc}
}

// Sentinel errors.
var (
	ErrAlreadyReversed = errors.New("reconciliation: commission already reversed")
)

// MatchStatement reconciles a batch of provider statement lines against the net
// posted premium per policy. Each line yields a ReconciliationRecord: MATCHED
// when amounts agree, BREAK otherwise. Returns the records (breaks are worked in
// the admin workbench).
func (s *Service) MatchStatement(ctx context.Context, provider string, lines []StatementLine) ([]ReconciliationRecord, error) {
	out := make([]ReconciliationRecord, 0, len(lines))
	for _, line := range lines {
		expected, err := s.repo.PremiumForPolicy(ctx, line.PolicyID)
		if err != nil {
			return out, fmt.Errorf("reconciliation: premium lookup for policy %s: %w", line.PolicyID, err)
		}
		status := StatusMatched
		breakReason := ""
		if expected != line.AmountKobo {
			status = StatusBreak
			breakReason = fmt.Sprintf("amount mismatch: expected %d, statement %d", expected, line.AmountKobo)
		}
		pid := line.PolicyID
		rec, err := s.repo.InsertRecord(ctx, &ReconciliationRecord{
			Provider:            provider,
			PolicyID:            &pid,
			StatementRef:        line.StatementRef,
			ExpectedAmountKobo:  expected,
			StatementAmountKobo: line.AmountKobo,
			Status:              status,
			BreakReason:         breakReason,
		})
		if err != nil {
			return out, err
		}
		out = append(out, *rec)
	}
	return out, nil
}

// ListBreaks returns reconciliation records (workbench), filtered by status +
// provider.
func (s *Service) ListRecords(ctx context.Context, status, provider string, limit, offset int) ([]ReconciliationRecord, error) {
	return s.repo.ListRecords(ctx, status, provider, limit, offset)
}

// ResolveBreak records an operator resolution for a BREAK record.
func (s *Service) ResolveBreak(ctx context.Context, id, note string) error {
	return s.repo.ResolveBreak(ctx, id, note)
}

// --- commission confirm / reverse ---

// ConfirmCommission marks a policy's commission entry CONFIRMED (reconciled
// against the provider statement). The ledger entry posted at bind is unchanged;
// only the domain status moves PENDING → CONFIRMED.
func (s *Service) ConfirmCommission(ctx context.Context, policyID string) (*CommissionEntry, error) {
	ce, err := s.repo.GetCommissionByPolicy(ctx, policyID)
	if err != nil {
		return nil, err
	}
	if ce.Status == CommissionConfirmed {
		return ce, nil
	}
	if ce.Status == CommissionReversed {
		return nil, ErrAlreadyReversed
	}
	if err := s.repo.SetCommissionStatus(ctx, ce.ID, CommissionConfirmed); err != nil {
		return nil, err
	}
	ce.Status = CommissionConfirmed
	return ce, nil
}

// ReverseCommission posts a BALANCED reversing entry that drains the commission
// account back into the provider-clearing pass-through (DR commission → CR
// provider_clearing) and marks the entry REVERSED. Used on cancellation/clawback.
// Idempotent: a second reverse is a no-op (already REVERSED), and the ledger post
// is keyed on the entry's idempotency_key + ":reverse".
func (s *Service) ReverseCommission(ctx context.Context, policyID, reason string) (*CommissionEntry, error) {
	ce, err := s.repo.GetCommissionByPolicy(ctx, policyID)
	if err != nil {
		return nil, err
	}
	if ce.Status == CommissionReversed {
		return ce, nil
	}
	if ce.AmountKobo > 0 && s.ledger != nil {
		commAcc, cErr := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountCommission)
		if cErr != nil {
			return nil, cErr
		}
		clearing, clErr := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
		if clErr != nil {
			return nil, clErr
		}
		// DR commission → CR provider_clearing: drains commission revenue back to the
		// pass-through (the inverse of the bind posting).
		postErr := s.ledger.PostJournal(ctx, ledger.JournalEntry{
			Reference:       "insurance:commission_reversal:" + ce.PolicyID,
			IdempotencyKey:  ce.IdempotencyKey + ":reverse",
			AmountKobo:      ce.AmountKobo,
			DebitAccountID:  commAcc.ID,
			CreditAccountID: clearing.ID,
		})
		if postErr != nil && !errors.Is(postErr, ledger.ErrDuplicate) {
			return nil, fmt.Errorf("reconciliation: commission reversal post: %w", postErr)
		}
	}
	if err := s.repo.SetCommissionStatus(ctx, ce.ID, CommissionReversed); err != nil {
		return nil, err
	}
	ce.Status = CommissionReversed
	return ce, nil
}

// ListCommission returns the commission ledger view (entries), filtered by status
// + provider.
func (s *Service) ListCommission(ctx context.Context, status, provider string, limit, offset int) ([]CommissionEntry, error) {
	return s.repo.ListCommission(ctx, status, provider, limit, offset)
}

// CommissionSummary returns the total commission (kobo) for a status + provider
// filter (the commission ledger view summary).
func (s *Service) CommissionSummary(ctx context.Context, status, provider string) (int64, error) {
	return s.repo.CommissionTotal(ctx, status, provider)
}
