package maps

import (
	"context"
	"errors"
	"time"
)

// types_v2.go — the Nigeria-tuned, cost-aware MapService v2 layer (MAPSERVICE.md).
// Everything here is ADDITIVE and gated by FeatureMapsV2Enabled: when the flag is
// off the legacy resolve() path runs unchanged. The orchestrator (orchestrator.go)
// ties these collaborators into the resolution chain (§4); concrete implementations
// are provided by the swarm and injected via Deps (all nil-safe).

// ErrNeedsPin signals the caller/courier should drop a precise pin — returned on
// low confidence or provider outage. Never a hard failure (MS-6, §2 principle 7).
var ErrNeedsPin = errors.New("maps: NEEDS_PIN — confidence below floor, drop a pin")

// ResolutionEvent is the deterministic, auditable record of one resolution
// (MAPSERVICE.md §9, MS-7). Logged for the cost/coverage dashboard.
type ResolutionEvent struct {
	ID           string       `json:"id"`
	RequestType  string       `json:"request_type"` // geocode | reverse | autocomplete | route ...
	Surface      string       `json:"surface"`
	H3Cell       string       `json:"h3_cell"`
	Tier         CoverageTier `json:"tier"`
	ChosenSource string       `json:"chosen_source"` // gazetteer | cache | prediction | osm | google | here
	Provider     string       `json:"provider"`
	Confidence   Confidence   `json:"confidence"`
	Escalated    bool         `json:"escalated"`   // true if we moved past the cheap path
	CostUnit     int          `json:"cost_unit"`   // 0 for deflected, 1 per paid call
	OutcomePin   bool         `json:"outcome_pin"` // true if it ended in NEEDS_PIN
	UserID       string       `json:"user_id"`
	TS           time.Time    `json:"ts"`
}

// GazetteerEntry is a verified internal point (MAPSERVICE.md §6/§9). PII-bearing;
// stays internal, encrypted, access-logged — NEVER uploaded to OSM (MS-4).
type GazetteerEntry struct {
	ID             string
	H3Cell         string
	Lat, Lng       float64
	NormalizedAddr string
	Components      string // JSON address components
	Source         string // courier_pin | user_saved | property | estate | agent
	VerifiedBy     string // user id
	VerifiedAt     time.Time
	PlusCode       string
}

// ContributionCandidate is a non-PII improvement queued for the OSM public
// pipeline (MAPSERVICE.md §7). PII must be stripped before it ever lands here.
type ContributionCandidate struct {
	ID          string    `json:"id"`
	H3Cell      string    `json:"h3_cell"`
	Geometry    string    `json:"geometry"` // GeoJSON, non-PII
	Type        string    `json:"type"`     // road | bus_stop | landmark | poi | building | area_name
	PIIStripped bool      `json:"pii_stripped"`
	Status      string    `json:"status"` // pending | approved | rejected | uploaded
	ReviewerID  string    `json:"reviewer_id"`
	CreatedAt   time.Time `json:"created_at"`
}

// --- v2 collaborator interfaces (concrete impls provided by the swarm) ---

// GazetteerStore is the private, verified-points lookup checked FIRST (MS-2).
// All lookups/writes are access-logged; PII encrypted at rest (MS-4).
type GazetteerStore interface {
	// Lookup finds a verified point by normalized address within/near an H3 cell.
	Lookup(ctx context.Context, normalizedAddr, h3Cell string) (GeoResult, bool, error)
	// ReverseLookup finds a verified point near a coordinate's cell.
	ReverseLookup(ctx context.Context, h3Cell string, lat, lng float64) (GeoResult, bool, error)
	// Upsert records a confirmed location (courier pin, saved place, …).
	Upsert(ctx context.Context, e GazetteerEntry) error
}

// CoverageIndex decides provider order per area and self-improves from outcomes.
type CoverageIndex interface {
	// Tier returns the coverage tier for an H3 cell (default FAIR if unknown).
	Tier(ctx context.Context, h3Cell string) CoverageTier
	// Observe records a resolution outcome to evolve the tier over time
	// (escalations demote; confirmed pins / cheap successes promote).
	Observe(ctx context.Context, h3Cell, chosenSource string, escalated bool, conf Confidence) error
}

// Predictor deflects paid calls using the user's own history (MAPSERVICE.md §6).
type Predictor interface {
	Predict(ctx context.Context, userID, normalizedAddr string, near *Point) (GeoResult, bool, error)
}

// ResolutionRecorder persists ResolutionEvents for audit + the dashboard (MS-7).
type ResolutionRecorder interface {
	Record(ctx context.Context, e ResolutionEvent) error
}

// ProviderGuard enforces cost guardrails + circuit breaking (MS-6, §10).
type ProviderGuard interface {
	// Allow reports whether a provider may be called now (circuit closed + under budget).
	Allow(ctx context.Context, provider string, prim Primitive) bool
	// Observe records the outcome of a provider call (for breaker + health).
	Observe(ctx context.Context, provider string, ok bool, latencyMs int64)
}

// --- nil-safe defaults so the orchestrator runs before the swarm lands ---

type nopGazetteer struct{}

func (nopGazetteer) Lookup(context.Context, string, string) (GeoResult, bool, error) {
	return GeoResult{}, false, nil
}
func (nopGazetteer) ReverseLookup(context.Context, string, float64, float64) (GeoResult, bool, error) {
	return GeoResult{}, false, nil
}
func (nopGazetteer) Upsert(context.Context, GazetteerEntry) error { return nil }

type nopCoverage struct{}

func (nopCoverage) Tier(context.Context, string) CoverageTier { return TierFair }
func (nopCoverage) Observe(context.Context, string, string, bool, Confidence) error {
	return nil
}

type nopPredictor struct{}

func (nopPredictor) Predict(context.Context, string, string, *Point) (GeoResult, bool, error) {
	return GeoResult{}, false, nil
}

type nopRecorder struct{}

func (nopRecorder) Record(context.Context, ResolutionEvent) error { return nil }

type allowGuard struct{}

func (allowGuard) Allow(context.Context, string, Primitive) bool       { return true }
func (allowGuard) Observe(context.Context, string, bool, int64)        {}
