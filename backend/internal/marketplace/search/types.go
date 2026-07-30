// Package search implements the Paymax Marketplace read model: an
// Elasticsearch-backed search client, the ranking query builder, the
// outbox-draining indexer, and the ES index-template loader.
//
// Ownership boundary (SWARM_INTEGRATION_CONTRACT.md): this package is owned
// by Agent B. It deliberately does NOT import package `marketplace` (the
// outbox row shape is re-declared locally in indexer.go) — and `marketplace`
// must NEVER import `search` either. Agent A's HTTP handler depends on a
// small local `Searcher` interface satisfied by `*search.Client`, not on a
// direct import, to avoid a compile cycle in either direction.
package search

import "time"

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
