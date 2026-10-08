package compliance

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// Service is the referral compliance service.
type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) PublishDisclosure(ctx context.Context, in DisclosureInput, createdBy string) (*Disclosure, error) {
	if in.Slug == "" || in.Title == "" || in.Body == "" {
		return nil, errors.New("compliance: disclosure slug, title and body are required")
	}
	return s.repo.PublishDisclosure(ctx, in, createdBy)
}

func (s *Service) ListDisclosures(ctx context.Context, slug string) ([]Disclosure, error) {
	return s.repo.ListDisclosures(ctx, slug)
}

func (s *Service) ActiveDisclosure(ctx context.Context, slug string) (*Disclosure, error) {
	if slug == "" {
		return nil, errors.New("compliance: slug required")
	}
	return s.repo.ActiveDisclosure(ctx, slug)
}

func (s *Service) RecordConsent(ctx context.Context, userID string, in ConsentInput) (*Consent, error) {
	if in.ConsentType == "" {
		return nil, errors.New("compliance: consent_type required")
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

func (s *Service) RaiseAML(ctx context.Context, in AMLFlagInput) (*AMLFlag, error) {
	if in.ReasonCode == "" {
		return nil, errors.New("compliance: aml reason_code required")
	}
	if in.AmountKobo < 0 {
		return nil, errors.New("compliance: aml amount must be non-negative")
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

func (s *Service) GetPolicy(ctx context.Context) (*Policy, error) { return s.repo.GetPolicy(ctx) }

func (s *Service) UpdatePolicy(ctx context.Context, in PolicyInput, updatedBy string) (*Policy, error) {
	if in.MaxPyramidDepth != nil && *in.MaxPyramidDepth < 0 {
		return nil, errors.New("compliance: max_pyramid_depth must be non-negative")
	}
	if in.TierCapKobo != nil && *in.TierCapKobo < 0 {
		return nil, errors.New("compliance: tier_cap_kobo must be non-negative")
	}
	return s.repo.UpdatePolicy(ctx, in, updatedBy)
}

func (s *Service) ClaimReview(ctx context.Context, status string) ([]ClaimReviewItem, error) {
	return s.repo.ClaimReview(ctx, status)
}

func (s *Service) RegulatoryExport(ctx context.Context, since, until string) ([]RegulatoryExportRow, error) {
	return s.repo.RegulatoryExport(ctx, since, until)
}

// AML statuses.
const (
	AMLOpen      = "open"
	AMLReviewing = "reviewing"
	AMLCleared   = "cleared"
	AMLReported  = "reported"
)

// Consent types.
const (
	ConsentNDPCData     = "ndpc_data"
	ConsentEarningTerms = "earnings_terms"
	ConsentMarketing    = "marketing"
	ConsentOverride     = "override_disclosure"
	// ConsentContacts — Collected by the referral settings screen. Kept distinct from
	// ConsentMarketing on purpose: consent records are per-purpose, and folding
	// contacts access into marketing would misstate what the user agreed to.
	ConsentContacts = "contacts"
	ConsentNudges   = "nudges"
)

// Disclosure is a versioned T&Cs / disclosure document.
type Disclosure struct {
	ID           string    `json:"id"`
	Slug         string    `json:"slug"`
	Version      int       `json:"version"`
	Title        string    `json:"title"`
	Body         string    `json:"body"`
	Jurisdiction string    `json:"jurisdiction"`
	Active       bool      `json:"active"`
	EffectiveAt  time.Time `json:"effective_at"`
	CreatedBy    string    `json:"created_by,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

// DisclosureInput publishes a new disclosure version. Versioning is automatic:
// publishing a slug bumps to max(version)+1 and deactivates prior versions.
type DisclosureInput struct {
	Slug         string `json:"slug"`
	Title        string `json:"title"`
	Body         string `json:"body"`
	Jurisdiction string `json:"jurisdiction"`
}

// Consent is an NDPC consent record (member-captured).
type Consent struct {
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	DisclosureID string    `json:"disclosure_id,omitempty"`
	ConsentType  string    `json:"consent_type"`
	Granted      bool      `json:"granted"`
	Version      int       `json:"version,omitempty"`
	Source       string    `json:"source,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

// ConsentInput records a member's consent decision.
type ConsentInput struct {
	ConsentType  string `json:"consent_type"`
	DisclosureID string `json:"disclosure_id"`
	Granted      *bool  `json:"granted"`
	Version      int    `json:"version"`
	Source       string `json:"source"`
}

// AMLFlag is a referral-earnings AML monitoring flag.
type AMLFlag struct {
	ID          string    `json:"id"`
	SubjectID   string    `json:"subject_id,omitempty"`
	ReasonCode  string    `json:"reason_code"`
	AmountKobo  int64     `json:"amount_kobo"`
	WindowCount int       `json:"window_count"`
	Status      string    `json:"status"`
	RewardID    string    `json:"reward_id,omitempty"`
	ReportedRef string    `json:"reported_ref,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

// AMLFlagInput raises an AML flag (reason code + amount only).
type AMLFlagInput struct {
	SubjectID   string `json:"subject_id"`
	ReasonCode  string `json:"reason_code"`
	AmountKobo  int64  `json:"amount_kobo"`
	WindowCount int    `json:"window_count"`
	RewardID    string `json:"reward_id"`
}

// Policy is the singleton structural policy (anti-pyramid / tier cap / jurisdiction).
type Policy struct {
	MaxPyramidDepth      int       `json:"max_pyramid_depth"`
	TierCapKobo          int64     `json:"tier_cap_kobo"`
	RequireActivity      bool      `json:"require_activity"`
	AllowedJurisdictions []string  `json:"allowed_jurisdictions"`
	UpdatedBy            string    `json:"updated_by,omitempty"`
	UpdatedAt            time.Time `json:"updated_at"`
}

// PolicyInput updates the structural policy singleton.
type PolicyInput struct {
	MaxPyramidDepth      *int     `json:"max_pyramid_depth"`
	TierCapKobo          *int64   `json:"tier_cap_kobo"`
	RequireActivity      *bool    `json:"require_activity"`
	AllowedJurisdictions []string `json:"allowed_jurisdictions"`
}

// ClaimReviewItem is an earnings-claim review row (reused from the risk review
// queue, filtered to claims). Earnings-claim review surfaces held/queued rewards.
type ClaimReviewItem struct {
	ID         string    `json:"id"`
	RewardID   string    `json:"reward_id,omitempty"`
	SubjectID  string    `json:"subject_id,omitempty"`
	ReasonCode string    `json:"reason_code"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"created_at"`
}

// RegulatoryExportRow is one row of the regulatory-reporting export.
type RegulatoryExportRow struct {
	SubjectID   string    `json:"subject_id,omitempty"`
	ReasonCode  string    `json:"reason_code"`
	AmountKobo  int64     `json:"amount_kobo"`
	Status      string    `json:"status"`
	ReportedRef string    `json:"reported_ref,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}
