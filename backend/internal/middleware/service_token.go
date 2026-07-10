package middleware

import (
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// RequireServiceToken guards internal, service-to-service endpoints (e.g. the
// internal ledger API the separate trading service calls). It authenticates the
// caller with a shared Bearer service token compared in CONSTANT TIME to the
// configured expected value — this is NEVER a user JWT and never touches Supabase
// auth / RBAC.
//
// Fail-closed semantics:
//   - expected == "" (token unconfigured) → 503, so a mis-provisioned deployment
//     cannot silently accept every caller.
//   - missing/malformed Authorization header → 401.
//   - token mismatch → 401.
//
// The constant-time compare avoids leaking the token length/prefix through timing.
// Mirrors the Bearer-parsing shape of RequireAuthContext (auth_context.go) but
// deliberately shares NO code with it: a service token must never be accepted where
// a user token is expected, and vice-versa.
func RequireServiceToken(expected string) gin.HandlerFunc {
	expected = strings.TrimSpace(expected)
	return func(c *gin.Context) {
		if expected == "" {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "service_token_not_configured"})
			return
		}
		h := strings.TrimSpace(c.GetHeader("Authorization"))
		if !strings.HasPrefix(strings.ToLower(h), "bearer ") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing service token"})
			return
		}
		got := strings.TrimSpace(h[7:])
		if subtle.ConstantTimeCompare([]byte(got), []byte(expected)) != 1 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid service token"})
			return
		}
		c.Next()
	}
}
