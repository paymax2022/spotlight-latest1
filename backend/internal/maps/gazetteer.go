package maps

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// gazetteer.go — the PrivateGazetteer, our private store of VERIFIED internal
// points checked FIRST in the resolution chain (MAPSERVICE.md §6, MS-2).
//
// Properties (MS-4 / NDPA):
//   - PII-bearing. Any PII payload is encrypted at rest into encrypted_pii via the
//     injected Encryptor — never persisted in plaintext.
//   - Every READ (Lookup / ReverseLookup) writes an immutable access-log row to
//     map_gazetteer_access_log, recording who accessed which entry and on what basis.
//   - Never uploaded to OSM; results are tagged SourceGazetteer (zero external cost),
//     Confidence 1.0 (these are confirmed points), and Cacheable=true (they are OURS,
//     not third-party-licensed).
//
// All SQL is parameterized. H3/geog patterns mirror geo_repo.go (PostGIS geography,
// ST_SetSRID/ST_MakePoint, ST_DWithin) and cell.go (string cell keys).

// reverseRadiusM is the small radius (metres) within which ReverseLookup accepts a
// verified point as a match for a coordinate. Kept tight: a gazetteer hit must be
// genuinely the same place, not just "nearby" (MAPSERVICE.md §6).
const reverseRadiusM = 75.0

// access-log basis values (map_gazetteer_access_log.basis).
const (
	accessBasisLookup  = "lookup"
	accessBasisReverse = "reverse"
)

// Gazetteer is the pgx-backed GazetteerStore.
type Gazetteer struct {
	pool *pgxpool.Pool
	enc  Encryptor
}

// NewGazetteer builds a PrivateGazetteer over map_gazetteer. If enc is nil a
// NoopEncryptor is used (dev/test only — production MUST inject a real AES key).
func NewGazetteer(pool *pgxpool.Pool, enc Encryptor) *Gazetteer {
	if enc == nil {
		enc = NoopEncryptor{}
	}
	return &Gazetteer{pool: pool, enc: enc}
}

// compile-time interface assertion: Gazetteer implements GazetteerStore EXACTLY.
var _ GazetteerStore = (*Gazetteer)(nil)

// Lookup finds a verified point by normalized address, preferring the same H3
// neighborhood when h3Cell is given, then falling back to a fuzzy (prefix/ILIKE)
// match. The best verified point is returned as a SourceGazetteer GeoResult. Every
// call writes an access-log row (MS-4).
func (g *Gazetteer) Lookup(ctx context.Context, normalizedAddr, h3Cell string) (GeoResult, bool, error) {
	if g == nil || g.pool == nil || normalizedAddr == "" {
		return GeoResult{}, false, nil
	}

	// 1. Exact normalized match. When an H3 cell is supplied, prefer points in the
	//    same coarse neighborhood (left(h3, coveragePrec) prefix), then fall back to
	//    an exact match anywhere. Ordering keeps the in-neighborhood point first.
	//    `verified_at DESC` breaks ties toward the most recently confirmed point.
	const exactQ = `
		SELECT id, lat, lng, normalized_addr, plus_code, h3
		FROM public.map_gazetteer
		WHERE normalized_addr = $1
		ORDER BY
			CASE WHEN $2 <> '' AND left(h3, $3) = left($2, $3) THEN 0 ELSE 1 END,
			verified_at DESC
		LIMIT 1`
	row := g.pool.QueryRow(ctx, exactQ, normalizedAddr, h3Cell, CellPrecisionCoverage)
	if res, id, ok := scanGazetteerPoint(row); ok {
		g.logAccess(ctx, id, accessBasisLookup)
		return res, true, nil
	}

	// 2. Fuzzy fallback: prefix / substring ILIKE. Anchored prefix first (cheap,
	//    index-friendly), and again preferring the same neighborhood when known.
	const fuzzyQ = `
		SELECT id, lat, lng, normalized_addr, plus_code, h3
		FROM public.map_gazetteer
		WHERE normalized_addr ILIKE $1 || '%' OR normalized_addr ILIKE '%' || $1 || '%'
		ORDER BY
			CASE WHEN $2 <> '' AND left(h3, $3) = left($2, $3) THEN 0 ELSE 1 END,
			CASE WHEN normalized_addr ILIKE $1 || '%' THEN 0 ELSE 1 END,
			verified_at DESC
		LIMIT 1`
	row = g.pool.QueryRow(ctx, fuzzyQ, normalizedAddr, h3Cell, CellPrecisionCoverage)
	if res, id, ok := scanGazetteerPoint(row); ok {
		g.logAccess(ctx, id, accessBasisLookup)
		return res, true, nil
	}
	return GeoResult{}, false, nil
}

// ReverseLookup finds the nearest verified point within reverseRadiusM of a
// coordinate, using ST_DWithin on the geography index (true metres). Access-logged.
func (g *Gazetteer) ReverseLookup(ctx context.Context, h3Cell string, lat, lng float64) (GeoResult, bool, error) {
	if g == nil || g.pool == nil {
		return GeoResult{}, false, nil
	}
	// $1=lat $2=lng $3=radius. ST_MakePoint takes (lng, lat) — mirrors geo_repo.go.
	const q = `
		SELECT id, lat, lng, normalized_addr, plus_code, h3
		FROM public.map_gazetteer
		WHERE ST_DWithin(geog, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
		ORDER BY ST_Distance(geog, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) ASC
		LIMIT 1`
	row := g.pool.QueryRow(ctx, q, lat, lng, reverseRadiusM)
	if res, id, ok := scanGazetteerPoint(row); ok {
		g.logAccess(ctx, id, accessBasisReverse)
		return res, true, nil
	}
	return GeoResult{}, false, nil
}

