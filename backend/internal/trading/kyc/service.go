package kyc

import (
	"context"
	"errors"
	"spotlight/backend/go-common/fsm"
	"spotlight/backend/go-common/ptr"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Service is the Module-KYC orchestrator. It drives the audited pure FSM
// (CanTransition / ValidateBypass / HasTradingAccess) over the persistence layer.
// It is DECOUPLED from the app's Tier 0-3 — it reads/writes only trading_kyc.
type Service struct {
	repo *Repository
	now  func() time.Time
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{repo: NewRepository(pool), now: time.Now}
}

// GetStatus returns the user's current record (synthetic NOT_STARTED if none).
func (s *Service) GetStatus(ctx context.Context, userID string) (Record, error) {
	rec, _, err := s.repo.Get(ctx, userID)
	return rec, err
}

// HasTradingAccess is the gate the trading wallet consults (satisfies
// wallet.AccessGate). Fail-closed on any error or unknown record.
func (s *Service) HasTradingAccess(ctx context.Context, userID string) (bool, error) {
	rec, _, err := s.repo.Get(ctx, userID)
	if err != nil {
		return false, err
	}
	return HasTradingAccess(rec.Status, rec.BypassExpiresAt, s.now()), nil
}

// transition applies from→to with the FSM guard + optimistic-version guard, and
// records the audit event. Retries once on a concurrent version conflict.
func (s *Service) transition(ctx context.Context, userID string, to Status, build func(cur Record) Apply) error {
	for attempt := 0; attempt < 2; attempt++ {
		cur, exists, err := s.repo.Get(ctx, userID)
		if err != nil {
			return err
		}
		if !CanTransition(cur.Status, to) {
			return ErrInvalidTransition
		}
		a := build(cur)
		a.To = to
		a.ExpectVersion = cur.Version
		a.RowExists = exists
		if err := s.repo.Apply(ctx, userID, cur.Status, a); err != nil {
			if err == ErrVersionConflict && attempt == 0 {
				continue // reload and retry once
			}
			return err
		}
		return nil
	}
	return ErrVersionConflict
}

// Submit — a user starts/re-submits verification (NOT_STARTED/REJECTED/EXPIRED → SUBMITTED).
func (s *Service) Submit(ctx context.Context, userID string) error {
	return s.transition(ctx, userID, StatusSubmitted, func(Record) Apply {
		return Apply{EventType: "submit", SetSubmittedNow: true}
	})
}

// StartReview — a reviewer picks up a case (SUBMITTED → UNDER_REVIEW).
func (s *Service) StartReview(ctx context.Context, reviewerID, userID string) error {
	return s.transition(ctx, userID, StatusUnderReview, func(Record) Apply {
		return Apply{EventType: "start_review", ActorID: &reviewerID}
	})
}

// Approve — grants access (SUBMITTED/UNDER_REVIEW → APPROVED). reason optional.
func (s *Service) Approve(ctx context.Context, reviewerID, userID, reason string) error {
	return s.transition(ctx, userID, StatusApproved, func(Record) Apply {
		return Apply{EventType: "approve", ActorID: &reviewerID, Reason: ptr.OrNil(reason), SetReviewedNow: true}
	})
}

// Reject — blocks access with a MANDATORY reason (→ REJECTED); resubmission allowed.
func (s *Service) Reject(ctx context.Context, reviewerID, userID, reason string) error {
	if reason == "" {
		return ErrReasonRequired
	}
	return s.transition(ctx, userID, StatusRejected, func(Record) Apply {
		return Apply{EventType: "reject", ActorID: &reviewerID, Reason: &reason, SetReviewedNow: true}
	})
}

// Bypass grants access WITHOUT standard verification — a controlled exception:
// two distinct admins (maker ≠ checker), a written justification, and a positive,
// bounded time-box (≤ MaxBypassTTL). Records the compliance-register row. §16B.1.
func (s *Service) Bypass(ctx context.Context, makerID, checkerID, userID, reason string, ttl time.Duration, exposureCapKobo *int64) error {
	if err := ValidateBypass(makerID, checkerID, reason, ttl); err != nil {
		return err
	}
	expires := s.now().Add(ttl)
	if err := s.transition(ctx, userID, StatusBypassed, func(Record) Apply {
		return Apply{
			EventType: "bypass", ActorID: &checkerID, Reason: &reason,
			BypassExpiresAt: &expires, ExposureCap: exposureCapKobo, KeepBypassFields: true,
		}
	}); err != nil {
		return err
	}
	// First-class, reportable register entry (best-effort after the state change).
	return s.repo.InsertBypassRegister(ctx, Bypass{
		UserID: userID, MakerID: makerID, CheckerID: checkerID, Reason: reason,
		ExposureCapKobo: exposureCapKobo, ExpiresAt: expires,
	})
}

// ExpireDue sweeps BYPASSED records past their time-box to EXPIRED (§16B.1). Meant
// to be run by the trading cron. Returns the count expired.
func (s *Service) ExpireDue(ctx context.Context) (int, error) {
	ids, err := s.repo.DueBypasses(ctx, s.now(), 500)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, id := range ids {
		if err := s.transition(ctx, id, StatusExpired, func(Record) Apply {
			return Apply{EventType: "expire"}
		}); err == nil {
			n++
		}
	}
	return n, nil
}

// ReviewQueue lists records awaiting review (SUBMITTED + UNDER_REVIEW).
func (s *Service) ReviewQueue(ctx context.Context, limit int) ([]Record, error) {
	sub, err := s.repo.ListByStatus(ctx, StatusSubmitted, limit)
	if err != nil {
		return nil, err
	}
	rev, err := s.repo.ListByStatus(ctx, StatusUnderReview, limit)
	if err != nil {
		return nil, err
	}
	return append(sub, rev...), nil
}

// GetCase returns a user's record + audit trail (admin case detail).
func (s *Service) GetCase(ctx context.Context, userID string) (Record, []Event, error) {
	rec, _, err := s.repo.Get(ctx, userID)
	if err != nil {
		return Record{}, nil, err
	}
	events, err := s.repo.ListEvents(ctx, userID, 50)
	return rec, events, err
}

// ListBypassRegister returns the compliance bypass register.
func (s *Service) ListBypassRegister(ctx context.Context, limit int) ([]Bypass, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	return s.repo.ListBypass(ctx, limit)
}

// RBAC permission slugs — MUST match the seeds in migration 20261029000200.
const (
	PermReview        = "trading.kyc.review"
	PermBypass        = "trading.kyc.bypass"         // maker
	PermBypassApprove = "trading.kyc.bypass.approve" // checker
	PermAuditRead     = "trading.audit.read"
)

// Record mirrors public.trading_kyc — the decoupled Module-KYC state (§16B.1).
// Record mirrors public.trading_kyc.
// The json tags are load-bearing: without them Go serialises the Go field names
// (UserID, SubmittedAt…), but the admin client types and fixtures expect
// snake_case (user_id, submitted_at…) — see frontend-admin/src/types/
// tradingAdmin.ts. A PascalCase payload parses without error and yields a table
// of undefined cells: the same silent client/server seam that emptied the
// savings screens.
type Record struct {
	UserID          string     `json:"user_id"`
	Status          Status     `json:"status"`
	SubmittedAt     *time.Time `json:"submitted_at"`
	ReviewedAt      *time.Time `json:"reviewed_at"`
	ReviewerID      *string    `json:"reviewer_id"`
	ReasonCode      *string    `json:"reason_code"`
	BypassExpiresAt *time.Time `json:"bypass_expires_at"`
	ExposureCapKobo *int64     `json:"exposure_cap_kobo"`
	Version         int        `json:"version"`
}

// Bypass mirrors public.trading_kyc_bypass (the compliance register). It is
// serialised to the admin register, so json tags are required — without them
// the client receives Go field names instead of snake_case.
type Bypass struct {
	ID              string     `json:"id"`
	UserID          string     `json:"user_id"`
	MakerID         string     `json:"maker_id"`
	CheckerID       string     `json:"checker_id"`
	Reason          string     `json:"reason"`
	ExposureCapKobo *int64     `json:"exposure_cap_kobo"`
	GrantedAt       time.Time  `json:"granted_at"`
	ExpiresAt       time.Time  `json:"expires_at"`
	RevokedAt       *time.Time `json:"revoked_at"`
}

// Service-level sentinel errors (mapped to HTTP by the handler).
var (
	ErrInvalidTransition = errors.New("trading kyc: illegal status transition")
	ErrReasonRequired    = errors.New("trading kyc: reason is required")
	ErrVersionConflict   = errors.New("trading kyc: record changed concurrently, retry")
	ErrNotFound          = errors.New("trading kyc: record not found")
)

// Status is the trading-access verification state (§16B.1). Stored on a dedicated
// trading_kyc record, never derived from the Tier 0–3 machine.
type Status string

const (
	StatusNotStarted  Status = "NOT_STARTED"
	StatusSubmitted   Status = "SUBMITTED"
	StatusUnderReview Status = "UNDER_REVIEW"
	StatusApproved    Status = "APPROVED"
	StatusRejected    Status = "REJECTED"
	StatusBypassed    Status = "BYPASSED"
	StatusExpired     Status = "EXPIRED"
)

// transitions is the allowed status graph. Bypass is reachable from any
// pre-approval state (admin two-person action, enforced in the service), but not
// from APPROVED (already has access) — and every state can EXPIRE.
//
//	NOT_STARTED  → SUBMITTED | BYPASSED
//	SUBMITTED    → UNDER_REVIEW | REJECTED | BYPASSED
//	UNDER_REVIEW → APPROVED | REJECTED | BYPASSED
//	APPROVED     → EXPIRED
//	REJECTED     → SUBMITTED (resubmit) | BYPASSED | EXPIRED
//	BYPASSED     → EXPIRED | UNDER_REVIEW (start real review before/after expiry)
//	EXPIRED      → SUBMITTED (re-verify) | BYPASSED
var transitions = fsm.Table[Status]{
	StatusNotStarted:  fsm.Set(StatusSubmitted, StatusBypassed),
	StatusSubmitted:   fsm.Set(StatusUnderReview, StatusRejected, StatusBypassed),
	StatusUnderReview: fsm.Set(StatusApproved, StatusRejected, StatusBypassed),
	StatusApproved:    fsm.Set(StatusExpired),
	StatusRejected:    fsm.Set(StatusSubmitted, StatusBypassed, StatusExpired),
	StatusBypassed:    fsm.Set(StatusExpired, StatusUnderReview),
	StatusExpired:     fsm.Set(StatusSubmitted, StatusBypassed),
}

// CanTransition reports whether the record may move from → to. Re-writing the
// same status is idempotent (allowed).
func CanTransition(from, to Status) bool {
	return from == to || transitions.Can(from, to)
}

// IsValidStatus reports whether s is a known status (rejects malformed input).
func IsValidStatus(s Status) bool {
	_, ok := transitions[s]
	return ok
}

// MaxBypassTTL is the hard ceiling on how long a bypass may grant access before
// full KYC must be completed (§16B.1 recommends ≤ 30 days).
const MaxBypassTTL = 30 * 24 * time.Hour

// BypassError enumerates why a bypass request is rejected.
type BypassError string

func (e BypassError) Error() string { return string(e) }

const (
	ErrBypassSameApprover BypassError = "bypass requires two different admins (maker ≠ checker)"
	ErrBypassNoMaker      BypassError = "bypass requires a maker admin id"
	ErrBypassNoChecker    BypassError = "bypass requires a checker admin id"
	ErrBypassNoReason     BypassError = "bypass requires a written justification"
	ErrBypassBadTTL       BypassError = "bypass ttl must be positive"
	ErrBypassTTLTooLong   BypassError = "bypass ttl exceeds the maximum allowed"
)

// ValidateBypass enforces the controlled-exception policy on a bypass grant
// BEFORE it is persisted: two distinct admins (maker ≠ checker), a written
// reason, and a positive, bounded time-box. Pure — the service supplies ids/ttl.
func ValidateBypass(makerID, checkerID, reason string, ttl time.Duration) error {
	if makerID == "" {
		return ErrBypassNoMaker
	}
	if checkerID == "" {
		return ErrBypassNoChecker
	}
	if makerID == checkerID {
		return ErrBypassSameApprover
	}
	if reason == "" {
		return ErrBypassNoReason
	}
	if ttl <= 0 {
		return ErrBypassBadTTL
	}
	if ttl > MaxBypassTTL {
		return ErrBypassTTLTooLong
	}
	return nil
}

// HasTradingAccess is the single access gate the trading module consults. Access
// is granted IFF the record is APPROVED, or BYPASSED and not past its expiry.
// A nil bypass expiry on a BYPASSED record is treated as expired (fail-closed) —
// a bypass must always carry a time-box.
func HasTradingAccess(status Status, bypassExpiresAt *time.Time, now time.Time) bool {
	switch status {
	case StatusApproved:
		return true
	case StatusBypassed:
		return bypassExpiresAt != nil && now.Before(*bypassExpiresAt)
	default:
		return false
	}
}

// BypassExpired reports whether a BYPASSED record has passed its time-box and
// should be swept to EXPIRED.
func BypassExpired(status Status, bypassExpiresAt *time.Time, now time.Time) bool {
	if status != StatusBypassed {
		return false
	}
	return bypassExpiresAt == nil || !now.Before(*bypassExpiresAt)
}
