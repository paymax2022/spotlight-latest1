// Package attribution is the §7A Attribution & Default-Referrer engine.
//
// ResolveReferrer runs the configurable fallback chain — valid code → deep-link →
// context (agent/estate/campaign) → regional house → GLOBAL house/Super-Admin —
// and ALWAYS resolves: the house is the last resort, so no signup is ever left
// unattributed (§7A.1). It writes exactly one referral_attributions row per
// referred user (UNIQUE referred_user_id; idempotent), accrues the referrer-side
// reward (notional for house rows), and records an engine event.
//
// Self-referral (own code, or same kycHash/deviceID) is BLOCKED → routed to the
// house with a risk flag (§7A.4). Invalid/expired codes are treated as no-code →
// house, and the attempt is logged. House rows are tagged is_house=true and the
// attribution carries status='grace' with grace_expires_at from config.
package attribution

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	cfgpkg "spotlight/backend/internal/referral/config"
	"spotlight/backend/internal/referral/events"
	"spotlight/backend/internal/referral/house"
	rewardledger "spotlight/backend/internal/referral/ledger"
)

// HouseReferrerRewardKobo is the notional referrer-side accrual captured to the
// house for an organic / no-code signup. Mirrors the seed reward (₦500). When
// config.budget_neutral is true the house accrual is purely notional (no payout).
const HouseReferrerRewardKobo = 50_000

// Attribution types (mirror the DB CHECK + §7A.1 chain).
const (
	TypeCode          = "code"
	TypeDeepLink      = "deeplink"
	TypeContext       = "context"
	TypeRegionalHouse = "regional_house"
	TypeGlobalHouse   = "global_house"
)

// Risk flags set on house-routed attributions.
const (
	RiskSelfReferral = "self_referral"
	RiskInvalidCode  = "invalid_code"
)

// Status values.
const (
	StatusGrace  = "grace"
	StatusLocked = "locked"
)

// CodeResolver maps a referral code to its owning referrer user id. The existing
// finance/referrals.Service satisfies this (ResolveCodeToReferrer), so the engine
// reuses the seed without breaking it.
type CodeResolver interface {
	ResolveCodeToReferrer(ctx context.Context, code string) (string, error)
}

// ResolveOpts carries the signup signals the resolver weighs (§7A.1, §7A.4).
type ResolveOpts struct {
	CodeEntered string // optional referral code typed at signup
	DeepLinkRef string // deferred deep-link / click attribution → referrer user id
	ContextRef  string // agent QR / estate link / campaign owner → referrer user id
	Region      string // for regional house selection (optional)
	DeviceID    string // self-referral fraud signal
	KYCHash     string // self-referral fraud signal (one human one identity)
}

// Attribution is one resolved referral_attributions row.
type Attribution struct {
	ID              string     `json:"id"`
	ReferredUserID  string     `json:"referred_user_id"`
	ReferrerID      string     `json:"referrer_id,omitempty"`
	HouseAccountID  string     `json:"house_account_id,omitempty"`
	AttributionType string     `json:"attribution_type"`
	CodeUsed        string     `json:"code_used,omitempty"`
	IsHouse         bool       `json:"is_house"`
	RiskFlag        string     `json:"risk_flag,omitempty"`
	Status          string     `json:"status"`
	GraceExpiresAt  *time.Time `json:"grace_expires_at,omitempty"`
}

// Service is the §7A resolver.
type Service struct {
	db     *pgxpool.Pool
	codes  CodeResolver
	house  *house.Service
	reward *rewardledger.Service
	cfg    *cfgpkg.Service
	events *events.Service
}

func NewService(
	db *pgxpool.Pool,
	codes CodeResolver,
	houseSvc *house.Service,
	reward *rewardledger.Service,
	cfg *cfgpkg.Service,
	ev *events.Service,
) *Service {
	return &Service{db: db, codes: codes, house: houseSvc, reward: reward, cfg: cfg, events: ev}
}

