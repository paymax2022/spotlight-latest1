package referrals

// Referral code shape — generation, normalisation and validation.
//
// A referral code is READ ALOUD and TYPED IN by hand ("use my code 7KQ4M"), so
// length and legibility are the whole design. The engine used to issue
// "R" + hex(5 bytes) = 11 characters, which is unusable in that setting.
//
// Codes are now 5 characters from a 27-symbol alphabet: A-Z and 0-9 minus every
// character in a confusable pair — the letters O, I, L, S, Z and the digits 0,
// 1, 5, 2. BOTH halves of each pair go: keeping the digit and dropping only the
// letter still leaves a caller unsure which they heard. That is 27^5 ≈ 14.3
// million codes. Short codes collide far more readily than 11-character ones
// did, so every issuing path must retry on the unique index rather than assume
// success.

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"strings"
)

const (
	// CodeMaxLen is the ceiling for BOTH generated and admin-chosen codes.
	CodeMaxLen = 5
	// CodeMinLen keeps a custom code from being trivially guessable or blank.
	CodeMinLen = 3

	// codeAlphabet is used for GENERATED codes only. It omits every character in
	// a confusable pair — the letters O, I, L, S, Z and the digits 0, 1, 5, 2 —
	// because a random string has no meaning to anchor a misread character
	// against. 27 symbols; 27^5 ~= 14.3 million codes.
	codeAlphabet = "ABCDEFGHJKMNPQRTUVWXY346789"

	// codeAllowed is the WIDER set accepted for an ADMIN-CHOSEN code.
	//
	// The two differ deliberately. Applying the generator's alphabet to custom
	// codes would have made the feature almost useless: O, I, L, S and Z are
	// among the commonest letters, so SALES, GOLD, LAGOS and most human names
	// would be rejected. A chosen code is memorable, and that memorability is
	// what protects it from being misread — the property the restricted alphabet
	// exists to supply for random strings. An admin picking O0 confusion is
	// making an informed trade the generator cannot.
	codeAllowed = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
)

// GenerateCode returns a random code of CodeMaxLen characters.
//
// It uses crypto/rand with rejection-free modular selection via rand.Int, so the
// distribution is uniform over the alphabet — a modulo of raw bytes would bias
// toward the first 256%31 symbols, which for a guessable identifier is a real
// (if small) weakness.
func GenerateCode() (string, error) {
	var b strings.Builder
	b.Grow(CodeMaxLen)
	max := big.NewInt(int64(len(codeAlphabet)))
	for i := 0; i < CodeMaxLen; i++ {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", fmt.Errorf("referrals: generate code: %w", err)
		}
		b.WriteByte(codeAlphabet[n.Int64()])
	}
	return b.String(), nil
}

// NormalizeCode is the single definition of "the same code".
//
// It must be applied on EVERY path that stores or looks up a code, or the
// uniqueness check becomes a lie: "7kq4m" would pass a duplicate check against a
// stored "7KQ4M" and then resolve to whichever row a lookup happened to find.
func NormalizeCode(raw string) string {
	return strings.ToUpper(strings.TrimSpace(raw))
}

// ValidateCode checks an admin-supplied code's shape: 3-5 characters of A-Z0-9,
// already normalised. It accepts the FULL alphanumeric set, not the narrower one
// the generator draws from — see codeAllowed for why.
//
// It does NOT check uniqueness; that needs the database and lives in the service.
func ValidateCode(code string) error {
	if code == "" {
		return fmt.Errorf("referral code is required")
	}
	// Counted in runes: a multi-byte character would otherwise pass a byte-length
	// check and store a code longer than the UI can render.
	if n := len([]rune(code)); n < CodeMinLen || n > CodeMaxLen {
		return fmt.Errorf("referral code must be %d-%d characters, got %d", CodeMinLen, CodeMaxLen, n)
	}
	for _, r := range code {
		if !strings.ContainsRune(codeAllowed, r) {
			return fmt.Errorf(
				"referral code may only use A-Z and 0-9 (no spaces or punctuation); %q is not allowed",
				string(r))
		}
	}
	return nil
}
