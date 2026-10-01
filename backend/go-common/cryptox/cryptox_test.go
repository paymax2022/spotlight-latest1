package cryptox_test

import (
	"encoding/hex"
	"testing"

	"spotlight/backend/go-common/cryptox"
)

func TestRandHex(t *testing.T) {
	h := cryptox.RandHex(16)
	if len(h) != 32 {
		t.Fatalf("RandHex(16) len = %d, want 32", len(h))
	}
	if _, err := hex.DecodeString(h); err != nil {
		t.Fatalf("RandHex not hex: %v", err)
	}
	a, b := cryptox.RandHex(16), cryptox.RandHex(16)
	if a == b {
		t.Fatal("two RandHex calls returned identical tokens")
	}
}

func TestToken(t *testing.T) {
	if got := cryptox.Token(); len(got) != 32 {
		t.Fatalf("Token len = %d, want 32", len(got))
	}
}

func TestTokenB64(t *testing.T) {
	tok := cryptox.TokenB64(32)
	if tok == "" || len(tok) < 40 {
		t.Fatalf("TokenB64 too short: %q", tok)
	}
	for _, r := range tok {
		if r == '+' || r == '/' || r == '=' {
			t.Fatalf("TokenB64 not URL-safe: %q", tok)
		}
	}
}

func TestHMACSHA256Hex_Deterministic(t *testing.T) {
	a := cryptox.HMACSHA256Hex("secret", "cid", "123", "nonce")
	b := cryptox.HMACSHA256Hex("secret", "cid", "123", "nonce")
	if a != b {
		t.Fatal("HMAC not deterministic")
	}
	if cryptox.HMACSHA256Hex("secret", "cid", "124", "nonce") == a {
		t.Fatal("different parts gave same signature")
	}
	if cryptox.HMACSHA256Hex("other", "cid", "123", "nonce") == a {
		t.Fatal("different secret gave same signature")
	}
}

func TestHMACSHA256Hex_JoinsWithPipe(t *testing.T) {
	// Must equal mac over "a|b|c" — the credential sign() shape.
	joined := cryptox.HMACSHA256Hex("s", "a", "b", "c")
	if len(joined) != 64 {
		t.Fatalf("HMACSHA256Hex len = %d, want 64", len(joined))
	}
}

func TestVerifyHMACSHA512(t *testing.T) {
	payload := []byte(`{"event":"charge.success"}`)
	sig := cryptox.HMACSHA512Hex("whsec", payload)
	if !cryptox.VerifyHMACSHA512("whsec", payload, sig) {
		t.Fatal("valid signature rejected")
	}
	if cryptox.VerifyHMACSHA512("whsec", payload, sig[:len(sig)-1]+"0") {
		t.Fatal("tampered signature accepted")
	}
	if cryptox.VerifyHMACSHA512("wrong", payload, sig) {
		t.Fatal("wrong secret accepted")
	}
}

func TestSHA256Hex(t *testing.T) {
	h := cryptox.SHA256Hex("hello")
	if len(h) != 64 {
		t.Fatalf("SHA256Hex len = %d", len(h))
	}
	if h != cryptox.SHA256Hex("hello") {
		t.Fatal("SHA256Hex not deterministic")
	}
}

func TestFingerprint(t *testing.T) {
	f := cryptox.Fingerprint("sk_live_abc")
	if len(f) != 12 {
		t.Fatalf("Fingerprint len = %d, want 12", len(f))
	}
	if f != cryptox.Fingerprint("sk_live_abc") {
		t.Fatal("Fingerprint not deterministic")
	}
}

func TestConstantTimeEqual(t *testing.T) {
	if !cryptox.ConstantTimeEqual("abc", "abc") {
		t.Fatal("equal strings rejected")
	}
	if cryptox.ConstantTimeEqual("abc", "abd") {
		t.Fatal("different strings accepted")
	}
	if cryptox.ConstantTimeEqual("abc", "abcd") {
		t.Fatal("different lengths accepted")
	}
}

func TestAPIKey(t *testing.T) {
	k := cryptox.APIKey("sk_test")
	prefix, secret, ok := cryptox.ParseAPIKey(k)
	if !ok {
		t.Fatalf("ParseAPIKey failed on %q", k)
	}
	if prefix != "sk_test" {
		t.Fatalf("prefix = %q, want sk_test", prefix)
	}
	if len(secret) < 40 {
		t.Fatalf("secret too short: %d chars", len(secret))
	}
}

func TestParseAPIKey_Bad(t *testing.T) {
	for _, k := range []string{"", "noseparator", "_x", "x_"} {
		if _, _, ok := cryptox.ParseAPIKey(k); ok {
			t.Fatalf("ParseAPIKey(%q) should fail", k)
		}
	}
}

func TestRandUint(t *testing.T) {
	if got := cryptox.RandUint(0); got != 0 {
		t.Fatalf("RandUint(0) = %d", got)
	}
	seen := map[uint64]bool{}
	for range 1000 {
		v := cryptox.RandUint(7)
		if v >= 7 {
			t.Fatalf("RandUint(7) = %d out of range", v)
		}
		seen[v] = true
	}
	if len(seen) < 5 {
		t.Fatalf("RandUint(7) suspicious distribution: %d distinct", len(seen))
	}
}
