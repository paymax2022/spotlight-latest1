package repo

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/arena/service"
)

// CompetitionRepo persists competitions, immutable config versions and
// authorized scoring adapters.
type CompetitionRepo struct{ pool *pgxpool.Pool }

// NewCompetitionRepo builds the competition repo.
func NewCompetitionRepo(pool *pgxpool.Pool) *CompetitionRepo { return &CompetitionRepo{pool: pool} }

var _ service.CompetitionRepo = (*CompetitionRepo)(nil)

// Create makes a new DRAFT competition.
func (r *CompetitionRepo) Create(ctx context.Context, slug, name, timezone, createdBy string) (*service.Competition, error) {
	var c service.Competition
	err := r.pool.QueryRow(ctx, `
		INSERT INTO arena_competition (slug, name, timezone, created_by)
		VALUES ($1,$2,$3, NULLIF($4,'')::uuid)
		RETURNING id, slug, name, status, timezone, config_version`,
		slug, name, timezone, createdBy).
		Scan(&c.ID, &c.Slug, &c.Name, &c.Status, &c.Timezone, &c.ConfigVersion)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, service.ErrConflict
		}
		return nil, err
	}
	return &c, nil
}

// Get returns a competition by id.
func (r *CompetitionRepo) Get(ctx context.Context, id string) (*service.Competition, error) {
	var c service.Competition
	err := r.pool.QueryRow(ctx, `
		SELECT id, slug, name, status, timezone, config_version
		  FROM arena_competition WHERE id = $1`, id).
		Scan(&c.ID, &c.Slug, &c.Name, &c.Status, &c.Timezone, &c.ConfigVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, service.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// List returns competitions (public catalogue).
func (r *CompetitionRepo) List(ctx context.Context, limit, offset int) ([]service.Competition, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, slug, name, status, timezone, config_version
		  FROM arena_competition
		 ORDER BY created_at DESC
		 LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []service.Competition{}
	for rows.Next() {
		var c service.Competition
		if err := rows.Scan(&c.ID, &c.Slug, &c.Name, &c.Status, &c.Timezone, &c.ConfigVersion); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// PublishConfig writes a new immutable config version and bumps config_version
// atomically. Extra config knobs (KYC gate, merit cuts, play-along, pot rules)
// are folded into the rails JSON under a reserved "_arena" key so the additive
// schema is preserved (no new columns needed).
func (r *CompetitionRepo) PublishConfig(ctx context.Context, competitionID, publishedBy string, cfg service.Config) (int, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	var next int
	err = tx.QueryRow(ctx, `
		SELECT config_version + 1 FROM arena_competition WHERE id = $1 FOR UPDATE`, competitionID).Scan(&next)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, service.ErrNotFound
	}
	if err != nil {
		return 0, err
	}

	rails := cfg.Rails
	if rails == nil {
		rails = map[string]any{}
	}
	// Fold the scalar gates into the rails JSON under a reserved key.
	rails["_arena"] = map[string]any{
		"required_kyc_tier":          cfg.RequiredKYCTier,
		"qualify_top_n":              cfg.QualifyTopN,
		"finalist_top_n":             cfg.FinalistTopN,
		"playalong_threshold":        cfg.PlayAlongThreshold,
		"playalong_cashback_kobo":    cfg.PlayAlongCashbackKobo,
		"playalong_cashback_per_day": cfg.PlayAlongCashbackPerDay,
		"pot_approvals_required":     cfg.PotApprovalsRequired,
	}
	// Pass native maps; pgx encodes them to jsonb via encoding/json.
	if _, err := tx.Exec(ctx, `
		INSERT INTO arena_competition_config
			(competition_id, version, rails, awards, rubric_versions, published_by)
		VALUES ($1,$2,$3,$4,$5, NULLIF($6,'')::uuid)`,
		competitionID, next, rails, orEmptyMap(cfg.Awards), orEmptyMap(cfg.RubricVersions), publishedBy); err != nil {
		if isUniqueViolation(err) {
			return 0, service.ErrConflict
		}
		return 0, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE arena_competition SET config_version = $2, updated_at = now() WHERE id = $1`,
		competitionID, next); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return next, nil
}

// CurrentConfig returns the latest published config for a competition.
func (r *CompetitionRepo) CurrentConfig(ctx context.Context, competitionID string) (*service.Config, error) {
	var (
		version   int
		railsRaw  []byte
		awardsRaw []byte
		rubricRaw []byte
	)
	err := r.pool.QueryRow(ctx, `
		SELECT version, rails, awards, rubric_versions
		  FROM arena_competition_config
		 WHERE competition_id = $1
		 ORDER BY version DESC LIMIT 1`, competitionID).
		Scan(&version, &railsRaw, &awardsRaw, &rubricRaw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, service.ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	cfg := service.Config{CompetitionID: competitionID, Version: version}
	var rails map[string]any
	_ = json.Unmarshal(railsRaw, &rails)
	if rails != nil {
		if inner, ok := rails["_arena"].(map[string]any); ok {
			cfg.RequiredKYCTier = jsonInt(inner["required_kyc_tier"])
			cfg.QualifyTopN = jsonInt(inner["qualify_top_n"])
			cfg.FinalistTopN = jsonInt(inner["finalist_top_n"])
			cfg.PlayAlongThreshold = jsonInt(inner["playalong_threshold"])
			cfg.PlayAlongCashbackKobo = int64(jsonInt(inner["playalong_cashback_kobo"]))
			cfg.PlayAlongCashbackPerDay = jsonInt(inner["playalong_cashback_per_day"])
			cfg.PotApprovalsRequired = jsonInt(inner["pot_approvals_required"])
		}
		delete(rails, "_arena")
	}
	cfg.Rails = rails
	_ = json.Unmarshal(awardsRaw, &cfg.Awards)
	_ = json.Unmarshal(rubricRaw, &cfg.RubricVersions)
	return &cfg, nil
}

// RegisterAdapter authorizes a scoring adapter (stores its public key). Only
// adapters registered here can produce a verifiable merit entry (NDC-2).
func (r *CompetitionRepo) RegisterAdapter(ctx context.Context, competitionID string, a service.AuthorizedAdapter) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO arena_authorized_adapter (competition_id, adapter_id, source_type, public_key, active)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (competition_id, adapter_id)
		DO UPDATE SET source_type = EXCLUDED.source_type,
		              public_key  = EXCLUDED.public_key,
		              active      = EXCLUDED.active`,
		competitionID, a.AdapterID, a.SourceType, a.PublicKey, a.Active)
	return err
}

func orEmptyMap(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}

// jsonInt coerces a JSON-decoded numeric (float64) into an int, tolerating nil.
func jsonInt(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	default:
		return 0
	}
}
