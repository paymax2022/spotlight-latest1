package marketplace

import (
	"regexp"
	"strings"
)

// Auto-moderation pre-filter (§2.1 submit). Risk-tier-0 categories auto-approve for
// trusted sellers straight to `active` with no human review — so a content screen
// MUST run first, or a trusted account can publish prohibited content instantly.
// This is a conservative, dependency-free keyword screen: a hit does NOT auto-reject
// (a human decides) — it only DENIES the auto-approve fast-path and routes the listing
// to pending_review with a reason. The keyword set is a deliberately small,
// high-precision starter list; admins extend the real policy list over time.

// systemActorID is the nil-UUID actor recorded in the immutable audit trail for
// automated (non-human) decisions such as the auto-moderation flag. admin_id is a
// NOT-NULL uuid column, so automated writes attribute to the all-zeros UUID.
const systemActorID = "00000000-0000-0000-0000-000000000000"

// prohibitedPatterns maps a moderation reason code to the terms that trip it. Terms
// are matched case-insensitively on word boundaries so "gun" does not match "began".
var prohibitedPatterns = map[string][]string{
	"weapons":          {"ak47", "ak-47", "handgun", "handguns", "firearm", "firearms", "ammunition", "ammo", "grenade", "grenades"},
	"drugs":            {"cocaine", "heroin", "mdma", "meth", "methamphetamine", "tramadol", "codeine syrup"},
	"counterfeit":      {"counterfeit", "fake currency", "cloned card", "cloned cards", "cvv dump", "cvv dumps"},
	"human_harm":       {"human organ", "human organs", "kidney for sale"},
	"payment_evasion":  {"pay outside", "cash only no escrow", "bypass escrow", "send to my account first"},
	"prohibited_wildlife": {"ivory tusk", "pangolin scales", "elephant tusk"},
}

// compiledProhibited is prohibitedPatterns compiled once into word-boundary regexps.
var compiledProhibited = func() map[string]*regexp.Regexp {
	out := make(map[string]*regexp.Regexp, len(prohibitedPatterns))
	for reason, terms := range prohibitedPatterns {
		quoted := make([]string, len(terms))
		for i, t := range terms {
			quoted[i] = regexp.QuoteMeta(t)
		}
		// \b works for the alnum-boundary terms; phrases with spaces still match.
		out[reason] = regexp.MustCompile(`(?i)\b(` + strings.Join(quoted, "|") + `)\b`)
	}
	return out
}()

// screenText reports the first prohibited-content reason found in text, or "" if clean.
// Deterministic order is not guaranteed across reasons (map iteration), but any hit is
// sufficient to route to review, so the exact reason among multiple hits is not
// safety-critical.
func screenText(text string) string {
	if strings.TrimSpace(text) == "" {
		return ""
	}
	for reason, re := range compiledProhibited {
		if re.MatchString(text) {
			return reason
		}
	}
	return ""
}

// screenListingContent screens a listing's user-authored surface (title, description,
// and string-valued attrs) and returns a reason code if anything trips the filter.
// Pure and testable — no I/O.
func screenListingContent(title, description string, attrs map[string]any) string {
	if r := screenText(title); r != "" {
		return r
	}
	if r := screenText(description); r != "" {
		return r
	}
	for _, v := range attrs {
		if sv, ok := v.(string); ok {
			if r := screenText(sv); r != "" {
				return r
			}
		}
	}
	return ""
}
