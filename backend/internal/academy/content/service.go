package content

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Service implements the academy content domain: the publish lifecycle for lessons
// and bundles, the production pipeline board, and localizations. No money path.
type Service struct {
	repo *Repository
}

// NewService wires the content service from a pgx pool.
func NewService(db *pgxpool.Pool) *Service { return &Service{repo: NewRepository(db)} }

// Sentinel errors mapped to HTTP statuses by the handler.
var (
	ErrIllegalTransition = errors.New("academy.content: illegal state transition")
	ErrInvalidInput      = errors.New("academy.content: invalid input")
)

// ── Lessons (publish) ────────────────────────────────────────────────────────────

// TransitionLesson runs the guarded draft→review→approved→live→archived lifecycle.
func (s *Service) TransitionLesson(ctx context.Context, actor, id string, to PublishStatus) (*Lesson, error) {
	if !validPublishStatus(to) {
		return nil, ErrInvalidInput
	}
	return s.repo.TransitionLesson(ctx, actor, id, to)
}

func (s *Service) GetLesson(ctx context.Context, id string) (*Lesson, error) {
	return s.repo.GetLesson(ctx, id)
}

// ListLessons serves the admin CMS surface: lessons across all statuses, optionally
// filtered by objective_id / status.
func (s *Service) ListLessons(ctx context.Context, objectiveID, status string, limit, offset int) ([]Lesson, error) {
	return s.repo.ListLessons(ctx, objectiveID, status, limit, offset)
}

// LiveLessonsForObjective serves the learner surface: only live lessons.
func (s *Service) LiveLessonsForObjective(ctx context.Context, objectiveID string, limit int) ([]Lesson, error) {
	if objectiveID == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.ListLiveLessonsForObjective(ctx, objectiveID, limit)
}

// ── Bundles (publish + manifest) ─────────────────────────────────────────────────

// TransitionBundle runs the guarded publish lifecycle; approved→live re-packages
// the bundle manifest.
func (s *Service) TransitionBundle(ctx context.Context, actor, id string, to PublishStatus) (*ContentBundle, error) {
	if !validPublishStatus(to) {
		return nil, ErrInvalidInput
	}
	return s.repo.TransitionBundle(ctx, actor, id, to)
}

func (s *Service) GetBundle(ctx context.Context, id string) (*ContentBundle, error) {
	return s.repo.GetBundle(ctx, id)
}

// LiveBundles serves the learner surface: only live bundles.
func (s *Service) LiveBundles(ctx context.Context, limit int) ([]ContentBundle, error) {
	return s.repo.ListLiveBundles(ctx, limit)
}

// BundleManifest returns the packaged manifest for a live bundle (learner offline
// download surface). Manifest is populated on approved→live.
func (s *Service) BundleManifest(ctx context.Context, id string) (map[string]any, error) {
	b, err := s.repo.GetBundle(ctx, id)
	if err != nil {
		return nil, err
	}
	return b.Manifest, nil
}

// ── Productions (pipeline board) ─────────────────────────────────────────────────

func (s *Service) CreateProduction(ctx context.Context, actor string, req CreateProductionRequest) (*Production, error) {
	if req.Title == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.InsertProduction(ctx, actor, req)
}

func (s *Service) UpdateProduction(ctx context.Context, actor, id string, req UpdateProductionRequest) (*Production, error) {
	if req.Status != "" && req.Status != ProdActive && req.Status != ProdDone && req.Status != ProdBlocked {
		return nil, ErrInvalidInput
	}
	return s.repo.UpdateProduction(ctx, actor, id, req)
}

// AdvanceProduction runs the guarded script→storyboard→shoot→edit→qa→publish move.
func (s *Service) AdvanceProduction(ctx context.Context, actor, id string, to ProductionStage) (*Production, error) {
	if !validStage(to) {
		return nil, ErrInvalidInput
	}
	return s.repo.AdvanceProduction(ctx, actor, id, to)
}

// BlockProduction moves a production card to the blocked status (active→blocked),
// reusing the guarded production state machine + audit pattern.
func (s *Service) BlockProduction(ctx context.Context, actor, id string) (*Production, error) {
	return s.repo.BlockProduction(ctx, actor, id)
}

func (s *Service) GetProduction(ctx context.Context, id string) (*Production, error) {
	return s.repo.GetProduction(ctx, id)
}

func (s *Service) ListProductions(ctx context.Context, f ProductionFilter) ([]Production, error) {
	return s.repo.ListProductions(ctx, f)
}

// ── Localizations ────────────────────────────────────────────────────────────────

func (s *Service) UpsertLocalization(ctx context.Context, actor string, req UpsertLocalizationRequest) (*Localization, error) {
	if req.EntityType == "" || req.EntityID == "" || req.Lang == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.UpsertLocalization(ctx, actor, req)
}

func (s *Service) ListLocalizations(ctx context.Context, entityType, entityID string) ([]Localization, error) {
	return s.repo.ListLocalizations(ctx, entityType, entityID)
}

func (s *Service) DeleteLocalization(ctx context.Context, actor, entityType, entityID, lang string) error {
	if entityType == "" || entityID == "" || lang == "" {
		return ErrInvalidInput
	}
	return s.repo.DeleteLocalization(ctx, actor, entityType, entityID, lang)
}
