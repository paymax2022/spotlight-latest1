package finance

import (
	"context"
	"fmt"
	"time"

	financeledger "spotlight/backend/internal/finance/ledger"
	referralevents "spotlight/backend/internal/referral/events"
)

// minPayoutTier is the KYC tier required to receive a referral payout (Tier/KYC
// gated). Tier 1 (basic verified) is the floor; admins can raise this in policy.
const minPayoutTier = 1

// Service is the referral finance service: payout queue + approvals,
// reconciliation, budget/burn monitoring, float, and reward-to-LTV.
type Service struct {
	repo    *Repository
	finance *financeledger.Service   // posts the real wallet credit (double-entry, idempotent)
	events  *referralevents.Service  // audit
}

func NewService(repo *Repository, finance *financeledger.Service, events *referralevents.Service) *Service {
	return &Service{repo: repo, finance: finance, events: events}
}

// --- payout queue ---

// QueuePayout enqueues a payout request. Tier/KYC is checked at queue time and
// re-checked at approval (fail-closed). Idempotent on idempotency_key.
func (s *Service) QueuePayout(ctx context.Context, in PayoutRequest, requestedBy string) (*Payout, error) {
	if in.BeneficiaryID == "" {
		return nil, fmt.Errorf("finance: payout requires beneficiary_id")
	}
	if in.AmountKobo <= 0 {
		return nil, fmt.Errorf("finance: payout amount must be positive (kobo)")
	}
	if in.IdempotencyKey == "" {
		return nil, fmt.Errorf("finance: payout requires an idempotency key")
	}
	tier, err := s.repo.KYCTier(ctx, in.BeneficiaryID)
	if err != nil {
		return nil, err
	}
	if tier < minPayoutTier {
		return nil, fmt.Errorf("finance: beneficiary KYC tier %d below required %d", tier, minPayoutTier)
	}
	p, created, err := s.repo.QueuePayout(ctx, in, requestedBy)
	if err != nil {
		return nil, err
	}
	if created {
		s.audit(ctx, "payout_queued", in.BeneficiaryID, in.RewardID,
			map[string]any{"amount_kobo": in.AmountKobo}, "payout_queued:"+in.IdempotencyKey)
	}
	return p, nil
}

func (s *Service) ListPayouts(ctx context.Context, status string) ([]Payout, error) {
	return s.repo.ListPayouts(ctx, status, 200)
}

// ApprovePayout approves and executes a queued payout: it re-checks Tier/KYC, then
// posts a balanced wallet credit through the finance ledger (DR referral-reward
// expense → CR beneficiary wallet) with a unique idempotency key, and marks the
// payout paid. Idempotent — a duplicate ledger key is a safe no-op.
func (s *Service) ApprovePayout(ctx context.Context, payoutID, approvedBy string) (*Payout, error) {
	p, err := s.repo.GetPayout(ctx, payoutID)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, fmt.Errorf("finance: payout not found")
	}
	if p.Status == PayoutPaid {
		return p, nil // idempotent
	}
	if p.Status != PayoutQueued && p.Status != PayoutApproved {
		return nil, fmt.Errorf("finance: payout in state %q cannot be approved", p.Status)
	}

	tier, err := s.repo.KYCTier(ctx, p.BeneficiaryID)
	if err != nil {
		return nil, err
	}
	if tier < minPayoutTier {
		return nil, fmt.Errorf("finance: beneficiary KYC tier %d below required %d", tier, minPayoutTier)
	}

	if s.finance == nil {
		return nil, fmt.Errorf("finance: ledger unavailable")
	}
	acc, err := s.finance.GetOrCreateStandingAccount(ctx, financeledger.AccountReferralReward)
	if err != nil {
		return nil, fmt.Errorf("finance: standing account: %w", err)
	}
	idemKey := "referral_payout:" + payoutID
	ref := "referral:payout:" + payoutID
	if err := s.finance.Credit(ctx, p.BeneficiaryID, ref, idemKey, acc.ID, p.AmountKobo); err != nil {
		if err != financeledger.ErrDuplicate {
			_ = s.repo.MarkPayoutFailed(ctx, payoutID, "ledger_post_failed")
			return nil, fmt.Errorf("finance: post payout credit: %w", err)
		}
	}
	if err := s.repo.MarkPayoutPaid(ctx, payoutID, approvedBy, idemKey); err != nil {
		return nil, err
	}
	// Track program burn (best-effort, against the global program budget).
	_ = s.repo.AddSpend(ctx, "program", "global", p.AmountKobo)

	s.audit(ctx, "payout_paid", p.BeneficiaryID, p.RewardID,
		map[string]any{"amount_kobo": p.AmountKobo, "approved_by": approvedBy}, "payout_paid:"+payoutID)
	return s.repo.GetPayout(ctx, payoutID)
}