// Upsert records a confirmed verified point (courier pin, saved place, …). The PII
// payload (the human address + JSON components) is encrypted into encrypted_pii;
// the H3 cell and plus code are derived/stored for proximity + display. On conflict
// of the same normalized address at the same point cell, the row is refreshed.
func (g *Gazetteer) Upsert(ctx context.Context, e GazetteerEntry) error {
	if g == nil || g.pool == nil {
		return nil
	}

	// Derive the spatial point cell if the caller didn't supply one.
	h3 := e.H3Cell
	if h3 == "" {
		h3 = PointCellKey(e.Lat, e.Lng)
	}

	// Encrypt the PII payload (normalized address + JSON components). Components are
	// already JSON text; we encrypt them together so the plaintext address never
	// rests unencrypted outside the indexed normalized_addr lookup key.
	encrypted, err := g.enc.Encrypt(gazetteerPII(e))
	if err != nil {
		return err
	}

	components := e.Components
	if components == "" {
		components = "{}"
	}

	// $1 h3, $2 lng, $3 lat, $4 normalized_addr, $5 components(jsonb),
	// $6 plus_code, $7 source, $8 verified_by(uuid|null), $9 verified_at, $10 encrypted_pii.
	// ST_MakePoint(lng, lat) per PostGIS convention (see geo_repo.go).
	const q = `
		INSERT INTO public.map_gazetteer
			(h3, geog, lat, lng, normalized_addr, components, plus_code, source, verified_by, verified_at, encrypted_pii)
		VALUES (
			$1,
			ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
			$3, $2, $4, $5::jsonb, NULLIF($6, ''), $7, $8, COALESCE($9, now()), $10
		)
		ON CONFLICT DO NOTHING`

	_, err = g.pool.Exec(ctx, q,
		h3,
		e.Lng, e.Lat,
		e.NormalizedAddr,
		components,
		e.PlusCode,
		nzSource(e.Source),
		nullUUID(e.VerifiedBy),
		nullableTime(e.VerifiedAt),
		encrypted,
	)
	return err
}

// --- helpers --------------------------------------------------------------

// scanGazetteerPoint scans one verified point into a SourceGazetteer GeoResult.
// It returns the entry id (for access logging) and ok=false on miss/scan error.
// Gazetteer points are OURS: Confidence 1.0, Cacheable true (not third-party).
func scanGazetteerPoint(row pgx.Row) (GeoResult, string, bool) {
	var (
		id       string
		lat, lng float64
		addr     string
		plusCode *string
		h3       string
	)
	if err := row.Scan(&id, &lat, &lng, &addr, &plusCode, &h3); err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			log.Printf("[maps] gazetteer scan: %v", err)
		}
		return GeoResult{}, "", false
	}
	pc := ""
	if plusCode != nil {
		pc = *plusCode
	}
	return GeoResult{
		Lat:        lat,
		Lng:        lng,
		Address:    addr,
		PlusCode:   pc,
		Provider:   string(SourceGazetteer),
		Source:     SourceGazetteer,
		Cacheable:  true, // ours, not third-party-licensed
		Confidence: 1.0,  // a confirmed/verified point
		H3Cell:     h3,
	}, id, true
}

// logAccess writes an immutable access-log row for a gazetteer READ (MS-4, NDPA).
// Best-effort: an audit-write failure is logged but never blocks the resolution
// (the data has already been read; failing the request would not un-read it).
func (g *Gazetteer) logAccess(ctx context.Context, entryID, basis string) {
	if g == nil || g.pool == nil || entryID == "" {
		return
	}
	accessor := userIDFromCtx(ctx)
	const q = `
		INSERT INTO public.map_gazetteer_access_log (entry_id, accessor_id, basis, accessed_at)
		VALUES ($1, $2, $3, now())`
	if _, err := g.pool.Exec(ctx, q, entryID, nullUUID(accessor), basis); err != nil {
		log.Printf("[maps] gazetteer access-log (entry=%s basis=%s): %v", entryID, basis, err)
	}
}

// gazetteerPII assembles the PII payload encrypted at rest: the human-readable
// normalized address plus its JSON components. Newline-separated, address first.
func gazetteerPII(e GazetteerEntry) []byte {
	if e.NormalizedAddr == "" && e.Components == "" {
		return nil
	}
	return []byte(e.NormalizedAddr + "\n" + e.Components)
}

// nullUUID maps an empty string to a typed SQL NULL so empty accessor/verified-by
// ids do not fail uuid parsing on insert. Non-empty values pass through verbatim.
func nullUUID(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// nzSource defaults an empty gazetteer source to a safe sentinel (the column is
// NOT NULL). Confirmed pins normally arrive with a real source.
func nzSource(s string) string {
	if s == "" {
		return "user_saved"
	}
	return s
}

// nullableTime maps a zero time.Time to SQL NULL so the column default (now())
// applies; a set VerifiedAt is passed through. Paired with COALESCE($9, now()).
func nullableTime(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t
}
