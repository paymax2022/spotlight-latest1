package marketplace

import "testing"

// The handler has always put market_id into the search request map. Nothing on the
// Postgres-fallback path read it, so a market-scoped browse was answered with every
// market's listings — while GET /categories, sitting on the same screen, scoped to
// one market. The two halves of the marketplace home disagreed about which market
// the shopper was in, and only when Elasticsearch was unwired (`degraded`), which is
// exactly when nobody is looking closely.
func TestParseSearchFallback_ReadsMarketID(t *testing.T) {
	f := parseSearchFallback(map[string]any{"market_id": "KE", "q": "corolla"})
	if f.MarketID != "KE" {
		t.Errorf("MarketID = %q, want KE (the handler's market_id must reach the query)", f.MarketID)
	}
	if f.Q != "corolla" {
		t.Errorf("Q = %q, want corolla", f.Q)
	}
}

// Absent means "the caller forgot", not "search every market". An unscoped search is
// the defect itself, so the parse fails closed onto one market rather than open onto
// all of them.
func TestParseSearchFallback_DefaultsMarketWhenAbsent(t *testing.T) {
	for _, tc := range []struct{ name string; req map[string]any }{
		{"key absent", map[string]any{"q": "corolla"}},
		{"key empty", map[string]any{"market_id": ""}},
		{"nil map", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var f SearchFallbackFilter
			if tc.req == nil {
				f = parseSearchFallback(nil)
			} else {
				f = parseSearchFallback(tc.req)
			}
			if f.MarketID != DefaultMarketID {
				t.Errorf("MarketID = %q, want %q — an unscoped fallback searches every market",
					f.MarketID, DefaultMarketID)
			}
		})
	}
}
