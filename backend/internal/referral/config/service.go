// Package config manages the singleton referral_config row (attribution window,
// grace window, fallback chain, house account code, budget-neutral and welcome
// reward toggles). All money/attribution tunables live here — never hard-coded.
package config

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Config is the referral engine's singleton configuration.
type Config struct {
	AttributionWindowHours int      `json:"attribution_window_hours"`
	GraceWindowHours       int      `json:"grace_window_hours"`
	FallbackChain          []string `json:"fallback_chain"`
	HouseAccountCode       string   `json:"house_account_code"`
	BudgetNeutral          bool     `json:"budget_neutral"`
	WelcomeRewardEnabled   bool     `json:"welcome_reward_enabled"`
}

// Defaults mirror the migration seed; used when the row is somehow absent.
func Defaults() Config {
	return Config{
		AttributionWindowHours: 72,
		GraceWindowHours:       72,
		FallbackChain:          []string{"code", "deeplink", "context", "regional_house", "global_house"},
		HouseAccountCode:       "SPOT-HOUSE",
		BudgetNeutral:          true,
		WelcomeRewardEnabled:   false,
	}
}

// Service reads and updates the singleton referral_config row.
type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

// Get returns the singleton config, falling back to defaults if no row exists.
func (s *Service) Get(ctx context.Context) (Config, error) {
	const q = `
		SELECT attribution_window_hours, grace_window_hours, fallback_chain,
		       house_account_code, budget_neutral, welcome_reward_enabled
		FROM referral_config
		WHERE id = true`
	var c Config
	var chainRaw []byte
	err := s.db.QueryRow(ctx, q).Scan(
		&c.AttributionWindowHours, &c.GraceWindowHours, &chainRaw,
		&c.HouseAccountCode, &c.BudgetNeutral, &c.WelcomeRewardEnabled)
	if err == pgx.ErrNoRows {
		return Defaults(), nil
	}
	if err != nil {
		return Config{}, fmt.Errorf("referral/config: get: %w", err)
	}
	if len(chainRaw) > 0 {
		_ = json.Unmarshal(chainRaw, &c.FallbackChain)
	}
	if len(c.FallbackChain) == 0 {
		c.FallbackChain = Defaults().FallbackChain
	}
	return c, nil
}

// Update upserts the singleton config row and returns the persisted value.
func (s *Service) Update(ctx context.Context, c Config) (Config, error) {
	chainRaw, err := json.Marshal(c.FallbackChain)
	if err != nil {
		return Config{}, fmt.Errorf("referral/config: marshal chain: %w", err)
	}
	const q = `
		INSERT INTO referral_config
			(id, attribution_window_hours, grace_window_hours, fallback_chain,
			 house_account_code, budget_neutral, welcome_reward_enabled, updated_at)
		VALUES (true, $1, $2, $3, $4, $5, $6, now())
		ON CONFLICT (id) DO UPDATE SET
			attribution_window_hours = EXCLUDED.attribution_window_hours,
			grace_window_hours       = EXCLUDED.grace_window_hours,
			fallback_chain           = EXCLUDED.fallback_chain,
			house_account_code       = EXCLUDED.house_account_code,
			budget_neutral           = EXCLUDED.budget_neutral,
			welcome_reward_enabled   = EXCLUDED.welcome_reward_enabled,
			updated_at               = now()`
	if _, err := s.db.Exec(ctx, q,
		c.AttributionWindowHours, c.GraceWindowHours, chainRaw,
		c.HouseAccountCode, c.BudgetNeutral, c.WelcomeRewardEnabled); err != nil {
		return Config{}, fmt.Errorf("referral/config: update: %w", err)
	}
	return s.Get(ctx)
}
