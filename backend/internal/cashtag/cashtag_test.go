package cashtag

import (
	"errors"
	"strings"
	"testing"
)

// These tests exercise only the pure, DB-free logic in the package:
// Normalize and Validate (which in turn covers format validation, the
// reserved-word list, and the impersonation guard). Claim/Resolve/HandleFor
// require a *pgxpool.Pool with no interface seam or in-memory fake, so they are
// intentionally left uncovered here.

func TestNormalize(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"plain lowercased", "Plain", "plain"},
		{"already normalized", "no_at", "no_at"},
		{"strips single leading at", "@John", "john"},
		{"trims surrounding whitespace then at", "  @UPPER  ", "upper"},
		{"mixed case", "MiXeD", "mixed"},
		{"lone at becomes empty", "@", ""},
		{"empty stays empty", "", ""},
		{"only whitespace becomes empty", "   ", ""},
		{"strips only one at", "@@x", "@x"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Normalize(tc.in); got != tc.want {
				t.Fatalf("Normalize(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

// formatErr is a marker used in the Validate table to mean "a non-sentinel
// format error is expected" (the package returns a plain fmt.Errorf there).
var formatErr = errors.New("marker: format error")

func TestValidate(t *testing.T) {
	// A 30-char handle: 1 leading alnum + 29 trailing = 30 total (the max).
	max30 := "a" + strings.Repeat("1", 29)
	// A 31-char handle: 1 + 30 = 31 total (one over the max).
	over31 := "a" + strings.Repeat("1", 30)

	cases := []struct {
		name string
		in   string
		want error // nil = valid; formatErr = format rejection; else a sentinel
	}{
		// ---- valid handles ----
		{"simple valid", "alice123", nil},
		{"underscore valid", "bob_smith", nil},
		{"min length 3", "abc", nil},
		{"max length 30", max30, nil},
		{"digits and letters", "jane99", nil},
		{"case-insensitive valid (normalizes to lower)", "AliceZ", nil},
		{"strips at then valid", "@carol_x", nil},
		// Extending a SHORT reserved word (len < 5) is allowed: "root" is only
		// 4 chars, so the len(r) >= 5 prefix gate does not fire.
		{"extends short reserved word is allowed", "rootbeer", nil},

		// ---- format rejections ----
		{"too short 2 chars", "ab", formatErr},
		{"empty", "", formatErr},
		{"too long 31 chars", over31, formatErr},
		{"leading underscore", "_hello", formatErr},
		{"leading digit is fine but space is not", "john doe", formatErr},
		{"disallowed punctuation", "hi!", formatErr},
		{"hyphen not allowed", "a-b-c", formatErr},

		// ---- reserved-word rejections (checked before impersonation) ----
		{"reserved admin", "admin", ErrReserved},
		{"reserved paymax", "paymax", ErrReserved},
		{"reserved via normalization (@Admin)", "@Admin", ErrReserved},
		{"reserved verified", "verified", ErrReserved},
		{"reserved payments", "payments", ErrReserved},

		// ---- impersonation guard ----
		// Prefix-padding a reserved word of len >= 5.
		{"impersonation prefix paymax_official", "paymax_official", ErrImpersonation},
		{"impersonation prefix admins (admin is len 5)", "admins", ErrImpersonation},
		// Underscore-splitting that strips down to an exact reserved word.
		{"impersonation strip to paymax", "p_a_y_m_a_x", ErrImpersonation},
		// Exact-strip branch has no len gate, so even a len-3 reserved word
		// ("ajo") is caught when stripping underscores yields it exactly.
		{"impersonation strip to short reserved ajo", "a_j_o", ErrImpersonation},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := Validate(tc.in)
			switch {
			case tc.want == nil:
				if err != nil {
					t.Fatalf("Validate(%q) = %v, want nil", tc.in, err)
				}
			case errors.Is(tc.want, formatErr):
				if err == nil {
					t.Fatalf("Validate(%q) = nil, want a format error", tc.in)
				}
				// Must NOT be one of the semantic sentinels.
				if errors.Is(err, ErrReserved) || errors.Is(err, ErrImpersonation) {
					t.Fatalf("Validate(%q) = %v, want a plain format error, not a sentinel", tc.in, err)
				}
			default:
				if !errors.Is(err, tc.want) {
					t.Fatalf("Validate(%q) = %v, want %v", tc.in, err, tc.want)
				}
			}
		})
	}
}

// TestValidateReservedPrecedence pins the ordering guarantee: an exact reserved
// word that would ALSO match the impersonation prefix rule is reported as
// ErrReserved (the reserved check runs first), never ErrImpersonation.
func TestValidateReservedPrecedence(t *testing.T) {
	// "verified" is in the reserved set and also has prefix "verify" (len 6),
	// which would otherwise trip the impersonation guard.
	if err := Validate("verified"); !errors.Is(err, ErrReserved) {
		t.Fatalf("Validate(\"verified\") = %v, want ErrReserved", err)
	}
}

// TestValidateNormalizesBeforeChecking confirms Validate applies Normalize, so
// an uppercase, at-prefixed, whitespace-padded reserved handle is still caught.
func TestValidateNormalizesBeforeChecking(t *testing.T) {
	if err := Validate("  @SUPPORT  "); !errors.Is(err, ErrReserved) {
		t.Fatalf("Validate(\"  @SUPPORT  \") = %v, want ErrReserved", err)
	}
}