// ResolveReferrer runs the §7A fallback chain for a freshly-signed-up user and
// persists exactly one attribution row. Idempotent on referred_user_id: a repeat
// call returns the existing attribution.
func (s *Service) ResolveReferrer(ctx context.Context, referredUserID string, opts ResolveOpts) (*Attribution, error) {
	if referredUserID == "" {
		return nil, fmt.Errorf("referral/attribution: referred user id required")
	}

	// Idempotency: if already attributed, return it untouched.
	if existing, err := s.getByReferred(ctx, referredUserID); err == nil {
		return existing, nil
	}

	cfg, err := s.cfg.Get(ctx)
	if err != nil {
		return nil, err
	}
	graceExpiry := time.Now().Add(time.Duration(cfg.GraceWindowHours) * time.Hour)

	// Resolve a self-referral signal once (own code is checked per-candidate below).
	selfByIdentity := s.isSelfByIdentity(ctx, referredUserID, opts)

	// Walk the configured fallback chain; first match wins.
	for _, step := range cfg.FallbackChain {
		switch step {
		case TypeCode:
			code := normalizeCode(opts.CodeEntered)
			if code == "" {
				continue
			}
			referrerID, err := s.codes.ResolveCodeToReferrer(ctx, code)
			if err != nil || referrerID == "" {
				// Invalid/expired code → treat as no-code; log the attempt and fall through.
				_ = s.events.Record(ctx, events.Input{
					EventType:      events.TypeInvalidCodeAttempt,
					UserID:         referredUserID,
					Payload:        map[string]any{"code": code},
					IdempotencyKey: "ref:invalid_code:" + referredUserID,
				})
				// Remember the invalid attempt → house gets a risk flag.
				return s.attributeToHouse(ctx, referredUserID, RiskInvalidCode, code, graceExpiry, cfg)
			}
			// Self-referral: own code OR same identity/device → blocked → house.
			if referrerID == referredUserID || selfByIdentity {
				_ = s.events.Record(ctx, events.Input{
					EventType:      events.TypeSelfReferralBlocked,
					UserID:         referredUserID,
					ReferrerID:     referrerID,
					Payload:        map[string]any{"code": code},
					IdempotencyKey: "ref:self_blocked:" + referredUserID,
				})
				return s.attributeToHouse(ctx, referredUserID, RiskSelfReferral, code, graceExpiry, cfg)
			}
			return s.attributeToReferrer(ctx, referredUserID, referrerID, TypeCode, code, graceExpiry)

		case TypeDeepLink:
			if opts.DeepLinkRef == "" {
				continue
			}
			if opts.DeepLinkRef == referredUserID || selfByIdentity {
				return s.attributeToHouse(ctx, referredUserID, RiskSelfReferral, "", graceExpiry, cfg)
			}
			return s.attributeToReferrer(ctx, referredUserID, opts.DeepLinkRef, TypeDeepLink, "", graceExpiry)

		case TypeContext:
			if opts.ContextRef == "" {
				continue
			}
			if opts.ContextRef == referredUserID || selfByIdentity {
				return s.attributeToHouse(ctx, referredUserID, RiskSelfReferral, "", graceExpiry, cfg)
			}
			return s.attributeToReferrer(ctx, referredUserID, opts.ContextRef, TypeContext, "", graceExpiry)

		case TypeRegionalHouse:
			if opts.Region == "" {
				continue
			}
			if acc, err := s.regionalHouse(ctx, opts.Region); err == nil && acc != nil {
				return s.attributeToHouseAccount(ctx, referredUserID, acc.ID, TypeRegionalHouse, "", "", graceExpiry)
			}
			continue

		case TypeGlobalHouse:
			return s.attributeToHouse(ctx, referredUserID, "", "", graceExpiry, cfg)
		}
	}

	// Chain exhausted without a global-house step → house is still the last resort.
	return s.attributeToHouse(ctx, referredUserID, "", "", graceExpiry, cfg)
}

