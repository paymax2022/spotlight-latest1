package auth

import (
	"net/http"
	"strings"
)

// MiddlewareVerifier is like Middleware but takes a pluggable token verifier
// (e.g. the RS256 JWKSVerifier.Verify), so the storage of the signing key is
// abstracted. Same exemptions and dev-mode semantics as Middleware: when
// verify is nil it runs in DEV mode (single demo user).
func MiddlewareVerifier(verify func(string) (Claims, error)) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/healthz" || r.URL.Path == "/readyz" || r.URL.Path == "/metrics" ||
				strings.HasPrefix(r.URL.Path, "/api/v1/crypto/webhooks/") {
				next.ServeHTTP(w, r)
				return
			}
			if verify == nil {
				// Dev fallback only reachable when constructed with a nil verifier;
				// server wiring only uses this middleware with a real JWKS verifier.
				next.ServeHTTP(w, r.WithContext(withUser(r.Context(), "demo-user", "")))
				return
			}
			tok := bearer(r)
			if tok == "" {
				unauthorized(w, "Missing bearer token.")
				return
			}
			claims, err := verify(tok)
			if err != nil {
				unauthorized(w, "Invalid or expired token.")
				return
			}
			next.ServeHTTP(w, r.WithContext(withUser(r.Context(), claims.Sub, claims.Role)))
		})
	}
}
