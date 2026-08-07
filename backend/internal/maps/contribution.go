package maps

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// contribution.go — the PUBLIC, NON-PII OSM contribution loop (MAPSERVICE.md §7).
//
// Two streams must NEVER mix:
//  1. Internal, PII-bearing confirmed locations → the PrivateGazetteer ONLY (MS-4).
//     This file does NOT touch gazetteer PII.
//  2. Public, NON-PII improvements (road geometry, bus-stops, landmarks, POIs,
//     building footprints, area/road names) → queued here as ContributionCandidates,
//     human-reviewed in admin, then uploaded to OSM via a moderated, rate-limited
//     pipeline (osm_pipeline.go).
//
// Iron rule (MS-4, ODbL): NO PII ever lands in map_contribution_candidate. This is
// enforced twice — defence in depth — by (a) the stripPII whitelist/denylist that
// scrubs GeoJSON `properties` before insert, and (b) the PIIStripped gate that
// refuses any candidate that was not run through StripPII.

// pii-bearing keys that may NEVER reach OSM. Denylist is authoritative: any property
// key whose lowercased name contains one of these fragments is dropped outright,
// regardless of value. These capture personal names, contact details, customer /
// account identifiers, and unit-level address fragments ("X's house", apt/unit/door).
var piiDenyFragments = []string{
	"phone", "tel", "mobile", "whatsapp", "email", "contact",
	"customer", "client", "account", "user", "owner", "resident", "occupant",
	"house", "household", "home", "apartment", "apt", "flat", "unit", "door",
	"firstname", "first_name", "lastname", "last_name", "surname", "fullname", "full_name",
	"person", "individual", "ssn", "nin", "bvn", "passport", "id_number", "idnumber",
	"dob", "birth", "gender", "next_of_kin", "kin",
	"recipient", "addressee", "buyer", "seller", "tenant", "landlord",
}

// OSM-safe whitelist: only these property keys (exact, lowercased) survive scrubbing.
// `name` is intentionally NOT global — it is allowed only for road/area/landmark/POI
// types and only via the type-aware filter in stripPIIForType, never for an
// address/house/unit candidate. Everything not on this list is dropped (closed world).
var osmSafeKeys = map[string]bool{
	"highway":          true,
	"amenity":          true,
	"building":         true,
	"public_transport": true,
	"bus":              true,
	"railway":          true,
	"shop":             true,
	"leisure":          true,
	"landuse":          true,
	"natural":          true,
	"barrier":          true,
	"surface":          true,
	"lanes":            true,
	"oneway":           true,
	"maxspeed":         true,
	"ref":              true,
	"network":          true,
	"operator":         true,
	"layer":            true,
	"bridge":           true,
	"tunnel":           true,
	"access":           true,
	"service":          true,
	"foot":             true,
	"bicycle":          true,
	"wheelchair":       true,
	"covered":          true,
	"shelter":          true,
	"bench":            true,
	"tourism":          true,
	"office":           true,
	"craft":            true,
	"place":            true, // for area_name (city/town/suburb/neighbourhood)
}

// typesAllowingName is the set of candidate types where a feature `name` is a
// generic place/road/area/landmark name (OSM-safe) rather than a person/customer
// name. Address/house/unit candidates are deliberately absent — they never carry name.
var typesAllowingName = map[string]bool{
	"road":      true,
	"area_name": true,
	"landmark":  true,
	"poi":       true,
	"bus_stop":  true,
}

// stripPII is the PURE, type-agnostic scrub: drop every denylisted key and keep
// only OSM-safe whitelisted keys. `name` is dropped here (the type-aware wrapper
// stripPIIForType re-admits it only for name-bearing public types). Kept pure and
// allocation-clean so it is trivially unit-testable (no DB, no I/O).
func stripPII(props map[string]any) map[string]any {
	out := make(map[string]any, len(props))
	for k, v := range props {
		lk := strings.ToLower(strings.TrimSpace(k))
		if lk == "" {
			continue
		}
		if isDeniedKey(lk) {
			continue // hard PII — never survives
		}
		if !osmSafeKeys[lk] {
			continue // closed-world whitelist: unknown keys are dropped
		}
		out[lk] = v
	}
	return out
}

// stripPIIForType applies stripPII and then conditionally re-admits a generic
// `name` ONLY for public name-bearing types (road/area/landmark/poi/bus_stop),
// after confirming the name field itself is not denylisted by construction.
func stripPIIForType(props map[string]any, candidateType string) map[string]any {
	out := stripPII(props)
	if typesAllowingName[strings.ToLower(strings.TrimSpace(candidateType))] {
		if v, ok := props["name"]; ok {
			// "name" is a generic place/road name here; it is never an address-level
			// person/house name because address/house/unit types do not reach this branch.
			out["name"] = v
		}
	}
	return out
}