// attributeToReferrer persists a human-referrer attribution + accrues the reward.
func (s *Service) attributeToReferrer(ctx context.Context, referredUserID, referrerID, attrType, code string, graceExpiry time.Time) (*Attribution, error) {
	att, err := s.insertAttribution(ctx, insertParams{
		ReferredUserID:  referredUserID,
		ReferrerID:      referrerID,
		AttributionType: attrType,
		CodeUsed:        code,
		IsHouse:         false,
		GraceExpiresAt:  graceExpiry,
	})
	if err != nil {
		return nil, err
	}
	if _, err := s.reward.Accrue(ctx, rewardledger.AccrueInput{
		BeneficiaryID:  referrerID,
		ReferredUserID: referredUserID,
		Kind:           rewardledger.KindReferrer,
		AmountKobo:     HouseReferrerRewardKobo,
		IsHouse:        false,
		IdempotencyKey: "ref:accrue:" + referredUserID,
	}); err != nil {
		return nil, err
	}
	_ = s.events.Record(ctx, events.Input{
		EventType:      events.TypeSignupAttributed,
		UserID:         referredUserID,
		ReferrerID:     referrerID,
		Payload:        map[string]any{"attribution_type": attrType, "code": code},
		IdempotencyKey: "ref:signup_attributed:" + referredUserID,
	})
	return att, nil
}

// attributeToHouse resolves the global house account and routes the attribution
// to it (last resort / self / invalid). The accrual is NOTIONAL.
func (s *Service) attributeToHouse(ctx context.Context, referredUserID, riskFlag, code string, graceExpiry time.Time, _ cfgpkg.Config) (*Attribution, error) {
	acc, err := s.house.GetOrCreateGlobalHouse(ctx)
	if err != nil {
		return nil, err
	}
	return s.attributeToHouseAccount(ctx, referredUserID, acc.ID, TypeGlobalHouse, code, riskFlag, graceExpiry)
}

// attributeToHouseAccount persists a house attribution + a notional house accrual
// (is_house=true → excluded from override chains and K-factor).
func (s *Service) attributeToHouseAccount(ctx context.Context, referredUserID, houseAccountID, attrType, code, riskFlag string, graceExpiry time.Time) (*Attribution, error) {
	att, err := s.insertAttribution(ctx, insertParams{
		ReferredUserID:  referredUserID,
		HouseAccountID:  houseAccountID,
		AttributionType: attrType,
		CodeUsed:        code,
		IsHouse:         true,
		RiskFlag:        riskFlag,
		GraceExpiresAt:  graceExpiry,
	})
	if err != nil {
		return nil, err
	}
	if _, err := s.reward.Accrue(ctx, rewardledger.AccrueInput{
		HouseAccountID: houseAccountID,
		ReferredUserID: referredUserID,
		Kind:           rewardledger.KindReferrer,
		AmountKobo:     HouseReferrerRewardKobo,
		IsHouse:        true,
		IdempotencyKey: "ref:accrue:" + referredUserID,
	}); err != nil {
		return nil, err
	}
	_ = s.events.Record(ctx, events.Input{
		EventType:      events.TypeAttributionToHouse,
		UserID:         referredUserID,
		Payload:        map[string]any{"attribution_type": attrType, "risk_flag": riskFlag, "code": code},
		IdempotencyKey: "ref:to_house:" + referredUserID,
	})
	return att, nil
}

type insertParams struct {
	ReferredUserID  string
	ReferrerID      string
	HouseAccountID  string
	AttributionType string
	CodeUsed        string
	IsHouse         bool
	RiskFlag        string
	GraceExpiresAt  time.Time
}

// insertAttribution writes the UNIQUE(referred_user_id) row; on conflict it
// returns the existing row (full idempotency).
func (s *Service) insertAttribution(ctx context.Context, p insertParams) (*Attribution, error) {
	const q = `
		INSERT INTO referral_attributions
			(referred_user_id, referrer_id, house_account_id, attribution_type,
			 code_used, is_house, risk_flag, status, grace_expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, 'grace', $8)
		ON CONFLICT (referred_user_id) DO NOTHING
		RETURNING ` + attrCols
	att, err := scanAttribution(s.db.QueryRow(ctx, q,
		p.ReferredUserID,
		nullable(p.ReferrerID),
		nullable(p.HouseAccountID),
		p.AttributionType,
		nullable(p.CodeUsed),
		p.IsHouse,
		nullable(p.RiskFlag),
		p.GraceExpiresAt,
	))
	if err == pgx.ErrNoRows {
		// Already attributed by a concurrent call — return existing.
		return s.getByReferred(ctx, p.ReferredUserID)
	}
	if err != nil {
		return nil, fmt.Errorf("referral/attribution: insert: %w", err)
	}
	return att, nil
}

