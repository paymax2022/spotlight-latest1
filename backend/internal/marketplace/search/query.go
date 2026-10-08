package search

import (
	"fmt"
	"strconv"
	"time"
)

// defaultMarket is used when SearchRequest.Market is empty — house doctrine
// (SWARM_INTEGRATION_CONTRACT.md, CLAUDE.md) is `market_id TEXT` default 'NG'
// on every table; the search read model mirrors that default.
const defaultMarket = "NG"

// defaultLimit / maxLimit mirror the pagination convention in the master
// contract §3 (`?cursor=&limit={1-50, default 20}`).
const (
	defaultLimit = 20
	maxLimit     = 50
)

// BuildQuery constructs the Elasticsearch function_score query body for
// GET /v1/marketplace/search, implementing the ranking template in
// Paymax_Marketplace_CLAUDE_BUILD_CONTRACT.md §4 EXACTLY:
//   - multi_match against title^3 / description / attrs.* (fuzziness AUTO)
//   - filter: status=active AND market_id={{market}}
//   - functions: quality_score (field_value_factor), seller_trust_score
//     (field_value_factor), geo gauss 25km (only when lat/lng present),
//     freshness exp 30d on freshness_ts, boost_weight field_value_factor
//     modifier=log1p factor=1.0
//   - score_mode: multiply
//   - boost_mode: sum   <-- boost_mode:sum = boosts add, never dominate
//
// Additional filters (category_id, price range, condition, state/lga,
// escrow_eligible is NOT filtered here — it's a display concern) are layered
// into the same bool.filter array; they are not part of the frozen §4
// template but are required to serve the frozen SearchRequest fields
// (category_id, price_min/max, condition, state, lga) — additive, not a
// deviation from the scored function list.
func BuildQuery(req SearchRequest) map[string]any {
	market := req.Market
	if market == "" {
		market = defaultMarket
	}

	filters := []map[string]any{
		{"term": map[string]any{"status": "active"}},
		{"term": map[string]any{"market_id": market}},
	}
	if req.CategoryID != "" {
		filters = append(filters, map[string]any{"term": map[string]any{"category_id": req.CategoryID}})
	}
	if req.Condition != "" {
		filters = append(filters, map[string]any{"term": map[string]any{"condition": req.Condition}})
	}
	if req.State != "" {
		filters = append(filters, map[string]any{"term": map[string]any{"state": req.State}})
	}
	if req.LGA != "" {
		filters = append(filters, map[string]any{"term": map[string]any{"lga": req.LGA}})
	}
	if req.PriceMin != nil || req.PriceMax != nil {
		rng := map[string]any{}
		if req.PriceMin != nil {
			rng["gte"] = *req.PriceMin
		}
		if req.PriceMax != nil {
			rng["lte"] = *req.PriceMax
		}
		filters = append(filters, map[string]any{"range": map[string]any{"price_kobo": rng}})
	}
	if req.Lat != nil && req.Lng != nil && req.RadiusKm != nil && *req.RadiusKm > 0 {
		filters = append(filters, map[string]any{
			"geo_distance": map[string]any{
				"distance": fmt.Sprintf("%gkm", *req.RadiusKm),
				"geo":      map[string]any{"lat": *req.Lat, "lng": *req.Lng},
			},
		})
	}

	must := []map[string]any{}
	if req.Q != "" {
		must = append(must, map[string]any{
			"multi_match": map[string]any{
				"query":     req.Q,
				"fields":    []string{"title^3", "description", "attrs.*"},
				"fuzziness": "AUTO",
			},
		})
	} else {
		// No free-text query — match_all keeps the bool query valid so
		// filters + function_score still apply (e.g. category browse).
		must = append(must, map[string]any{"match_all": map[string]any{}})
	}

	functions := []map[string]any{
		{"field_value_factor": map[string]any{"field": "quality_score", "missing": 0.5}},
		{"field_value_factor": map[string]any{"field": "seller_trust_score", "missing": 0.5}},
	}
	if req.Lat != nil && req.Lng != nil {
		functions = append(functions, map[string]any{
			"gauss": map[string]any{
				"geo": map[string]any{
					"origin": fmt.Sprintf("%g,%g", *req.Lat, *req.Lng),
					"scale":  "25km",
				},
			},
		})
	}
	functions = append(functions,
		map[string]any{"exp": map[string]any{"freshness_ts": map[string]any{"origin": "now", "scale": "30d"}}},
		map[string]any{"field_value_factor": map[string]any{
			"field":    "boost_weight",
			"missing":  0,
			"modifier": "log1p",
			"factor":   1.0,
		}},
	)

	query := map[string]any{
		"query": map[string]any{
			"function_score": map[string]any{
				"query": map[string]any{
					"bool": map[string]any{
						"must":   must,
						"filter": filters,
					},
				},
				"functions": functions,
				// score_mode:multiply combines quality/trust/geo/freshness together;
				// boost_mode:sum = boosts add, never dominate (paid boost cannot
				// out-multiply an otherwise-poor match — it can only add a bounded
				// log1p(boost_weight) on top of the multiplied relevance score).
				"score_mode": "multiply",
				"boost_mode": "sum",
			},
		},
		"size": clampLimit(req.Limit),
		// from applies req.Cursor as an ES offset. Without this, paging past page 1
		// always re-requested the first `size` hits from offset 0 regardless of the
		// cursor the caller sent, because Cursor was defined on SearchRequest but
		// never read anywhere in the query builder — same page every time.
		"from": parseCursor(req.Cursor),
	}

	if sortClause := buildSort(req.Sort); sortClause != nil {
		query["sort"] = sortClause
	}

	return query
}