// RejectPayout rejects a queued/approved payout.
func (s *Service) RejectPayout(ctx context.Context, payoutID, approvedBy, reason string) error {
	if err := s.repo.RejectPayout(ctx, payoutID, approvedBy, reason); err != nil {
		return err
	}
	s.audit(ctx, "payout_rejected", "", "",
		map[string]any{"payout_id": payoutID, "reason": reason}, "payout_rejected:"+payoutID)
	return nil
}

// --- reconciliation ---

// Reconcile compares the RB0 reward ledger 'paid' total against wallet payout
// postings for a period and records a snapshot (balanced or variance).
func (s *Service) Reconcile(ctx context.Context, since, until, createdBy string) (*Reconciliation, error) {
	if since == "" || until == "" {
		return nil, fmt.Errorf("finance: reconcile requires since and until")
	}
	ledgerPaid, err := s.repo.LedgerPaidInPeriod(ctx, since, until)
	if err != nil {
		return nil, err
	}
	walletPaid, err := s.repo.WalletPaidInPeriod(ctx, since, until)
	if err != nil {
		return nil, err
	}
	variance := ledgerPaid - walletPaid
	status := ReconBalanced
	if variance != 0 {
		status = ReconVariance
	}
	ps, _ := time.Parse(time.RFC3339, since)
	pe, _ := time.Parse(time.RFC3339, until)
	rc := Reconciliation{
		PeriodStart:    ps,
		PeriodEnd:      pe,
		LedgerPaidKobo: ledgerPaid,
		WalletPaidKobo: walletPaid,
		VarianceKobo:   variance,
		Status:         status,
	}
	return s.repo.InsertReconciliation(ctx, rc, createdBy)
}

func (s *Service) ListReconciliations(ctx context.Context) ([]Reconciliation, error) {
	return s.repo.ListReconciliations(ctx)
}

// --- budgets / burn ---

func (s *Service) UpsertBudget(ctx context.Context, in BudgetInput) (*Budget, error) {
	if in.BudgetKobo < 0 {
		return nil, fmt.Errorf("finance: budget must be non-negative")
	}
	if in.AlertThresholdPct != nil && (*in.AlertThresholdPct < 0 || *in.AlertThresholdPct > 100) {
		return nil, fmt.Errorf("finance: alert threshold must be 0..100")
	}
	return s.repo.UpsertBudget(ctx, in)
}

// ListBudgets returns budgets with burn % computed; flags any over threshold.
func (s *Service) ListBudgets(ctx context.Context) ([]Budget, error) {
	budgets, err := s.repo.ListBudgets(ctx)
	if err != nil {
		return nil, err
	}
	for _, b := range budgets {
		if b.AlertTriggered {
			s.audit(ctx, "budget_burn_alert", "", "",
				map[string]any{"scope": b.Scope, "scope_ref": b.ScopeRef, "burn_pct": b.BurnPct},
				fmt.Sprintf("budget_alert:%s:%s:%d", b.Scope, b.ScopeRef, b.BurnPct))
		}
	}
	return budgets, nil
}

// --- float ---

func (s *Service) SnapshotFloat(ctx context.Context, fundedKobo int64, note string) (*Float, error) {
	if fundedKobo < 0 {
		return nil, fmt.Errorf("finance: funded amount must be non-negative")
	}
	return s.repo.SnapshotFloat(ctx, fundedKobo, note)
}

func (s *Service) LatestFloat(ctx context.Context) (*Float, error) { return s.repo.LatestFloat(ctx) }

// --- reward-to-LTV ---

func (s *Service) RewardToLTV(ctx context.Context) (*RewardToLTV, error) { return s.repo.RewardToLTV(ctx) }

// --- helpers ---

func (s *Service) audit(ctx context.Context, eventType, userID, rewardID string, extra map[string]any, idemKey string) {
	if s.events == nil {
		return
	}
	payload := map[string]any{}
	for k, v := range extra {
		payload[k] = v
	}
	if rewardID != "" {
		payload["reward_id"] = rewardID
	}
	_ = s.events.Record(ctx, referralevents.Input{
		EventType:      eventType,
		UserID:         userID,
		Payload:        payload,
		IdempotencyKey: idemKey,
	})
}
