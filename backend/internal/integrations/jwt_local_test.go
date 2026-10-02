package integrations_test

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"spotlight/backend/internal/integrations"
)

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return b
}

func signHS256(t *testing.T, secret string, claims map[string]any) string {
	t.Helper()
	head := b64(mustJSON(t, map[string]any{"alg": "HS256", "typ": "JWT"})) + "." + b64(mustJSON(t, claims))
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(head))
	return head + "." + b64(mac.Sum(nil))
}

func signES256(t *testing.T, priv *ecdsa.PrivateKey, kid string, claims map[string]any) string {
	t.Helper()
	head := b64(mustJSON(t, map[string]any{"alg": "ES256", "typ": "JWT", "kid": kid})) + "." + b64(mustJSON(t, claims))
	digest := sha256.Sum256([]byte(head))
	r, s, err := ecdsa.Sign(rand.Reader, priv, digest[:])
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	sig := append(r.FillBytes(make([]byte, 32)), s.FillBytes(make([]byte, 32))...)
	return head + "." + b64(sig)
}

func jwksServer(t *testing.T, pub *ecdsa.PublicKey, kid string) *httptest.Server {
	t.Helper()
	// pub.Bytes() is the uncompressed SEC-1 form: 0x04 || X(32) || Y(32).
	raw, err := pub.Bytes()
	if err != nil {
		t.Fatalf("pub.Bytes: %v", err)
	}
	jwks := map[string]any{"keys": []map[string]any{{
		"kty": "EC", "crv": "P-256", "kid": kid, "alg": "ES256", "use": "sig",
		"x": b64(raw[1:33]), "y": b64(raw[33:65]),
	}}}
	mux := http.NewServeMux()
	mux.HandleFunc("/auth/v1/.well-known/jwks.json", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(jwks)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func validClaims() map[string]any {
	return map[string]any{
		"sub":   "6053f241-b4dd-4566-a809-aae0e6702510",
		"email": "admin@spotlight.internal",
		"exp":   float64(time.Now().Add(time.Hour).Unix()),
		"role":  "authenticated",
	}
}

func TestVerifyLocalJWT_HS256(t *testing.T) {
	c := integrations.NewSupabaseRestClient("", "")
	c.EnableLocalJWTVerify("test-secret")
	info, err := c.AuthUser(signHS256(t, "test-secret", validClaims()))
	if err != nil {
		t.Fatalf("valid token rejected: %v", err)
	}
	if info["id"] != "6053f241-b4dd-4566-a809-aae0e6702510" {
		t.Fatalf("id mismatch: %v", info["id"])
	}
	if info["email"] != "admin@spotlight.internal" {
		t.Fatalf("email mismatch: %v", info["email"])
	}
}

func TestVerifyLocalJWT_ES256ViaJWKS(t *testing.T) {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}
	srv := jwksServer(t, &priv.PublicKey, "kid-1")
	c := integrations.NewSupabaseRestClient(srv.URL, "")
	c.EnableLocalJWTVerify("")
	info, err := c.AuthUser(signES256(t, priv, "kid-1", validClaims()))
	if err != nil {
		t.Fatalf("valid ES256 token rejected: %v", err)
	}
	if info["id"] != "6053f241-b4dd-4566-a809-aae0e6702510" {
		t.Fatalf("id mismatch: %v", info["id"])
	}
}

func TestVerifyLocalJWT_ES256WrongKey(t *testing.T) {
	priv, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	other, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	srv := jwksServer(t, &other.PublicKey, "kid-1") // jwks carries a different key
	c := integrations.NewSupabaseRestClient(srv.URL, "")
	c.EnableLocalJWTVerify("")
	if _, err := c.AuthUser(signES256(t, priv, "kid-1", validClaims())); !errors.Is(err, integrations.ErrTokenInvalid) {
		t.Fatalf("want ErrTokenInvalid, got %v", err)
	}
}

func TestVerifyLocalJWT_ES256UnknownKid(t *testing.T) {
	priv, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	srv := jwksServer(t, &priv.PublicKey, "kid-1")
	c := integrations.NewSupabaseRestClient(srv.URL, "")
	c.EnableLocalJWTVerify("")
	if _, err := c.AuthUser(signES256(t, priv, "kid-other", validClaims())); !errors.Is(err, integrations.ErrTokenInvalid) {
		t.Fatalf("want ErrTokenInvalid, got %v", err)
	}
}

func TestVerifyLocalJWT_Rejects(t *testing.T) {
	secret := "test-secret"
	cases := map[string]func(t *testing.T) string{
		"expired": func(t *testing.T) string {
			t.Helper()
			return signHS256(t, secret, map[string]any{"sub": "u1", "exp": float64(time.Now().Add(-time.Hour).Unix())})
		},
		"wrong secret": func(t *testing.T) string {
			t.Helper()
			return signHS256(t, "other-secret", validClaims())
		},
		"missing sub": func(t *testing.T) string {
			t.Helper()
			return signHS256(t, secret, map[string]any{"exp": float64(time.Now().Add(time.Hour).Unix())})
		},
		"not jwt": func(t *testing.T) string { t.Helper(); return "not-a-jwt" },
		"bad b64": func(t *testing.T) string { t.Helper(); return "!!!.@@@.###" },
		"HS256 without secret": func(t *testing.T) string {
			t.Helper()
			return signHS256(t, secret, validClaims()) // client below has no secret
		},
		"tampered": func(t *testing.T) string {
			t.Helper()
			tok := []byte(signHS256(t, secret, validClaims()))
			p := len(tok)/2 - 1
			if tok[p] == 'a' {
				tok[p] = 'b'
			} else {
				tok[p] = 'a'
			}
			return string(tok)
		},
	}
	for name, mk := range cases {
		t.Run(name, func(t *testing.T) {
			c := integrations.NewSupabaseRestClient("", "")
			if name == "HS256 without secret" {
				c.EnableLocalJWTVerify("")
			} else {
				c.EnableLocalJWTVerify(secret)
			}
			if _, err := c.AuthUser(mk(t)); !errors.Is(err, integrations.ErrTokenInvalid) {
				t.Fatalf("want ErrTokenInvalid, got %v", err)
			}
		})
	}
}

func TestVerifyLocalJWT_FlagOffKeepsRemote(t *testing.T) {
	// Without EnableLocalJWTVerify, AuthUser must take the remote path — with
	// an empty baseURL that returns "not configured", not ErrTokenInvalid,
	// proving the local path was not taken.
	c := integrations.NewSupabaseRestClient("", "")
	tok := signHS256(t, "any", validClaims())
	if _, err := c.AuthUser(tok); errors.Is(err, integrations.ErrTokenInvalid) || err == nil {
		t.Fatalf("remote path not taken: %v", err)
	}
}
