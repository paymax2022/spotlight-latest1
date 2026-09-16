package compliance

import (
	"context"
	"fmt"
)

// Service is the referral compliance service.
type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// --- disclosures ---

func (s *Service) PublishDisclosure(ctx context.Context, in DisclosureInput, createdBy string) (*Disclosure, error) {
	if in.Slug == "" || in.Title == "" || in.Body == "" {
		return nil, fmt.Errorf("compliance: disclosure slug, title and body are required")
	}
	return s.repo.PublishDisclosure(ctx, in, createdBy)
}

func (s *Service) ListDisclosures(ctx context.Context, slug string) ([]Disclosure, error) {
	return s.repo.ListDisclosures(ctx, slug)
}

func (s *Service) ActiveDisclosure(ctx context.Context, slug string) (*Disclosure, error) {
	if slug == "" {
		return nil, fmt.Errorf("compliance: slug required")
	}
	return s.repo.ActiveDisclosure(ctx, slug)
}

// --- consents ---

func (s *Service) RecordConsent(ctx context.Context, userID string, in ConsentInput) (*Consent, error) {
	if in.ConsentType == "" {
		return nil, fmt.Errorf("compliance: consent_type required")
	}
	switch in.ConsentType {
	case ConsentNDPCData, ConsentEarningTerms, ConsentMarketing, ConsentOverride,
		ConsentContacts, ConsentNudges:
	default:
		return nil, fmt.Errorf("compliance: invalid consent_type %q", in.ConsentType)
	}
	return s.repo.RecordConsent(ctx, userID, in)
}

func (s *Service) MyConsents(ctx context.Context, userID string) ([]Consent, error) {
	return s.repo.ConsentsByUser(ctx, userID)
}

func (s *Service) UserConsents(ctx context.Context, userID string) ([]Consent, error) {
	return s.repo.ConsentsByUser(ctx, userID)
}

// --- AML ---

func (s *Service) RaiseAML(ctx context.Context, in AMLFlagInput) (*AMLFlag, error) {
	if in.ReasonCode == "" {
		return nil, fmt.Errorf("compliance: aml reason_code required")
	}
	if in.AmountKobo < 0 {
		return nil, fmt.Errorf("compliance: aml amount must be non-negative")
	}
	return s.repo.RaiseAML(ctx, in)
}

func (s *Service) ListAML(ctx context.Context, status string) ([]AMLFlag, error) {
	return s.repo.ListAML(ctx, status)
}

func (s *Service) SetAMLStatus(ctx context.Context, id, status, reportedRef string) error {
	switch status {
	case AMLOpen, AMLReviewing, AMLCleared, AMLReported:
	default:
		return fmt.Errorf("compliance: invalid aml status %q", status)
	}
	return s.repo.SetAMLStatus(ctx, id, status, reportedRef)
}

// --- policy ---

func (s *Service) GetPolicy(ctx context.Context) (*Policy, error) { return s.repo.GetPolicy(ctx) }

func (s *Service) UpdatePolicy(ctx context.Context, in PolicyInput, updatedBy string) (*Policy, error) {
	if in.MaxPyramidDepth != nil && *in.MaxPyramidDepth < 0 {
		return nil, fmt.Errorf("compliance: max_pyramid_depth must be non-negative")
	}
	if in.TierCapKobo != nil && *in.TierCapKobo < 0 {
		return nil, fmt.Errorf("compliance: tier_cap_kobo must be non-negative")
	}
	return s.repo.UpdatePolicy(ctx, in, updatedBy)
}

// --- earnings-claim review ---

func (s *Service) ClaimReview(ctx context.Context, status string) ([]ClaimReviewItem, error) {
	return s.repo.ClaimReview(ctx, status)
}

// --- regulatory reporting ---

func (s *Service) RegulatoryExport(ctx context.Context, since, until string) ([]RegulatoryExportRow, error) {
	return s.repo.RegulatoryExport(ctx, since, until)
}
