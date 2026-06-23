package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

const secret = "test-secret-0123456789"

// sign builds an HS256 JWT for the given claims (test helper).
func sign(alg, secret string, claims map[string]any) string {
	hdr := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"` + alg + `","typ":"JWT"}`))
	pb, _ := json.Marshal(claims)
	pay := base64.RawURLEncoding.EncodeToString(pb)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(hdr + "." + pay))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return hdr + "." + pay + "." + sig
}

func TestVerifyValid(t *testing.T) {
	tok := sign("HS256", secret, map[string]any{"sub": "user-1", "exp": time.Now().Add(time.Hour).Unix()})
	c, err := Verify(tok, secret)
	if err != nil {
		t.Fatalf("Verify error: %v", err)
	}
	if c.Sub != "user-1" {
		t.Errorf("sub = %q, want user-1", c.Sub)
	}
}

func TestVerifyRejects(t *testing.T) {
	valid := sign("HS256", secret, map[string]any{"sub": "u", "exp": time.Now().Add(time.Hour).Unix()})

	cases := []struct {
		name  string
		token string
		want  error
	}{
		{"malformed", "not.a.jwt.token", ErrMalformed},
		{"bad signature", valid[:len(valid)-2] + "xx", ErrSignature},
		{"wrong secret", sign("HS256", "other-secret", map[string]any{"sub": "u", "exp": time.Now().Add(time.Hour).Unix()}), ErrSignature},
		{"expired", sign("HS256", secret, map[string]any{"sub": "u", "exp": time.Now().Add(-time.Minute).Unix()}), ErrExpired},
		{"wrong alg", sign("none", secret, map[string]any{"sub": "u"}), ErrAlg},
		{"missing sub", sign("HS256", secret, map[string]any{"exp": time.Now().Add(time.Hour).Unix()}), ErrNoSubject},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := Verify(tc.token, secret); err != tc.want {
				t.Errorf("err = %v, want %v", err, tc.want)
			}
		})
	}
}

func TestMiddlewareEnforcesWhenSecretSet(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(UserID(r.Context())))
	})
	h := Middleware(secret)(next)

	// No token → 401.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/crypto/assets", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("no-token status = %d, want 401", rec.Code)
	}

	// Valid token → 200 and the handler sees the user id.
	tok := sign("HS256", secret, map[string]any{"sub": "user-42", "exp": time.Now().Add(time.Hour).Unix()})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/crypto/assets", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Body.String() != "user-42" {
		t.Fatalf("auth'd req = %d %q, want 200 user-42", rec.Code, rec.Body.String())
	}

	// /healthz is always exempt.
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if rec.Code != http.StatusOK {
		t.Errorf("healthz status = %d, want 200", rec.Code)
	}
}

func TestMiddlewareDevFallback(t *testing.T) {
	var seen string
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { seen = UserID(r.Context()) })
	Middleware("")(next).ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/v1/crypto/assets", nil))
	if seen != "demo-user" {
		t.Errorf("dev fallback user = %q, want demo-user", seen)
	}
}
