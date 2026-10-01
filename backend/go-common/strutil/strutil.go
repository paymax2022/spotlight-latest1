// Package strutil replaces the string helpers copy-pasted across internal
// modules (firstNonEmpty, orStr, normalizers, masks, token formatting).
// Nothing here allocates beyond the returned string.
package strutil

import (
	"strings"
	"unicode/utf8"
)

// FirstNonEmpty returns the first argument that is not "" — the variadic
// superset of every firstNonEmpty(a, b) copy in the codebase.
func FirstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// FirstNonBlank is FirstNonEmpty with whitespace trimming — a value that is
// only spaces/tabs counts as blank.
func FirstNonBlank(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// Or returns s or def when s is "".
func Or(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

// OrBlank is Or with whitespace trimming.
func OrBlank(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}

// Normalize lowercases and trims — the canonical form for case-insensitive
// identifiers (slugs, emails-as-keys, status strings from webhooks).
func Normalize(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}

// NormalizeCode uppercases and trims — the canonical form for user-facing
// codes (referral codes, invite codes, tickers).
func NormalizeCode(s string) string {
	return strings.ToUpper(strings.TrimSpace(s))
}

// Truncate cuts s at n bytes, appending no ellipsis — byte-exact, so callers
// enforcing column limits get predictable storage.
func Truncate(s string, n int) string {
	if n < 0 || len(s) <= n {
		return s
	}
	return s[:n]
}

// TruncateRunes cuts s at n runes — the correct form for user-visible text
// where a mid-rune byte cut would corrupt UTF-8.
func TruncateRunes(s string, n int) string {
	if n < 0 || utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return string(r[:n])
}

// Ellipsis truncates to n runes and appends "…" when it cut — log and UI safe.
func Ellipsis(s string, n int) string {
	if n <= 0 || utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n-1]) + "…"
}

// MaskRight keeps the first keep runes and masks the rest — the MaskPhone /
// card-display pattern: MaskRight("08031234567", 4) == "0803*******".
func MaskRight(s string, keep int) string {
	r := []rune(s)
	if keep < 0 {
		keep = 0
	}
	if keep >= len(r) {
		return s
	}
	return string(r[:keep]) + strings.Repeat("*", len(r)-keep)
}

// MaskLeft keeps the last keep runes and masks the rest — for account numbers
// and tokens where the tail identifies (…4567).
func MaskLeft(s string, keep int) string {
	r := []rune(s)
	if keep < 0 {
		keep = 0
	}
	if keep >= len(r) {
		return s
	}
	return strings.Repeat("*", len(r)-keep) + string(r[len(r)-keep:])
}

// ContainsFold reports case-insensitive substring membership — the recurring
// strings.Contains(strings.ToLower(a), strings.ToLower(b)) pair.
func ContainsFold(s, substr string) bool {
	return strings.Contains(strings.ToLower(s), strings.ToLower(substr))
}

// EqualFold reports case-insensitive equality after trimming both sides.
func EqualFold(a, b string) bool {
	return strings.EqualFold(strings.TrimSpace(a), strings.TrimSpace(b))
}

// SplitCSV splits a comma-separated value into trimmed non-empty parts —
// replaces the repeated FieldsFunc/TrimSpace/append-empty-check block.
func SplitCSV(s string) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if v := strings.TrimSpace(p); v != "" {
			out = append(out, v)
		}
	}
	return out
}

// JoinNonEmpty joins only the non-blank parts with sep — builds display
// strings like "Lagos, Nigeria" without dangling separators.
func JoinNonEmpty(sep string, parts ...string) string {
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if v := strings.TrimSpace(p); v != "" {
			out = append(out, v)
		}
	}
	return strings.Join(out, sep)
}

// NormalizeSpace collapses every run of whitespace (incl. newlines/tabs) to a
// single space and trims — for user input stored/displayed normalized.
func NormalizeSpace(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// Cap uppercases the first rune only — display titles where strings.Title's
// per-word behaviour (and deprecation) is wrong.
func Cap(s string) string {
	if s == "" {
		return s
	}
	r := []rune(s)
	r[0] = []rune(strings.ToUpper(string(r[0])))[0]
	return string(r)
}

// Initials returns up to n uppercase initials of the words in s — avatar
// fallbacks and compact person display ("Ada Lovelace" → "AL").
func Initials(s string, n int) string {
	if n <= 0 {
		n = 2
	}
	var out []rune
	for w := range strings.FieldsSeq(s) {
		r := []rune(w)
		if len(r) == 0 {
			continue
		}
		out = append(out, []rune(strings.ToUpper(string(r[0])))[0])
		if len(out) == n {
			break
		}
	}
	return string(out)
}

// Snake converts CamelCase/mixed input to snake_case — for deriving stable
// slugs/column names from Go-style identifiers in codegen-adjacent paths.
func Snake(s string) string {
	var b strings.Builder
	prevLower := false
	for i, r := range s {
		isUpper := r >= 'A' && r <= 'Z'
		if isUpper && i > 0 && prevLower {
			b.WriteByte('_')
		}
		switch {
		case r == ' ' || r == '-':
			b.WriteByte('_')
		case isUpper:
			b.WriteRune(r + ('a' - 'A'))
		default:
			b.WriteRune(r)
		}
		prevLower = !isUpper && r != ' ' && r != '-'
	}
	return b.String()
}
