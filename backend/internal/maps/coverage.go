package maps

import (
	"context"
	"errors"
	"log"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// coverage.go — the self-improving CoverageIndex (MAPSERVICE.md §5).
//
// Each H3 coverage cell carries a tier (GOOD/FAIR/LOW) that drives the per-area
// provider order (config_v2.go ProviderOrder). The tier evolves from observed
// outcomes: areas that keep forcing us past the cheap OSM path (high escalation
// rate) get demoted toward LOW (so accuracy providers go first); areas with many
// confirmed gazetteer pins and low escalation get promoted toward GOOD.
//
// All writes are BEST-EFFORT (MS-6 — degrade, never hard-fail). A coverage write
// failing must never block a resolution: callers ignore the error in practice and
// the orchestrator injects this via a nil-safe interface.

// Coverage is the pgx-backed CoverageIndex.
type Coverage struct {
	pool *pgxpool.Pool
}

// NewCoverage builds a CoverageIndex over map_coverage_cell.
func NewCoverage(pool *pgxpool.Pool) *Coverage { return &Coverage{pool: pool} }

// compile-time interface assertion.
var _ CoverageIndex = (*Coverage)(nil)

// --- tier derivation (pure, unit-testable) -------------------------------

// Tuning constants for deriveTier. Kept package-level so tests document the rules.
const (
	// minTierSamples is the floor of observations before we trust a derived tier;
	// below this we hold at FAIR (the safe default) regardless of signal.
	minTierSamples = 5
	// demoteEscalationRate: escalation above this demotes the cell toward LOW —
	// the cheap path keeps failing here, so lead with accuracy providers.
	demoteEscalationRate = 0.50
	// promoteEscalationRate: escalation at/under this (with enough pins) promotes
	// toward GOOD — the cheap/OSM path is reliably winning here.
	promoteEscalationRate = 0.20
	// promotePinCount: confirmed gazetteer pins needed to vouch for an area.
	promotePinCount = 3
)

// deriveTier is the pure decision function for a cell's coverage tier. It maps
// the rolling escalation rate, confirmed-pin count, and sample size onto a tier.
//
// Rules (MAPSERVICE.md §5):
//   - Too few samples            → FAIR (default; don't over-fit on noise).
//   - escalationRate > 0.50      → LOW  (cheap path keeps failing → accuracy first).
//   - escalationRate <= 0.20 AND pins >= 3 → GOOD (cheap path reliably wins).
//   - otherwise                  → FAIR.
func deriveTier(escalationRate float64, pinCount, sampleCount int64) CoverageTier {
	if sampleCount < minTierSamples {
		return TierFair
	}
	if escalationRate > demoteEscalationRate {
		return TierLow
	}
	if escalationRate <= promoteEscalationRate && pinCount >= promotePinCount {
		return TierGood
	}
	return TierFair
}

// --- CoverageIndex implementation ----------------------------------------

// Tier returns the coverage tier for an H3 cell. If the fine cell has no row it
// rolls up to the parent cell (CellParent) before falling back to FAIR. Read
// errors degrade to FAIR (never block — MS-6).
func (c *Coverage) Tier(ctx context.Context, h3Cell string) CoverageTier {
	if c == nil || c.pool == nil || h3Cell == "" {
		return TierFair
	}
	if tier, ok := c.tierFor(ctx, h3Cell); ok {
		return tier
	}
	// Roll up one level: a known parent neighborhood informs an unseen fine cell.
	if parent := CellParent(h3Cell); parent != "" && parent != h3Cell {
		if tier, ok := c.tierFor(ctx, parent); ok {
			return tier
		}
	}
	return TierFair
}

// tierFor reads a single cell's tier; ok=false on miss or transient error.
func (c *Coverage) tierFor(ctx context.Context, h3 string) (CoverageTier, bool) {
	const q = `SELECT tier FROM map_coverage_cell WHERE h3 = $1`
	var tier string
	if err := c.pool.QueryRow(ctx, q, h3).Scan(&tier); err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			log.Printf("[maps] coverage tier read %q: %v", h3, err)
		}
		return "", false
	}
	switch CoverageTier(tier) {
	case TierGood, TierFair, TierLow:
		return CoverageTier(tier), true
	default:
		return TierFair, true
	}
}

