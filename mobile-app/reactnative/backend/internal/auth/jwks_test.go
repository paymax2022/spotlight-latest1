package auth

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// rs256Fixture spins up an httptest server that serves a JWKS for a freshly
// generated RSA key, and returns helpers to sign tokens against that key.
type rs256Fixture struct {
	key  *rsa.PrivateKey
	kid  string
	srv  *httptest.Server
}

func newRS256Fixture(t *testing.T) *rs256Fixture {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	kid := "test-kid-1"

	jwks := map[string]any{
		"keys": []map[string]string{{
			"kty": "RSA",
			"kid": kid,
			"alg": "RS256",
			"use": "sig",
			"n":   base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
			"e":   base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
		}},
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(jwks)
	}))
	t.Cleanup(srv.Close)

	return &rs256Fixture{key: key, kid: kid, srv: srv}
}

// signRS256 builds and signs an RS256 JWT with the given header alg/kid and claims.
func (f *rs256Fixture) signRS256(t *testing.T, alg, kid string, claims Claims) string {
	t.Helper()
	header := map[string]string{"alg": alg, "typ": "JWT", "kid": kid}
	hb, _ := json.Marshal(header)
	cb, _ := json.Marshal(claims)
	signingInput := base64.RawURLEncoding.EncodeToString(hb) + "." +
		base64.RawURLEncoding.EncodeToString(cb)

	digest := sha256.Sum256([]byte(signingInput))
	sig, err := rsa.SignPKCS1v15(rand.Reader, f.key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return signingInput + "." + base64.RawURLEncoding.EncodeToString(sig)
}

func validClaims() Claims {
	return Claims{Sub: "user-123", Email: "u@example.com", Role: "authenticated",
		Exp: time.Now().Add(time.Hour).Unix()}
}

func TestJWKSVerify_OK(t *testing.T) {
	f := newRS256Fixture(t)
	v := NewJWKSVerifier(f.srv.URL)

	tok := f.signRS256(t, "RS256", f.kid, validClaims())
	c, err := v.Verify(tok)
	if err != nil {
		t.Fatalf("Verify: unexpected error: %v", err)
	}
	if c.Sub != "user-123" {
		t.Fatalf("Sub = %q, want user-123", c.Sub)
	}
	if c.Email != "u@example.com" {
		t.Fatalf("Email = %q, want u@example.com", c.Email)
	}
}

func TestJWKSVerify_WrongKid(t *testing.T) {
	f := newRS256Fixture(t)
	v := NewJWKSVerifier(f.srv.URL)

	tok := f.signRS256(t, "RS256", "unknown-kid", validClaims())
	_, err := v.Verify(tok)
	if !errors.Is(err, ErrSignature) {
		t.Fatalf("err = %v, want ErrSignature", err)
	}
}

func TestJWKSVerify_Expired(t *testing.T) {
	f := newRS256Fixture(t)
	v := NewJWKSVerifier(f.srv.URL)

	claims := validClaims()
	claims.Exp = time.Now().Add(-time.Minute).Unix()
	tok := f.signRS256(t, "RS256", f.kid, claims)

	_, err := v.Verify(tok)
	if !errors.Is(err, ErrExpired) {
		t.Fatalf("err = %v, want ErrExpired", err)
	}
}

func TestJWKSVerify_RejectsHS256Alg(t *testing.T) {
	f := newRS256Fixture(t)
	v := NewJWKSVerifier(f.srv.URL)

	// Header claims HS256 — must be rejected by the RS256-pinned verifier.
	tok := f.signRS256(t, "HS256", f.kid, validClaims())
	_, err := v.Verify(tok)
	if !errors.Is(err, ErrAlg) {
		t.Fatalf("err = %v, want ErrAlg", err)
	}
}

func TestJWKSVerify_TamperedSignature(t *testing.T) {
	f := newRS256Fixture(t)
	v := NewJWKSVerifier(f.srv.URL)

	tok := f.signRS256(t, "RS256", f.kid, validClaims())

	// Tamper with the signature BYTES, not its spelling. Flipping the final
	// base64 character is not enough: a 256-byte RS256 signature encodes to a
	// trailing group of 2 chars whose last char carries only 2 significant bits
	// (the low 4 are padding), and RawURLEncoding is not Strict, so 'A'->'B'
	// decodes to the identical signature and verification correctly succeeds.
	// That made this test fail ~25% of runs — whenever the signature's last byte
	// happened to land on a 'A'-encoding boundary.
	parts := strings.Split(tok, ".")
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		t.Fatalf("decode signature: %v", err)
	}
	sig[0] ^= 0x01
	bad := parts[0] + "." + parts[1] + "." + base64.RawURLEncoding.EncodeToString(sig)

	_, err = v.Verify(bad)
	if !errors.Is(err, ErrSignature) {
		t.Fatalf("err = %v, want ErrSignature", err)
	}
}

func TestJWKSVerify_Malformed(t *testing.T) {
	f := newRS256Fixture(t)
	v := NewJWKSVerifier(f.srv.URL)

	if _, err := v.Verify("not-a-jwt"); !errors.Is(err, ErrMalformed) {
		t.Fatalf("err = %v, want ErrMalformed", err)
	}
}
