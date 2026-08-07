package platform

// feature_flags.go — REAL runtime feature-flag store for the academy phase flags
// (SU-10). Replaces the documented NO-OP placeholder: flag state is now persisted in
// public.academy_feature_flags and consulted at startup by the composition root
// (RegisterAcademy) with the compile-time boolean as a FAIL-CLOSED fallback.
//
// Authorization + audit: the admin toggle is RBAC-gated (platform_edtech_admin, at the
// route group) and every SetFlag appends an immutable academy_commerce_audit row in the
// same transaction — the same append-only trail SU-11 reads. No money path; no ledger.

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// Canonical flag keys. These MUST match the seed rows in
// 20260924000000_academy_feature_flags.sql and the compile-time booleans wired in
// academy_routes.go (RegisterAcademy).
const (
	FlagExam        = "academy.exam"
	FlagSpine       = "academy.spine"
	FlagEduPay      = "academy.edupay"
	FlagCredentials = "academy.credentials"
	FlagLive        = "academy.live"
	FlagSchools     = "academy.schools"
	FlagTutor       = "academy.tutor"
	FlagFees        = "academy.fees"
)

// FeatureFlag is a persisted runtime feature flag. enabled is authoritative when a row
// exists; a MISSING row means "no override" and the caller falls back to the compile-time
// default (fail-closed — the store never silently enables).
type FeatureFlag struct {
	Key         string
	Enabled     bool
	Description string
	UpdatedBy   string
	UpdatedAt   time.Time
	CreatedAt   time.Time
}

// ── Repo data access ──────────────────────────────────────────────────────────

// GetFlag returns the stored enabled value for key, or (nil, nil) when no row exists
// (the caller falls back to the compile-time default — fail-closed).
func (r *Repo) GetFlag(ctx context.Context, key string) (*bool, error) {
	var enabled bool
	err := r.pool.QueryRow(ctx,
		`SELECT enabled FROM public.academy_feature_flags WHERE key = $1`, key).Scan(&enabled)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &enabled, nil
}

// ListFeatureFlags returns every persisted runtime flag in key order.
func (r *Repo) ListFeatureFlags(ctx context.Context) ([]FeatureFlag, error) {
	const q = `
SELECT key, enabled, COALESCE(description,''), COALESCE(updated_by::text,''), updated_at, created_at
FROM public.academy_feature_flags
ORDER BY key`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]FeatureFlag, 0, 8)
	for rows.Next() {
		var f FeatureFlag
		if err := rows.Scan(&f.Key, &f.Enabled, &f.Description, &f.UpdatedBy, &f.UpdatedAt, &f.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// SetFlag upserts a runtime flag and appends an immutable academy_commerce_audit row in
// the SAME transaction (atomic: no toggle without its audit trail). actorID is the
// authenticated platform operator (RBAC platform_edtech_admin). Returns the resulting row.
func (r *Repo) SetFlag(ctx context.Context, key string, enabled bool, actorID string) (FeatureFlag, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return FeatureFlag{}, err
	}
	defer tx.Rollback(ctx)

	var actor any
	if actorID != "" {
		actor = actorID
	}

	const ups = `
INSERT INTO public.academy_feature_flags (key, enabled, updated_by, updated_at)
VALUES ($1, $2, $3, now())
ON CONFLICT (key) DO UPDATE
  SET enabled    = EXCLUDED.enabled,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
RETURNING key, enabled, COALESCE(description,''), COALESCE(updated_by::text,''), updated_at, created_at`
	var f FeatureFlag
	if err := tx.QueryRow(ctx, ups, key, enabled, actor).Scan(
		&f.Key, &f.Enabled, &f.Description, &f.UpdatedBy, &f.UpdatedAt, &f.CreatedAt); err != nil {
		return FeatureFlag{}, err
	}

	// Append-only audit (same immutable trail SU-11 reads). academy_commerce_audit.entity_id
	// is uuid-typed, so the (text) flag key rides the detail payload; entity_id stays NULL.
	action := "academy.flag.disable"
	if enabled {
		action = "academy.flag.enable"
	}
	detail, _ := json.Marshal(map[string]any{"key": key, "enabled": enabled})
	const ins = `
INSERT INTO public.academy_commerce_audit (actor_id, action, entity_type, entity_id, detail)
VALUES ($1, $2, 'academy_feature_flag', NULL, $3)`
	if _, err := tx.Exec(ctx, ins, actor, action, detail); err != nil {
		return FeatureFlag{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return FeatureFlag{}, err
	}
	return f, nil
}

// ── Service ───────────────────────────────────────────────────────────────────

// FlagService is the platform runtime feature-flag service (SU-10). It wraps the repo so
// the handlers and the composition-root resolver share one code path.
type FlagService struct{ repo *Repo }

// NewFlagService builds the flag service over the platform repo.
func NewFlagService(repo *Repo) *FlagService { return &FlagService{repo: repo} }

// GetFlag returns the stored value for key (nil ⇒ no override; caller uses the default).
func (s *FlagService) GetFlag(ctx context.Context, key string) (*bool, error) {
	return s.repo.GetFlag(ctx, key)
}

// ListFlags returns every persisted runtime flag.
func (s *FlagService) ListFlags(ctx context.Context) ([]FeatureFlag, error) {
	return s.repo.ListFeatureFlags(ctx)
}

// SetFlag persists the requested enabled state (+ audit) for key by actorID.
func (s *FlagService) SetFlag(ctx context.Context, key string, enabled bool, actorID string) (FeatureFlag, error) {
	return s.repo.SetFlag(ctx, key, enabled, actorID)
}

// ── Composition-root resolver ───────────────────────────────────────────────────

// FlagResolver reads the store ONCE at startup and resolves effective values against the
// compile-time defaults. If the store read fails, overrides is nil and every Resolve
// returns the compile-time default (fail-closed — a store failure MUST NOT destabilize
// route registration or silently enable anything).
type FlagResolver struct {
	overrides map[string]bool // nil ⇒ store unavailable ⇒ all defaults
}

// NewFlagResolver reads the persisted flags once. On ANY error it returns a resolver with
// no overrides (every flag falls back to its compile-time default) PLUS the error, so the
// caller can log and continue. The returned *FlagResolver is always non-nil.
func NewFlagResolver(ctx context.Context, repo *Repo) (*FlagResolver, error) {
	if repo == nil {
		return &FlagResolver{}, nil
	}
	rows, err := repo.ListFeatureFlags(ctx)
	if err != nil {
		return &FlagResolver{}, err
	}
	m := make(map[string]bool, len(rows))
	for _, f := range rows {
		m[f.Key] = f.Enabled
	}
	return &FlagResolver{overrides: m}, nil
}

// Resolve returns the stored override for key when present, else compileDefault.
func (r *FlagResolver) Resolve(key string, compileDefault bool) bool {
	if r == nil || r.overrides == nil {
		return compileDefault
	}
	if v, ok := r.overrides[key]; ok {
		return v
	}
	return compileDefault
}
