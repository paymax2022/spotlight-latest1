package dojah

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
)

// geo.go — Dojah reference data for Nigerian geography (Wallet Utilities).
// GET /api/v1/general/states and GET /api/v1/general/states/lgas?state=<State>.
// Read-only lookups used to populate the doctor profile address pickers.
// Returns an error when unconfigured or when Dojah cannot answer, so the caller
// (a proxy endpoint) can surface 503 and the app can fall back to a static list.

// ListStates returns the Nigerian state names.
func (c *Client) ListStates(ctx context.Context) ([]string, error) {
	if !c.configured() {
		return nil, fmt.Errorf("dojah: geo not configured (missing DOJAH_APP_ID / DOJAH_SECRET_KEY)")
	}
	raw, err := c.get(ctx, "/api/v1/general/states", nil)
	if err != nil {
		return nil, err
	}
	return extractStringList(raw, "states")
}

// ListLgas returns the Local Government Areas for a state name.
func (c *Client) ListLgas(ctx context.Context, state string) ([]string, error) {
	if !c.configured() {
		return nil, fmt.Errorf("dojah: geo not configured (missing DOJAH_APP_ID / DOJAH_SECRET_KEY)")
	}
	raw, err := c.get(ctx, "/api/v1/general/states/lgas?state="+url.QueryEscape(state), nil)
	if err != nil {
		return nil, err
	}
	return extractStringList(raw, "lgas")
}

// extractStringList reads a []string from a Dojah JSON body, tolerating both the
// top-level shape {"states":[...]} and the wrapped {"data":{"states":[...]}} /
// {"entity":{"states":[...]}} envelopes Dojah uses across versions.
func extractStringList(raw []byte, key string) ([]string, error) {
	var env map[string]json.RawMessage
	if err := json.Unmarshal(raw, &env); err != nil {
		return nil, fmt.Errorf("dojah: decode geo: %w", err)
	}
	for _, container := range []string{"", "data", "entity", "responseBody"} {
		src := env
		if container != "" {
			var nested map[string]json.RawMessage
			if err := json.Unmarshal(env[container], &nested); err != nil {
				continue
			}
			src = nested
		}
		if arr, ok := src[key]; ok {
			var out []string
			if err := json.Unmarshal(arr, &out); err == nil && len(out) > 0 {
				return out, nil
			}
		}
	}
	return nil, fmt.Errorf("dojah: geo response missing %q", key)
}
