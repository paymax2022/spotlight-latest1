// Package connectconfig exposes the backend-owned Paymax Connect configuration
// (feature flags, matching weights, discovery/anti-fatigue limits, moderation
// rules, verification requirements). Mobile reads ONLY the public subset; all
// values live in the public.connect_config table and are never hard-coded in
// the client. See docs/prd/dating/architecture.md §26.4.
package connectconfig

import "encoding/json"

// Entry is a single backend-owned config row.
type Entry struct {
	Key         string          `json:"key"`
	Value       json.RawMessage `json:"value"`
	Scope       string          `json:"scope"`
	Visibility  string          `json:"visibility"` // "public" (mobile-readable) | "internal"
	Description string          `json:"description,omitempty"`
}
