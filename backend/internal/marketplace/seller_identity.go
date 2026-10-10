package marketplace

import (
	"fmt"
	"strings"
	"time"
	"unicode"
)

// The seller profile, the seller card on a listing, the followed list and the
// blocked list all name a person who never agreed to publish their legal name to
// anonymous browsers. One helper keeps every screen showing the same, privacy-safe
// name instead of "Tunde Adeyemi" on one screen and "Tunde A." on another.

// publicSellerFallback is shown when a profile has no usable name.
const publicSellerFallback = "Seller"

// PublicDisplayName reduces a full name to "First L." — the first word and the
// initial of the last — and never returns an empty string.
func PublicDisplayName(full string) string {
	words := strings.Fields(full)
	switch len(words) {
	case 0:
		return publicSellerFallback
	case 1:
		return words[0]
	}
	last := []rune(words[len(words)-1])
	if len(last) == 0 || !unicode.IsLetter(last[0]) {
		return words[0]
	}
	return fmt.Sprintf("%s %s.", words[0], strings.ToUpper(string(last[0])))
}

// TenureLabel is the server-computed, ungameable "how long on the platform" badge
// (the seller screen shows it as-is; the client must not derive it).
func TenureLabel(now, since time.Time) string {
	if since.IsZero() || since.After(now) {
		return ""
	}
	days := int(now.Sub(since).Hours() / 24)
	switch {
	case days < 30:
		return "New seller"
	case days < 365:
		if months := days / 30; months > 1 {
			return fmt.Sprintf("%d months on Paymax", months)
		}
		return "1 month on Paymax"
	default:
		years := days / 365
		if years == 1 {
			return "1 year on Paymax"
		}
		return fmt.Sprintf("%d years on Paymax", years)
	}
}
