package referrals

import (
	"strings"
	"testing"
)

// The complaint that started this: the code was 11 characters and unusable when
// read aloud. Length is the requirement, so it is asserted directly.
func TestGenerateCode_IsFiveCharactersFromTheSafeAlphabet(t *testing.T) {
	for i := 0; i < 200; i++ {
		code, err := GenerateCode()
		if err != nil {
			t.Fatalf("generate: %v", err)
		}
		if len([]rune(code)) != CodeMaxLen {
			t.Fatalf("code %q is %d characters, want %d", code, len([]rune(code)), CodeMaxLen)
		}
		if err := ValidateCode(code); err != nil {
			t.Fatalf("generated code %q fails its own validator: %v", code, err)
		}
	}
}

// A generator that repeats itself would collide constantly against the unique
// index and burn the retry budget. This is a smoke test for a stuck RNG, not a
// statistical claim.
func TestGenerateCode_DoesNotRepeatItself(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 500; i++ {
		c, err := GenerateCode()
		if err != nil {
			t.Fatalf("generate: %v", err)
		}
		seen[c] = true
	}
	if len(seen) < 495 {
		t.Errorf("only %d distinct codes in 500 draws — the generator is not random enough", len(seen))
	}
}

// Codes get read off a screen and typed back in. Characters that are misread as
// one another must not appear, or support absorbs the difference.
func TestGenerateCode_OmitsConfusableCharacters(t *testing.T) {
	for i := 0; i < 300; i++ {
		c, _ := GenerateCode()
		if n := strings.IndexAny(c, "OILSZ0152"); n >= 0 {
			t.Fatalf("code %q contains confusable %q", c, string(c[n]))
		}
	}
}

func TestNormalizeCode(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"  7kq4m  ", "7KQ4M"},
		{"7KQ4M", "7KQ4M"},
		{"jide1", "JIDE1"},
	} {
		if got := NormalizeCode(tc.in); got != tc.want {
			t.Errorf("NormalizeCode(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// Normalisation is what makes the duplicate check honest. If "7kq4m" did not
// fold to "7KQ4M", it would pass a uniqueness check against the stored code and
// then resolve to whichever row a lookup happened to hit.
func TestNormalizeCode_MakesTheDuplicateCheckCaseProof(t *testing.T) {
	if NormalizeCode("7kq4m") != NormalizeCode("7KQ4M") {
		t.Error("case variants of one code do not normalise together — duplicates would slip through")
	}
}

func TestValidateCode(t *testing.T) {
	for _, tc := range []struct {
		name, code string
		wantErr    bool
	}{
		{"five chars ok", "7KQ4M", false},
		{"three chars ok (minimum)", "ABC", false},
		{"empty rejected", "", true},
		{"too short", "AB", true},
		{"six chars rejected — the whole point", "ABCDEF", true},
		{"the old 11-char shape rejected", "R3F9A2B1C4D", true},
		{"lowercase rejected (normalise first)", "abcde", true},
		// A CHOSEN code may use the full alphanumeric set — SALES, GOLD and most
		// names would otherwise be unusable. Only GENERATED codes avoid these.
		{"confusable O allowed for a chosen code", "ABCDO", false},
		{"confusable 0 allowed for a chosen code", "ABCD0", false},
		{"a real word an admin would pick", "SALES", false},
		{"space rejected", "AB CD", true},
		{"punctuation rejected", "AB-CD", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateCode(tc.code)
			if tc.wantErr && err == nil {
				t.Errorf("ValidateCode(%q) accepted it; want rejection", tc.code)
			}
			if !tc.wantErr && err != nil {
				t.Errorf("ValidateCode(%q) = %v; want accepted", tc.code, err)
			}
		})
	}
}

// A multi-byte character passes a naive byte-length check while being one rune.
// Guarding in runes is what keeps a "5 character" code renderable.
func TestValidateCode_CountsRunesNotBytes(t *testing.T) {
	if err := ValidateCode("ABCDÉ"); err == nil {
		t.Error("accepted a non-alphabet multi-byte character")
	}
}
