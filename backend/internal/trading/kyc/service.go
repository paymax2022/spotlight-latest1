package kyc

import (
	"context"
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
		return Apply{EventType: "approve", ActorID: &reviewerID, Reason: strPtrOrNil(reason), SetReviewedNow: true}
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

func strPtrOrNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