// Observe records one resolution outcome against a cell and re-derives its tier.
//
// It UPSERTs the cell, increments sample_count, recomputes a rolling escalation
// rate (escalated calls / samples), bumps pin_count when a confirmed gazetteer
// point was chosen (chosenSource == "gazetteer" with confidence >= 1.0), then
// re-derives the tier from those signals. Best-effort: errors are logged and
// swallowed so a coverage write never blocks a request (MS-6).
func (c *Coverage) Observe(ctx context.Context, h3Cell, chosenSource string, escalated bool, conf Confidence) error {
	if c == nil || c.pool == nil || h3Cell == "" {
		return nil
	}
	escInc := 0
	if escalated {
		escInc = 1
	}
	pinInc := 0
	if chosenSource == "gazetteer" && conf >= 1.0 {
		pinInc = 1
	}

	// Single round-trip: upsert + recompute the rolling escalation rate and tier
	// inside SQL so concurrent observers stay consistent (rate = escalations/samples).
	// We track escalations implicitly via escalation_rate*sample_count to avoid a
	// dedicated counter column (additive-only migration constraint).
	const q = `
		INSERT INTO map_coverage_cell (h3, tier, escalation_rate, sample_count, pin_count, last_eval_at)
		VALUES ($1, $2, $3, 1, $4, now())
		ON CONFLICT (h3) DO UPDATE SET
			sample_count    = map_coverage_cell.sample_count + 1,
			pin_count       = map_coverage_cell.pin_count + $4,
			escalation_rate = (
				map_coverage_cell.escalation_rate * map_coverage_cell.sample_count + $5
			) / (map_coverage_cell.sample_count + 1),
			last_eval_at    = now(),
			tier            = map_coverage_cell.tier -- placeholder; re-derived below
		RETURNING escalation_rate, pin_count, sample_count`
	// Seed tier for a brand-new row from the single observation we have.
	seedTier := deriveTier(float64(escInc), int64(pinInc), 1)

	var (
		rate    float64
		pins    int64
		samples int64
	)
	err := c.pool.QueryRow(ctx, q, h3Cell, string(seedTier), float64(escInc), pinInc, escInc).
		Scan(&rate, &pins, &samples)
	if err != nil {
		log.Printf("[maps] coverage observe %q: %v", h3Cell, err)
		return nil // best-effort: never block the request
	}

	// Re-derive tier from the freshly aggregated signals and persist if changed.
	newTier := deriveTier(rate, pins, samples)
	const upd = `UPDATE map_coverage_cell SET tier = $2, last_eval_at = now() WHERE h3 = $1 AND tier <> $2`
	if _, err := c.pool.Exec(ctx, upd, h3Cell, string(newTier)); err != nil {
		log.Printf("[maps] coverage tier update %q: %v", h3Cell, err)
	}
	return nil
}

// --- seeding -------------------------------------------------------------

// seedCell is a starting coverage cell for SeedLagos.
type seedCell struct {
	name     string
	lat, lng float64
	tier     CoverageTier
}

// lagosSeeds are well-known Lagos areas with hand-set starting tiers: the mapped
// islands/CBDs start GOOD/FAIR; informal high-density areas start LOW so we lead
// with accuracy providers there until observations refine the tier.
var lagosSeeds = []seedCell{
	{"Ikeja", 6.6018, 3.3515, TierGood},
	{"Lekki", 6.4698, 3.5852, TierFair},
	{"Victoria Island", 6.4281, 3.4219, TierGood},
	{"Yaba", 6.5095, 3.3711, TierFair},
	{"Surulere", 6.4999, 3.3543, TierFair},
	{"Ajegunle", 6.4566, 3.3330, TierLow}, // informal/high-density → LOW
}

// SeedLagos inserts a handful of Lagos coverage cells with sensible starting
// tiers. Idempotent: existing cells are left untouched (ON CONFLICT DO NOTHING),
// so it can run on every boot without clobbering learned tiers.
func (c *Coverage) SeedLagos(ctx context.Context) error {
	if c == nil || c.pool == nil {
		return nil
	}
	const q = `
		INSERT INTO map_coverage_cell (h3, tier, sample_count, pin_count, last_eval_at)
		VALUES ($1, $2, 0, 0, now())
		ON CONFLICT (h3) DO NOTHING`
	for _, s := range lagosSeeds {
		cell := CellKey(s.lat, s.lng)
		if _, err := c.pool.Exec(ctx, q, cell, string(s.tier)); err != nil {
			log.Printf("[maps] seed lagos %s (%s): %v", s.name, cell, err)
		}
	}
	return nil
}
