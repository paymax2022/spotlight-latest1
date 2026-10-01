package service

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"spotlight/backend/internal/arena"
	"spotlight/backend/internal/finance/ledger"
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
func (s *PotDisbursementService) Approve(ctx context.Context, actorID, competitionID string) (int, error) {
	var err error

	var approvals int

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
	ref := "arena:pot-disburse:" + competitionID

	// MarkDisbursed flips state + runs the payout atomically, idempotent by idemKey.
	if err := s.pot.MarkDisbursed(ctx, competitionID, idemKey, func(ctx context.Context) error {
		// CREDIT the winner's wallet from the pot standing account. A resumed
		// disburse (state flip failed/crashed after the credit posted on a
		// prior attempt) replays with the same idemKey — treat the ledger's
		// own replay signal as success rather than an error, same fix as
		// SupportService.Contribute (see isLedgerReplay).
		if err := s.ledger.Credit(ctx, winnerUserID, ref, idemKey, potAcct, total); err != nil && !isLedgerReplay(err) {
			return err
		}
		return nil
	}); err != nil {
		return err
	}

	return s.audit.Log(ctx, AuditRecord{
		CompetitionID: competitionID, ActorID: actorID, EntityType: "pot", EntityID: competitionID,
		Action: "POT_DISBURSE", Reason: string(arena.RailSupport),
		After: map[string]any{"winner_user_id": winnerUserID, "amount_kobo": total, "approvals": approvals},
	})
}

// PlayAlongService is the PLAY-ALONG rail (ADR-014 §13, NDC-1): a free quiz that
// writes ONLY to the engagement ledger and, on passing the config threshold,
// issues a CERTIFIED_SAFE_DRIVER credential + a small, rate-limited, ledgered
// cashback. It holds NO signer and never touches merit. The credential is
// engagement-derived (arena.AwardCertifiedDriver is fed by RailPlayAlong, not
// merit) and cannot influence the crown.
type PlayAlongService struct {
	repo   EngagementRepo
	creds  *CredentialService
	ledger LedgerPort
	cfg    ConfigReader
	audit  AuditRepo
}

// playAlongCashbackAccountType is the standing account funding play-along cashback.
const playAlongCashbackAccountType = "arena_playalong_cashback"

// NewPlayAlongService builds the Play-Along rail. It receives NO signer/gateway.
func NewPlayAlongService(repo EngagementRepo, creds *CredentialService, ledger LedgerPort, cfg ConfigReader, audit AuditRepo) *PlayAlongService {
	return &PlayAlongService{repo: repo, creds: creds, ledger: ledger, cfg: cfg, audit: audit}
}

// AttemptPayload is the quiz submission.
type AttemptPayload struct {
	Points int  `json:"points"` // points earned this attempt (adapter-scored upstream)
	Passed bool `json:"passed"` // whether this attempt cleared the round
}

// AttemptResult reports the running total and any credential/cashback granted.
type AttemptResult struct {
	TotalPoints  int    `json:"total_points"`
	Duplicate    bool   `json:"duplicate"`
	Certified    bool   `json:"certified"`
	Credential   string `json:"credential_hash,omitempty"`
	CashbackKobo int64  `json:"cashback_kobo,omitempty"`
}

