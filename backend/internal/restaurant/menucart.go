package restaurant

import (
	"fmt"
	"sort"
	"strings"
	"unicode"
)

const (
	// maxItemPriceKobo caps a single menu item at ₦1,000,000 (MN-004 — a sanity bound
	// against fat-finger/overflow prices; the DB already forbids negatives).
	maxItemPriceKobo = 100_000_000
	// maxInstructionsLen caps the free-text order note (CT-009).
	maxInstructionsLen = 500
	// maxDietaryTags / maxTagLen bound the per-item dietary label set (MN-009).
	maxDietaryTags = 12
	maxTagLen      = 32
)

// validateItemPriceKobo enforces the menu-item price bounds (MN-004): non-negative and
// no larger than maxItemPriceKobo.
func validateItemPriceKobo(kobo int64) error {
	if kobo < 0 {
		return fmt.Errorf("restaurant: price_kobo must be >= 0")
	}
	if kobo > maxItemPriceKobo {
		return fmt.Errorf("restaurant: price_kobo must be <= %d (₦1,000,000)", maxItemPriceKobo)
	}
	return nil
}

// sanitizeInstructions cleans a customer's free-text order note (CT-009): strips control
// characters (so no injected escape/format bytes reach downstream views), collapses
// runs of whitespace, trims, and caps the length. Purely defensive normalization — it
// never trusts client formatting.
func sanitizeInstructions(s string) string {
	var b strings.Builder
	lastSpace := false
	for _, r := range s {
		if r == '\n' || r == '\t' {
			r = ' '
		}
		if unicode.IsControl(r) {
			continue // drop other control chars
		}
		if r == ' ' {
			if lastSpace {
				continue
			}
			lastSpace = true
		} else {
			lastSpace = false
		}
		b.WriteRune(r)
	}
	out := strings.TrimSpace(b.String())
	if len(out) > maxInstructionsLen {
		out = strings.TrimSpace(out[:maxInstructionsLen])
	}
	return out
}

// normalizeDietaryTags cleans a set of dietary/allergen labels (MN-009): lower-cased,
// trimmed, de-duplicated, sorted (stable output), each capped at maxTagLen, empties
// dropped, and the whole set capped at maxDietaryTags. Open vocabulary (vegan,
// vegetarian, halal, gluten_free, contains_nuts, …) — normalized, not white-listed.
func normalizeDietaryTags(tags []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, t := range tags {
		t = strings.ToLower(strings.TrimSpace(t))
		t = strings.ReplaceAll(t, " ", "_")
		if t == "" || seen[t] {
			continue
		}
		if len(t) > maxTagLen {
			t = t[:maxTagLen]
		}
		seen[t] = true
		out = append(out, t)
		if len(out) >= maxDietaryTags {
			break
		}
	}
	sort.Strings(out)
	return out
}
