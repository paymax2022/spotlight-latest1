// Package strutil replaces the string helpers copy-pasted across internal
// modules (firstNonEmpty, orStr, normalizers).
// Nothing here allocates beyond the returned string.
package strutil

import (
	"strings"
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
