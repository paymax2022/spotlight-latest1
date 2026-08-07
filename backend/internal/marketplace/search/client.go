package search

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// indexPattern matches the §4 template's `index_patterns: ["mkt_listings_ng_v*"]`.
// Search always targets the alias for the requested market; the indexer/
// template owns rollover versioning behind that alias.
const indexAliasFmt = "mkt_listings_%s"

// Client is a minimal Elasticsearch HTTP client. Deliberately dependency-free
// (net/http only) — the repo does not vendor an ES client library (go.mod has
// no elastic/opensearch package), and the swarm contract does not require one.
type Client struct {
	baseURL string
	http    *http.Client
}

// NewClient builds a Client against the given Elasticsearch base URL
// (e.g. "http://localhost:9200"). No network call is made here — connectivity
// is validated lazily on first request so app boot never blocks/panics on a
// down ES cluster.
func NewClient(esURL string) *Client {
	return &Client{
		baseURL: strings.TrimRight(esURL, "/"),
		http:    &http.Client{Timeout: 10 * time.Second},
	}
}

// ErrSearchUnavailable is returned (wrapped) whenever Elasticsearch cannot be
// reached or returns a non-2xx status. Callers (Agent A's handler) should
// treat this as a degraded-search condition, never panic.
type ErrSearchUnavailable struct {
	Op  string
	Err error
}

func (e *ErrSearchUnavailable) Error() string {
	return fmt.Sprintf("search: %s unavailable: %v", e.Op, e.Err)
}

func (e *ErrSearchUnavailable) Unwrap() error { return e.Err }

// esAggBucket is one terms/range aggregation bucket. Named (not anonymous) so
// it can be shared between esSearchResponse and bucketsToFacets without
// relying on Go's anonymous-struct structural-identity rules.
type esAggBucket struct {
	Key      any     `json:"key"`
	KeyAsStr *string `json:"key_as_string"`
	DocCount int64   `json:"doc_count"`
}

// esAgg is one named aggregation's bucket list.
type esAgg struct {
	Buckets []esAggBucket `json:"buckets"`
}

// esSearchResponse is the subset of the ES _search response shape we read.
type esSearchResponse struct {
	Took int `json:"took"`
	Hits struct {
		Hits []struct {
			Source json.RawMessage `json:"_source"`
			Score  *float64        `json:"_score"`
		} `json:"hits"`
	} `json:"hits"`
	Aggregations map[string]esAgg `json:"aggregations"`
}

// esListingDoc mirrors the mapping properties in es-mapping.json (§4). Kept
// local (not imported from marketplace) so this package has zero dependency
// on the outbox payload shape beyond what search actually renders.
type esListingDoc struct {
	ListingID        string    `json:"listing_id"`
	Title            string    `json:"title"`
	PriceKobo        int64     `json:"price_kobo"`
	Condition        string    `json:"condition"`
	CategoryID       string    `json:"category_id"`
	State            string    `json:"state"`
	LGA              string    `json:"lga"`
	ThumbURL         string    `json:"thumb_url"`
	SellerTrustScore float64   `json:"seller_trust_score"`
	QualityScore     float64   `json:"quality_score"`
	BoostWeight      float64   `json:"boost_weight"`
	EscrowEligible   bool      `json:"escrow_eligible"`
	CreatedAt        time.Time `json:"created_at"`
}

// Search executes req against Elasticsearch and returns the ranked results.
//
// EXACT signature required by Agent A's local `Searcher` interface
// (SWARM_INTEGRATION_CONTRACT.md): this must not change.
func (c *Client) Search(ctx context.Context, req SearchRequest) (SearchResults, error) {
	market := req.Market
	if market == "" {
		market = defaultMarket
	}
	index := fmt.Sprintf(indexAliasFmt, strings.ToLower(market))

	body := BuildQuery(req)
	// Facet aggregations — additive to the frozen function_score query, needed
	// to satisfy the frozen §3.2 response shape `facets: {categories, conditions, price_ranges}`.
	body["aggs"] = map[string]any{
		"categories": map[string]any{"terms": map[string]any{"field": "category_id", "size": 20}},
		"conditions": map[string]any{"terms": map[string]any{"field": "condition", "size": 10}},
		"price_ranges": map[string]any{"range": map[string]any{
			"field": "price_kobo",
			"ranges": []map[string]any{
				{"to": 500000},
				{"from": 500000, "to": 2000000},
				{"from": 2000000, "to": 10000000},
				{"from": 10000000},
			},
		}},
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return SearchResults{}, &ErrSearchUnavailable{Op: "encode query", Err: err}
	}

	start := time.Now()
	url := fmt.Sprintf("%s/%s/_search", c.baseURL, index)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return SearchResults{}, &ErrSearchUnavailable{Op: "build request", Err: err}
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(httpReq)
	if err != nil {
		return SearchResults{}, &ErrSearchUnavailable{Op: "request", Err: err}
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return SearchResults{}, &ErrSearchUnavailable{Op: "read response", Err: err}
	}
	if resp.StatusCode >= 300 {
		return SearchResults{}, &ErrSearchUnavailable{Op: "request", Err: fmt.Errorf("status %d: %s", resp.StatusCode, string(respBody))}
	}

	var parsed esSearchResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return SearchResults{}, &ErrSearchUnavailable{Op: "decode response", Err: err}
	}

	results := make([]ListingSummary, 0, len(parsed.Hits.Hits))
	for _, h := range parsed.Hits.Hits {
		var doc esListingDoc
		if err := json.Unmarshal(h.Source, &doc); err != nil {
			continue // skip malformed doc rather than fail the whole page
		}
		summary := ListingSummary{
			ListingID:        doc.ListingID,
			Title:            doc.Title,
			PriceKobo:        doc.PriceKobo,
			Condition:        doc.Condition,
			CategoryID:       doc.CategoryID,
			State:            doc.State,
			LGA:              doc.LGA,
			ThumbURL:         doc.ThumbURL,
			SellerTrustScore: doc.SellerTrustScore,
			QualityScore:     doc.QualityScore,
			BoostWeight:      doc.BoostWeight,
			EscrowEligible:   doc.EscrowEligible,
			CreatedAt:        doc.CreatedAt,
		}
		if h.Score != nil {
			summary.Score = *h.Score
		}
		results = append(results, summary)
	}

	facets := Facets{}
	if agg, ok := parsed.Aggregations["categories"]; ok {
		facets.Categories = bucketsToFacets(agg.Buckets)
	}
	if agg, ok := parsed.Aggregations["conditions"]; ok {
		facets.Conditions = bucketsToFacets(agg.Buckets)
	}
	if agg, ok := parsed.Aggregations["price_ranges"]; ok {
		facets.PriceRanges = bucketsToFacets(agg.Buckets)
	}

	nextCursor := ""
	limit := clampLimit(req.Limit)
	if len(results) == limit {
		// Simple offset-style opaque cursor; the indexer/search API can evolve
		// to search_after without changing this exported shape.
		nextCursor = fmt.Sprintf("%d", limit)
	}

	return SearchResults{
		Results:    results,
		Facets:     facets,
		NextCursor: nextCursor,
		TookMs:     time.Since(start).Milliseconds(),
	}, nil
}

func bucketsToFacets(buckets []esAggBucket) []Facet {
	out := make([]Facet, 0, len(buckets))
	for _, b := range buckets {
		key := fmt.Sprintf("%v", b.Key)
		out = append(out, Facet{Key: key, Count: b.DocCount})
	}
	return out
}
