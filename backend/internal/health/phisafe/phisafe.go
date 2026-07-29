// Package phisafe is a pure, deterministic guard against leaking protected health
// information (PHI) in notifications (test plan NT-002 / EC-013): a push/SMS/email
// subject or body, and any link it carries, must NOT contain the patient's name,
// date of birth, a specific result value, or a record/patient id. The notification
// says "your result is ready" and links via an opaque token; the PHI stays behind
// the consent-gated, access-logged record vault.
//
// Callers assemble the PHI terms for the recipient/context (name, DOB, result
// value, record id, …) and route notification content through GuardNotification
// before sending.
package phisafe

import (
	"fmt"
	"strings"
)

// minTermLen ignores PHI terms shorter than this so stray initials/short tokens
// don't cause false positives.
const minTermLen = 3

// LeakError identifies which notification field leaked which PHI term.
type LeakError struct {
	Field string // subject | body | link
	Term  string
}

func (e *LeakError) Error() string {
	return fmt.Sprintf("phisafe: notification %s contains PHI (%q) — remove it and link via an opaque token", e.Field, e.Term)
}

// LeakedTerm returns the first PHI term from `phi` that appears in `text`
// (case-insensitive), or "" if none. Empty or too-short terms are ignored.
func LeakedTerm(text string, phi []string) string {
	lower := strings.ToLower(text)
	for _, term := range phi {
		t := strings.TrimSpace(term)
		if len([]rune(t)) < minTermLen {
			continue
		}
		if strings.Contains(lower, strings.ToLower(t)) {
			return term
		}
	}
	return ""
}

// GuardNotification checks a notification's subject, body, and link for PHI
// leakage and returns a *LeakError on the first offending field (NT-002/EC-013).
// A link is checked as a whole string, so a record/patient id or a name embedded in
// its path or query is caught — forcing a tokenized link.
func GuardNotification(subject, body, link string, phi []string) error {
	for _, f := range []struct {
		field, text string
	}{
		{"subject", subject},
		{"body", body},
		{"link", link},
	} {
		if term := LeakedTerm(f.text, phi); term != "" {
			return &LeakError{Field: f.field, Term: term}
		}
	}
	return nil
}
