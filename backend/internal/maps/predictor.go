package maps

import (
	"context"
	"log"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// predictor.go — the history-based destination deflector (MAPSERVICE.md §6, MS-2).
//
// Predict answers a paid geocode for FREE by matching the typed query against the
// USER'S OWN confirmed destinations: the places this user has actually been sent
// to or travelled to. Those rows carry both a human address (the typed label) and
// real coordinates (the confirmed result), so a match short-circuits the whole
// provider chain at zero external cost.
//
// Real, user-scoped history sources used here (all verified to exist and to carry
// BOTH an address text column AND lat/lng coordinates, scoped to the requesting
// user — see supabase/migrations):
//
//   - trips        — rider_id, dest_address, dest_lat, dest_lng
//                    (ride destinations; 20260616290000_transport.sql +
//                     20260623000000_transport_mobility.sql adds dest_lat/lng)
//   - parcels      — sender_id, dropoff_address, dropoff_lat, dropoff_lng
//                    (parcel drop-offs; 20260624000000_transport_modes.sql)
//
// Deliberately EXCLUDED (kept conservative — false positives are worse than a
// miss): restaurant `orders.delivery_address` has NO coordinate columns, so it
// cannot yield a point to deflect to; `towing_jobs.dest_address` likewise has no
// destination coordinates; `business_deliveries` is scoped by business_id, not a
// personal user. We only query tables that genuinely have (user, address, lat, lng).
//
// Strategy: per source, fetch the user's recent, coordinate-bearing destinations
// whose normalized address relates to the query (exact / prefix / substring),
// score each candidate with the pure scoreHistoryMatch (biased upward when the
// candidate sits in the same H3 neighborhood as `near`), and return the single
// best match — but ONLY when its confidence clears predictStrongFloor. Otherwise
// ok=false, so the orchestrator escalates to the (paid) providers as normal.

// predictStrongFloor is the minimum confidence at which Predict claims a hit.
// Below it we return ok=false and let the chain escalate. The orchestrator also
// re-checks r.Confidence >= th.Escalate, so this is a conservative inner gate.
const predictStrongFloor = 0.75

// predictCandidateLimit caps how many of the user's recent destinations we pull
// per source. Small and index-friendly (indexed by the owner column); the typed
// query already narrows it via the SQL relate-filter.
const predictCandidateLimit = 8

// HistoryPredictor is the pgx-backed Predictor. It is user-scoped and incurs zero
// external (provider) cost: every lookup is a local PostGIS query against the
// user's own confirmed destinations.
type HistoryPredictor struct {
	pool *pgxpool.Pool
}

// NewHistoryPredictor builds the history-based predictor over the finance pgx pool.
func NewHistoryPredictor(pool *pgxpool.Pool) *HistoryPredictor {
	return &HistoryPredictor{pool: pool}
}

// compile-time interface assertion: HistoryPredictor implements Predictor EXACTLY.
var _ Predictor = (*HistoryPredictor)(nil)

// historyCandidate is one of the user's past destinations: a stored address label
// plus the coordinate it resolved to.
type historyCandidate struct {
	addr     string
	lat, lng float64
	source   string // which history table it came from (for provenance/logging)
}

// historySource describes one user-scoped destination table to mine. Every field
// is a fixed identifier (table/column names are compile-time constants here, never
// user input) so the assembled SQL is static; only the query/userID are bound.
type historySource struct {
	name    string // logical source name (provenance)
	table   string // physical table
	userCol string // owner column (scopes to the requesting user)
	addrCol string // address-text column
	latCol  string // latitude column
	lngCol  string // longitude column
}

// historySources is the allow-list of REAL tables mined for predictions. Adding a
// source here is the only way to introduce one — keeps the SQL static and audited.
var historySources = []historySource{
	{name: "trip", table: "public.trips", userCol: "rider_id", addrCol: "dest_address", latCol: "dest_lat", lngCol: "dest_lng"},
	{name: "parcel", table: "public.parcels", userCol: "sender_id", addrCol: "dropoff_address", latCol: "dropoff_lat", lngCol: "dropoff_lng"},
}

// Predict deflects a paid geocode by matching the normalized query against the
// user's own historical destinations. Returns ok=true ONLY on a strong match.
func (p *HistoryPredictor) Predict(ctx context.Context, userID, normalizedAddr string, near *Point) (GeoResult, bool, error) {
	if p == nil || p.pool == nil || userID == "" || normalizedAddr == "" {
		return GeoResult{}, false, nil
	}

	// The H3 neighborhood we're biasing toward (empty when no `near` hint).
	nearCell := ""
	if near != nil {
		nearCell = CellKey(near.Lat, near.Lng)
	}

	var (
		best      historyCandidate
		bestConf  Confidence
		haveMatch bool
	)

	for _, src := range historySources {
		cands, err := p.candidates(ctx, src, userID, normalizedAddr)
		if err != nil {
			// A missing table/column or transient error must not break resolution:
			// log and skip this source so the chain still escalates to providers.
			log.Printf("[maps] predictor source %s: %v", src.name, err)
			continue
		}
		for _, c := range cands {
			sameCell := nearCell != "" && SameNeighborhood(nearCell, CellKey(c.lat, c.lng))
			conf, ok := scoreHistoryMatch(normalizedAddr, NormalizeQuery(c.addr), sameCell)
			if !ok {
				continue
			}
			if !haveMatch || conf > bestConf {
				best, bestConf, haveMatch = c, conf, true
			}
		}
	}

	// Conservative inner gate: only claim a hit on a strong match.
	if !haveMatch || bestConf < predictStrongFloor {
		return GeoResult{}, false, nil
	}

	res := GeoResult{
		Lat:        best.lat,
		Lng:        best.lng,
		Address:    normalizedAddr,
		Provider:   string(SourcePrediction),
		Source:     SourcePrediction,
		Confidence: bestConf,
		H3Cell:     PointCellKey(best.lat, best.lng),
		// A prediction is derived from the user's own history, not an OSM-licensed
		// provider — it is NOT written to the OSM cache (the cache writer would
		// refuse it anyway). Keep it out of the write-through.
		Cacheable: false,
	}
	return res, true, nil
}

// candidates pulls the user's recent, coordinate-bearing destinations from one
// source whose stored address relates to the query. The relate-filter (exact /
// prefix / substring, case-insensitive) keeps the row set tiny; final scoring is
// done in Go by scoreHistoryMatch. All SQL is parameterized and scoped to userID;
// NULL coordinates are excluded (no point = nothing to deflect to).
//
// Table/column identifiers come from the static historySources allow-list (never
// user input), so building the statement with fmt-style identifier substitution
// is safe; the only bound parameters are userID, the query, and the limit.
func (p *HistoryPredictor) candidates(ctx context.Context, src historySource, userID, normalizedAddr string) ([]historyCandidate, error) {
	// $1 userID, $2 query, $3 limit. lower(addr) compared against the already-
	// lowercased normalized query (NormalizeQuery lowercases) for case-insensitive
	// exact / prefix / substring relation. Most-recent first so the freshest
	// confirmed destination wins ties.
	q := "SELECT " + src.addrCol + ", " + src.latCol + ", " + src.lngCol +
		" FROM " + src.table +
		" WHERE " + src.userCol + " = $1" +
		" AND " + src.latCol + " IS NOT NULL AND " + src.lngCol + " IS NOT NULL" +
		" AND (lower(" + src.addrCol + ") = $2" +
		"   OR lower(" + src.addrCol + ") LIKE $2 || '%'" +
		"   OR lower(" + src.addrCol + ") LIKE '%' || $2 || '%')" +
		" ORDER BY created_at DESC" +
		" LIMIT $3"

	rows, err := p.pool.Query(ctx, q, userID, normalizedAddr, predictCandidateLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]historyCandidate, 0, predictCandidateLimit)
	for rows.Next() {
		var (
			addr     string
			lat, lng float64
		)
		if err := rows.Scan(&addr, &lat, &lng); err != nil {
			log.Printf("[maps] predictor scan (%s): %v", src.name, err)
			continue
		}
		out = append(out, historyCandidate{addr: addr, lat: lat, lng: lng, source: src.name})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// scoreHistoryMatch is the PURE matching/scoring rule (unit-tested). Given the
// normalized query and a normalized candidate address (both already lowercased /
// whitespace-collapsed by NormalizeQuery), it returns a confidence in [0,1] and
// whether the pair is a usable match.
//
// Scoring rule:
//   - empty query or candidate            → (0, false)        — nothing to match.
//   - exact equality                      → 0.90 base         — a known place.
//   - candidate is a prefix of the query
//     OR query is a prefix of the candidate→ 0.78 base         — strong partial.
//   - one fully contains the other        → 0.70 base         — weak partial.
//   - otherwise                           → (0, false)        — not a match.
//
// A same-H3-neighborhood `near` hint adds a +0.05 spatial bonus (capped at 1.0):
// when the user is standing in the same area the candidate resolves to, the match
// is more trustworthy. The returned ok is true whenever a base tier fired; the
// caller (Predict) applies the conservative predictStrongFloor gate on top, so a
// bare weak-partial (0.70) alone will NOT trigger a deflection unless the spatial
// bonus lifts it — exactly the "false positives are worse than a miss" posture.
func scoreHistoryMatch(query, candidate string, sameCell bool) (Confidence, bool) {
	if query == "" || candidate == "" {
		return 0, false
	}

	var base Confidence
	switch {
	case query == candidate:
		base = 0.90
	case strings.HasPrefix(candidate, query) || strings.HasPrefix(query, candidate):
		base = 0.78
	case strings.Contains(candidate, query) || strings.Contains(query, candidate):
		base = 0.70
	default:
		return 0, false
	}

	if sameCell {
		base += 0.05
		if base > 1.0 {
			base = 1.0
		}
	}
	return base, true
}