// isDeniedKey reports whether a (lowercased) property key contains any PII fragment.
func isDeniedKey(lk string) bool {
	for _, frag := range piiDenyFragments {
		if strings.Contains(lk, frag) {
			return true
		}
	}
	return false
}

// canContribTransition is the PURE guard for the candidate state machine:
//
//	pending  → approved | rejected
//	approved → uploaded
//
// rejected and uploaded are terminal. Everything else (incl. self-loops and
// backwards moves) is illegal. Kept pure for exhaustive unit testing.
func canContribTransition(from, to string) bool {
	switch from {
	case "pending":
		return to == "approved" || to == "rejected"
	case "approved":
		return to == "uploaded"
	default:
		return false
	}
}

// ContributionService manages the non-PII OSM contribution queue. All writes are
// parameterized; the geometry column is jsonb (we store the GeoJSON string).
type ContributionService struct {
	pool *pgxpool.Pool
}

// NewContributionService constructs the service against the financial-grade pgx pool.
func NewContributionService(pool *pgxpool.Pool) *ContributionService {
	return &ContributionService{pool: pool}
}

// Propose inserts a PENDING candidate after enforcing the no-PII contract.
//
// Enforcement (defence in depth):
//  1. The caller MUST have stripped PII; if c.PIIStripped == false we refuse.
//  2. We independently re-run StripPII over the GeoJSON `properties` (whitelist
//     only) so even a mislabelled PIIStripped flag cannot leak PII into the table.
//
// Returns the new candidate id.
func (s *ContributionService) Propose(ctx context.Context, c ContributionCandidate) (string, error) {
	if c.PIIStripped == false {
		return "", fmt.Errorf("maps: contribution refused — PII not stripped (PIIStripped=false); run StripPII first")
	}
	if strings.TrimSpace(c.Geometry) == "" {
		return "", fmt.Errorf("maps: contribution refused — empty geometry")
	}
	if strings.TrimSpace(c.Type) == "" {
		return "", fmt.Errorf("maps: contribution refused — missing type")
	}

	// Re-scrub the geometry's properties server-side regardless of the flag.
	scrubbed, err := s.StripPII(c.Geometry, c.Type)
	if err != nil {
		return "", fmt.Errorf("maps: contribution refused — geometry scrub failed: %w", err)
	}

	h3 := c.H3Cell
	const q = `
		INSERT INTO map_contribution_candidate (h3, geometry, type, pii_stripped, status, created_at)
		VALUES ($1, $2::jsonb, $3, true, 'pending', now())
		RETURNING id`
	var id string
	if err := s.pool.QueryRow(ctx, q, h3, scrubbed, c.Type).Scan(&id); err != nil {
		return "", fmt.Errorf("maps: insert contribution candidate: %w", err)
	}
	return id, nil
}

