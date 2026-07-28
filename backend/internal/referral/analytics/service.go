package analytics

import (
	"context"
	"fmt"
)

// Service is the referral analytics read-model service.
type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) KFactor(ctx context.Context) (*KFactor, error) { return s.repo.KFactor(ctx) }

func (s *Service) Funnel(ctx context.Context) ([]FunnelStage, error) { return s.repo.Funnel(ctx) }

// CAC computes referral cost-of-acquisition (house-excluded spend / human-referred
// signups) and compares it against a supplied paid-CAC benchmark.
func (s *Service) CAC(ctx context.Context, paidCACKobo int64) (*CAC, error) {
	spend, err := s.repo.ReferralSpendKobo(ctx)
	if err != nil {
		return nil, err
	}
	signups, err := s.repo.ReferredSignupCount(ctx)
	if err != nil {
		return nil, err
	}
	out := &CAC{
		ReferralSpendKobo: spend,
		ReferredSignups:   signups,
		PaidCACKobo:       paidCACKobo,
	}
	if signups > 0 {
		out.ReferralCACKobo = spend / int64(signups)
	}
	return out, nil
}

func (s *Service) Cohorts(ctx context.Context) ([]CohortRow, error) { return s.repo.Cohorts(ctx) }

func (s *Service) Channels(ctx context.Context) ([]ChannelRow, error) { return s.repo.Channels(ctx) }

func (s *Service) Segmentation(ctx context.Context) (*Segmentation, error) {
	return s.repo.Segmentation(ctx)
}

func (s *Service) User360(ctx context.Context, userID string) (*User360, error) {
	if userID == "" {
		return nil, fmt.Errorf("analytics: user id required")
	}
	return s.repo.User360(ctx, userID)
}
