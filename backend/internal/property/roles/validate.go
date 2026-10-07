package roles

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

const maxDetailsBytes = 8 * 1024

type keyType int

const (
	tString keyType = iota
	tStringList
	tCount
)

var allowedKeys = map[string]map[string]keyType{
	RoleAgent: {
		"licenceNumber": tString, "operatingStates": tStringList, "agencyName": tString,
		"bio": tString, "specialisations": tString,
	},
	RoleDeveloper: {
		"companyName": tString, "cacNumber": tString, "website": tString, "projectSummary": tString,
	},
	RoleEstateManager: {
		"organisationName": tString, "estatesManaged": tCount,
	},
}

var requiredKeys = map[string][]string{
	RoleAgent:         {"licenceNumber", "operatingStates"},
	RoleDeveloper:     {"companyName", "cacNumber"},
	RoleEstateManager: {"organisationName"},
}

// identityKeys reset verification when changed on a verified or pending profile.
var identityKeys = map[string]string{
	RoleAgent:         "licenceNumber",
	RoleDeveloper:     "cacNumber",
	RoleEstateManager: "organisationName",
}

func bad(format string, a ...any) error {
	return fmt.Errorf("%w: %s", ErrDetailsInvalid, fmt.Sprintf(format, a...))
}

// ValidateDetails rejects unknown keys, wrong types and payloads over 8 KB.
func ValidateDetails(role string, details map[string]any) error {
	allowed, ok := allowedKeys[role]
	if !ok {
		return ErrInvalidRole
	}
	b, err := json.Marshal(details)
	if err != nil {
		return bad("not serialisable")
	}
	if len(b) > maxDetailsBytes {
		return bad("exceeds %d bytes", maxDetailsBytes)
	}
	for k, v := range details {
		t, known := allowed[k]
		if !known {
			return bad("unknown key %q for role %s", k, role)
		}
		switch t {
		case tString:
			if _, ok := v.(string); !ok {
				return bad("%s must be a string", k)
			}
		case tStringList:
			if !isStringList(v) {
				return bad("%s must be an array of strings", k)
			}
		case tCount:
			f, ok := asNumber(v)
			if !ok || f < 0 || f != math.Trunc(f) {
				return bad("%s must be a non-negative whole number", k)
			}
		}
	}
	return nil
}

func isStringList(v any) bool {
	switch l := v.(type) {
	case []string:
		return true
	case []any:
		for _, e := range l {
			if _, ok := e.(string); !ok {
				return false
			}
		}
		return true
	}
	return false
}

func asNumber(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	}
	return 0, false
}

// MissingForSubmit lists required keys that are absent, blank or empty.
func MissingForSubmit(role string, details map[string]any) []string {
	missing := []string{}
	for _, k := range requiredKeys[role] {
		if blank(details[k]) {
			missing = append(missing, k)
		}
	}
	return missing
}

func blank(v any) bool {
	switch x := v.(type) {
	case nil:
		return true
	case string:
		return strings.TrimSpace(x) == ""
	case []any:
		return len(x) == 0
	case []string:
		return len(x) == 0
	}
	return false
}
