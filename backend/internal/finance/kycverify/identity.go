package kycverify

import (
	"strings"
	"time"
)

// VerifiedIdentity is the authoritative legal identity Paymax persists to a
// user's profile after a PASSED ID-number data-match. It is SOURCED FROM THE
// PROVIDER RESPONSE — never collected from the user — so a mistyped name or DOB
// can never land on a verified profile.
type VerifiedIdentity struct {
	FullName  string
	FirstName string
	LastName  string
	// DOB is normalized to ISO "YYYY-MM-DD" (the form Postgres DATE accepts), or
	// "" when the provider returned no parseable date of birth.
	DOB string
}

// dobLayouts are the date formats a provider may return, tried in order. ISO
// first (unambiguous); then day-first (Dojah commonly returns DD-MM-YYYY). We
// deliberately do NOT try a month-first layout for the "-"/"/" forms: it would
// silently mis-parse a day-first date (e.g. 02-05-1990 as Feb 5), which is worse
// than dropping an ambiguous value.
var dobLayouts = []string{
	"2006-01-02",
	"02-01-2006",
	"02/01/2006",
	"2006/01/02",
}

// ExtractVerifiedIdentity pulls the verified legal name + DOB out of a provider
// ID-number data-match result's flattened ExtractedFields. It returns ok=false
// when there is no usable name (no first, last, or full name) — an empty
// identity is never persisted over whatever the profile already holds. DOB is
// best-effort: a missing or unparseable date yields DOB="" with ok still true
// as long as a name is present.
func ExtractVerifiedIdentity(fields map[string]string) (VerifiedIdentity, bool) {
	if len(fields) == 0 {
		return VerifiedIdentity{}, false
	}
	first := firstNonEmpty(fields, "first_name", "firstName", "firstname")
	last := firstNonEmpty(fields, "last_name", "lastName", "lastname", "surname")
	full := firstNonEmpty(fields, "full_name", "fullName", "fullname")

	id := VerifiedIdentity{FirstName: first, LastName: last}
	switch {
	case full != "":
		id.FullName = full
	default:
		id.FullName = strings.TrimSpace(strings.Join(nonEmpty(first, last), " "))
	}
	if id.FullName == "" && first == "" && last == "" {
		return VerifiedIdentity{}, false
	}

	if raw := firstNonEmpty(fields, "date_of_birth", "dateOfBirth", "dob", "date_of_birth_"); raw != "" {
		id.DOB = normalizeDOB(raw)
	}
	return id, true
}

// normalizeDOB returns the ISO "YYYY-MM-DD" form of a provider date, or "" when
// it cannot be parsed by any known layout (never the raw, possibly-ambiguous
// string).
func normalizeDOB(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	for _, layout := range dobLayouts {
		if t, err := time.Parse(layout, raw); err == nil {
			return t.Format("2006-01-02")
		}
	}
	return ""
}

func firstNonEmpty(fields map[string]string, keys ...string) string {
	for _, k := range keys {
		if v := strings.TrimSpace(fields[k]); v != "" {
			return v
		}
	}
	return ""
}

func nonEmpty(vals ...string) []string {
	out := make([]string, 0, len(vals))
	for _, v := range vals {
		if v != "" {
			out = append(out, v)
		}
	}
	return out
}
