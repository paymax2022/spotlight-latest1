// Package content is the Spotlight Academy Phase-2 CMS sub-package: the publish
// lifecycle for lessons + content bundles, the content-production pipeline tracker,
// and per-entity localizations.
//
// GOLDEN RULES enforced here (docs/prd/edtech state-machines.md §7, conventions.md):
//   - Guarded state machines. The publish lifecycle (draft→review→approved→live→
//     archived) for academy_lessons and academy_content_bundles only accepts listed
//     transitions; illegal ones are rejected with a stable code AND written to the
//     immutable public.audit_logs table.
//   - Publish transitions require the academy.content staff capability (RBAC) and
//     are audited. approved→live (re)packages the bundle manifest (offline bundles
//     re-package on approved→live).
//   - The content-production board (academy_content_productions) advances through a
//     guarded pipeline stage script→storyboard→shoot→edit→qa→publish.
//   - No money path here.
//
// Tables owned/managed: academy_lessons (status), academy_content_bundles
// (status, manifest), academy_content_productions, academy_localizations.
package content

import "time"

// ── Publish lifecycle ──────────────────────────────────────────────────────────

// PublishStatus mirrors the academy_lessons.status / academy_content_bundles.status
// CHECK (draft, review, approved, live, archived).
type PublishStatus string

const (
	StatusDraft    PublishStatus = "draft"
	StatusReview   PublishStatus = "review"
	StatusApproved PublishStatus = "approved"
	StatusLive     PublishStatus = "live"
	StatusArchived PublishStatus = "archived"
)

// ── Production pipeline ─────────────────────────────────────────────────────────

// ProductionStage mirrors academy_content_productions.stage CHECK.
type ProductionStage string

const (
	StageScript     ProductionStage = "script"
	StageStoryboard ProductionStage = "storyboard"
	StageShoot      ProductionStage = "shoot"
	StageEdit       ProductionStage = "edit"
	StageQA         ProductionStage = "qa"
	StagePublish    ProductionStage = "publish"
)

// ProductionStatus mirrors academy_content_productions.status CHECK.
type ProductionStatus string

const (
	ProdActive  ProductionStatus = "active"
	ProdDone    ProductionStatus = "done"
	ProdBlocked ProductionStatus = "blocked"
)

// ── Models ──────────────────────────────────────────────────────────────────────

// Lesson is one academy_edu_lessons row (subset relevant to the CMS publish surface).
type Lesson struct {
	ID          string        `json:"id"`
	ObjectiveID *string       `json:"objective_id,omitempty"`
	Title       string        `json:"title"`
	Type        string        `json:"type"`
	VersionID   *string       `json:"version_id,omitempty"`
	MediaRef    *string       `json:"media_ref,omitempty"`
	Transcript  *string       `json:"transcript,omitempty"`
	DurationS   int           `json:"duration_s"`
	Status      PublishStatus `json:"status"`
	CreatedAt   time.Time     `json:"created_at"`
	UpdatedAt   time.Time     `json:"updated_at"`
}

// ContentBundle is one academy_content_bundles row.
type ContentBundle struct {
	ID              string         `json:"id"`
	Name            string         `json:"name"`
	VersionID       *string        `json:"version_id,omitempty"`
	ArenaCode       *string        `json:"arena_code,omitempty"`
	SizeBudgetBytes int64          `json:"size_budget_bytes"`
	LessonIDs       []string       `json:"lesson_ids"`
	AccessCardMap   *string        `json:"access_card_mapping,omitempty"`
	Status          PublishStatus  `json:"status"`
	Manifest        map[string]any `json:"manifest"`
	CreatedAt       time.Time      `json:"created_at"`
}

// Production is one academy_content_productions row (the pipeline board card).
type Production struct {
	ID        string           `json:"id"`
	LessonID  *string          `json:"lesson_id,omitempty"`
	Title     string           `json:"title"`
	Stage     ProductionStage  `json:"stage"`
	OwnerID   *string          `json:"owner_id,omitempty"`
	SLADue    *time.Time       `json:"sla_due,omitempty"`
	Status    ProductionStatus `json:"status"`
	Notes     *string          `json:"notes,omitempty"`
	CreatedAt time.Time        `json:"created_at"`
	UpdatedAt time.Time        `json:"updated_at"`
}

// Localization is one academy_localizations row (UNIQUE entity_type, entity_id, lang).
type Localization struct {
	ID         string         `json:"id"`
	EntityType string         `json:"entity_type"`
	EntityID   string         `json:"entity_id"`
	Lang       string         `json:"lang"`
	Payload    map[string]any `json:"payload"`
	Status     string         `json:"status"`
	UpdatedAt  time.Time      `json:"updated_at"`
}

// ── Request DTOs ───────────────────────────────────────────────────────────────

// TransitionRequest — admin publish-transition body for a lesson or bundle.
type TransitionRequest struct {
	To PublishStatus `json:"to" binding:"required"` // target publish state
}

// CreateProductionRequest — admin POST /content/productions.
type CreateProductionRequest struct {
	LessonID *string    `json:"lesson_id,omitempty"`
	Title    string     `json:"title" binding:"required"`
	OwnerID  *string    `json:"owner_id,omitempty"`
	SLADue   *time.Time `json:"sla_due,omitempty"`
	Notes    *string    `json:"notes,omitempty"`
}

// UpdateProductionRequest — admin PUT /content/productions/:id (metadata; the
// pipeline stage is advanced via the dedicated /advance endpoint).
type UpdateProductionRequest struct {
	Title   *string          `json:"title,omitempty"`
	OwnerID *string          `json:"owner_id,omitempty"`
	SLADue  *time.Time       `json:"sla_due,omitempty"`
	Status  ProductionStatus `json:"status,omitempty"`
	Notes   *string          `json:"notes,omitempty"`
}

// AdvanceProductionRequest — admin POST /content/productions/:id/advance.
type AdvanceProductionRequest struct {
	To ProductionStage `json:"to" binding:"required"` // target pipeline stage
}

// UpsertLocalizationRequest — admin POST/PUT /content/localizations.
type UpsertLocalizationRequest struct {
	EntityType string         `json:"entity_type" binding:"required"`
	EntityID   string         `json:"entity_id" binding:"required"`
	Lang       string         `json:"lang" binding:"required"`
	Payload    map[string]any `json:"payload"`
	Status     string         `json:"status,omitempty"`
}

// ProductionFilter — list/filter query params for the board.
type ProductionFilter struct {
	Stage  string
	Status string
	Limit  int
	Offset int
}
