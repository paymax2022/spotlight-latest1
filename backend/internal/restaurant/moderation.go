package restaurant

import "strings"

// bannedReviewTerms is a small abuse/profanity list; a comment containing any is
// auto-flagged for a human moderator (not auto-hidden — a false positive shouldn't
// silently suppress a legitimate review). Deliberately conservative.
var bannedReviewTerms = []string{"scam", "fraud", "idiot", "stupid", "fuck", "shit", "bitch", "kill you"}

// sanitizeReviewComment cleans a review comment the same way order instructions are
// cleaned (SEC-007): control chars stripped, whitespace collapsed, length-capped.
func sanitizeReviewComment(s string) string { return sanitizeInstructions(s) }

// autoFlagComment returns the initial moderation status for a new review: "flagged"
// when the (already-sanitized) comment contains a banned term, else "visible".
func autoFlagComment(comment string) string {
	lc := strings.ToLower(comment)
	for _, w := range bannedReviewTerms {
		if strings.Contains(lc, w) {
			return "flagged"
		}
	}
	return "visible"
}

// maskEmail masks the local part of an email for support/rider views (SEC-009):
// "amara.obi@gmail.com" → "am****@gmail.com". Non-emails are returned fully masked.
func maskEmail(s string) string {
	at := strings.IndexByte(s, '@')
	if at <= 0 {
		return maskTail(s, 0)
	}
	local, domain := s[:at], s[at:]
	keep := 2
	if len(local) < keep {
		keep = len(local)
	}
	return local[:keep] + "****" + domain
}

// maskPhone keeps the last 3 digits of a phone number (SEC-009):
// "08031234567" → "********567".
func maskPhone(s string) string {
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, s)
	if len(digits) <= 3 {
		return strings.Repeat("*", len(digits))
	}
	return strings.Repeat("*", len(digits)-3) + digits[len(digits)-3:]
}

// maskDeliveryAddress redacts a customer's precise address for OFFERED (not-yet-assigned)
// riders (SEC-009 PII minimization): only the assigned rider sees the full address. It
// keeps the last comma-separated segment (the area/city) and masks the street detail —
// "12b Adeola St, Victoria Island, Lagos" → "…, Victoria Island, Lagos".
func maskDeliveryAddress(s string) string {
	parts := strings.Split(s, ",")
	if len(parts) <= 1 {
		return "…" // no structure to keep — hide entirely
	}
	// keep the last up-to-2 segments (area, city).
	keep := 2
	if len(parts) < keep {
		keep = len(parts)
	}
	tail := parts[len(parts)-keep:]
	for i := range tail {
		tail[i] = strings.TrimSpace(tail[i])
	}
	return "…, " + strings.Join(tail, ", ")
}

// maskTail keeps `keep` leading chars and masks the rest.
func maskTail(s string, keep int) string {
	if len(s) <= keep {
		return strings.Repeat("*", len(s))
	}
	return s[:keep] + strings.Repeat("*", len(s)-keep)
}