// Attempt records an idempotent engagement event; on crossing the config
// threshold it issues CERTIFIED_SAFE_DRIVER via CredentialService and posts a
// small ledgered cashback (rate-limited per day). Idempotent by idemKey.
func (s *PlayAlongService) Attempt(ctx context.Context, userID, idemKey, competitionID string, payload AttemptPayload) (*AttemptResult, error) {
	if strings.TrimSpace(idemKey) == "" {
		return nil, ErrMissingIdem
	}
	cfg, err := s.cfg.CurrentConfig(ctx, competitionID)
	if err != nil {
		return nil, err
	}

	eventType := "QUIZ_ATTEMPT"
	if payload.Passed {
		eventType = "QUIZ_PASS"
	}
	total, dup, err := s.repo.Record(ctx, competitionID, userID, eventType, "", idemKey, payload.Points)
	if err != nil {
		return nil, err
	}
	res := &AttemptResult{TotalPoints: total, Duplicate: dup}
	if dup {
		return res, nil // replay: no double-grant
	}

	// Credential threshold (engagement → credential, NEVER merit).
	if PassesCertification(total, cfg.PlayAlongThreshold) {
		hash, cerr := s.creds.Issue(ctx, userID, userID, competitionID,
			string(arena.CredCertifiedSafeDriver), fmt.Sprintf("playalong:%s:%s", competitionID, userID))
		if cerr == nil {
			res.Certified = true
			res.Credential = hash
		}

		// Rate-limited ledgered cashback.
		if cfg.PlayAlongCashbackKobo > 0 && cfg.PlayAlongCashbackPerDay > 0 {
			count, rerr := s.repo.CashbackCountToday(ctx, competitionID, userID)
			// count is the number already granted today; allow only while strictly
			// below the daily cap so exactly PlayAlongCashbackPerDay post per day
			// (a `<=` here would permit PerDay+1).
			if rerr == nil && count < cfg.PlayAlongCashbackPerDay {
				acct, aerr := s.ledger.StandingAccountID(ctx, playAlongCashbackAccountType)
				if aerr == nil {
					ref := fmt.Sprintf("arena:playalong-cashback:%s:%s", competitionID, userID)
					// Idempotency key ties the cashback to this pass event.
					if err := s.ledger.Credit(ctx, userID, ref, "cashback:"+idemKey, acct, cfg.PlayAlongCashbackKobo); err == nil {
						res.CashbackKobo = cfg.PlayAlongCashbackKobo
					}
				}
			}
		}
	}

	_ = s.audit.Log(ctx, AuditRecord{
		CompetitionID: competitionID, ActorID: userID, EntityType: "engagement_event", EntityID: userID,
		Action: "PLAYALONG_ATTEMPT", Reason: string(arena.RailPlayAlong),
		After: map[string]any{"points": payload.Points, "total": total, "certified": res.Certified},
	})
	return res, nil
}

// PredictionService is the prediction sub-rail: an idempotent engagement event
// (NEVER merit). Predictions accrue engagement points only.
type PredictionService struct {
	repo  EngagementRepo
	audit AuditRepo
}

// NewPredictionService builds the prediction rail.
func NewPredictionService(repo EngagementRepo, audit AuditRepo) *PredictionService {
	return &PredictionService{repo: repo, audit: audit}
}

// PredictionPayload is a spectator's prediction (who wins / which state).
type PredictionPayload struct {
	SubjectID string `json:"subject_id"` // predicted contestant/state
	Points    int    `json:"points"`
}

// Submit records an idempotent PREDICTION engagement event.
func (s *PredictionService) Submit(ctx context.Context, userID, idemKey, competitionID string, payload PredictionPayload) (int, bool, error) {
	if strings.TrimSpace(idemKey) == "" {
		return 0, false, ErrMissingIdem
	}
	total, dup, err := s.repo.Record(ctx, competitionID, userID, "PREDICTION", payload.SubjectID, idemKey, payload.Points)
	if err != nil {
		return 0, false, err
	}
	if !dup {
		_ = s.audit.Log(ctx, AuditRecord{
			CompetitionID: competitionID, ActorID: userID, EntityType: "engagement_event", EntityID: userID,
			Action: "PREDICTION_SUBMIT", Reason: string(arena.RailPlayAlong),
			After: map[string]any{"subject_id": payload.SubjectID, "points": payload.Points},
		})
	}
	return total, dup, nil
}

// SupportService is the SUPPORT rail (ADR-014 §11, NDC-1): real-Naira gifting
// that feeds the prize pot and the People's Champion / State Pride display
// tallies. It NEVER references merit and holds NO signer — it can only move money
// (via LedgerPort) and tag the gift (via SupportRepo). Its awards are Support-fed
// and can never influence the crown (arena.AwardFedByMeritOnly is false for them).
type SupportService struct {
	repo   SupportRepo
	ledger LedgerPort
	tiers  TierPort
	cfg    ConfigReader
	audit  AuditRepo
}

// ConfigReader is the minimal config lookup the rails need (KYC gate, play-along
// knobs). CompetitionService satisfies it.
type ConfigReader interface {
	CurrentConfig(ctx context.Context, competitionID string) (*Config, error)
}

// SupportContributor is the standing account debited to fund the pot. Support
// moves money from the backer's wallet into this competition-pot standing account.
const supportPotAccountType = "arena_support_pot"

