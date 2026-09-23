package search

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestParseCursor verifies the opaque cursor (a plain base-10 offset) decodes
// safely, defaulting a missing/malformed/negative cursor to page 1 rather
// than erroring.
func TestParseCursor(t *testing.T) {
	cases := []struct {
		name   string
		cursor string
		want   int
	}{
		{"empty defaults to 0", "", 0},
		{"valid offset", "40", 40},
		{"garbage defaults to 0", "not-a-number", 0},
		{"negative defaults to 0", "-5", 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := parseCursor(c.cursor); got != c.want {
				t.Errorf("parseCursor(%q) = %d, want %d", c.cursor, got, c.want)
			}
		})
	}
}

// TestBuildQuery_FromReflectsCursor is the regression test for the bug: the
// query builder used to never read req.Cursor at all, so every page request
// asked Elasticsearch for the same `from: 0` results regardless of cursor.
func TestBuildQuery_FromReflectsCursor(t *testing.T) {
	cases := []struct {
		name   string
		cursor string
		limit  int
		want   int
	}{
		{"page 1: no cursor", "", 20, 0},
		{"page 2: cursor from page 1's next_cursor", "20", 20, 20},
		{"page 3: cursor advances again", "40", 20, 40},
		{"malformed cursor degrades to page 1", "garbage", 20, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			q := BuildQuery(SearchRequest{Cursor: c.cursor, Limit: c.limit})
			got, ok := q["from"].(int)
			if !ok {
				t.Fatalf("BuildQuery()[\"from\"] missing or wrong type: %#v", q["from"])
			}
			if got != c.want {
				t.Errorf("from = %d, want %d", got, c.want)
			}
		})
	}
}

// esDoc is a minimal fake index of listings the test ES server pages through.
type esDoc struct {
	ListingID string `json:"listing_id"`
	Title     string `json:"title"`
}

// newFakeES starts an httptest server that behaves like Elasticsearch just
// enough for Client.Search: it reads the posted query body's "from"/"size"
// and slices a fixed in-memory dataset accordingly, so the test can prove
// real pagination — not just that a field got set.
func newFakeES(t *testing.T, dataset []esDoc) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		from := 0
		if f, ok := body["from"].(float64); ok {
			from = int(f)
		}
		size := 20
		if s, ok := body["size"].(float64); ok {
			size = int(s)
		}
		end := from + size
		if end > len(dataset) {
			end = len(dataset)
		}
		var hits []map[string]any
		if from < len(dataset) {
			for _, d := range dataset[from:end] {
				src, _ := json.Marshal(d)
				hits = append(hits, map[string]any{"_source": json.RawMessage(src)})
			}
		}
		resp := map[string]any{
			"took": 1,
			"hits": map[string]any{"hits": hits},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
}

// TestClientSearch_PaginationAdvances is the end-to-end regression proof:
// paging through a 5-doc dataset with page size 2 must visit every doc
// exactly once (no repeats of page 1, no gaps, no duplicates), and the final
// page must report no next_cursor.
func TestClientSearch_PaginationAdvances(t *testing.T) {
	dataset := []esDoc{
		{ListingID: "id-1", Title: "one"},
		{ListingID: "id-2", Title: "two"},
		{ListingID: "id-3", Title: "three"},
		{ListingID: "id-4", Title: "four"},
		{ListingID: "id-5", Title: "five"},
	}
	srv := newFakeES(t, dataset)
	defer srv.Close()

	c := NewClient(srv.URL)
	const pageSize = 2

	seen := map[string]bool{}
	var order []string
	cursor := ""
	pages := 0
	for {
		pages++
		if pages > 10 {
			t.Fatalf("pagination did not terminate after %d pages (looping?)", pages)
		}
		res, err := c.Search(context.Background(), SearchRequest{Limit: pageSize, Cursor: cursor})
		if err != nil {
			t.Fatalf("Search: %v", err)
		}
		if len(res.Results) == 0 {
			break
		}
		for _, r := range res.Results {
			if seen[r.ListingID] {
				t.Fatalf("duplicate result %s on page %d (offset not advancing correctly)", r.ListingID, pages)
			}
			seen[r.ListingID] = true
			order = append(order, r.ListingID)
		}
		if res.NextCursor == "" {
			break
		}
		if res.NextCursor == cursor {
			t.Fatalf("next_cursor did not advance past %q (this is the original bug: cursor always the bare limit constant)", cursor)
		}
		cursor = res.NextCursor
	}

	if len(order) != len(dataset) {
		t.Fatalf("visited %d results, want all %d (gap in pagination): got %v", len(order), len(dataset), order)
	}
	for i, d := range dataset {
		if order[i] != d.ListingID {
			t.Errorf("result[%d] = %s, want %s (page 2 should NOT repeat page 1)", i, order[i], d.ListingID)
		}
	}
	// 5 docs at page size 2 must take 3 pages (2 + 2 + 1), proving page 2
	// actually returned NEW docs 3-4, not doc 1-2 again.
	if pages != 3 {
		t.Errorf("took %d page fetches, want 3", pages)
	}
}
