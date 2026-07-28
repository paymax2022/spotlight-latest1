package search

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
)

// Agent C owns backend/internal/marketplace/search/es-mapping.json (per
// SWARM_INTEGRATION_CONTRACT.md — "Only Agent C creates the search/es-mapping.json
// file; Agent B creates all .go files in search/"). We reference it via a
// go:embed GLOB (*.json, not the literal filename) specifically so this
// package still compiles standalone before that file lands: a literal
// `//go:embed es-mapping.json` fails the build if the file is absent, but a
// wildcard pattern is allowed to match zero files. EnsureTemplate then
// tolerates its absence at runtime with a typed error instead of panicking
// (see loadMappingBytes).
//
//go:embed *.json
var embeddedMappingFS embed.FS

const mappingFileName = "es-mapping.json"

// EnsureTemplate PUTs the index template (settings+mappings) described by
// es-mapping.json to Elasticsearch, so a fresh cluster gets the exact
// analyzer/mapping config from Paymax_Marketplace_CLAUDE_BUILD_CONTRACT.md §4
// before the indexer/search API ever writes or queries a document.
//
// Tolerates the mapping file being absent (Agent C not landed yet, or a
// build/test environment without the file embedded) by returning a typed,
// non-fatal error — callers (cmd/marketplace-indexer) log and continue rather
// than crash-loop.
func (c *Client) EnsureTemplate(ctx context.Context) error {
	raw, err := loadMappingBytes()
	if err != nil {
		return fmt.Errorf("search: es-mapping.json not available: %w", err)
	}

	var tmpl map[string]any
	if err := json.Unmarshal(raw, &tmpl); err != nil {
		return fmt.Errorf("search: parse es-mapping.json: %w", err)
	}

	name, _ := tmpl["name"].(string)
	if name == "" {
		name = "mkt_listings_template"
	}

	// The template body ES expects is everything except an optional wrapper
	// "name" key; es-mapping.json is documented (§4) as
	// {"index_patterns": [...], "template": {...}} which IS the template body.
	body, err := json.Marshal(tmpl)
	if err != nil {
		return fmt.Errorf("search: encode index template: %w", err)
	}

	url := fmt.Sprintf("%s/_index_template/%s", c.baseURL, name)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPut, url, bytes.NewReader(body))
	if err != nil {
		return &ErrSearchUnavailable{Op: "build template request", Err: err}
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(httpReq)
	if err != nil {
		return &ErrSearchUnavailable{Op: "put index template", Err: err}
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return &ErrSearchUnavailable{Op: "put index template", Err: fmt.Errorf("status %d: %s", resp.StatusCode, string(respBody))}
	}
	return nil
}

// loadMappingBytes tries the embedded copy first (production build), then
// falls back to reading the file from disk relative to the working directory
// (useful in tests / local dev where the embed may be a placeholder). Returns
// a plain error — never panics — when neither source has content.
func loadMappingBytes() ([]byte, error) {
	if b, err := embeddedMappingFS.ReadFile(mappingFileName); err == nil && len(b) > 0 {
		return b, nil
	}
	if b, err := os.ReadFile(mappingFileName); err == nil && len(b) > 0 {
		return b, nil
	}
	return nil, fmt.Errorf("%s not found (embedded or on disk)", mappingFileName)
}
