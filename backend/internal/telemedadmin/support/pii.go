package support

import (
	"encoding/json"
	"strings"
)

// piiKeyMarkers are substrings that mark a free-form detail key as patient
// identity. Emergency/dispute payloads are client-authored JSON, so the admin
// list/detail never echoes these back.
var piiKeyMarkers = []string{
	"name", "phone", "email", "address", "birth", "contact",
	"next_of_kin", "nextofkin", "guardian", "passport",
}

// piiExactKeys are short identifiers matched whole, so "meaning" survives.
var piiExactKeys = map[string]bool{"dob": true, "nin": true, "bvn": true, "ssn": true}

func isPIIKey(key string) bool {
	k := strings.ToLower(key)
	if piiExactKeys[k] {
		return true
	}
	// The markers are deliberately blunt: a false positive hides a field, a
	// false negative leaks a patient.
	for _, m := range piiKeyMarkers {
		if strings.Contains(k, m) {
			return true
		}
	}
	return false
}

// scrubDetail parses a JSON object and drops identity-looking keys at any
// depth. Non-object payloads yield nil.
func scrubDetail(raw []byte) map[string]any {
	if len(raw) == 0 {
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil || m == nil {
		return nil
	}
	return scrubMap(m)
}

func scrubMap(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		if isPIIKey(k) {
			continue
		}
		out[k] = scrubValue(v)
	}
	return out
}

func scrubValue(v any) any {
	switch t := v.(type) {
	case map[string]any:
		return scrubMap(t)
	case []any:
		out := make([]any, 0, len(t))
		for _, e := range t {
			out = append(out, scrubValue(e))
		}
		return out
	default:
		return v
	}
}

// maskRef shows only the first 4 and last 2 characters of an identifier.
func maskRef(s string) string {
	s = strings.TrimSpace(s)
	switch {
	case s == "":
		return ""
	case len(s) <= 6:
		return strings.Repeat("•", len(s))
	}
	return s[:4] + "…" + s[len(s)-2:]
}
