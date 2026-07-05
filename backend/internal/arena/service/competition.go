package service

import (
	"context"
	"strings"
)

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
