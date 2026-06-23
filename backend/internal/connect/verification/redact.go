package connectverification

// redactedMarker is the only thing that should ever reach logs in place of
// verification PII.
const redactedMarker = "[redacted]"

// Redact returns a constant marker for any non-empty sensitive value, so
// verification identifiers / biometric references can never leak into logs,
// error messages, or audit payloads (invariant 5).
func Redact(s string) string {
	if s == "" {
		return ""
	}
	return redactedMarker
}

// RedactFields returns a copy of m with the given keys replaced by the redact
// marker — convenient for sanitising structured log/audit maps before they are
// written.
func RedactFields(m map[string]any, sensitiveKeys ...string) map[string]any {
	if m == nil {
		return nil
	}
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = v
	}
	for _, k := range sensitiveKeys {
		if _, ok := out[k]; ok {
			out[k] = redactedMarker
		}
	}
	return out
}
