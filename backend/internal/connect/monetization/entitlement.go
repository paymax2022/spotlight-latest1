package connectmonetization

import (
	"encoding/json"
	"time"
)

// featureEnabled reports whether any of the given entitlements enables a named
// boolean feature, OR carries a positive numeric quota for it. Pure function so
// the server-side enforcement rule is unit-testable without a DB.
//
// A feature is "enabled" when, across active entitlements, its value is:
//   - boolean true, or
//   - a number > 0 (a quota such as super_likes_per_day).
func featureEnabled(ents []Entitlement, feature string) bool {
	for _, e := range ents {
		if !e.Active {
			continue
		}
		if e.ExpiresAt != nil && !e.ExpiresAt.After(time.Now().UTC()) {
			continue
		}
		var m map[string]json.RawMessage
		if err := json.Unmarshal(e.Features, &m); err != nil {
			continue
		}
		raw, ok := m[feature]
		if !ok {
			continue
		}
		var b bool
		if err := json.Unmarshal(raw, &b); err == nil {
			if b {
				return true
			}
			continue
		}
		var n float64
		if err := json.Unmarshal(raw, &n); err == nil && n > 0 {
			return true
		}
	}
	return false
}
