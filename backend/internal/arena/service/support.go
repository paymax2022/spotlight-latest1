package service

import (
	"context"
	"fmt"
	"strings"

	"spotlight/backend/internal/arena"
)

// SupportService is the SUPPORT rail (ADR-014 §11, NDC-1): real-Naira gifting
// that feeds the prize pot and the People's Champion / State Pride display
// tallies. It NEVER references merit and holds NO signer — it can only move money
// (via LedgerPort) and tag the gift (via SupportRepo). Its awards are Support-fed
// and can never influence the crown (arena.AwardFedByMeritOnly is false for them).
type SupportService struct {
	repo    SupportRepo
	ledger  LedgerPort
	tiers   TierPort
	cfg     ConfigReader
	audit   AuditRepo
}

// ConfigReader is the minimal config lookup the rails need (KYC gate, play-along
// knobs). CompetitionService satisfies it.
type ConfigReader interface {
	CurrentConfig(ctx context.Context, competitionID string) (*Config, error)
}

// SupportContributor is the standing account debited to fund the pot. Support
// moves money from the backer's wallet into this competition-pot standing account.
const supportPotAccountType = "arena_support_pot"

// NewSupportService builds the Support rail. It receives NO signer/gateway.
func NewSupportService(repo SupportRepo, ledger LedgerPort, tiers TierPort, cfg ConfigReader, audit AuditRepo) *SupportService {
	return &SupportService{repo: repo, ledger: ledger, tiers: tiers, cfg: cfg, audit: audit}
}

// Contribute gifts amountKobo to a contestant: (1) KYC-gate via TierPort against
// the config-required tier, (2) move money via LedgerPort into the pot standing
// account, (3) tag the support row (idempotent), (4) audit. Idempotent by idemKey.
func (s *SupportService) Contribute(ctx context.Context, userID, idemKey, competitionID, contestantID string, amountKobo int64) error {
	if strings.TrimSpace(idemKey) == "" {
		return ErrMissingIdem
	}
	if amountKobo <= 0 {
		return ErrInvalidInput
	}

	// KYC gate (NDC-3): fail-closed if tier lookup fails or is below required.
	cfg, err := s.cfg.CurrentConfig(ctx, competitionID)
	if err != nil {
		return err
	}
	tier, err := s.tiers.UserTier(ctx, userID)
	if err != nil {
		return ErrKYCTierTooLow
	}
	if tier < cfg.RequiredKYCTier {
		return ErrKYCTierTooLow
	}

	// Resolve the pot standing account and DEBIT the backer's wallet into it.
	potAcct, err := s.ledger.StandingAccountID(ctx, supportPotAccountType)
	if err != nil {
		return err
	}
	ref := fmt.Sprintf("arena:support:%s:%s", competitionID, contestantID)
	if err := s.ledger.Debit(ctx, userID, ref, idemKey, potAcct, amountKobo); err != nil {
		return err
	}

	// Tag AFTER the money moved. home_state is resolved by the caller/handler and
	// passed through the row; here we tag with the ledger reference as the audit
	// trail back to the source-of-truth money movement.
	homeState := "" // populated by ContributeWithState; plain Contribute leaves it blank.
	if err := s.repo.TagAfterLedger(ctx, competitionID, contestantID, homeState, userID, ref, idemKey, amountKobo); err != nil {
		return err
	}
	return s.audit.Log(ctx, AuditRecord{
		CompetitionID: competitionID, ActorID: userID, EntityType: "support_txn", EntityID: contestantID,
		Action: "SUPPORT_CONTRIBUTE", Reason: string(arena.RailSupport),
		After: map[string]any{"amount_kobo": amountKobo, "ledger_ref": ref},
	})
}

// ContributeWithState is Contribute plus a home_state tag for the State Pride
// aggregate. The state code is the contestant's home_state, resolved upstream.
func (s *SupportService) ContributeWithState(ctx context.Context, userID, idemKey, competitionID, contestantID, homeState string, amountKobo int64) error {
	if strings.TrimSpace(idemKey) == "" {
		return ErrMissingIdem
	}
	if amountKobo <= 0 {
		return ErrInvalidInput
	}
	cfg, err := s.cfg.CurrentConfig(ctx, competitionID)
	if err != nil {
		return err
	}
	tier, err := s.tiers.UserTier(ctx, userID)
	if err != nil {
		return ErrKYCTierTooLow
	}
	if tier < cfg.RequiredKYCTier {
		return ErrKYCTierTooLow
	}
	potAcct, err := s.ledger.StandingAccountID(ctx, supportPotAccountType)
	if err != nil {
		return err
	}
	ref := fmt.Sprintf("arena:support:%s:%s", competitionID, contestantID)
	if err := s.ledger.Debit(ctx, userID, ref, idemKey, potAcct, amountKobo); err != nil {
		return err
	}
	if err := s.repo.TagAfterLedger(ctx, competitionID, contestantID, homeState, userID, ref, idemKey, amountKobo); err != nil {
		return err
	}
	return s.audit.Log(ctx, AuditRecord{
		CompetitionID: competitionID, ActorID: userID, EntityType: "support_txn", EntityID: contestantID,
		Action: "SUPPORT_CONTRIBUTE", Reason: string(arena.RailSupport),
		After: map[string]any{"amount_kobo": amountKobo, "ledger_ref": ref, "home_state": homeState},
	})
}

// PotTotal derives the standing pot total (integer kobo) from the tagged support
// rows — a projection, never a stored mutable balance.
func (s *SupportService) PotTotal(ctx context.Context, competitionID string) (int64, error) {
	rows, err := s.repo.Rows(ctx, competitionID)
	if err != nil {
		return 0, err
	}
	return PotTotalKobo(rows), nil
}

// Tallies returns the display-only People's Champion + State Pride aggregates
// derived from support rows (NEVER merit).
func (s *SupportService) Tallies(ctx context.Context, competitionID string) (peoplesChampion string, championTally map[string]int64, statePride string, stateTally map[string]int64, err error) {
	rows, err := s.repo.Rows(ctx, competitionID)
	if err != nil {
		return "", nil, "", nil, err
	}
	pc, ct := PeoplesChampion(rows)
	sp, st := StatePride(rows)
	return pc, ct, sp, st, nil
}
