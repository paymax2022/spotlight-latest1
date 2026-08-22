package middleware

import (
	"log"
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
)

// devEnv is the ONLY environment in which an unconfigured admin gate is allowed
// to pass traffic. Anything else - staging, production, or an unrecognised value -
// is treated as needing the gate.
const devEnv = "development"

var warnUnconfigured sync.Once

// RequireAdmin protects admin endpoints with the x-admin-api-key header.
//
// FAILS CLOSED. An empty expectedKey used to call c.Next() and allow EVERY admin
// request: the gate silently disappeared exactly when it was misconfigured, which
// is the worst possible moment for it to do so. Unsetting a variable should never
// widen access.
//
// The one exception is appEnv == "development", where an unset key keeps working
// so nobody has to invent one to run the stack locally - and it logs, loudly and
// once, so the state is visible rather than assumed. An unrecognised appEnv is
// treated as NOT development, so a typo or an unset APP_ENV errs toward refusing.
//
// 503 rather than 401 when unconfigured: the caller has done nothing wrong and no
// credential they could supply would help. 401 would invite them to retry with
// something, which is misleading.
func RequireAdmin(expectedKey string, appEnv string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if expectedKey == "" {
			if appEnv == devEnv {
				warnUnconfigured.Do(func() {
					log.Printf("[admin-auth] ADMIN_API_KEY is unset and APP_ENV=%s - admin endpoints are UNGATED. "+
						"This is allowed in development only; any other environment refuses these routes.", devEnv)
				})
				c.Next()
				return
			}
			log.Printf("[admin-auth] refusing %s %s: ADMIN_API_KEY is unset (APP_ENV=%q)",
				c.Request.Method, c.Request.URL.Path, appEnv)
			c.AbortWithStatusJSON(http.StatusServiceUnavailable,
				gin.H{"success": false, "error": "admin API is not configured"})
			return
		}
		if c.GetHeader("x-admin-api-key") != expectedKey {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthorized"})
			return
		}
		c.Next()
	}
}
