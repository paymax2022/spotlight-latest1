package claims

import (
	"encoding/json"
	"regexp"
	"strings"
	"unicode/utf8"
)

var (
	statusRe = regexp.MustCompile(`^[a-z0-9_]{1,32}$`)
	uuidRe   = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
)

// maskPatient reveals at most the first four characters of a patient identifier.
func maskPatient(id *string) string {
	if id == nil {
		return "—"
	}
	s := strings.TrimSpace(*id)
	if s == "" {
		return "—"
	}
	if utf8.RuneCountInString(s) <= 4 {
		return "••••"
	}
	r := []rune(s)
	return string(r[:4]) + "•••"
}

// likePattern escapes LIKE metacharacters so a search term is matched literally.
func likePattern(q string) string {
	q = strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(strings.TrimSpace(q))
	return "%" + q + "%"
}

// detailAllow is the closed set of top-level detail keys an admin may see. Detail
// is client-supplied free-form JSON that can carry patient names or clinical
// narrative, so anything not listed here is dropped rather than redacted.
var detailAllow = map[string]bool{
	"hmo": true, "plan": true, "payer": true, "provider": true,
	"service": true, "services": true, "description": true,
	"reason": true, "dispute_reason": true, "rejection_reason": true,
	"note": true, "message": true, "summary": true, "title": true,
	"approved_kobo": true, "claimed_kobo": true, "decided_at": true,
	"timeline": true, "specialty": true, "urgency": true,
	"admin_review": true,
}

const maxDetailString = 500

// sanitizeDetail keeps only allow-listed keys and truncates long strings.
func sanitizeDetail(raw []byte) map[string]any {
	out := map[string]any{}
	if len(raw) == 0 {
		return out
	}
	var in map[string]any
	if err := json.Unmarshal(raw, &in); err != nil {
		return out
	}
	for k, v := range in {
		if detailAllow[k] {
			out[k] = truncateStrings(v)
		}
	}
	return out
}

func truncateStrings(v any) any {
	switch t := v.(type) {
	case string:
		if utf8.RuneCountInString(t) > maxDetailString {
			return string([]rune(t)[:maxDetailString]) + "…"
		}
		return t
	case []any:
		for i := range t {
			t[i] = truncateStrings(t[i])
		}
		return t
	case map[string]any:
		for k := range t {
			t[k] = truncateStrings(t[k])
		}
		return t
	default:
		return v
	}
}

// warningSummary picks the first non-empty allow-listed text field of a warning.
func warningSummary(raw []byte) string {
	d := sanitizeDetail(raw)
	for _, k := range []string{"summary", "message", "reason", "description", "title"} {
		if s, ok := d[k].(string); ok && strings.TrimSpace(s) != "" {
			return s
		}
	}
	return ""
}
