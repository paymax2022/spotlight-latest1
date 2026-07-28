package service

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"

	"spotlight/backend/internal/arena"
)

// base64Sig encodes a raw signature for storage.
func base64Sig(sig []byte) string { return base64.StdEncoding.EncodeToString(sig) }

// PotDisbursementService disburses the prize pot (ADR-014 §12, NDC-4). The pot
// TOTAL is DERIVED from the tagged support rows (never a stored balance). Payout
// is guarded by a config-required number of DISTINCT approvals, idempotent by
// idemKey, and audited. It holds NO signer and only moves money via LedgerPort.
type PotDisbursementService struct {
	pot     PotRepo
	support SupportRepo
	ledger  LedgerPort
	cfg     ConfigReader
	audit   AuditRepo
}

// potPayoutAccountType is the standing account the pot is paid OUT from (the same
// pot account the Support rail funds).
const potPayoutAccountType = supportPotAccountType

// NewPotDisbursementService builds the pot disbursement service.
func NewPotDisbursementService(pot PotRepo, support SupportRepo, ledger LedgerPort, cfg ConfigReader, audit AuditRepo) *PotDisbursementService {
	return &PotDisbursementService{pot: pot, support: support, ledger: ledger, cfg: cfg, audit: audit}
}

// PotTotal derives the pot total (integer kobo) from the support rows.
func (s *PotDisbursementService) PotTotal(ctx context.Context, competitionID string) (int64, error) {
	rows, err := s.support.Rows(ctx, competitionID)
	if err != nil {
		return 0, err
	}
	return PotTotalKobo(rows), nil
}

// Approve records one distinct approver toward the config-required threshold.
func (s *PotDisbursementService) Approve(ctx context.Context, actorID, competitionID string) (approvals int, err error) {
	approvals, err = s.pot.Approve(ctx, competitionID, actorID)
	if err != nil {
		return 0, err
	}
	_ = s.audit.Log(ctx, AuditRecord{
		CompetitionID: competitionID, ActorID: actorID, EntityType: "pot", EntityID: competitionID,
		Action: "POT_APPROVE", After: map[string]any{"approvals": approvals},
	})
	return approvals, nil
}

// OnCrown is invoked in the CROWNED tx to record the crowning as the first pot
// approval and mark readiness. It does NOT itself disburse (disbursement stays a
// separate guarded, multi-approved action) — it only records the trigger.
func (s *PotDisbursementService) OnCrown(ctx context.Context, actorID, competitionID, winnerUserID string) error {
	if _, err := s.pot.Approve(ctx, competitionID, actorID); err != nil {
		return err
	}
	return s.audit.Log(ctx, AuditRecord{
		CompetitionID: competitionID, ActorID: actorID, EntityType: "pot", EntityID: competitionID,
		Action: "POT_CROWN_TRIGGER", After: map[string]any{"winner_user_id": winnerUserID},
	})
}

// Disburse pays the derived pot total to winnerUserID once (idempotent by idemKey)
// after the config-required distinct approvals are recorded (NDC-4). Fails closed
// if approvals are short, the pot is empty, or it is already DISBURSED.
func (s *PotDisbursementService) Disburse(ctx context.Context, actorID, idemKey, competitionID, winnerUserID string) error {
	if strings.TrimSpace(idemKey) == "" {
		return ErrMissingIdem
	}
	cfg, err := s.cfg.CurrentConfig(ctx, competitionID)
	if err != nil {
		return err
	}
	required := cfg.PotApprovalsRequired
	if required <= 0 {
		required = 1
	}

	status, approvals, err := s.pot.State(ctx, competitionID)
	if err != nil {
		return err
	}
	if status == "DISBURSED" {
		return ErrPotState
	}
	if approvals < required {
		return ErrForbidden
	}

	total, err := s.PotTotal(ctx, competitionID)
	if err != nil {
		return err
	}
	if total <= 0 {
		return ErrPotState
	}

	potAcct, err := s.ledger.StandingAccountID(ctx, potPayoutAccountType)
	if err != nil {
		return err
	}
	ref := fmt.Sprintf("arena:pot-disburse:%s", competitionID)

	// MarkDisbursed flips state + runs the payout atomically, idempotent by idemKey.
	if err := s.pot.MarkDisbursed(ctx, competitionID, idemKey, func(ctx context.Context) error {
		// CREDIT the winner's wallet from the pot standing account.
		return s.ledger.Credit(ctx, winnerUserID, ref, idemKey, potAcct, total)
	}); err != nil {
		return err
	}

	return s.audit.Log(ctx, AuditRecord{
		CompetitionID: competitionID, ActorID: actorID, EntityType: "pot", EntityID: competitionID,
		Action: "POT_DISBURSE", Reason: string(arena.RailSupport),
		After: map[string]any{"winner_user_id": winnerUserID, "amount_kobo": total, "approvals": approvals},
	})
}
