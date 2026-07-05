package service

import (
	"context"
	"fmt"
	"strings"

	"spotlight/backend/internal/arena"
)

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
