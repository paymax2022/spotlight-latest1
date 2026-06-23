// Package auth verifies the bearer token the mobile client attaches (a Supabase
// HS256 JWT) and threads the authenticated user id through request context.
//
// Stdlib-only (crypto/hmac + crypto/sha256), so the service stays dependency-free
// and the offline build keeps working. For Supabase projects using RS256/JWKS,
// swap Verify for a JWKS-fetching variant behind the same Middleware.
package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

// Claims is the subset of the JWT payload the service needs.
type Claims struct {
	Sub   string `json:"sub"`
	Exp   int64  `json:"exp"`
	Email string `json:"email"`
	Role  string `json:"role"`
}

// Verification errors (distinct so callers/tests can assert on cause).
var (
	ErrMalformed = errors.New("malformed token")
	ErrAlg       = errors.New("unexpected signing algorithm")
	ErrSignature = errors.New("invalid signature")
	ErrExpired   = errors.New("token expired")
	ErrNoSubject = errors.New("missing subject")
)

// Verify checks an HS256 JWT against the shared secret and returns its claims.
// The algorithm is pinned to HS256 to prevent "alg" confusion / "none" attacks.
func Verify(token, secret string) (Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return Claims{}, ErrMalformed
	}

	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return Claims{}, ErrMalformed
	}
	var header struct {
		Alg string `json:"alg"`
	}
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return Claims{}, ErrMalformed
	}
	if header.Alg != "HS256" {
		return Claims{}, ErrAlg
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(parts[0] + "." + parts[1]))
	expected := mac.Sum(nil)
	got, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return Claims{}, ErrMalformed
	}
	if !hmac.Equal(expected, got) {
		return Claims{}, ErrSignature
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return Claims{}, ErrMalformed
	}
	var c Claims
	if err := json.Unmarshal(payloadBytes, &c); err != nil {
		return Claims{}, ErrMalformed
	}
	if c.Exp != 0 && time.Now().Unix() >= c.Exp {
		return Claims{}, ErrExpired
	}
	if c.Sub == "" {
		return Claims{}, ErrNoSubject
	}
	return c, nil
}

// ── Request context ───────────────────────────────────────────────────────────

type ctxKey struct{}

func withUser(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, ctxKey{}, id)
}

// UserID returns the authenticated user id (empty if unauthenticated).
func UserID(ctx context.Context) string {
	v, _ := ctx.Value(ctxKey{}).(string)
	return v
}

// ── Middleware ────────────────────────────────────────────────────────────────

// Middleware verifies the bearer token and injects the user id into context.
//   - /healthz is always exempt.
//   - When secret == "" (no SUPABASE_JWT_SECRET configured) it runs in DEV mode:
//     requests pass through as a single "demo-user" so the mock works locally.
//     Set the secret in any real environment to enforce authentication.
func Middleware(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/healthz" {
				next.ServeHTTP(w, r)
				return
			}
			if secret == "" {
				next.ServeHTTP(w, r.WithContext(withUser(r.Context(), "demo-user")))
				return
			}
			tok := bearer(r)
			if tok == "" {
				unauthorized(w, "Missing bearer token.")
				return
			}
			claims, err := Verify(tok, secret)
			if err != nil {
				unauthorized(w, "Invalid or expired token.")
				return
			}
			next.ServeHTTP(w, r.WithContext(withUser(r.Context(), claims.Sub)))
		})
	}
}

func bearer(r *http.Request) string {
	const prefix = "Bearer "
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(h, prefix) {
		return strings.TrimSpace(h[len(prefix):])
	}
	return ""
}

func unauthorized(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"type": "authentication", "code": "authentication", "message": msg,
	})
}