const attrCols = `id, referred_user_id, referrer_id, house_account_id, attribution_type,
	code_used, is_house, risk_flag, status, grace_expires_at`

func scanAttribution(row pgx.Row) (*Attribution, error) {
	var (
		a                                  Attribution
		referrer, hAcc, code, risk         *string
		grace                              *time.Time
	)
	if err := row.Scan(&a.ID, &a.ReferredUserID, &referrer, &hAcc, &a.AttributionType,
		&code, &a.IsHouse, &risk, &a.Status, &grace); err != nil {
		return nil, err
	}
	if referrer != nil {
		a.ReferrerID = *referrer
	}
	if hAcc != nil {
		a.HouseAccountID = *hAcc
	}
	if code != nil {
		a.CodeUsed = *code
	}
	if risk != nil {
		a.RiskFlag = *risk
	}
	a.GraceExpiresAt = grace
	return &a, nil
}

// GetByReferred returns the attribution for a referred user (member my-attribution).
func (s *Service) GetByReferred(ctx context.Context, referredUserID string) (*Attribution, error) {
	return s.getByReferred(ctx, referredUserID)
}

func (s *Service) getByReferred(ctx context.Context, referredUserID string) (*Attribution, error) {
	const q = `SELECT ` + attrCols + ` FROM referral_attributions WHERE referred_user_id = $1`
	return scanAttribution(s.db.QueryRow(ctx, q, referredUserID))
}

// GetByID returns an attribution by its id.
func (s *Service) GetByID(ctx context.Context, id string) (*Attribution, error) {
	const q = `SELECT ` + attrCols + ` FROM referral_attributions WHERE id = $1`
	return scanAttribution(s.db.QueryRow(ctx, q, id))
}

// isSelfByIdentity returns true when the device/KYC fingerprint already belongs to
// a DIFFERENT user with an attribution — a one-human-many-accounts self-referral
// signal (§7A.4). Best-effort: any error returns false (fail-open on the signal,
// but the resolver still always attributes).
func (s *Service) isSelfByIdentity(ctx context.Context, referredUserID string, opts ResolveOpts) bool {
	if opts.KYCHash == "" && opts.DeviceID == "" {
		return false
	}
	const q = `
		SELECT 1
		FROM referral_engine_events
		WHERE event_type = $1
		  AND user_id IS NOT NULL
		  AND user_id <> $2
		  AND (payload->>'kyc_hash' = $3 OR payload->>'device_id' = $4)
		LIMIT 1`
	var hit int
	err := s.db.QueryRow(ctx, q, events.TypeSignupAttributed, referredUserID,
		emptyToken(opts.KYCHash), emptyToken(opts.DeviceID)).Scan(&hit)
	return err == nil && hit == 1
}

// regionalHouse returns the regional house account for a region, if configured.
func (s *Service) regionalHouse(ctx context.Context, region string) (*house.Account, error) {
	const q = `
		SELECT id, scope, region, owner_user_id, code, non_withdrawable, created_at
		FROM referral_house_accounts
		WHERE scope = 'regional' AND region = $1
		LIMIT 1`
	var a house.Account
	if err := s.db.QueryRow(ctx, q, region).Scan(
		&a.ID, &a.Scope, &a.Region, &a.OwnerUserID, &a.Code, &a.NonWithdrawable, &a.CreatedAt); err != nil {
		return nil, err
	}
	return &a, nil
}

func normalizeCode(code string) string {
	return strings.ToUpper(strings.TrimSpace(code))
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// emptyToken avoids matching NULL/empty payload fields against an empty signal.
func emptyToken(s string) string {
	if s == "" {
		return "\x00-none-\x00"
	}
	return s
}