// parseCursor decodes the opaque pagination cursor (a plain base-10 offset,
// see Client.Search) back into an ES `from` value. An empty, malformed, or
// negative cursor is treated as page 1 (offset 0) rather than erroring —
// a bad/stale cursor should degrade to the first page, not fail the request.
func parseCursor(cursor string) int {
	if cursor == "" {
		return 0
	}
	n, err := strconv.Atoi(cursor)
	if err != nil || n < 0 {
		return 0
	}
	return n
}

// buildSort maps the frozen `sort` enum (relevance|price_asc|price_desc|
// newest|trusted_first) to an ES sort clause. relevance (default) omits an
// explicit sort so ES falls back to _score from the function_score query.
func buildSort(sort string) []map[string]any {
	switch sort {
	case "price_asc":
		return []map[string]any{{"price_kobo": map[string]any{"order": "asc"}}}
	case "price_desc":
		return []map[string]any{{"price_kobo": map[string]any{"order": "desc"}}}
	case "newest":
		return []map[string]any{{"created_at": map[string]any{"order": "desc"}}}
	case "trusted_first":
		return []map[string]any{{"seller_trust_score": map[string]any{"order": "desc"}}}
	default:
		return nil
	}
}

func clampLimit(limit int) int {
	if limit <= 0 {
		return defaultLimit
	}
	if limit > maxLimit {
		return maxLimit
	}
	return limit
}

// Package search implements the Paymax Marketplace read model: an
// Elasticsearch-backed search client, the ranking query builder, the
// outbox-draining indexer, and the ES index-template loader.
// Ownership boundary (SWARM_INTEGRATION_CONTRACT.md): this package is owned
// by Agent B. It deliberately does NOT import package `marketplace` (the
// outbox row shape is re-declared locally in indexer.go) — and `marketplace`
// must NEVER import `search` either. Agent A's HTTP handler depends on a
// small local `Searcher` interface satisfied by `*search.Client`, not on a
// direct import, to avoid a compile cycle in either direction.

// SearchRequest carries every filter/sort/pagination input accepted by
// GET /v1/marketplace/search (contract §3.2). Field names are frozen by the
// swarm integration contract; do not rename.
type SearchRequest struct {
	Q          string   `json:"q,omitempty"`
	CategoryID string   `json:"category_id,omitempty"`
	PriceMin   *int64   `json:"price_min,omitempty"`
	PriceMax   *int64   `json:"price_max,omitempty"`
	Condition  string   `json:"condition,omitempty"`
	Lat        *float64 `json:"lat,omitempty"`
	Lng        *float64 `json:"lng,omitempty"`
	RadiusKm   *float64 `json:"radius_km,omitempty"`
	State      string   `json:"state,omitempty"`
	LGA        string   `json:"lga,omitempty"`
	// Sort: relevance|price_asc|price_desc|newest|trusted_first (default relevance).
	Sort   string `json:"sort,omitempty"`
	Cursor string `json:"cursor,omitempty"`
	Limit  int    `json:"limit,omitempty"`
	// Market scopes every query to a market_id (multi-tenant SaaS readiness).
	// Defaults to "NG" when empty.
	Market string `json:"market,omitempty"`
}

// ListingSummary is one search result row — the minimum fields a search
// results card needs, per §3.2 `results: array of listing summary objects`.
type ListingSummary struct {
	ListingID        string    `json:"listing_id"`
	Title            string    `json:"title"`
	PriceKobo        int64     `json:"price_kobo"`
	Condition        string    `json:"condition"`
	CategoryID       string    `json:"category_id"`
	State            string    `json:"state"`
	LGA              string    `json:"lga,omitempty"`
	ThumbURL         string    `json:"thumb_url,omitempty"`
	SellerTrustScore float64   `json:"seller_trust_score"`
	QualityScore     float64   `json:"quality_score"`
	BoostWeight      float64   `json:"boost_weight,omitempty"`
	EscrowEligible   bool      `json:"escrow_eligible"`
	CreatedAt        time.Time `json:"created_at"`
	Score            float64   `json:"score,omitempty"`
}

// Facet is one bucket in a facet list (categories/conditions/price_ranges).
type Facet struct {
	Key   string `json:"key"`
	Label string `json:"label,omitempty"`
	Count int64  `json:"count"`
}

// Facets mirrors the §3.2 response shape:
// facets: {categories: [...], conditions: [...], price_ranges: [...]}
type Facets struct {
	Categories  []Facet `json:"categories"`
	Conditions  []Facet `json:"conditions"`
	PriceRanges []Facet `json:"price_ranges"`
}

// SearchResults is the full response payload for GET /v1/marketplace/search.
type SearchResults struct {
	Results    []ListingSummary `json:"results"`
	Facets     Facets           `json:"facets"`
	NextCursor string           `json:"next_cursor,omitempty"`
	TookMs     int64            `json:"took_ms"`
}
