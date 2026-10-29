package onboarding

import (
	"context"
	"fmt"
	"time"

	"spotlight/backend/internal/doctor"
)

// decider applies a verdict to an MDCN verification. Satisfied by
// *doctor.MDCNReviewService, which owns the status state machine, the
// self-approval ban, the discoverability gate (doctor_profiles.verification /
// is_published) and the licence-expiry auto-suspend job.
type decider interface {
	Decide(ctx context.Context, reviewerID, verificationID string, in doctor.MDCNDecision) (*doctor.MDCNReviewRecord, error)
}

type Service struct {
	store   store
	decider decider
	now     func() time.Time
}

func newService(s store, d decider) *Service {
	return &Service{store: s, decider: d, now: time.Now}
}

func normalizeList(q ListQuery) (ListQuery, error) {
	if q.Stage != "" && !ValidStage(q.Stage) {
		return q, fmt.Errorf("%w: unknown stage %q", ErrValidation, q.Stage)
	}
	if q.Limit <= 0 {
		q.Limit = 25
	}
	if q.Limit > 200 {
		q.Limit = 200
	}
	if q.Offset < 0 {
		q.Offset = 0
	}
	if len(q.Q) > 100 {
		q.Q = q.Q[:100]
	}
	return q, nil
}

func (s *Service) List(ctx context.Context, q ListQuery) (*ApplicationList, error) {
	q, err := normalizeList(q)
	if err != nil {
		return nil, err
	}
	return s.store.List(ctx, q)
}

func (s *Service) Get(ctx context.Context, userID string) (*ApplicationDetail, error) {
	return s.store.Detail(ctx, userID)
}

// Decide applies the verdict to the applicant's latest verification through the
// MDCN review service, then records the outcome on the merchant-upgrade request
// plus an audit row in one transaction. Each half is idempotent, so if recording
// fails after the verdict landed the reviewer can retry the same decision.
func (s *Service) Decide(ctx context.Context, reviewerID, userID string, req DecisionRequest) (*ApplicationDetail, error) {
	dec, err := ValidateDecision(req, s.now())
	if err != nil {
		return nil, err
	}
	// 404 for an unknown applicant before anything else.
	if _, err := s.store.Detail(ctx, userID); err != nil {
		return nil, err
	}
	verifID, status, err := s.store.LatestVerification(ctx, userID)
	if err != nil {
		return nil, err
	}
	to := map[string]string{"approve": "approved", "need_info": "needs_info", "reject": "rejected"}[dec.Action]
	// A settled verdict that matches is a retry; anything else needs an open one.
	if status != to && !CanDecide(status) {
		return nil, fmt.Errorf("%w (status is %s)", ErrNoOpenVerification, status)
	}

	if _, err := s.decider.Decide(ctx, reviewerID, verifID, doctor.MDCNDecision{
		Action: dec.Action, LicenceExpiry: dec.LicenceExpiry, Discipline: dec.Discipline, Notes: dec.Notes,
	}); err != nil {
		return nil, err
	}
	if err := s.store.RecordDecision(ctx, decisionRecord{
		ReviewerID: reviewerID, UserID: userID, VerificationID: verifID,
		Action: dec.Action, NewStatus: to, Notes: dec.Notes,
	}); err != nil {
		return nil, fmt.Errorf("verdict applied but not recorded, retry the same decision: %w", err)
	}
	return s.store.Detail(ctx, userID)
}