// StripPII scrubs the GeoJSON `properties` object using the type-aware whitelist and
// returns the re-serialized, PII-free GeoJSON. It accepts either a Feature
// (object with a "properties" member) or a bare properties object; anything else
// is passed through with no properties (geometry-only). Always sets the result to
// a state where PIIStripped can safely be marked true.
func (s *ContributionService) StripPII(geometry, candidateType string) (string, error) {
	var raw map[string]any
	if err := json.Unmarshal([]byte(geometry), &raw); err != nil {
		return "", fmt.Errorf("invalid GeoJSON: %w", err)
	}

	// Case 1: a GeoJSON Feature — scrub its "properties" in place, keep geometry.
	if props, ok := raw["properties"].(map[string]any); ok {
		raw["properties"] = stripPIIForType(props, candidateType)
		out, err := json.Marshal(raw)
		if err != nil {
			return "", err
		}
		return string(out), nil
	}

	// Case 2: a bare properties bag (no geometry/feature wrapper) — scrub directly.
	if _, hasType := raw["type"]; !hasType {
		scrubbed := stripPIIForType(raw, candidateType)
		out, err := json.Marshal(scrubbed)
		if err != nil {
			return "", err
		}
		return string(out), nil
	}

	// Case 3: a geometry-only object (e.g. {"type":"LineString",...}) with no
	// properties — nothing to scrub, return as-is.
	out, err := json.Marshal(raw)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// ListForReview returns candidates in a given status, newest first.
func (s *ContributionService) ListForReview(ctx context.Context, status string, limit int) ([]ContributionCandidate, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	const q = `
		SELECT id, h3, geometry::text, type, pii_stripped, status,
		       COALESCE(reviewer_id::text, ''), created_at
		FROM map_contribution_candidate
		WHERE status = $1
		ORDER BY created_at DESC
		LIMIT $2`
	rows, err := s.pool.Query(ctx, q, status, limit)
	if err != nil {
		return nil, fmt.Errorf("maps: list contributions: %w", err)
	}
	defer rows.Close()
	return scanCandidates(rows)
}

// Review applies a guarded pending→approved|rejected transition, recording the
// reviewer, decision time and notes. action must be "approve" or "reject".
func (s *ContributionService) Review(ctx context.Context, id, reviewerID, action, notes string) (ContributionCandidate, error) {
	var to string
	switch action {
	case "approve":
		to = "approved"
	case "reject":
		to = "rejected"
	default:
		return ContributionCandidate{}, fmt.Errorf("maps: invalid review action %q (want approve|reject)", action)
	}
	if !canContribTransition("pending", to) { // defensive; always true here
		return ContributionCandidate{}, fmt.Errorf("maps: illegal transition pending->%s", to)
	}
	if strings.TrimSpace(reviewerID) == "" {
		return ContributionCandidate{}, fmt.Errorf("maps: reviewer_id required")
	}

	// Guard the transition in SQL: only flip rows that are still 'pending'.
	const q = `
		UPDATE map_contribution_candidate
		SET status = $2, reviewer_id = $3, notes = $4, decided_at = now()
		WHERE id = $1 AND status = 'pending'
		RETURNING id, h3, geometry::text, type, pii_stripped, status,
		          COALESCE(reviewer_id::text, ''), created_at`
	row := s.pool.QueryRow(ctx, q, id, to, reviewerID, notes)
	c, err := scanCandidate(row)
	if err != nil {
		if err == pgx.ErrNoRows {
			return ContributionCandidate{}, fmt.Errorf("maps: candidate %s not in 'pending' state (already decided or missing)", id)
		}
		return ContributionCandidate{}, fmt.Errorf("maps: review candidate: %w", err)
	}
	return c, nil
}

// MarkUploaded applies the guarded approved→uploaded transition and records the
// OSM changeset id. Only an 'approved' row may be marked uploaded.
func (s *ContributionService) MarkUploaded(ctx context.Context, id, changesetID string) error {
	if !canContribTransition("approved", "uploaded") { // defensive; always true
		return fmt.Errorf("maps: illegal transition approved->uploaded")
	}
	if strings.TrimSpace(changesetID) == "" {
		return fmt.Errorf("maps: changeset_id required to mark uploaded")
	}
	const q = `
		UPDATE map_contribution_candidate
		SET status = 'uploaded', changeset_id = $2
		WHERE id = $1 AND status = 'approved'`
	ct, err := s.pool.Exec(ctx, q, id, changesetID)
	if err != nil {
		return fmt.Errorf("maps: mark uploaded: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("maps: candidate %s not in 'approved' state (cannot mark uploaded)", id)
	}
	return nil
}

// PendingApprovedForUpload returns approved-but-not-yet-uploaded candidates, oldest
// first, for the moderated OSM batch pipeline.
func (s *ContributionService) PendingApprovedForUpload(ctx context.Context, limit int) ([]ContributionCandidate, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `
		SELECT id, h3, geometry::text, type, pii_stripped, status,
		       COALESCE(reviewer_id::text, ''), created_at
		FROM map_contribution_candidate
		WHERE status = 'approved'
		ORDER BY created_at ASC
		LIMIT $1`
	rows, err := s.pool.Query(ctx, q, limit)
	if err != nil {
		return nil, fmt.Errorf("maps: list approved-for-upload: %w", err)
	}
	defer rows.Close()
	return scanCandidates(rows)
}

// --- scan helpers ---

type scannable interface {
	Scan(dest ...any) error
}

func scanCandidate(row scannable) (ContributionCandidate, error) {
	var c ContributionCandidate
	var created time.Time
	if err := row.Scan(&c.ID, &c.H3Cell, &c.Geometry, &c.Type, &c.PIIStripped, &c.Status, &c.ReviewerID, &created); err != nil {
		return ContributionCandidate{}, err
	}
	c.CreatedAt = created
	return c, nil
}

func scanCandidates(rows pgx.Rows) ([]ContributionCandidate, error) {
	var out []ContributionCandidate
	for rows.Next() {
		c, err := scanCandidate(rows)
		if err != nil {
			return nil, fmt.Errorf("maps: scan candidate: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}
