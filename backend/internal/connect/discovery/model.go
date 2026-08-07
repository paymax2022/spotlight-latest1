// Package connectdiscovery implements Paymax Connect Phase-1 curated daily matches
// (with match-reason cards and anti-fatigue daily limits sourced from the Connect
// config service) and privacy-preserving search/filters (verified-only, intent,
// bucketed approximate distance). All tunables are backend-owned (connect_config),
// never hard-coded. See docs/prd/dating/{api.md §Phase 1, compliance.md}.
package connectdiscovery

// Candidate is a discovery/search result. Exact coordinates are NEVER returned —
// only a coarse, bucketed distance label preserves location privacy (invariant 3).
type Candidate struct {
	ProfileID     string       `json:"profile_id"`
	DisplayName   *string      `json:"display_name,omitempty"`
	City          *string      `json:"city,omitempty"`
	Verified      bool         `json:"verified"`
	IntentTags    []string     `json:"intent_tags"`
	DistanceLabel string       `json:"distance_label,omitempty"` // e.g. "within 25 km"
	MatchReason   *MatchReason `json:"match_reason,omitempty"`   // present on curated discovery
}

// MatchReason is the "match-reason card" surfaced with curated daily matches.
type MatchReason struct {
	Headline string   `json:"headline"` // short human reason
	Factors  []string `json:"factors"`  // e.g. ["shared intent: hiking", "verified", "within 25 km"]
	Score    float64  `json:"score"`
}

// DiscoveryResponse wraps the curated daily set plus the anti-fatigue limit applied.
type DiscoveryResponse struct {
	Mode       string      `json:"mode"`
	DailyLimit int         `json:"daily_limit"` // from connect_config, not hard-coded
	Candidates []Candidate `json:"candidates"`
}

// SearchFilters captures the privacy-preserving search query.
type SearchFilters struct {
	Mode         string
	VerifiedOnly bool
	Intent       string // single intent tag to match
	MaxDistKm    int    // requested cap; snapped to a configured bucket
	Limit        int
}