// isLedgerReplay reports whether err is the ledger's own idempotent-replay
// signal (ledger.ErrDuplicate, surfaced via the redis idempotency lock — see
// finance/ledger.Service.Debit/Credit). Found live via UAT: none of the money
// rails checked for this, so a genuine client retry with the same
// Idempotency-Key (the normal, expected case after a timeout) bubbled the raw
// internal ledger error all the way to an unmapped 500, instead of the
// idempotent no-op every other money path in this codebase gives a replay.
func isLedgerReplay(err error) bool {
	return errors.Is(err, ledger.ErrDuplicate)
}

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
		if isLedgerReplay(err) {
			// Same key already moved this money on a prior attempt — the tag
			// row and audit log were written then too, so this call is done.
			return nil
		}
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
		if isLedgerReplay(err) {
			return nil
		}
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
func (s *SupportService) Tallies(ctx context.Context, competitionID string) (string, map[string]int64, string, map[string]int64, error) {
	rows, err := s.repo.Rows(ctx, competitionID)
	if err != nil {
		return "", nil, "", nil, err
	}
	pc, ct := PeoplesChampion(rows)
	sp, st := StatePride(rows)
	return pc, ct, sp, st, nil
}

// CompetitionService creates competitions, publishes immutable config versions,
// and registers authorized scoring adapters (their public keys). Config is the
// source of truth for KYC gate, merit cuts, play-along thresholds and pot rules.
type CompetitionService struct {
	repo  CompetitionRepo
	audit AuditRepo
}

// NewCompetitionService builds the competition service.
func NewCompetitionService(repo CompetitionRepo, audit AuditRepo) *CompetitionService {
	return &CompetitionService{repo: repo, audit: audit}
}

// Create makes a new DRAFT competition.
func (s *CompetitionService) Create(ctx context.Context, actorID, slug, name, timezone string) (*Competition, error) {
	slug = strings.TrimSpace(slug)
	name = strings.TrimSpace(name)
	if slug == "" || name == "" {
		return nil, ErrInvalidInput
	}
	if timezone == "" {
		timezone = "Africa/Lagos"
	}
	c, err := s.repo.Create(ctx, slug, name, timezone, actorID)
	if err != nil {
		return nil, err
	}
	_ = s.audit.Log(ctx, AuditRecord{
		CompetitionID: c.ID, ActorID: actorID, EntityType: "competition", EntityID: c.ID,
		Action: "COMPETITION_CREATE", After: map[string]any{"slug": slug, "name": name},
	})
	return c, nil
}

// Get returns a competition by id.
func (s *CompetitionService) Get(ctx context.Context, id string) (*Competition, error) {
	return s.repo.Get(ctx, id)
}

// List returns competitions (public catalogue).
func (s *CompetitionService) List(ctx context.Context, limit, offset int) ([]Competition, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	return s.repo.List(ctx, limit, offset)
}

// PublishConfig writes a new immutable config version (rails, awards, gates).
func (s *CompetitionService) PublishConfig(ctx context.Context, actorID, competitionID string, cfg Config) (int, error) {
	version, err := s.repo.PublishConfig(ctx, competitionID, actorID, cfg)
	if err != nil {
		return 0, err
	}
	_ = s.audit.Log(ctx, AuditRecord{
		CompetitionID: competitionID, ActorID: actorID, EntityType: "competition_config", EntityID: competitionID,
		Action: "CONFIG_PUBLISH", After: map[string]any{"version": version, "required_kyc_tier": cfg.RequiredKYCTier},
	})
	return version, nil
}

// CurrentConfig returns the latest published config for a competition.
func (s *CompetitionService) CurrentConfig(ctx context.Context, competitionID string) (*Config, error) {
	return s.repo.CurrentConfig(ctx, competitionID)
}

// RegisterAdapter authorizes a scoring adapter (stores its public key). Only
// adapters registered here can produce a verifiable merit entry (NDC-2).
func (s *CompetitionService) RegisterAdapter(ctx context.Context, actorID, competitionID string, a AuthorizedAdapter) error {
	if a.AdapterID == "" || a.PublicKey == "" || a.SourceType == "" {
		return ErrInvalidInput
	}
	if err := s.repo.RegisterAdapter(ctx, competitionID, a); err != nil {
		return err
	}
	return s.audit.Log(ctx, AuditRecord{
		CompetitionID: competitionID, ActorID: actorID, EntityType: "authorized_adapter", EntityID: a.AdapterID,
		Action: "ADAPTER_REGISTER", After: map[string]any{"source_type": a.SourceType},
	})
}
