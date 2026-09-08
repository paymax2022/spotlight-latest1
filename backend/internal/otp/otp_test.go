package otp

import (
	"strings"
	"testing"
)

// A generator that cannot produce a leading zero silently shortens one code in
// ten. The bug is invisible in casual testing — nine out of ten codes look
// right — and shows up as users unable to enter what they were sent.
func TestGeneratePreservesLeadingZeros(t *testing.T) {
	const runs = 20000
	sawLeadingZero := false
	for i := 0; i < runs; i++ {
		code, err := Generate(6)
		if err != nil {
			t.Fatalf("generate: %v", err)
		}
		if len(code) != 6 {
			t.Fatalf("code %q has length %d, want 6", code, len(code))
		}
		if strings.Trim(code, "0123456789") != "" {
			t.Fatalf("code %q contains a non-digit", code)
		}
		if code[0] == '0' {
			sawLeadingZero = true
		}
	}
	if !sawLeadingZero {
		t.Errorf("no leading-zero code in %d draws — the generator is dropping them (expected ~%d)", runs, runs/10)
	}
}

// Not a randomness proof — it is a smoke test that the source is not stuck or
// skewed. A generator returning a constant, or one digit far more often than the
// rest, fails here.
func TestGenerateDigitsAreRoughlyUniform(t *testing.T) {
	const runs = 20000
	const length = 6
	var counts [10]int
	for i := 0; i < runs; i++ {
		code, err := Generate(length)
		if err != nil {
			t.Fatalf("generate: %v", err)
		}
		for _, ch := range code {
			counts[ch-'0']++
		}
	}
	total := runs * length
	expected := total / 10
	// ±20% is wide enough never to flake and narrow enough to catch a real skew.
	low, high := expected*8/10, expected*12/10
	for d, n := range counts {
		if n < low || n > high {
			t.Errorf("digit %d appeared %d times, want between %d and %d", d, n, low, high)
		}
	}
}

func TestGenerateRejectsAbsurdLengths(t *testing.T) {
	for _, n := range []int{-1, 0, 3, 11, 64} {
		if _, err := Generate(n); err != ErrInvalidLength {
			t.Errorf("Generate(%d) error = %v, want ErrInvalidLength", n, err)
		}
	}
}

// The pepper is the whole reason the digest is not reversible. If the same code
// hashed under two peppers collides, it is not being used.
func TestHashDependsOnThePepper(t *testing.T) {
	a := Hash("482913", []byte("pepper-one"))
	b := Hash("482913", []byte("pepper-two"))
	if a == b {
		t.Fatal("hash ignored the pepper — a database dump would be reversible by rainbow table")
	}
	if a != Hash("482913", []byte("pepper-one")) {
		t.Fatal("hash is not deterministic")
	}
	if a == Hash("482914", []byte("pepper-one")) {
		t.Fatal("different codes produced the same digest")
	}
}

func TestEqual(t *testing.T) {
	h := Hash("123456", []byte("p"))
	if !Equal(h, Hash("123456", []byte("p"))) {
		t.Error("equal digests compared unequal")
	}
	if Equal(h, Hash("123457", []byte("p"))) {
		t.Error("different digests compared equal")
	}
	if Equal(h, "") {
		t.Error("empty string compared equal to a digest")
	}
}

func TestPurposeAllowlist(t *testing.T) {
	for _, p := range []string{PurposeLogin, PurposeVerifyEmail, PurposePasswordReset} {
		if !IsAllowedPurpose(p) {
			t.Errorf("%q should be allowed", p)
		}
	}
	// An unchecked purpose is a free reset of the per-address send budget: each
	// distinct string is its own key.
	for _, p := range []string{"", "LOGIN", "anything", "login ", "../login"} {
		if IsAllowedPurpose(p) {
			t.Errorf("%q must not be allowed", p)
		}
	}
}

func TestNormalizeEmail(t *testing.T) {
	// Issue and Verify must derive the same key or a code can never be redeemed.
	for _, in := range []string{"User@Example.com", "  user@example.com ", "USER@EXAMPLE.COM"} {
		if got := normalizeEmail(in); got != "user@example.com" {
			t.Errorf("normalizeEmail(%q) = %q", in, got)
		}
	}
}
