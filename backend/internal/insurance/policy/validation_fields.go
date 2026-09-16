package policy

import (
	"regexp"
	"strings"
)

// validationFields turns an insurer's validation complaints into a per-field map
// the applicant's form can highlight.
//
// WHY THIS EXISTS
// A rejected application is only fixable if the person can see WHICH answer is
// wrong. The client attributes a message to a field by its leading token, which
// works for MyCover's per-field shape but not for its summary shape:
//
//	per-field : "email must be an email"                        -> attributable
//	summary   : "missing required fields: email, phone_number"  -> starts with
//	                                                               prose, so the
//	                                                               client
//	                                                               highlights
//	                                                               nothing
//
// Expanding the summary here is what turns "something is wrong" into "these
// three inputs are wrong". Both shapes are real; both were observed live.
//
// ⚠️ It never GUESSES. Prose that names no field yields no entry, because a
// wrong highlight is worse than none — it sends someone to edit an answer that
// was already correct, and they cannot tell that we are the ones confused.
// Unattributable messages still reach the client in the message list, so nothing
// is hidden; they simply appear as a form-level error instead of a field one.

// "…missing required fields: a, b, c" — the trailing list is what we want.
var missingFieldsRe = regexp.MustCompile(`(?i)missing required fields?\s*:\s*(.+)$`)

// A leading snake_case token followed by the complaint. Mirrors the client's
// attributeMessage so the two agree about what counts as a field name.
var leadingFieldRe = regexp.MustCompile(`^([a-z][a-z0-9_]{1,60})(?:\.\d+)?\s+(.+)$`)

// looksLikeFieldName keeps prose out. Provider field names in this integration
// are lower-case identifiers; an English word that happens to be lower-case is
// filtered by requiring it to appear in a field-list context or carry the
// complaint suffix, which the two call sites below enforce.
func looksLikeFieldName(s string) bool {
	if s == "" || len(s) > 60 {
		return false
	}
	for i, r := range s {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= '0' && r <= '9' && i > 0:
		case r == '_' && i > 0:
		default:
			return false
		}
	}
	return true
}

func validationFields(messages []string) map[string]string {
	out := map[string]string{}

	for _, raw := range messages {
		m := strings.TrimSpace(raw)
		if m == "" {
			continue
		}

		// Summary shape: expand the trailing list into one entry per field. The
		// provider does not say WHY each is wrong beyond being absent, so the
		// message is ours — the only honest thing to say is that it is required.
		if g := missingFieldsRe.FindStringSubmatch(m); g != nil {
			for _, part := range strings.Split(g[1], ",") {
				f := strings.Trim(strings.TrimSpace(part), ".;")
				if looksLikeFieldName(f) {
					if _, exists := out[f]; !exists {
						out[f] = "This is required."
					}
				}
			}
			continue
		}

		// Per-field shape: keep the insurer's wording, minus the field name that
		// prefixes it. Their wording is the rule the applicant has to satisfy, so
		// rewriting it would be us paraphrasing a requirement we do not own.
		if g := leadingFieldRe.FindStringSubmatch(m); g != nil && looksLikeFieldName(g[1]) {
			if _, exists := out[g[1]]; !exists {
				rest := g[2]
				out[g[1]] = strings.ToUpper(rest[:1]) + rest[1:]
			}
		}
	}

	return out
}
