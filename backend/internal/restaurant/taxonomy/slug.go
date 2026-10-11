package taxonomy

import (
	"strings"
	"unicode"
)

var accents = strings.NewReplacer("é", "e", "è", "e", "ê", "e", "ë", "e", "á", "a", "à", "a", "â", "a", "ä", "a",
	"ó", "o", "ò", "o", "ô", "o", "ö", "o", "ú", "u", "ù", "u", "û", "u", "ü", "u", "í", "i", "ì", "i", "î", "i",
	"ñ", "n", "ç", "c", "É", "e", "Ö", "o", "Ü", "u")

// Slugify mirrors the seed generator: lower-case, "&" becomes "and", apostrophes
// are dropped, accents are folded, and every other run of non-alphanumerics is a
// single hyphen. The seed file stores slugs already, so this is for admin-created rows.
func Slugify(name string) string {
	if !strings.ContainsFunc(name, func(r rune) bool { return unicode.IsLetter(r) || unicode.IsDigit(r) }) {
		return ""
	}
	s := accents.Replace(name)
	s = strings.ReplaceAll(s, "&", " and ")
	s = strings.ReplaceAll(s, "'", "")
	var b strings.Builder
	dash := true
	for _, r := range strings.ToLower(s) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			dash = false
			continue
		}
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			continue
		}
		if !dash {
			b.WriteByte('-')
			dash = true
		}
	}
	return strings.TrimSuffix(b.String(), "-")
}
