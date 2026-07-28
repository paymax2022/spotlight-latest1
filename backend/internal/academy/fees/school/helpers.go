package feesschool

import "encoding/json"

// nullStr maps an empty string to a SQL NULL so COALESCE-based partial updates leave the
// column unchanged and NOT-NULL-optional columns stay NULL rather than empty-string.
func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// nullUUID maps an empty string to NULL for uuid columns (entity_id is uuid).
func nullUUID(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// deref returns the pointed-to string or "" for a nil pointer.
func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// ptrOrNil returns a *string for a non-empty value, or nil.
func ptrOrNil(s string) *string {
	if s == "" {
		return nil
	}
	v := s
	return &v
}

// toJSON marshals a detail payload for the audit_logs jsonb column, never returning nil.
func toJSON(v any) []byte {
	if v == nil {
		return []byte("{}")
	}
	if b, ok := v.([]byte); ok {
		if len(b) == 0 {
			return []byte("{}")
		}
		return b
	}
	b, err := json.Marshal(v)
	if err != nil {
		return []byte("{}")
	}
	return b
}
