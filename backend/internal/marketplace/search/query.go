package search

import "fmt"

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
//
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
	}

	if sortClause := buildSort(req.Sort); sortClause != nil {
		query["sort"] = sortClause
	}

	return query
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
